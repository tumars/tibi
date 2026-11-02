//! Tibi Core（sidecar）的进程管理与 JSON-RPC 转发（06 §1、05 §3）。
//!
//! 协议（每行一条 JSON，stdout 只给协议，日志走 stderr）：
//! - 壳 → Core：`{"jsonrpc":"2.0","id":<u64>,"method":"…","params":{…}}`，Core 回 `{"jsonrpc":"2.0","id":<u64>,"result":…}` 或 `error`。
//! - Core → 壳 事件：`{"jsonrpc":"2.0","method":"event","params":{"event":"task.done","data":{…}}}`（没有 id）→ 转成 Tauri 事件 `core_event`。
//! - Core → 壳 反向请求（密钥）：`{"jsonrpc":"2.0","id":"h-<n>","method":"secret.get","params":{"ref":"…"}}`，
//!   壳查密钥存储后回 `{"jsonrpc":"2.0","id":"h-<n>","result":{"secret":"…"}}`（没有就 `{"secret":null}`）。
//!   这样 API Key 只在壳的密钥存储里（keys.rs），Core 按需取、只留内存，不经过 WebView，也不进数据库和日志。
//!
//! 启动顺序：先找随包的 sidecar（`tibi-core` 同目录 / `binaries/tibi-core-<triple>`），
//! 没有就（开发）用 `node ../../packages/core-node/dist/tibi-core.js`。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub struct CoreProcess {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
    seq: AtomicU64,
    started_at: Mutex<Instant>,
    app: AppHandle,
}

impl CoreProcess {
    pub fn new(app: AppHandle) -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            seq: AtomicU64::new(1),
            started_at: Mutex::new(Instant::now()),
            app,
        }
    }

    fn db_path(&self) -> PathBuf {
        let dir = self.app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".tibi"));
        let _ = std::fs::create_dir_all(&dir);
        dir.join("app.db")
    }

    fn dict_path(&self) -> Option<PathBuf> {
        // 随包资源 dict.db；开发时也接受仓库 data/ecdict/dict.db
        if let Ok(p) = self.app.path().resolve("dict.db", tauri::path::BaseDirectory::Resource) {
            if p.exists() {
                return Some(p);
            }
        }
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../data/ecdict/dict.db");
        if dev.exists() {
            return Some(dev);
        }
        None
    }

    /// 找 sidecar：随包二进制 → 开发时的 node 脚本
    fn command(&self) -> Result<Command, String> {
        let exe_name = if cfg!(windows) { "tibi-core.exe" } else { "tibi-core" };
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let p = dir.join(exe_name);
                if p.exists() {
                    return Ok(Command::new(p));
                }
            }
        }
        let triple = tauri::utils::platform::target_triple().unwrap_or_default();
        let dev_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("tibi-core-{triple}{}", if cfg!(windows) { ".exe" } else { "" }));
        if dev_bin.exists() {
            return Ok(Command::new(dev_bin));
        }
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/core-node/dist/tibi-core.js");
        if script.exists() {
            let mut c = Command::new("node");
            c.arg(script);
            return Ok(c);
        }
        Err("找不到 Tibi Core。先运行 pnpm --filter @tibi/core-node build".into())
    }

    pub fn start(&self) -> Result<(), String> {
        let mut cmd = self.command()?;
        cmd.arg("--stdio").arg("--db").arg(self.db_path());
        if let Some(d) = self.dict_path() {
            cmd.arg("--dict").arg(d);
        }
        cmd.env("TIBI_VERSION", self.app.package_info().version.to_string());
        // OCR 的 worker 和 wasm 随安装包放在 resources/ocr/（scripts/sidecar.mjs 拷进去）
        if let Ok(r) = self.app.path().resource_dir() {
            cmd.env("TIBI_RESOURCE_DIR", r.join("ocr"));
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("启动 Tibi Core 失败：{e}"))?;
        let stdout = child.stdout.take().ok_or("拿不到 Core 的 stdout")?;
        let stdin = child.stdin.take().ok_or("拿不到 Core 的 stdin")?;
        *self.stdin.lock().unwrap() = Some(stdin);
        *self.child.lock().unwrap() = Some(child);
        *self.started_at.lock().unwrap() = Instant::now();

        let pending = self.pending.clone();
        let app = self.app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(line) else {
                    log::warn!("Core 输出了不是 JSON 的一行：{line}");
                    continue;
                };
                match v.get("method").and_then(Value::as_str) {
                    Some("event") => {
                        if let Some(params) = v.get("params") {
                            let _ = app.emit("core_event", params.clone());
                        }
                    }
                    Some("secret.get") => {
                        // 反向请求：只给 sidecar，WebView 不能调
                        let id = v.get("id").cloned().unwrap_or(Value::Null);
                        let r = v.get("params").and_then(|p| p.get("ref")).and_then(Value::as_str).unwrap_or("");
                        let secret = crate::keys::get(r).ok().flatten();
                        let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "secret": secret } });
                        if let Some(core) = app.try_state::<Arc<CoreProcess>>() {
                            core.write_line(&reply.to_string());
                        }
                    }
                    Some(other) => log::warn!("Core 发来不认识的请求：{other}"),
                    None => {
                        if let Some(id) = v.get("id").and_then(Value::as_u64) {
                            if let Some(tx) = pending.lock().unwrap().remove(&id) {
                                let _ = tx.send(v);
                            }
                        }
                    }
                }
            }
            log::warn!("Tibi Core 的 stdout 结束了");
            let _ = app.emit("core_event", json!({ "event": "core.exited", "data": {} }));
        });
        Ok(())
    }

    fn write_line(&self, line: &str) {
        if let Some(stdin) = self.stdin.lock().unwrap().as_mut() {
            let _ = stdin.write_all(line.as_bytes());
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
        }
    }

    /// 发请求并等响应（阻塞，调用方放在 spawn_blocking 里）
    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Value {
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let req = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.write_line(&req.to_string());
        match rx.recv_timeout(timeout) {
            Ok(v) => v,
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": "Tibi Core 没有回应", "data": { "code": "busy" } } })
            }
        }
    }

    pub fn status(&self) -> Value {
        let pid = self.child.lock().unwrap().as_ref().map(|c| c.id()).unwrap_or(0);
        let uptime = self.started_at.lock().unwrap().elapsed().as_millis() as u64;
        json!({ "pid": pid, "uptime_ms": uptime })
    }

    pub fn restart(&self) -> Result<(), String> {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        *self.stdin.lock().unwrap() = None;
        self.pending.lock().unwrap().clear();
        self.start()
    }

    pub fn stop(&self) {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

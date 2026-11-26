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

use crate::lock_or_recover;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const STDERR_TAIL_LIMIT: usize = 20;

fn core_exited_error(id: u64, reason: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32000,
            "message": reason,
            "data": { "code": "core_exited" }
        }
    })
}

fn format_exit_reason(tail: &[String]) -> String {
    let picked = tail
        .iter()
        .find(|line| {
            line.starts_with("TypeError:")
                || line.starts_with("Error:")
                || line.starts_with("ReferenceError:")
                || line.starts_with("SyntaxError:")
                || line.contains("Error:")
        })
        .or_else(|| tail.last());
    match picked {
        Some(line) => {
            let trimmed = line.trim();
            if trimmed.chars().count() > 240 {
                let short: String = trimmed.chars().take(240).collect();
                format!("{short}…")
            } else {
                trimmed.to_string()
            }
        }
        None => "Tibi Core 异常退出".to_string(),
    }
}

type PendingMap = Arc<Mutex<HashMap<u64, (u64, mpsc::Sender<Value>)>>>;

pub struct CoreProcess {
    lifecycle: Mutex<()>,
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<(u64, std::process::ChildStdin)>>>,
    pending: PendingMap,
    seq: AtomicU64,
    started_at: Mutex<Instant>,
    generation: Arc<Mutex<u64>>,
    exit_reason: Arc<Mutex<Option<String>>>,
    fatal_db_error: Mutex<Option<String>>,
    app: AppHandle,
}

impl CoreProcess {
    pub fn new(app: AppHandle) -> Self {
        Self {
            lifecycle: Mutex::new(()),
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            seq: AtomicU64::new(1),
            started_at: Mutex::new(Instant::now()),
            generation: Arc::new(Mutex::new(0)),
            exit_reason: Arc::new(Mutex::new(None)),
            fatal_db_error: Mutex::new(None),
            app,
        }
    }

    fn data_dir(&self) -> PathBuf {
        let dir = self.app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".tibi"));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    fn db_path(&self) -> PathBuf {
        self.data_dir().join("app.db")
    }

    fn log_path(&self) -> PathBuf {
        self.data_dir().join("core.log")
    }

    fn dict_path(&self) -> Option<PathBuf> {
        // 随包资源 dict.db；开发时也接受仓库 data/ecdict/dict.db。空文件是让 tauri-build 编过的占位，不算
        let usable = |p: &PathBuf| std::fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false);
        if let Ok(p) = self.app.path().resolve("dict.db", tauri::path::BaseDirectory::Resource) {
            if usable(&p) {
                return Some(p);
            }
        }
        #[cfg(debug_assertions)]
        {
            let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../data/ecdict/dict.db");
            if usable(&dev) {
                return Some(dev);
            }
        }
        None
    }

    /// 找 sidecar：随包二进制 →（仅开发模式）本地构建二进制 / node 脚本
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
        #[cfg(debug_assertions)]
        {
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
        }
        Err("找不到 Tibi Core。先运行 pnpm --filter @tibi/core-node build".into())
    }

    pub fn start(&self) -> Result<(), String> {
        let _life = lock_or_recover(&self.lifecycle);
        self.start_locked()
    }

    fn start_locked(&self) -> Result<(), String> {
        if let Some(fatal) = lock_or_recover(&self.fatal_db_error).clone() {
            *lock_or_recover(&self.exit_reason) = Some(fatal.clone());
            return Err(fatal);
        }
        let gen = {
            let mut g = lock_or_recover(&self.generation);
            *g += 1;
            *lock_or_recover(&self.exit_reason) = None;
            *g
        };
        let mut cmd = self.command()?;
        cmd.arg("--stdio").arg("--db").arg(self.db_path());
        #[cfg(feature = "app-store")]
        cmd.arg("--no-mcp");
        if let Some(d) = self.dict_path() {
            cmd.arg("--dict").arg(d);
        }
        cmd.env("TIBI_VERSION", self.app.package_info().version.to_string());
        // OCR 的 worker 和 wasm 随安装包放在 resources/ocr/（scripts/sidecar.mjs 拷进去）
        if let Ok(r) = self.app.path().resource_dir() {
            cmd.env("TIBI_RESOURCE_DIR", r.join("ocr"));
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("启动 Tibi Core 失败：{e}");
                *lock_or_recover(&self.exit_reason) = Some(msg.clone());
                return Err(msg);
            }
        };
        let stdout = child.stdout.take().ok_or("拿不到 Core 的 stdout")?;
        let stdin = child.stdin.take().ok_or("拿不到 Core 的 stdin")?;
        let stderr = child.stderr.take().ok_or("拿不到 Core 的 stderr")?;
        *lock_or_recover(&self.stdin) = Some((gen, stdin));
        *lock_or_recover(&self.child) = Some(child);
        *lock_or_recover(&self.started_at) = Instant::now();

        // 捕获 stderr 到应用数据目录 core.log，并保留最后若干行，方便崩溃时立刻告诉界面原因
        let log_path = self.log_path();
        let stderr_handle = std::thread::spawn(move || {
            let mut log_file = std::fs::File::create(&log_path).ok();
            let mut tail = VecDeque::with_capacity(STDERR_TAIL_LIMIT);
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                log::warn!("[tibi-core] {line}");
                if let Some(f) = log_file.as_mut() {
                    let _ = writeln!(f, "{line}");
                    let _ = f.flush();
                }
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    if tail.len() >= STDERR_TAIL_LIMIT {
                        tail.pop_front();
                    }
                    tail.push_back(trimmed.to_string());
                }
            }
            tail.into_iter().collect::<Vec<_>>()
        });

        let pending = self.pending.clone();
        let generation = self.generation.clone();
        let exit_reason = self.exit_reason.clone();
        let child_slot = self.child.clone();
        let stdin_slot = self.stdin.clone();
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
                        // 反向请求：只给 sidecar，WebView 不能调；放到工作线程执行避免阻塞 stdout 读循环
                        let id = v.get("id").cloned().unwrap_or(Value::Null);
                        let r = v.get("params").and_then(|p| p.get("ref")).and_then(Value::as_str).unwrap_or("").to_string();
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let secret = crate::keys::get(&r).ok().flatten();
                            let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "secret": secret } });
                            if let Some(core) = app_clone.try_state::<Arc<CoreProcess>>() {
                                let _ = core.write_line_for_gen(gen, &reply.to_string());
                            }
                        });
                    }
                    Some(other) => log::warn!("Core 发来不认识的请求：{other}"),
                    None => {
                        if let Some(id) = v.get("id").and_then(Value::as_u64) {
                            let matched = {
                                let mut map = lock_or_recover(&pending);
                                if map.get(&id).is_some_and(|(req_gen, _)| *req_gen == gen) {
                                    map.remove(&id).map(|(_, tx)| tx)
                                } else {
                                    None
                                }
                            };
                            if let Some(tx) = matched {
                                let _ = tx.send(v);
                            }
                        }
                    }
                }
            }
            let tail = stderr_handle.join().unwrap_or_default();
            // 按严格单向清理，绝不在持有一把锁时回取另一把锁（generation -> child -> exit_reason -> pending；stdin 单独带代次清理）
            let exited_child = {
                let g = lock_or_recover(&generation);
                if *g != gen {
                    return;
                }
                let c = lock_or_recover(&child_slot).take();
                let reason = format_exit_reason(&tail);
                log::warn!("Tibi Core 已退出：{reason}");
                *lock_or_recover(&exit_reason) = Some(reason.clone());
                let mut map = lock_or_recover(&pending);
                let ids: Vec<u64> = map.iter().filter(|(_, (rg, _))| *rg == gen).map(|(id, _)| *id).collect();
                for id in ids {
                    if let Some((_, tx)) = map.remove(&id) {
                        let _ = tx.send(core_exited_error(id, &reason));
                    }
                }
                let _ = app.emit("core_event", json!({ "event": "core.exited", "data": { "message": reason } }));
                c
            };
            {
                let mut guard = lock_or_recover(&stdin_slot);
                if guard.as_ref().is_some_and(|(sg, _)| *sg == gen) {
                    *guard = None;
                }
            }
            if let Some(mut c) = exited_child {
                let _ = c.wait();
            }
        });
        Ok(())
    }

    fn write_line_for_gen(&self, expected_gen: u64, line: &str) -> bool {
        // 仅锁 stdin，并在管线内直接比对代次元组，彻底消除与 generation 锁的锁序反转
        let mut guard = lock_or_recover(&self.stdin);
        let Some((stdin_gen, stdin)) = guard.as_mut() else {
            return false;
        };
        if *stdin_gen != expected_gen {
            return false;
        }
        if stdin.write_all(line.as_bytes()).is_err() || stdin.write_all(b"\n").is_err() || stdin.flush().is_err() {
            *guard = None;
            return false;
        }
        true
    }

    /// 发请求并等响应（阻塞，调用方放在 spawn_blocking 里）
    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Value {
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        let gen = *lock_or_recover(&self.generation);
        if let Some(reason) = lock_or_recover(&self.exit_reason).clone() {
            return core_exited_error(id, &reason);
        }
        let (tx, rx) = mpsc::channel();
        {
            let cur_gen = *lock_or_recover(&self.generation);
            if cur_gen != gen || gen == 0 {
                return core_exited_error(id, "Tibi Core 正在重启");
            }
            lock_or_recover(&self.pending).insert(id, (gen, tx));
        }
        if let Some(reason) = lock_or_recover(&self.exit_reason).clone() {
            lock_or_recover(&self.pending).remove(&id);
            return core_exited_error(id, &reason);
        }
        let req = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if !self.write_line_for_gen(gen, &req.to_string()) {
            lock_or_recover(&self.pending).remove(&id);
            let reason = lock_or_recover(&self.exit_reason).clone().unwrap_or_else(|| "Tibi Core 已退出".to_string());
            return core_exited_error(id, &reason);
        }
        match rx.recv_timeout(timeout) {
            Ok(v) => v,
            Err(_) => {
                lock_or_recover(&self.pending).remove(&id);
                if let Some(reason) = lock_or_recover(&self.exit_reason).clone() {
                    return core_exited_error(id, &reason);
                }
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": "Tibi Core 没有回应", "data": { "code": "busy" } } })
            }
        }
    }

    pub fn status(&self) -> Value {
        let pid = lock_or_recover(&self.child).as_ref().map(|c| c.id()).unwrap_or(0);
        let uptime = lock_or_recover(&self.started_at).elapsed().as_millis() as u64;
        let error = lock_or_recover(&self.exit_reason).clone();
        json!({ "pid": pid, "uptime_ms": uptime, "error": error })
    }

    pub fn restart(&self) -> Result<(), String> {
        let _life = lock_or_recover(&self.lifecycle);
        self.stop_locked();
        self.start_locked()
    }

    pub fn stop(&self) {
        let _life = lock_or_recover(&self.lifecycle);
        self.stop_locked();
    }

    pub fn set_fatal_db_error(&self, msg: String) {
        *lock_or_recover(&self.fatal_db_error) = Some(msg.clone());
        *lock_or_recover(&self.exit_reason) = Some(msg);
    }

    /// 独占 Core 生命周期执行停机替换（如恢复备份）：`Err((fatal, msg))` 中 `fatal == true` 表示新旧状态可能不兼容，不再自动重启。
    pub fn replace_db<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce() -> Result<(), (bool, String)>,
    {
        let _life = lock_or_recover(&self.lifecycle);
        self.stop_locked();
        match f() {
            Ok(()) => self.start_locked(),
            Err((fatal, e)) => {
                if fatal {
                    *lock_or_recover(&self.fatal_db_error) = Some(e.clone());
                    *lock_or_recover(&self.exit_reason) = Some(e.clone());
                } else {
                    let _ = self.start_locked();
                }
                Err(e)
            }
        }
    }

    fn stop_locked(&self) {
        let prev_child = {
            let mut g = lock_or_recover(&self.generation);
            *g += 1;
            lock_or_recover(&self.child).take()
        };
        if let Some(mut c) = prev_child {
            let _ = c.kill();
            let _ = c.wait();
        }
        *lock_or_recover(&self.stdin) = None;
        for (id, (_, tx)) in lock_or_recover(&self.pending).drain() {
            let _ = tx.send(core_exited_error(id, "Tibi Core 已停止"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::format_exit_reason;

    #[test]
    fn format_exit_reason_prefers_error_line() {
        let tail = vec![
            "TypeError: Q.util.markAsUncloneable is not a function".to_string(),
            "at new W (/$bunfs/root/tibi-core:1:1)".to_string(),
            "Bun v1.2.17 (macOS arm64)".to_string(),
        ];
        assert_eq!(format_exit_reason(&tail), "TypeError: Q.util.markAsUncloneable is not a function");
    }

    #[test]
    fn format_exit_reason_falls_back_to_last_line_or_default() {
        assert_eq!(format_exit_reason(&["fatal signal".to_string()]), "fatal signal");
        assert_eq!(format_exit_reason(&[]), "Tibi Core 异常退出");
    }
}

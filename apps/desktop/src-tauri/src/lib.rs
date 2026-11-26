//! Tibi 的 Rust 壳：很薄，只做系统能力（06 §7）——启动 / 守护 Tibi Core、转发 JSON-RPC、密钥、文件选择、深链、托盘。
//! 业务数据全部在 Core（TypeScript），界面不直连数据库（B2）。

#[cfg(all(feature = "app-store", feature = "direct-distribution"))]
compile_error!("App Store builds require --no-default-features --features app-store");

mod asset_protocol;
#[cfg(not(any(mobile, feature = "mobile-preview")))]
mod core;
#[cfg(not(any(mobile, feature = "mobile-preview")))]
mod hotkey;
mod keys;
#[cfg(any(mobile, feature = "mobile-preview"))]
mod local_db;
#[cfg(any(mobile, feature = "mobile-preview", test))]
mod sync_fs;
#[cfg(any(mobile, feature = "mobile-preview", test))]
mod app_group;
#[cfg(not(any(mobile, feature = "mobile-preview")))]
mod tray;
#[cfg(all(feature = "direct-distribution", not(any(mobile, feature = "mobile-preview"))))]
mod update;

use serde_json::{json, Value};
use std::collections::HashSet;
#[cfg(any(not(any(mobile, feature = "mobile-preview")), test))]
use std::path::Path;
use std::path::PathBuf;
#[cfg(not(any(mobile, feature = "mobile-preview")))]
use std::sync::Arc;
use std::sync::{Mutex, MutexGuard};
#[cfg(not(any(mobile, feature = "mobile-preview")))]
use std::time::Duration;
#[cfg(not(any(mobile, feature = "mobile-preview")))]
use tauri::WindowEvent;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 避免某一线程 panic 中毒 Mutex 后级联拖垮整个壳进程
pub(crate) fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 规范化路径后判断 `path` 是否位于 `dir` 目录内，防止 `..` 和符号链接越界
#[cfg(any(not(any(mobile, feature = "mobile-preview")), test))]
pub(crate) fn is_within_dir(path: &Path, dir: &Path) -> bool {
    let Ok(canon_dir) = std::fs::canonicalize(dir) else { return false };
    let Ok(canon_path) = std::fs::canonicalize(path) else { return false };
    canon_path.starts_with(&canon_dir)
}

/// pick_file / 拖入 登记过的路径：能力层的 path 只认这里的（06 §1）
#[derive(Default)]
pub(crate) struct Allowed(pub(crate) Mutex<HashSet<String>>);

/// 手机 / mobile-preview 允许 sync_fs_* 操作的资料库根目录白名单
#[cfg(any(mobile, feature = "mobile-preview", test))]
#[derive(Default)]
pub(crate) struct AllowedSyncRoots(pub(crate) Mutex<HashSet<PathBuf>>);

#[cfg(not(any(mobile, feature = "mobile-preview")))]
struct TrayMode(Mutex<bool>);
#[cfg(not(any(mobile, feature = "mobile-preview")))]
impl Default for TrayMode {
    fn default() -> Self {
        // macOS 上顶栏图标提供快速查词，关主窗口默认留在菜单栏（可在设置中关闭）
        Self(Mutex::new(cfg!(target_os = "macos")))
    }
}

#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
async fn core_call(core: State<'_, Arc<core::CoreProcess>>, method: String, params: Option<Value>) -> Result<Value, String> {
    // 只允许 WebView 调 Core 的公开方法；secret.* 和 system.registerPaths 只能由壳在系统文件选择/拖放后内部调用
    if method.starts_with("secret.") || method == "system.registerPaths" {
        return Err("permission_denied".into());
    }
    let core = core.inner().clone();
    let timeout = if method.ends_with(".import") || method.starts_with("documents.") { Duration::from_secs(120) } else { Duration::from_secs(60) };
    tauri::async_runtime::spawn_blocking(move || core.call(&method, params.unwrap_or_else(|| json!({})), timeout))
        .await
        .map_err(|e| e.to_string())
}

/// 桌面拖放确认：只转发已由系统 DragDrop 事件登记进 Rust 白名单的路径给 Core，消除异步竞态且不暴露任意路径注册
#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
async fn confirm_dropped_paths(app: AppHandle, allowed: State<'_, Allowed>, paths: Vec<String>) -> Result<Value, String> {
    let verified: Vec<String> = {
        let guard = lock_or_recover(&allowed.0);
        paths.into_iter().filter(|p| guard.contains(p)).collect()
    };
    if verified.is_empty() {
        return Ok(json!({ "ok": true }));
    }
    if let Some(core) = app.try_state::<Arc<core::CoreProcess>>().map(|c| c.inner().clone()) {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            core.call("system.registerPaths", json!({ "paths": verified }), Duration::from_secs(5))
        })
        .await;
    }
    Ok(json!({ "ok": true }))
}

// Tauri 的菜单 IPC 持有 WebView 资源表的锁等待 AppKit 菜单退出。
// AppKit 跟踪菜单时仍处理 WebView 消息，菜单命令可能在这期间再次访问资源表。
#[cfg(all(target_os = "macos", not(any(mobile, feature = "mobile-preview"))))]
#[tauri::command]
async fn popup_context_menu(
    webview: tauri::Webview,
    rid: tauri::ResourceId,
    at: Option<tauri::Position>,
) -> Result<(), String> {
    use tauri::menu::{ContextMenu, Menu};

    let menu = {
        let resources = webview.resources_table();
        resources.get::<Menu<tauri::Wry>>(rid).map_err(|e| e.to_string())?
    };
    match at {
        Some(at) => menu.popup_at(webview.window(), at),
        None => menu.popup(webview.window()),
    }
    .map_err(|e| e.to_string())
}

#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
fn core_restart(core: State<'_, Arc<core::CoreProcess>>) -> Result<Value, String> {
    core.restart()?;
    Ok(core.status())
}

// async：Android 上要经 Keystore 插件（run_mobile_plugin 会等 Kotlin 那边），不能占着主线程
#[tauri::command]
async fn keyring_set(r#ref: String, secret: String) -> Result<Value, String> {
    if r#ref.is_empty() || secret.is_empty() {
        return Err("引用名和密钥不能为空".into());
    }
    keys::set(&r#ref, &secret)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn keyring_delete(r#ref: String) -> Result<Value, String> {
    keys::delete(&r#ref)?;
    Ok(json!({ "ok": true }))
}

#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
fn open_path(path: String, allowed: State<'_, Allowed>, app: AppHandle) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    let target = Path::new(&path);
    let data = app.path().app_data_dir().ok();
    let same_db = data
        .as_ref()
        .and_then(|d| {
            let db = std::fs::canonicalize(d.join("app.db")).ok()?;
            let cand = std::fs::canonicalize(target).ok()?;
            Some(cand == db)
        })
        .unwrap_or(false);
    let in_backups = data.as_ref().is_some_and(|d| is_within_dir(target, &d.join("backups")));
    let in_allowed = lock_or_recover(&allowed.0).contains(&path);
    if !(in_allowed || same_db || in_backups) {
        return Err("permission_denied".into());
    }
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

/// 从备份恢复（06 system.backups）：先把当前库再备一份，停 Core，原子换文件，重启。只认 app 数据目录 backups/ 下的真实文件
#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[cfg(any(not(any(mobile, feature = "mobile-preview")), test))]
fn cleanup_wal_dirty(dir: &Path) -> Result<(), String> {
    let marker = dir.join("app.db.wal_dirty");
    match marker.try_exists() {
        Ok(false) => return Ok(()),
        Ok(true) => {}
        Err(e) => return Err(format!("检查旧 WAL 恢复标记失败：{e}")),
    }
    let db = dir.join("app.db");
    for ext in ["-wal", "-shm"] {
        let side = format!("{}{}", db.to_string_lossy(), ext);
        if let Err(e) = std::fs::remove_file(&side) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("上次恢复备份后清理旧 {ext} 失败：{e}"));
            }
        }
    }
    if let Err(e) = std::fs::remove_file(&marker) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("清除旧 WAL 恢复标记失败：{e}"));
        }
    }
    Ok(())
}

#[cfg(any(not(any(mobile, feature = "mobile-preview")), test))]
fn rollback_moved_side_files(moved: Vec<(PathBuf, PathBuf)>, cause: &str) -> (bool, String) {
    // 依次尝试把每个已移走的文件全部移回，不在首个失败处提前退出，以免漏回滚 WAL；任一回滚失败即标记为致命
    let mut rb_errs = Vec::new();
    for (orig, bak) in moved.into_iter().rev() {
        if let Err(rb_err) = std::fs::rename(&bak, &orig) {
            rb_errs.push(format!("{} ({rb_err})", orig.display()));
        }
    }
    if rb_errs.is_empty() {
        (false, cause.to_string())
    } else {
        (true, format!("{cause}；且回滚旧库附属文件失败：{}", rb_errs.join("；")))
    }
}

#[cfg(any(not(any(mobile, feature = "mobile-preview")), test))]
fn swap_db_with_wal_isolation(data: &Path, src: &Path, tmp: &Path, suffix: &str) -> Result<(), (bool, String)> {
    let db = data.join("app.db");
    if let Err(e) = std::fs::copy(src, tmp) {
        let _ = std::fs::remove_file(tmp);
        return Err((false, e.to_string()));
    }
    // 换主库前先把旧 WAL/SHM 原子移走：若移走失败或换库失败则原样移回，若换库成功则绝无旧 WAL 可被重放
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for ext in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{}", db.to_string_lossy(), ext));
        let staged = PathBuf::from(format!("{}{}.restore.{}", db.to_string_lossy(), ext, suffix));
        match std::fs::rename(&side, &staged) {
            Ok(()) => moved.push((side, staged)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let _ = std::fs::remove_file(tmp);
                return Err(rollback_moved_side_files(moved, &format!("隔离旧 {ext} 失败：{e}")));
            }
        }
    }
    if let Err(e) = std::fs::rename(tmp, &db) {
        let _ = std::fs::remove_file(tmp);
        return Err(rollback_moved_side_files(moved, &format!("替换数据库失败：{e}")));
    }
    // 清除遗留脏标记（若删除失败则返回 fatal，防止下次启动误删新库有效 WAL）；.restore 副本非 SQLite 文件，尽最大努力清理即可
    let marker = data.join("app.db.wal_dirty");
    if let Err(e) = std::fs::remove_file(&marker) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err((true, format!("已替换数据库，但清除旧 WAL 恢复标记失败：{e}")));
        }
    }
    for (_, bak) in moved {
        let _ = std::fs::remove_file(bak);
    }
    Ok(())
}

#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
async fn restore_backup(path: String, app: AppHandle, core: State<'_, Arc<core::CoreProcess>>) -> Result<Value, String> {
    static RESTORE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    static RESTORE_LOCK: Mutex<()> = Mutex::new(());
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let backups_dir = data.join("backups");
    let src = PathBuf::from(&path);
    if !is_within_dir(&src, &backups_dir) || !src.is_file() {
        return Err("permission_denied".into());
    }
    let src = std::fs::canonicalize(&src).map_err(|_| "permission_denied".to_string())?;
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let _guard = lock_or_recover(&RESTORE_LOCK);
        let r = core.call("system.backup", json!({ "reason": "before_restore" }), Duration::from_secs(60));
        if r.get("error").is_some() {
            return Err(format!("恢复前备份失败：{}", r["error"]["message"].as_str().unwrap_or("")));
        }
        let seq = RESTORE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let suffix = format!("{}.{}", std::process::id(), seq);
        let tmp = data.join(format!("app.db.restore.{suffix}.tmp"));
        core.replace_db(|| swap_db_with_wal_isolation(&data, &src, &tmp, &suffix))?;
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 另存为文本（导出学习汇总等）：弹保存对话框，用户选了路径才写
#[tauri::command]
async fn save_text_file(app: AppHandle, default_name: String, text: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().set_file_name(&default_name).blocking_save_file();
        let Some(p) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(json!({ "saved": false }));
        };
        std::fs::write(&p, text).map_err(|e| e.to_string())?;
        Ok(json!({ "saved": true, "path": p.to_string_lossy() }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// MCP 接入配置用（06 §6）：sidecar 可执行文件的路径（安装包里和主程序放在一起）与 app 数据目录
#[cfg(all(feature = "direct-distribution", not(any(mobile, feature = "mobile-preview"))))]
#[tauri::command]
fn mcp_command(app: AppHandle) -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("找不到程序目录")?;
    let name = if cfg!(windows) { "tibi-core.exe" } else { "tibi-core" };
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(json!({ "program": dir.join(name).to_string_lossy(), "data_dir": data.to_string_lossy() }))
}

/// 选一个文件夹（同步：任意本地文件夹，08 §13）；不登记给 Core 的文件白名单，Core 只在里面建 Tibi Sync/
#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Value, String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(json!({ "path": path }))
}

/// 文件选择：所选路径登记到白名单，并告诉 Core（system.registerPaths）
#[tauri::command]
async fn pick_file(app: AppHandle, kinds: Vec<String>, multiple: Option<bool>) -> Result<Value, String> {
    let app_for_dialog = app.clone();
    let paths = tauri::async_runtime::spawn_blocking(move || {
        let mut exts: Vec<&str> = Vec::new();
        for k in &kinds {
            match k.as_str() {
                "pdf" => exts.push("pdf"),
                "epub" => exts.push("epub"),
                "docx" => exts.push("docx"),
                "txt" => { exts.push("txt"); exts.push("md"); }
                "image" => { exts.extend(["png", "jpg", "jpeg", "webp", "heic"]); }
                "audio" => { exts.extend(["mp3", "m4a", "wav", "ogg", "aac", "opus"]); }
                "mp3" | "m4a" | "wav" | "ogg" | "aac" | "opus" => exts.push(k.as_str()),
                "vtt" | "srt" | "json" => exts.push(k.as_str()),
                "csv" => exts.push("csv"),
                "apkg" => exts.push("apkg"),
                _ => {}
            }
        }
        let mut dialog = app_for_dialog.dialog().file();
        if !exts.is_empty() {
            dialog = dialog.add_filter("文件", &exts);
        }
        if multiple.unwrap_or(false) {
            dialog.blocking_pick_files().unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>()
        } else {
            dialog.blocking_pick_file().and_then(|p| p.into_path().ok()).map(|p| vec![p.to_string_lossy().into_owned()]).unwrap_or_default()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    register_paths(&app, &paths).await;
    Ok(json!({ "paths": paths }))
}

async fn register_paths(app: &AppHandle, paths: &[String]) {
    if paths.is_empty() {
        return;
    }
    lock_or_recover(&app.state::<Allowed>().0).extend(paths.iter().cloned());
    // 手机上 Core 在 WebView 里，没有 sidecar：路径由界面自己交给 Core
    #[cfg(not(any(mobile, feature = "mobile-preview")))]
    {
        let Some(core) = app.try_state::<Arc<core::CoreProcess>>().map(|c| c.inner().clone()) else { return };
        let p = paths.to_vec();
        let _ = tauri::async_runtime::spawn_blocking(move || core.call("system.registerPaths", json!({ "paths": p }), Duration::from_secs(5))).await;
    }
}

#[cfg(not(any(mobile, feature = "mobile-preview")))]
#[tauri::command]
fn window_set_tray_mode(keep_running: bool, mode: State<'_, TrayMode>) -> Value {
    *lock_or_recover(&mode.0) = keep_running;
    json!({ "ok": true })
}

#[derive(Default)]
struct PendingDeepLinks {
    ready: std::sync::atomic::AtomicBool,
    queue: Mutex<Vec<Value>>,
}

#[tauri::command]
fn take_pending_deep_links(pending: State<'_, PendingDeepLinks>) -> Vec<Value> {
    let mut guard = lock_or_recover(&pending.queue);
    pending.ready.store(true, std::sync::atomic::Ordering::SeqCst);
    std::mem::take(&mut *guard)
}

#[tauri::command]
fn reset_deep_link_ready(pending: State<'_, PendingDeepLinks>) {
    let _guard = lock_or_recover(&pending.queue);
    pending.ready.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// 深链（06 §7）：tibi://import?url=… 交给 WebView 先弹确认卡；其余 tibi:// 原样交给 WebView，
/// 由它按白名单（core 的 deeplink.ts）解析成页面跳转，不认识的丢弃。都只是跳转，不在这里做写入
fn handle_deep_link(app: &AppHandle, urls: &[tauri::Url]) {
    for u in urls {
        if u.scheme() != "tibi" {
            continue;
        }
        let payload = if u.host_str() == Some("import") {
            match u.query_pairs().find(|(k, _)| k == "url") {
                Some((_, v)) => json!({ "action": "import", "url": v.to_string() }),
                None => continue,
            }
        } else {
            json!({ "action": "open", "url": u.as_str() })
        };
        let emitted = if let Some(pending) = app.try_state::<PendingDeepLinks>() {
            let mut guard = lock_or_recover(&pending.queue);
            if pending.ready.load(std::sync::atomic::Ordering::SeqCst) {
                true
            } else {
                guard.push(payload.clone());
                false
            }
        } else {
            true
        };
        if emitted {
            let _ = app.emit("deep_link", payload);
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[cfg(not(feature = "direct-distribution"))]
#[tauri::command]
async fn confirm_ai_sharing(app: AppHandle, message: String, agree: String, cancel: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().message(message).title("Tibi")
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(agree, cancel))
            .blocking_show()
    })
    .await
    .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    #[cfg(any(mobile, feature = "mobile-preview"))]
    run_mobile();
    #[cfg(not(any(mobile, feature = "mobile-preview")))]
    run_desktop();
}

/// 手机（M7，00 §3.13）：没有 sidecar，Core 跑在 WebView 里（mobile.html），这里只给 SQLite、密钥、文件选择、深链。
/// 桌面上加 --features mobile-preview 也走这里，用来在电脑上预览手机版、检查这段能编译。
#[cfg(any(mobile, feature = "mobile-preview"))]
fn run_mobile() {
    let builder = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("asset", asset_protocol::handle)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init());
    // Android：随包资源（词典）在 APK 的 assets 里，经 fs 插件读出来（local_db.rs）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fs::init());
    // Android：API Key 再经 Keystore 加密（keys.rs、gen/android 的 KeystorePlugin.kt）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(keys::keystore::plugin());
    builder
        .manage(Allowed::default())
        .manage(AllowedSyncRoots::default())
        .manage(PendingDeepLinks::default())
        .manage(local_db::Dbs::default())
        .setup(|app| {
            // 密钥文件的目录（keys.rs）
            if let Ok(dir) = app.path().app_data_dir() {
                keys::file_store::init(dir);
            }
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    handle_deep_link(app.handle(), &urls);
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| handle_deep_link(&handle, &event.urls()));
            }
            // 桌面预览：窗口配置里是 index.html，换成手机壳
            #[cfg(desktop)]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("if (!location.pathname.endsWith('mobile.html')) location.replace('mobile.html' + location.hash)");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local_db::db_open, local_db::db_exec, local_db::db_run, local_db::db_all, local_db::keyring_get, local_db::read_file, local_db::asset_write, local_db::asset_list, local_db::asset_remove,
            sync_fs::sync_fs_read, sync_fs::sync_fs_write, sync_fs::sync_fs_list, sync_fs::sync_fs_remove, sync_fs::sync_icloud_root, app_group::share_take_pending, app_group::widget_write,
            keyring_set, keyring_delete, pick_file, save_text_file, take_pending_deep_links, reset_deep_link_ready
        ])
        .run(tauri::generate_context!())
        .expect("Tibi 启动失败");
}

#[cfg(not(any(mobile, feature = "mobile-preview")))]
fn run_desktop() {
    let builder = tauri::Builder::default();
    // 单实例要最先注册（插件文档要求）；第二个进程带来的深链由 deep-link 特性转发给 on_open_url
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));
    #[cfg(feature = "direct-distribution")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).manage(update::Pending::default());
    let builder = builder
        .register_asynchronous_uri_scheme_protocol("asset", asset_protocol::handle)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .manage(Allowed::default())
        .manage(PendingDeepLinks::default())
        .manage(TrayMode::default())
        .manage(tray::TrayState::default())
        .on_page_load(|webview, payload| {
            // 主窗口重载前先在 Rust 侧复位深链就绪态，消除前端 beforeunload 异步 IPC 的竞态窗口
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                let pending = webview.app_handle().state::<PendingDeepLinks>();
                let _guard = lock_or_recover(&pending.queue);
                pending.ready.store(false, std::sync::atomic::Ordering::SeqCst);
            }
        })
        .setup(|app| {
            // 密钥文件的目录，要在 Core 启动、来取密钥之前设好（keys.rs）
            if let Ok(dir) = app.path().app_data_dir() {
                keys::file_store::init(dir);
            }
            // Tibi Core：若上次换库遗留了未清理干净的 WAL 脏标记，先完成清理再启动
            let core = Arc::new(core::CoreProcess::new(app.handle().clone()));
            app.manage(core.clone());
            let mut wal_dirty_err: Option<String> = None;
            if let Ok(dir) = app.path().app_data_dir() {
                if let Err(err) = cleanup_wal_dirty(&dir) {
                    wal_dirty_err = Some(err);
                }
            }
            if let Some(err) = wal_dirty_err {
                log::error!("{err}");
                core.set_fatal_db_error(err.clone());
                let _ = app.emit("core_event", json!({ "event": "core.error", "data": { "message": err } }));
            } else if let Err(e) = core.start() {
                log::error!("{e}");
                let _ = app.emit("core_event", json!({ "event": "core.error", "data": { "message": e } }));
            }
            // 启动后把 system.status 发给界面
            {
                let core = core.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let v = core.call("system.status", json!({}), Duration::from_secs(20));
                    let _ = handle.emit("core_event", json!({ "event": "system.status", "data": v.get("result").cloned().unwrap_or(Value::Null) }));
                });
            }
            // 深链（Linux / Windows 的开发模式要先注册 scheme）
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "linux", windows))]
                let _ = app.deep_link().register_all();
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    handle_deep_link(app.handle(), &urls);
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| handle_deep_link(&handle, &event.urls()));
            }
            // E2：macOS 侧栏 vibrancy（失败不阻塞）。窗口透明只在 tauri.macos.conf.json 里开，圆角交给系统窗口
            #[cfg(all(target_os = "macos", not(feature = "app-store")))]
            if let Some(w) = app.get_webview_window("main") {
                if let Err(e) = window_vibrancy::apply_vibrancy(&w, window_vibrancy::NSVisualEffectMaterial::Sidebar, None, None) {
                    log::warn!("侧栏材质没加上：{e}");
                }
            }
            // 托盘与 macOS 顶栏快捷查词面板
            if let Err(e) = tray::setup(app) {
                log::error!("托盘初始化失败：{e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if tray::handle_popover_window_event(window, event) {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = *lock_or_recover(&window.state::<TrayMode>().0);
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    if let Some(c) = window.try_state::<Arc<core::CoreProcess>>() {
                        c.stop();
                    }
                    // macOS 上关掉主窗口后默认进程不退出（还有隐藏托盘面板），关闭"留在菜单栏"时显式退出进程
                    #[cfg(target_os = "macos")]
                    window.app_handle().exit(0);
                }
            }
            if let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                // 先同步写进 Rust 白名单，再异步通知 Core；界面 drop 时调 confirm_dropped_paths 确保 Core 已登记
                let paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                lock_or_recover(&window.state::<Allowed>().0).extend(paths.iter().cloned());
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move { register_paths(&app, &paths).await; });
            }
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "macos")]
            popup_context_menu,
            core_call, confirm_dropped_paths, core_restart, keyring_set, keyring_delete, open_path, pick_file,
            pick_folder, window_set_tray_mode, restore_backup, save_text_file, take_pending_deep_links, reset_deep_link_ready,
            #[cfg(feature = "direct-distribution")]
            mcp_command,
            #[cfg(not(feature = "direct-distribution"))]
            confirm_ai_sharing,
            tray::tray_hide, tray::tray_set_pinned, tray::tray_open_main, tray::tray_update_summary,
            tray::tray_sync_theme, tray::tray_set_hotkey, tray::tray_read_clipboard,
            #[cfg(feature = "direct-distribution")]
            update::update_check,
            #[cfg(feature = "direct-distribution")]
            update::update_install,
            #[cfg(feature = "direct-distribution")]
            update::update_installer_asset
        ]);
    builder
        .build(tauri::generate_context!())
        .expect("Tibi 启动失败")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                let main_visible = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if !main_visible {
                    tray::show_main_window(app, None, None);
                }
            }
            if let tauri::RunEvent::Exit = event {
                if let Some(c) = app.try_state::<Arc<core::CoreProcess>>() {
                    c.stop();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{cleanup_wal_dirty, is_within_dir, rollback_moved_side_files, swap_db_with_wal_isolation};

    #[test]
    fn is_within_dir_blocks_parent_traversal() {
        let base = std::env::temp_dir().join(format!("tibi-path-check-{}", std::process::id()));
        let backups = base.join("backups");
        let _ = std::fs::create_dir_all(&backups);
        let ok = backups.join("ok.db");
        let secret = base.join("secrets.json");
        std::fs::write(&ok, b"db").unwrap();
        std::fs::write(&secret, b"{}").unwrap();

        assert!(is_within_dir(&ok, &backups));
        assert!(!is_within_dir(&backups.join("../secrets.json"), &backups));
        assert!(!is_within_dir(&backups.join("missing.db"), &backups));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn swap_db_isolates_old_wal_and_rolls_back_on_error() {
        let base = std::env::temp_dir().join(format!("tibi-swap-check-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let db = base.join("app.db");
        let wal = base.join("app.db-wal");
        let shm = base.join("app.db-shm");
        let backup = base.join("backup.db");
        let tmp = base.join("app.db.tmp");

        std::fs::write(&db, b"old-db").unwrap();
        std::fs::write(&wal, b"old-wal").unwrap();
        std::fs::write(&shm, b"old-shm").unwrap();
        std::fs::write(&backup, b"new-db").unwrap();

        swap_db_with_wal_isolation(&base, &backup, &tmp, "1").unwrap();
        assert_eq!(std::fs::read(&db).unwrap(), b"new-db");
        assert!(!wal.exists());
        assert!(!shm.exists());

        // 若目标路径不可替换（用同名非空目录制造 rename 失败），旧 WAL/SHM 必须完整回滚
        let bad_dir = base.join("bad");
        std::fs::create_dir_all(bad_dir.join("app.db/nonempty")).unwrap();
        std::fs::write(bad_dir.join("app.db-wal"), b"keep-wal").unwrap();
        std::fs::write(bad_dir.join("app.db-shm"), b"keep-shm").unwrap();
        let res = swap_db_with_wal_isolation(&bad_dir, &backup, &bad_dir.join("app.db.tmp"), "2");
        assert!(matches!(res, Err((false, _))));
        assert_eq!(std::fs::read(bad_dir.join("app.db-wal")).unwrap(), b"keep-wal");
        assert_eq!(std::fs::read(bad_dir.join("app.db-shm")).unwrap(), b"keep-shm");

        // cleanup_wal_dirty 清理残留并移除标记
        std::fs::write(&wal, b"stale-wal").unwrap();
        std::fs::write(base.join("app.db.wal_dirty"), b"1").unwrap();
        cleanup_wal_dirty(&base).unwrap();
        assert!(!wal.exists());
        assert!(!base.join("app.db.wal_dirty").exists());

        // 部分回滚失败时不提前退出：即便 -shm 回滚失败，-wal 仍会被回滚，且返回 fatal = true
        let rb_dir = base.join("rb");
        std::fs::create_dir_all(&rb_dir).unwrap();
        let wal_orig = rb_dir.join("app.db-wal");
        let wal_bak = rb_dir.join("app.db-wal.bak");
        let shm_orig = rb_dir.join("app.db-shm");
        let shm_missing_bak = rb_dir.join("app.db-shm.missing");
        std::fs::write(&wal_bak, b"wal-data").unwrap();
        let (fatal, msg) = rollback_moved_side_files(
            vec![(wal_orig.clone(), wal_bak), (shm_orig, shm_missing_bak)],
            "隔离旧 -shm 失败",
        );
        assert!(fatal);
        assert!(msg.contains("隔离旧 -shm 失败"));
        assert_eq!(std::fs::read(&wal_orig).unwrap(), b"wal-data");

        let _ = std::fs::remove_dir_all(&base);
    }
}

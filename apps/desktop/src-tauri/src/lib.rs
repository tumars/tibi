//! Tibi 的 Rust 壳：很薄，只做系统能力（06 §7）——启动 / 守护 Tibi Core、转发 JSON-RPC、钥匙串、文件选择、深链、托盘。
//! 业务数据全部在 Core（TypeScript），界面不直连数据库（B2）。

mod core;
mod keys;

use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// pick_file / 拖入 登记过的路径：能力层的 path 只认这里的（06 §1）
#[derive(Default)]
struct Allowed(Mutex<HashSet<String>>);
#[derive(Default)]
struct TrayMode(Mutex<bool>);

#[tauri::command]
async fn core_call(core: State<'_, Arc<core::CoreProcess>>, method: String, params: Option<Value>) -> Result<Value, String> {
    // 只允许 WebView 调 Core 的公开方法；secret.* 是壳内部的
    if method.starts_with("secret.") {
        return Err("permission_denied".into());
    }
    let core = core.inner().clone();
    let timeout = if method.ends_with(".import") || method.starts_with("documents.") { Duration::from_secs(120) } else { Duration::from_secs(60) };
    tauri::async_runtime::spawn_blocking(move || core.call(&method, params.unwrap_or_else(|| json!({})), timeout))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn core_status(core: State<'_, Arc<core::CoreProcess>>) -> Value {
    core.status()
}

#[tauri::command]
fn core_restart(core: State<'_, Arc<core::CoreProcess>>) -> Result<Value, String> {
    core.restart()?;
    Ok(core.status())
}

#[tauri::command]
fn keyring_set(r#ref: String, secret: String) -> Result<Value, String> {
    if r#ref.is_empty() || secret.is_empty() {
        return Err("引用名和密钥不能为空".into());
    }
    keys::set(&r#ref, &secret)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn keyring_delete(r#ref: String) -> Result<Value, String> {
    keys::delete(&r#ref)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn open_path(path: String, allowed: State<'_, Allowed>, app: AppHandle) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    let db = app.path().app_data_dir().map(|d| d.join("app.db")).ok();
    let ok = allowed.0.lock().unwrap().contains(&path) || db.map(|d| d.to_string_lossy() == path).unwrap_or(false);
    if !ok {
        return Err("permission_denied".into());
    }
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

/// 文件选择：所选路径登记到白名单，并告诉 Core（system.registerPaths）
#[tauri::command]
async fn pick_file(app: AppHandle, kinds: Vec<String>, multiple: Option<bool>) -> Result<Value, String> {
    let mut exts: Vec<&str> = Vec::new();
    for k in &kinds {
        match k.as_str() {
            "pdf" => exts.push("pdf"),
            "epub" => exts.push("epub"),
            "docx" => exts.push("docx"),
            "txt" => { exts.push("txt"); exts.push("md"); }
            "image" => { exts.extend(["png", "jpg", "jpeg", "webp", "heic"]); }
            "csv" => exts.push("csv"),
            "apkg" => exts.push("apkg"),
            _ => {}
        }
    }
    let mut dialog = app.dialog().file();
    if !exts.is_empty() {
        dialog = dialog.add_filter("文件", &exts);
    }
    let paths: Vec<String> = if multiple.unwrap_or(false) {
        dialog.blocking_pick_files().unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect()
    } else {
        dialog.blocking_pick_file().and_then(|p| p.into_path().ok()).map(|p| vec![p.to_string_lossy().into_owned()]).unwrap_or_default()
    };
    register_paths(&app, &paths).await;
    Ok(json!({ "paths": paths }))
}

async fn register_paths(app: &AppHandle, paths: &[String]) {
    if paths.is_empty() {
        return;
    }
    app.state::<Allowed>().0.lock().unwrap().extend(paths.iter().cloned());
    let core = app.state::<Arc<core::CoreProcess>>().inner().clone();
    let p = paths.to_vec();
    let _ = tauri::async_runtime::spawn_blocking(move || core.call("system.registerPaths", json!({ "paths": p }), Duration::from_secs(5))).await;
}

#[tauri::command]
fn window_set_tray_mode(keep_running: bool, mode: State<'_, TrayMode>) -> Value {
    *mode.0.lock().unwrap() = keep_running;
    json!({ "ok": true })
}

/// 深链：只认 tibi://import?url=…，其余丢弃；WebView 收到后先弹确认卡（06 §7）
fn handle_deep_link(app: &AppHandle, urls: &[tauri::Url]) {
    for u in urls {
        if u.scheme() != "tibi" || u.host_str() != Some("import") {
            continue;
        }
        if let Some((_, v)) = u.query_pairs().find(|(k, _)| k == "url") {
            let _ = app.emit("deep_link", json!({ "action": "import", "url": v.to_string() }));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Allowed::default())
        .manage(TrayMode::default())
        .setup(|app| {
            // Tibi Core
            let core = Arc::new(core::CoreProcess::new(app.handle().clone()));
            app.manage(core.clone());
            if let Err(e) = core.start() {
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
            // E2：macOS 侧栏 vibrancy（失败不阻塞）
            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("main") {
                let _ = window_vibrancy::apply_vibrancy(&w, window_vibrancy::NSVisualEffectMaterial::Sidebar, None, Some(12.0));
            }
            // 托盘：关窗口后 Core 留在托盘继续跑（可设置）
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                let open = MenuItem::with_id(app, "open", "打开 Tibi", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &quit])?;
                let mut tray = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(true).on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(c) = app.try_state::<Arc<core::CoreProcess>>() {
                            c.stop();
                        }
                        app.exit(0);
                    }
                    _ => {}
                });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                let _ = tray.build(app);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = *window.state::<TrayMode>().0.lock().unwrap();
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                } else if let Some(c) = window.try_state::<Arc<core::CoreProcess>>() {
                    c.stop();
                }
            }
            if let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                // 拖入的文件登记到白名单，路径随 WebView 的 drop 事件一起用
                let paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move { register_paths(&app, &paths).await; });
            }
        })
        .invoke_handler(tauri::generate_handler![core_call, core_status, core_restart, keyring_set, keyring_delete, open_path, pick_file, window_set_tray_mode])
        .run(tauri::generate_context!())
        .expect("Tibi 启动失败");
}

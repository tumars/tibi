//! 桌面端软件更新（T31）：走壳的命令，不开放 updater 插件给 WebView。
//! 新版本的来源和签名校验都在插件里（tauri.conf.json 的 endpoints、pubkey），界面只能问"有没有"和"装不装"。

use crate::core::CoreProcess;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 检查到、还没装的那个版本
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<Value, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = match &update {
        Some(u) => json!({ "available": true, "version": u.version }),
        None => json!({ "available": false }),
    };
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// 下载并验签 → 备份 → 停 Core → 安装 → 重启。
/// Core 要先停：Windows 上它占着 tibi-core.exe，安装器换不掉；新版本启动时才跑数据库迁移，所以备份放在这里。
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("先检查更新")?;
    let mut got = 0u64;
    let handle = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                got += chunk as u64;
                let _ = handle.emit("update_progress", json!({ "got": got, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    let core = app.state::<Arc<CoreProcess>>().inner().clone();
    let c = core.clone();
    let backup = tauri::async_runtime::spawn_blocking(move || c.call("system.backup", json!({ "reason": "before_update" }), Duration::from_secs(60))).await.map_err(|e| e.to_string())?;
    // Core 坏了也要能更新（新版本可能正是修它的），只记日志；每天的自动备份还在
    if backup.get("error").is_some() {
        log::warn!("更新前备份失败：{backup}");
    }
    core.stop();

    if let Err(e) = update.install(bytes) {
        let _ = core.restart();
        return Err(e.to_string());
    }
    app.restart()
}

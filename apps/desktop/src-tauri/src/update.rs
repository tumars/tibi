//! 桌面端软件更新（T31）：走壳的命令，不开放 updater 插件给 WebView。
//! 新版本的来源和签名校验都在插件里（tauri.conf.json 的 endpoints、pubkey），界面只能问"有没有"和"装不装"。

use crate::core::CoreProcess;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 界面靠这个前缀认出"备份失败，要用户确认"（lib/update.ts）
const BACKUP_FAILED: &str = "backup_failed:";

/// 检查到、还没装的那个版本；下载好的包留着，备份失败后再装不用重下
struct Staged {
    update: Update,
    bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct Pending(Mutex<Option<Staged>>);

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<Value, String> {
    // 超时只管检查，不管下载：连不上国内源时要尽快试 GitHub，而插件默认不设超时
    let updater = app.updater_builder().timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = match &update {
        Some(u) => json!({ "available": true, "version": u.version }),
        None => json!({ "available": false }),
    };
    *pending.0.lock().unwrap() = update.map(|update| Staged { update, bytes: None });
    Ok(info)
}

/// 国内源 latest/ 下这台电脑能用的安装包文件名（别名见 .github/scripts/cn-mirror-prep.mjs）
#[tauri::command]
pub fn update_mirror_asset() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") { "Tibi_aarch64.dmg" } else { "Tibi_x64.dmg" }
    } else if cfg!(windows) {
        "Tibi_x64-setup.exe"
    } else {
        "Tibi_amd64.AppImage"
    }
}

/// 备份失败的原因；成功是 None。Core 没回应也算失败
async fn backup(core: Arc<CoreProcess>) -> Option<String> {
    let res = tauri::async_runtime::spawn_blocking(move || core.call("system.backup", json!({ "reason": "before_update" }), Duration::from_secs(60))).await;
    match res {
        Err(e) => Some(e.to_string()),
        Ok(v) => v.get("error").map(|e| e.get("message").and_then(Value::as_str).unwrap_or("未知错误").to_string()),
    }
}

/// 下载并验签 → 备份 → 停 Core → 安装 → 重启。
/// Core 要先停：Windows 上它占着 tibi-core.exe，安装器换不掉；新版本启动时才跑数据库迁移，所以备份放在这里。
/// 备份失败时不停 Core、不安装，把决定交给用户；用户确认后带 skip_backup 再调（Core 坏了也要能更新，新版本可能正是修它的）。
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>, skip_backup: Option<bool>) -> Result<(), String> {
    let Staged { update, bytes } = pending.0.lock().unwrap().take().ok_or("先检查更新")?;
    let bytes = match bytes {
        Some(b) => b,
        None => {
            let mut got = 0u64;
            let handle = app.clone();
            let _ = app.emit("update_progress", json!({ "stage": "downloading" }));
            let downloaded = update
                .download(
                    move |chunk, total| {
                        got += chunk as u64;
                        let _ = handle.emit("update_progress", json!({ "stage": "downloading", "got": got, "total": total }));
                    },
                    || {},
                )
                .await;
            match downloaded {
                Ok(b) => b,
                Err(e) => {
                    *pending.0.lock().unwrap() = Some(Staged { update, bytes: None });
                    return Err(e.to_string());
                }
            }
        }
    };

    let core = app.state::<Arc<CoreProcess>>().inner().clone();
    if skip_backup == Some(true) {
        log::warn!("用户确认跳过更新前备份");
    } else {
        let _ = app.emit("update_progress", json!({ "stage": "backing_up" }));
        if let Some(reason) = backup(core.clone()).await {
            log::warn!("更新前备份失败：{reason}");
            *pending.0.lock().unwrap() = Some(Staged { update, bytes: Some(bytes) });
            return Err(format!("{BACKUP_FAILED}{reason}"));
        }
    }

    let _ = app.emit("update_progress", json!({ "stage": "installing" }));
    core.stop();
    if let Err(e) = update.install(bytes) {
        let _ = core.restart();
        return Err(e.to_string());
    }
    app.restart()
}

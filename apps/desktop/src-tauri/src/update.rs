//! 桌面端软件更新（T31）：走壳的命令，不开放 updater 插件给 WebView。
//! 新版本的来源和签名校验都在插件里（tauri.conf.json 的 endpoints、pubkey），界面只能问"有没有"、"下载"和"装不装"。
//!
//! 两阶段模型（参考 Codex / Cursor）：
//! 1. `update_check`：查询更新清单（含 release notes / date），检查本地缓存是否已有验签通过的包，并预检 macOS 运行路径。
//! 2. `update_download`：后台流式下载、Ed25519 验签并原子落盘到缓存目录（不常驻内存），每 100ms 节流上报进度。
//! 3. `update_install`：优先读取已验签缓存（缺失则现场下载）→ 备份 → 停 Core → 安装 → 清理缓存并重启。

use crate::core::CoreProcess;
use crate::lock_or_recover;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 界面靠这个前缀认出"备份失败，要用户确认"（lib/update.ts）
const BACKUP_FAILED: &str = "backup_failed:";

/// 进度事件节流间隔：避免高频 chunk 刷爆 IPC
const PROGRESS_THROTTLE: Duration = Duration::from_millis(100);

/// 检查到、还没装的那个版本；下载好的包落盘在缓存目录，不占常驻内存
struct Staged {
    update: Update,
    cache_path: Option<PathBuf>,
}

#[derive(Default)]
pub struct Pending {
    staged: Mutex<Option<Staged>>,
    busy: AtomicBool,
}

struct BusyGuard<'a>(&'a AtomicBool);

impl<'a> BusyGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Result<Self, String> {
        if flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return Err("正在处理更新，请稍候".into());
        }
        Ok(Self(flag))
    }
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// 版本号清洗成安全文件名片段，防止路径穿越
fn sanitize_version(version: &str) -> String {
    version
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn cache_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("tibi"))
        .join("updates")
}

fn package_path_in(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!("tibi-{}.pkg", sanitize_version(version)))
}

/// 原子写入更新包到缓存目录
fn write_cache_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建更新缓存目录失败：{e}"))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("写入更新缓存失败：{e}"));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("保存更新缓存失败：{e}"));
    }
    Ok(())
}

/// 清理缓存目录下除 `keep` 以外的旧更新包和残留 `.tmp` 文件
fn prune_cache_dir(dir: &Path, keep: Option<&Path>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if keep.is_some_and(|k| k == p) {
            continue;
        }
        if p.is_file() {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// 应用启动时清理已过期或残留的更新缓存（例如 Windows 安装器退出后遗留的缓存包）
pub fn cleanup_stale_cache(app: &AppHandle) {
    let dir = cache_dir(app);
    let current = app.package_info().version.to_string();
    let current_file = package_path_in(&dir, &current);
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // 清理临时文件与当前已安装版本的安装包；若已有更新版本的完整缓存则保留，待 update_check 验签复用
        if name.contains(".tmp.") || p == current_file {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// 检测 macOS 是否运行在只读挂载卷（DMG）或 App Translocation 随机只读路径下
fn detect_macos_install_issue(exe: &Path) -> Option<&'static str> {
    let s = exe.to_string_lossy();
    if s.contains("/AppTranslocation/") {
        Some("translocated")
    } else if s.starts_with("/Volumes/") {
        Some("mounted_volume")
    } else {
        None
    }
}

fn install_location_issue() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        std::env::current_exe().ok().and_then(|p| detect_macos_install_issue(&p))
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn format_install_issue_error(issue: &str) -> String {
    match issue {
        "translocated" => "当前 Tibi 正在系统临时安全路径运行，无法原位更新；请先将 Tibi 移入「应用程序」文件夹后再更新，或手动下载安装包。".into(),
        "mounted_volume" => "当前 Tibi 正直接从磁盘镜像（DMG）中运行，无法原位更新；请先拖入「应用程序」文件夹后再更新，或手动下载安装包。".into(),
        _ => "当前运行位置不可写入，无法原位更新，请手动下载安装包。".into(),
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<Value, String> {
    if pending.busy.load(Ordering::SeqCst) {
        return Err("正在下载或安装更新，请稍候".into());
    }
    // 超时只管检查，不管下载：分发源不可用时及时返回错误，而插件默认不设超时
    let updater = app.updater_builder().timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let dir = cache_dir(&app);
    let current_version = app.package_info().version.to_string();

    let Some(u) = update else {
        prune_cache_dir(&dir, None);
        *lock_or_recover(&pending.staged) = None;
        return Ok(json!({
            "available": false,
            "currentVersion": current_version,
        }));
    };

    let target_path = package_path_in(&dir, &u.version);
    let cached_valid = match std::fs::read(&target_path) {
        Ok(bytes) => {
            if u.verify(&bytes).is_ok() {
                true
            } else {
                let _ = std::fs::remove_file(&target_path);
                false
            }
        }
        Err(_) => false,
    };
    let cache_path = if cached_valid { Some(target_path) } else { None };
    prune_cache_dir(&dir, cache_path.as_deref());

    let date = u.date.map(|d| d.date().to_string());
    let info = json!({
        "available": true,
        "version": u.version,
        "currentVersion": u.current_version,
        "notes": u.body,
        "date": date,
        "downloaded": cache_path.is_some(),
        "installIssue": install_location_issue(),
        "platform": std::env::consts::OS,
    });
    *lock_or_recover(&pending.staged) = Some(Staged { update: u, cache_path });
    Ok(info)
}

/// 腾讯云 latest/ 下这台电脑能用的安装包文件名（别名见 .github/scripts/cn-mirror-prep.mjs）
#[tauri::command]
pub fn update_installer_asset() -> &'static str {
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

/// 下载并验签，流式节流上报进度
async fn download_verified(app: &AppHandle, update: &Update) -> Result<Vec<u8>, String> {
    let mut got = 0u64;
    let mut last_emit = Instant::now() - PROGRESS_THROTTLE;
    let handle = app.clone();
    let _ = app.emit("update_progress", json!({ "stage": "downloading", "got": 0, "total": Value::Null }));
    let bytes = update
        .download(
            move |chunk, total| {
                got += chunk as u64;
                let done = total.is_some_and(|t| got >= t);
                if done || last_emit.elapsed() >= PROGRESS_THROTTLE {
                    last_emit = Instant::now();
                    let _ = handle.emit("update_progress", json!({ "stage": "downloading", "got": got, "total": total }));
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let total = bytes.len() as u64;
    let _ = app.emit("update_progress", json!({ "stage": "downloading", "got": total, "total": total }));
    Ok(bytes)
}

/// 阶段 1：后台下载并验签，落盘缓存（不中断当前使用，也不常驻内存）
#[tauri::command]
pub async fn update_download(app: AppHandle, pending: State<'_, Pending>) -> Result<Value, String> {
    let _guard = BusyGuard::acquire(&pending.busy)?;
    let Staged { update, cache_path } = lock_or_recover(&pending.staged).take().ok_or("先检查更新")?;

    // 已有通过验签的本地缓存，直接就绪
    if let Some(ref path) = cache_path {
        if let Ok(bytes) = std::fs::read(path) {
            if update.verify(&bytes).is_ok() {
                let version = update.version.clone();
                *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path });
                return Ok(json!({ "version": version, "downloaded": true }));
            }
        }
        let _ = std::fs::remove_file(path);
    }

    let bytes = match download_verified(&app, &update).await {
        Ok(b) => b,
        Err(e) => {
            *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path: None });
            return Err(e);
        }
    };

    let dir = cache_dir(&app);
    let path = package_path_in(&dir, &update.version);
    if let Err(e) = write_cache_atomic(&path, &bytes) {
        *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path: None });
        return Err(e);
    }
    drop(bytes);
    prune_cache_dir(&dir, Some(&path));

    let version = update.version.clone();
    *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path: Some(path) });
    Ok(json!({ "version": version, "downloaded": true }))
}

/// 阶段 2：使用已验签缓存（如缺失则下载）→ 备份 → 停 Core → 安装 → 清理缓存并重启。
/// Core 要先停：Windows 上它占着 tibi-core.exe，安装器换不掉；新版本启动时才跑数据库迁移，所以备份放在这里。
/// 备份失败时不停 Core、不安装，把决定交给用户；用户确认后带 skip_backup 再调（复用本地缓存包，不用重下）。
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>, skip_backup: Option<bool>) -> Result<(), String> {
    let _guard = BusyGuard::acquire(&pending.busy)?;
    if let Some(issue) = install_location_issue() {
        return Err(format_install_issue_error(issue));
    }

    let Staged { update, mut cache_path } = lock_or_recover(&pending.staged).take().ok_or("先检查更新")?;

    let cached_bytes = cache_path.as_ref().and_then(|path| {
        let bytes = std::fs::read(path).ok()?;
        if update.verify(&bytes).is_ok() {
            Some(bytes)
        } else {
            let _ = std::fs::remove_file(path);
            None
        }
    });

    let bytes = match cached_bytes {
        Some(b) => b,
        None => {
            cache_path = None;
            let downloaded = match download_verified(&app, &update).await {
                Ok(b) => b,
                Err(e) => {
                    *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path: None });
                    return Err(e);
                }
            };
            let dir = cache_dir(&app);
            let path = package_path_in(&dir, &update.version);
            if write_cache_atomic(&path, &downloaded).is_ok() {
                prune_cache_dir(&dir, Some(&path));
                cache_path = Some(path);
            }
            downloaded
        }
    };

    let core = app.state::<Arc<CoreProcess>>().inner().clone();
    if skip_backup == Some(true) {
        log::warn!("用户确认跳过更新前备份");
    } else {
        let _ = app.emit("update_progress", json!({ "stage": "backing_up" }));
        if let Some(reason) = backup(core.clone()).await {
            log::warn!("更新前备份失败：{reason}");
            // 释放 bytes 内存，只保留磁盘缓存路径供用户跳过备份后重试
            drop(bytes);
            *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path });
            return Err(format!("{BACKUP_FAILED}{reason}"));
        }
    }

    let _ = app.emit("update_progress", json!({ "stage": "installing" }));
    core.stop();
    if let Err(e) = update.install(&bytes) {
        let _ = core.restart();
        *lock_or_recover(&pending.staged) = Some(Staged { update, cache_path });
        return Err(e.to_string());
    }
    if let Some(path) = cache_path {
        let _ = std::fs::remove_file(path);
    }
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_version_strips_path_separators() {
        assert_eq!(sanitize_version("0.2.3"), "0.2.3");
        assert_eq!(sanitize_version("0.2.3-beta.1"), "0.2.3-beta.1");
        assert_eq!(sanitize_version("../evil/0.2.3"), ".._evil_0.2.3");
    }

    #[test]
    fn detects_macos_readonly_install_paths() {
        assert_eq!(
            detect_macos_install_issue(Path::new("/Volumes/Tibi/Tibi.app/Contents/MacOS/tibi")),
            Some("mounted_volume")
        );
        assert_eq!(
            detect_macos_install_issue(Path::new("/private/var/folders/xx/T/AppTranslocation/UUID/d/Tibi.app/Contents/MacOS/tibi")),
            Some("translocated")
        );
        assert_eq!(
            detect_macos_install_issue(Path::new("/Applications/Tibi.app/Contents/MacOS/tibi")),
            None
        );
    }

    #[test]
    fn atomic_cache_write_and_prune_keeps_only_active_package() {
        let base = std::env::temp_dir().join(format!("tibi-upd-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let old_pkg = package_path_in(&base, "0.2.1");
        let new_pkg = package_path_in(&base, "0.2.2");
        let tmp_file = base.join("tibi-0.2.2.tmp.99");

        write_cache_atomic(&old_pkg, b"old-bytes").unwrap();
        write_cache_atomic(&new_pkg, b"new-bytes").unwrap();
        std::fs::write(&tmp_file, b"stale-tmp").unwrap();

        prune_cache_dir(&base, Some(&new_pkg));
        assert!(!old_pkg.exists());
        assert!(!tmp_file.exists());
        assert_eq!(std::fs::read(&new_pkg).unwrap(), b"new-bytes");

        prune_cache_dir(&base, None);
        assert!(!new_pkg.exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn busy_guard_prevents_concurrent_access_and_releases_on_drop() {
        let flag = AtomicBool::new(false);
        {
            let _g1 = BusyGuard::acquire(&flag).unwrap();
            assert!(BusyGuard::acquire(&flag).is_err());
        }
        assert!(BusyGuard::acquire(&flag).is_ok());
    }
}

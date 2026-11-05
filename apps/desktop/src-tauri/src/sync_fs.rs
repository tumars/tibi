//! 手机上的同步文件夹（08 §8，M7）：Core 在 WebView 里，没法直接读写文件，经这几条命令操作一个"资料库根目录"下的文件。
//! - iOS 的 iCloud Drive：应用容器 iCloud.app.tibi/Documents/Tibi Sync（NSFileManager，需要 iCloud 权限和 entitlements）。
//!   还没下载到本机的文件是 `.名字.icloud` 占位：列目录时按原名列出，读的时候先触发下载、这次当作还没到（下次同步再读）。
//! - 桌面预览（mobile-preview）的"文件夹"后端也走这里。
//!
//! 路径一律相对根目录，拒绝 `..`。

use base64::Engine;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

fn join(root: &str, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("路径不对".into());
    }
    Ok(Path::new(root).join(p))
}

fn placeholder(p: &Path) -> Option<PathBuf> {
    let name = p.file_name()?.to_string_lossy();
    Some(p.with_file_name(format!(".{name}.icloud")))
}

/// 读文件：不存在时返回错误 "ENOENT"（iCloud 占位先触发下载）
#[tauri::command]
pub fn sync_fs_read(root: String, path: String) -> Result<tauri::ipc::Response, String> {
    let p = join(&root, &path)?;
    match std::fs::read(&p) {
        Ok(b) => Ok(tauri::ipc::Response::new(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some(ph) = placeholder(&p) {
                if ph.exists() {
                    icloud::start_download(&p);
                }
            }
            Err("ENOENT".into())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 写文件（base64）：先写临时文件再改名，别的设备不会读到半截
#[tauri::command]
pub fn sync_fs_write(root: String, path: String, data: String) -> Result<(), String> {
    let p = join(&root, &path)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("tibi-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| if e.raw_os_error() == Some(28) { "QUOTA".to_string() } else { e.to_string() })?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// 目录下的文件名（不含子目录；iCloud 占位按原名列出）
#[tauri::command]
pub fn sync_fs_list(root: String, dir: String) -> Result<Vec<String>, String> {
    let d = if dir.is_empty() { PathBuf::from(&root) } else { join(&root, &dir)? };
    let Ok(rd) = std::fs::read_dir(&d) else { return Ok(vec![]) };
    let mut out = Vec::new();
    for e in rd.flatten() {
        if e.file_type().map(|t| t.is_dir()).unwrap_or(true) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".tibi-tmp") {
            continue;
        }
        match name.strip_prefix('.').and_then(|n| n.strip_suffix(".icloud")) {
            Some(orig) => out.push(orig.to_string()),
            None if !name.starts_with('.') => out.push(name),
            None => {}
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

#[tauri::command]
pub fn sync_fs_remove(root: String, path: String) -> Result<(), String> {
    let p = join(&root, &path)?;
    let _ = std::fs::remove_file(&p);
    if let Some(ph) = placeholder(&p) {
        let _ = std::fs::remove_file(ph);
    }
    Ok(())
}

/// iCloud Drive 里 Tibi 的资料库目录（只有 iOS；没登录 iCloud、没开 iCloud Drive 或没有权限时报错）
#[tauri::command]
pub fn sync_icloud_root() -> Result<Value, String> {
    let root = icloud::container_root().ok_or_else(|| "这台设备没有登录 iCloud，或没有打开 iCloud Drive。去系统设置打开，或改用 WebDAV。".to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": root.to_string_lossy() }))
}

#[cfg(target_os = "ios")]
mod icloud {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    use std::path::{Path, PathBuf};

    pub fn container_root() -> Option<PathBuf> {
        let fm = NSFileManager::defaultManager();
        let url = fm.URLForUbiquityContainerIdentifier(Some(&NSString::from_str("iCloud.app.tibi")))?;
        let base = url.path()?.to_string();
        Some(PathBuf::from(base).join("Documents").join("Tibi Sync"))
    }

    pub fn start_download(p: &Path) {
        let fm = NSFileManager::defaultManager();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()));
        let _ = fm.startDownloadingUbiquitousItemAtURL_error(&url);
    }
}

#[cfg(not(target_os = "ios"))]
mod icloud {
    use std::path::{Path, PathBuf};
    pub fn container_root() -> Option<PathBuf> {
        None
    }
    pub fn start_download(_p: &Path) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_write_list_remove_and_placeholders() {
        let root = std::env::temp_dir().join(format!("tibi-syncfs-{}", std::process::id()));
        let r = root.to_string_lossy().to_string();
        sync_fs_write(r.clone(), "changes/dev1/0000000001.jsonl.gz".into(), base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3])).unwrap();
        sync_fs_write(r.clone(), "library.json".into(), base64::engine::general_purpose::STANDARD.encode(b"{}")).unwrap();
        // iCloud 占位：还没下载的文件按原名列出，读时报 ENOENT
        std::fs::write(root.join("changes/dev1/.0000000002.jsonl.gz.icloud"), b"").unwrap();
        assert_eq!(sync_fs_list(r.clone(), "changes/dev1".into()).unwrap(), vec!["0000000001.jsonl.gz", "0000000002.jsonl.gz"]);
        assert_eq!(sync_fs_list(r.clone(), "changes".into()).unwrap(), Vec::<String>::new());
        assert_eq!(sync_fs_read(r.clone(), "changes/dev1/0000000002.jsonl.gz".into()).err().as_deref(), Some("ENOENT"));
        assert!(sync_fs_read(r.clone(), "library.json".into()).is_ok());
        assert!(sync_fs_write(r.clone(), "../escape".into(), String::new()).is_err());
        sync_fs_remove(r.clone(), "library.json".into()).unwrap();
        assert!(sync_fs_read(r.clone(), "library.json".into()).is_err());
        assert!(sync_icloud_root().is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}

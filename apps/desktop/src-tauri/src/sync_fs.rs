//! 手机上的同步文件夹（08 §8，M7）：Core 在 WebView 里，没法直接读写文件，经这几条命令操作一个"资料库根目录"下的文件。
//! - iOS 的 iCloud Drive：应用容器 iCloud.app.tibi/Documents/Tibi Sync（NSFileManager，需要 iCloud 权限和 entitlements）。
//!   还没下载到本机的文件是 `.名字.icloud` 占位：列目录时按原名列出，读的时候先触发下载、这次当作还没到（下次同步再读）。
//! - 桌面预览（mobile-preview）的"文件夹"后端也走这里。
//!
//! 路径一律相对根目录，拒绝 `..`。

use crate::{lock_or_recover, AllowedSyncRoots};
use base64::Engine;
#[cfg(any(mobile, feature = "mobile-preview"))]
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(mobile, feature = "mobile-preview"))]
use tauri::State;

static TMP_SEQ: AtomicU64 = AtomicU64::new(1);

fn join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("路径不对".into());
    }
    Ok(root.join(p))
}

fn verify_sync_root(root: &str, allowed: &AllowedSyncRoots) -> Result<PathBuf, String> {
    let cand = PathBuf::from(root);
    let canon = std::fs::canonicalize(&cand).unwrap_or(cand);
    let ok = lock_or_recover(&allowed.0)
        .iter()
        .any(|r| canon == *r || canon.starts_with(r));
    if !ok {
        return Err("permission_denied".into());
    }
    Ok(canon)
}

fn placeholder(p: &Path) -> Option<PathBuf> {
    let name = p.file_name()?.to_string_lossy();
    Some(p.with_file_name(format!(".{name}.icloud")))
}

fn is_tmp_file(name: &str) -> bool {
    name.ends_with(".tibi-tmp") || name.contains(".tibi-tmp.")
}

pub(crate) fn read_under_root(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    let p = join(root, path)?;
    match std::fs::read(&p) {
        Ok(b) => Ok(b),
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

pub(crate) fn write_under_root(root: &Path, path: &str, data: &str) -> Result<(), String> {
    let p = join(root, path)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let name = p.file_name().ok_or("路径不对")?.to_string_lossy();
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = p.with_file_name(format!("{name}.tibi-tmp.{}.{seq}", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(if e.raw_os_error() == Some(28) { "QUOTA".to_string() } else { e.to_string() });
    }
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

pub(crate) fn list_under_root(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    let d = if dir.is_empty() { root.to_path_buf() } else { join(root, dir)? };
    let Ok(rd) = std::fs::read_dir(&d) else { return Ok(vec![]) };
    let mut out = Vec::new();
    for e in rd.flatten() {
        if e.file_type().map(|t| t.is_dir()).unwrap_or(true) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if is_tmp_file(&name) {
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

pub(crate) fn remove_under_root(root: &Path, path: &str) -> Result<(), String> {
    let p = join(root, path)?;
    let _ = std::fs::remove_file(&p);
    if let Some(ph) = placeholder(&p) {
        let _ = std::fs::remove_file(ph);
    }
    Ok(())
}

/// 读文件：不存在时返回错误 "ENOENT"（iCloud 占位先触发下载）
#[cfg(any(mobile, feature = "mobile-preview"))]
#[tauri::command]
pub fn sync_fs_read(root: String, path: String, allowed: State<'_, AllowedSyncRoots>) -> Result<tauri::ipc::Response, String> {
    let root = verify_sync_root(&root, &allowed)?;
    read_under_root(&root, &path).map(tauri::ipc::Response::new)
}

/// 写文件（base64）：先写临时文件再改名，别的设备不会读到半截
#[cfg(any(mobile, feature = "mobile-preview"))]
#[tauri::command]
pub fn sync_fs_write(root: String, path: String, data: String, allowed: State<'_, AllowedSyncRoots>) -> Result<(), String> {
    let root = verify_sync_root(&root, &allowed)?;
    write_under_root(&root, &path, &data)
}

/// 目录下的文件名（不含子目录；iCloud 占位按原名列出）
#[cfg(any(mobile, feature = "mobile-preview"))]
#[tauri::command]
pub fn sync_fs_list(root: String, dir: String, allowed: State<'_, AllowedSyncRoots>) -> Result<Vec<String>, String> {
    let root = verify_sync_root(&root, &allowed)?;
    list_under_root(&root, &dir)
}

#[cfg(any(mobile, feature = "mobile-preview"))]
#[tauri::command]
pub fn sync_fs_remove(root: String, path: String, allowed: State<'_, AllowedSyncRoots>) -> Result<(), String> {
    let root = verify_sync_root(&root, &allowed)?;
    remove_under_root(&root, &path)
}

/// iCloud Drive 里 Tibi 的资料库目录（只有 iOS；没登录 iCloud、没开 iCloud Drive 或没有权限时报错）
#[cfg(any(mobile, feature = "mobile-preview"))]
#[tauri::command]
pub fn sync_icloud_root(allowed: State<'_, AllowedSyncRoots>) -> Result<Value, String> {
    let root = icloud::container_root().ok_or_else(|| "这台设备没有登录 iCloud，或没有打开 iCloud Drive。去系统设置打开，或改用 WebDAV。".to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let canon = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    lock_or_recover(&allowed.0).insert(canon);
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
        write_under_root(&root, "changes/dev1/0000000001.jsonl.gz", &base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3])).unwrap();
        write_under_root(&root, "library.json", &base64::engine::general_purpose::STANDARD.encode(b"{}")).unwrap();
        // iCloud 占位：还没下载的文件按原名列出，读时报 ENOENT
        std::fs::write(root.join("changes/dev1/.0000000002.jsonl.gz.icloud"), b"").unwrap();
        assert_eq!(list_under_root(&root, "changes/dev1").unwrap(), vec!["0000000001.jsonl.gz", "0000000002.jsonl.gz"]);
        assert_eq!(list_under_root(&root, "changes").unwrap(), Vec::<String>::new());
        assert_eq!(read_under_root(&root, "changes/dev1/0000000002.jsonl.gz").err().as_deref(), Some("ENOENT"));
        assert!(read_under_root(&root, "library.json").is_ok());
        assert!(write_under_root(&root, "../escape", "").is_err());
        remove_under_root(&root, "library.json").unwrap();
        assert!(read_under_root(&root, "library.json").is_err());
        assert!(icloud::container_root().is_none());
        let allowed = AllowedSyncRoots::default();
        assert_eq!(verify_sync_root(&root.to_string_lossy(), &allowed).err().as_deref(), Some("permission_denied"));
        let _ = std::fs::remove_dir_all(root);
    }
}

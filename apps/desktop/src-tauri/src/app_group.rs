//! iOS 的 App Group 共享目录（group.app.tibi）：主应用和扩展之间交换数据（00 §3.13 J3、J7）。
//! - Safari 分享扩展（ios-extensions/ShareExtension）把网址写进 share-inbox/<时间>.json，主应用打开 / 回到前台时取走导入；
//! - 小组件（ios-extensions/TibiWidget）读主应用写的 widget.json（待复习数、连续天数、今日分钟、继续读的文章）。
//! 不是 iOS 时没有共享目录：取收件箱返回空、写快照什么都不做（测试时可以用 TIBI_APP_GROUP_DIR 指一个目录）。

use serde_json::Value;
use std::path::PathBuf;

fn group_dir() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("TIBI_APP_GROUP_DIR") {
        return Some(PathBuf::from(d));
    }
    platform::group_dir()
}

/// 取走分享扩展放进来的网址（读完即删）
#[tauri::command]
pub fn share_take_pending() -> Result<Vec<Value>, String> {
    let Some(dir) = group_dir().map(|d| d.join("share-inbox")) else { return Ok(vec![]) };
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    files.sort();
    let mut out = Vec::new();
    for f in files {
        if let Ok(s) = std::fs::read_to_string(&f) {
            if let Ok(v) = serde_json::from_str::<Value>(&s) {
                if v.get("url").and_then(|u| u.as_str()).is_some_and(|u| u.starts_with("http")) {
                    out.push(v);
                }
            }
        }
        let _ = std::fs::remove_file(&f);
    }
    Ok(out)
}

/// 写小组件快照（主应用每次刷新状态时写）
#[tauri::command]
pub fn widget_write(snapshot: Value) -> Result<(), String> {
    let Some(dir) = group_dir() else { return Ok(()) };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("widget.json.tmp");
    std::fs::write(&tmp, snapshot.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, dir.join("widget.json")).map_err(|e| e.to_string())
}

#[cfg(target_os = "ios")]
mod platform {
    use objc2_foundation::{NSFileManager, NSString};
    use std::path::PathBuf;
    pub fn group_dir() -> Option<PathBuf> {
        let fm = NSFileManager::defaultManager();
        let url = fm.containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str("group.app.tibi"))?;
        Some(PathBuf::from(url.path()?.to_string()))
    }
}

#[cfg(not(target_os = "ios"))]
mod platform {
    pub fn group_dir() -> Option<std::path::PathBuf> {
        None
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn inbox_and_widget() {
        let dir = std::env::temp_dir().join(format!("tibi-group-{}", std::process::id()));
        std::env::set_var("TIBI_APP_GROUP_DIR", &dir);
        std::fs::create_dir_all(dir.join("share-inbox")).unwrap();
        std::fs::write(dir.join("share-inbox/1.json"), r#"{"url":"https://example.com/a","title":"A","later":false}"#).unwrap();
        std::fs::write(dir.join("share-inbox/2.json"), r#"{"url":"javascript:alert(1)"}"#).unwrap();
        let got = super::share_take_pending().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["url"], "https://example.com/a");
        assert!(super::share_take_pending().unwrap().is_empty());
        super::widget_write(serde_json::json!({ "due": 3 })).unwrap();
        assert!(std::fs::read_to_string(dir.join("widget.json")).unwrap().contains("\"due\":3"));
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var("TIBI_APP_GROUP_DIR");
    }
}

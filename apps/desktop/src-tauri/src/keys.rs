//! 密钥存储（05 §8）：引用名如 provider.deepseek.llm。
//! WebView 只能写入和删除；读取只给 sidecar 的 secret.get 反向请求（手机上 Core 在 WebView 里，经 keyring_get）。
//! 所有平台都存应用数据目录里的 secrets.json（权限 0600）。不进 app.db，所以不进 Tibi 的备份、导出和同步。
//! - 桌面、iOS：不加密。钥匙串在未固定签名的构建上反复弹窗，各端也要各写一套，这里用便利换了一部分安全：
//!   桌面上同用户的程序能读这个文件；iOS 上别的应用读不到，但设备备份可能带上它。
//!   以前存在钥匙串（service = app.tibi）里的 Key，第一次读到时搬过来并删掉原条目。
//! - Android：keyring 没有后端（只存在内存里，重启就丢），一直存这个文件。
//!   gen/android 的备份规则（res/xml/backup_rules.xml、data_extraction_rules.xml）把它排除在云端备份和换机迁移之外；
//!   值再经 Android Keystore 加密（gen/android 的 KeystorePlugin.kt，AES-256-GCM，密钥不出系统），文件里只有 "ks1:" 开头的密文。
//!   以前存的明文照样能读，读到时顺手加密写回。

#[cfg(not(target_os = "android"))]
mod keychain {
    const SERVICE: &str = "app.tibi";

    pub fn set(r: &str, secret: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, r).map_err(|e| e.to_string())?.set_password(secret).map_err(|e| format!("写入钥匙串失败：{e}"))
    }

    pub fn delete(r: &str) -> Result<(), String> {
        match keyring::Entry::new(SERVICE, r).map_err(|e| e.to_string())?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("删除钥匙串条目失败：{e}")),
        }
    }

    pub fn get(r: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(SERVICE, r).map_err(|e| e.to_string())?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("读取钥匙串失败：{e}")),
        }
    }
}

#[cfg(target_os = "android")]
pub use file_store::{delete, get, set};

#[cfg(not(target_os = "android"))]
pub fn set(r: &str, secret: &str) -> Result<(), String> {
    file_store::set(r, secret)?;
    // 旧条目留着的话，之后删掉 Key 时读取会把它搬回来
    let _ = keychain::delete(r);
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn delete(r: &str) -> Result<(), String> {
    file_store::delete(r)?;
    keychain::delete(r)
}

#[cfg(not(target_os = "android"))]
pub fn get(r: &str) -> Result<Option<String>, String> {
    if let Some(v) = file_store::get(r)? {
        return Ok(Some(v));
    }
    migrate(keychain::get(r)?, |v| file_store::set(r, v), || keychain::delete(r))
}

/// 钥匙串里的旧 Key 搬进文件：写成功才删原条目；删失败不影响这次读取，下次写入或删除时还会再删
#[cfg(not(target_os = "android"))]
fn migrate(
    legacy: Option<String>,
    store: impl FnOnce(&str) -> Result<(), String>,
    remove: impl FnOnce() -> Result<(), String>,
) -> Result<Option<String>, String> {
    let Some(v) = legacy else { return Ok(None) };
    store(&v)?;
    let _ = remove();
    Ok(Some(v))
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use std::cell::Cell;

    #[test]
    fn migrate_removes_legacy_only_after_store() {
        let removed = Cell::new(false);
        let got = super::migrate(Some("sk".into()), |v| { assert_eq!(v, "sk"); Ok(()) }, || { removed.set(true); Ok(()) });
        assert_eq!(got.unwrap().as_deref(), Some("sk"));
        assert!(removed.get());

        let removed = Cell::new(false);
        let failed = super::migrate(Some("sk".into()), |_| Err("disk full".to_string()), || { removed.set(true); Ok(()) });
        assert!(failed.is_err());
        assert!(!removed.get());

        let none = super::migrate(None, |_| panic!("没有旧 Key 不该写入"), || panic!("没有旧 Key 不该删除"));
        assert_eq!(none.unwrap(), None);
    }

    #[test]
    fn migrate_keeps_value_when_remove_fails() {
        let got = super::migrate(Some("sk".into()), |_| Ok(()), || Err("denied".to_string()));
        assert_eq!(got.unwrap().as_deref(), Some("sk"));
    }
}

/// Android Keystore：壳里的小插件 tibi-keystore，Kotlin 那边是 gen/android/…/app/tibi/KeystorePlugin.kt
#[cfg(target_os = "android")]
pub mod keystore {
    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::Wry;

    #[derive(Serialize)]
    struct In<'a> {
        text: &'a str,
    }
    #[derive(Deserialize)]
    struct Out {
        text: String,
    }

    struct Keystore(PluginHandle<Wry>);
    impl Keystore {
        fn call(&self, cmd: &str, text: &str) -> Result<String, String> {
            self.0.run_mobile_plugin::<Out>(cmd, In { text }).map(|o| o.text).map_err(|e| e.to_string())
        }
    }
    impl super::file_store::Seal for Keystore {
        fn seal(&self, plain: &str) -> Result<String, String> {
            self.call("encrypt", plain)
        }
        fn open(&self, sealed: &str) -> Result<String, String> {
            self.call("decrypt", sealed)
        }
    }

    pub fn plugin() -> TauriPlugin<Wry> {
        Builder::new("tibi-keystore")
            .setup(|_app, api| {
                let h = api.register_android_plugin("app.tibi", "KeystorePlugin")?;
                super::file_store::set_seal(Box::new(Keystore(h)));
                Ok(())
            })
            .build()
    }
}

/// 文件存储（所有平台）
#[allow(dead_code)]
pub mod file_store {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};

    static DIR: OnceLock<PathBuf> = OnceLock::new();
    static LOCK: Mutex<()> = Mutex::new(());

    /// 启动时由壳设置（app_data_dir）
    pub fn init(dir: PathBuf) {
        let _ = DIR.set(dir);
    }

    fn path() -> Result<PathBuf, String> {
        DIR.get().map(|d| d.join("secrets.json")).ok_or_else(|| "密钥存储还没初始化".to_string())
    }

    fn load(p: &Path) -> BTreeMap<String, String> {
        std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    fn save(p: &Path, m: &BTreeMap<String, String>) -> Result<(), String> {
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let tmp = p.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_string(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, p).map_err(|e| e.to_string())
    }

    /// 加密层（Android 上是 Keystore；单测里没有，按明文存）
    static SEAL: OnceLock<Box<dyn Seal>> = OnceLock::new();
    pub trait Seal: Send + Sync {
        fn seal(&self, plain: &str) -> Result<String, String>;
        fn open(&self, sealed: &str) -> Result<String, String>;
    }
    pub fn set_seal(s: Box<dyn Seal>) {
        let _ = SEAL.set(s);
    }
    const PREFIX: &str = "ks1:";
    fn seal(v: &str) -> Result<String, String> {
        match SEAL.get() {
            Some(s) => Ok(format!("{PREFIX}{}", s.seal(v)?)),
            None => Ok(v.to_string()),
        }
    }

    pub fn set(r: &str, secret: &str) -> Result<(), String> {
        let _g = LOCK.lock().unwrap();
        let p = path()?;
        let mut m = load(&p);
        m.insert(r.to_string(), seal(secret)?);
        save(&p, &m)
    }

    pub fn delete(r: &str) -> Result<(), String> {
        let _g = LOCK.lock().unwrap();
        let p = path()?;
        let mut m = load(&p);
        if m.remove(r).is_some() {
            save(&p, &m)?;
        }
        Ok(())
    }

    pub fn get(r: &str) -> Result<Option<String>, String> {
        let _g = LOCK.lock().unwrap();
        let p = path()?;
        let mut m = load(&p);
        let Some(v) = m.get(r).cloned() else { return Ok(None) };
        if let Some(sealed) = v.strip_prefix(PREFIX) {
            let s = SEAL.get().ok_or("这台设备上没有解密用的密钥")?;
            return s.open(sealed).map(Some);
        }
        // 以前存的明文：有加密层时顺手加密写回
        if SEAL.get().is_some() {
            if let Ok(sealed) = seal(&v) {
                m.insert(r.to_string(), sealed);
                let _ = save(&p, &m);
            }
        }
        Ok(Some(v))
    }

    #[cfg(test)]
    mod tests {
        struct Rev;
        impl super::Seal for Rev {
            fn seal(&self, p: &str) -> Result<String, String> {
                Ok(p.chars().rev().collect())
            }
            fn open(&self, s: &str) -> Result<String, String> {
                Ok(s.chars().rev().collect())
            }
        }

        // DIR、SEAL 是进程级的、只能设一次，所以按顺序放在一个测试里：先不加密，再加上加密层看迁移
        #[test]
        fn store_then_seal_and_migrate() {
            let dir = std::env::temp_dir().join(format!("tibi-keys-{}", std::process::id()));
            super::init(dir.clone());
            super::set("provider.deepseek.llm", "sk-1").unwrap();
            super::set("sync.webdav", "pw").unwrap();
            assert_eq!(super::get("provider.deepseek.llm").unwrap().as_deref(), Some("sk-1"));
            let p = dir.join("secrets.json");
            assert!(std::fs::read_to_string(&p).unwrap().contains("sync.webdav"));
            super::delete("provider.deepseek.llm").unwrap();
            assert_eq!(super::get("provider.deepseek.llm").unwrap(), None);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
            }
            // 加上加密层：新写的是密文；以前的明文照样能读，读完加密写回
            super::set_seal(Box::new(Rev));
            super::set("new", "abc").unwrap();
            let raw = std::fs::read_to_string(&p).unwrap();
            assert!(raw.contains("\"new\":\"ks1:cba\""), "{raw}");
            assert_eq!(super::get("new").unwrap().as_deref(), Some("abc"));
            assert_eq!(super::get("sync.webdav").unwrap().as_deref(), Some("pw"));
            assert!(std::fs::read_to_string(&p).unwrap().contains("ks1:wp"));
            assert_eq!(super::get("sync.webdav").unwrap().as_deref(), Some("pw"));
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

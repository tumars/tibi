//! 钥匙串（05 §8）：service = app.tibi，账户 = 引用名（如 provider.deepseek.llm）。
//! WebView 只能写入和删除；读取只给 sidecar 的 secret.get 反向请求。

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

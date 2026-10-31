//! 手机上 Core 跑在 WebView 里（00 §3.13、R11、T28）：这里只给它一个 SQLite（rusqlite，自带 FTS5），不做业务。
//! 每个库一条连接、加锁串行，BEGIN / COMMIT 跨多次调用也在同一条连接上（Core 的事务靠这个）。
//! 库：app（app_data_dir/app.db，读写）、dict（随包资源 dict.db，只读，可能没有）。

use rusqlite::{params_from_iter, types::Value as SqlV, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct Dbs(Mutex<HashMap<String, Connection>>);

fn to_sql(v: &Value) -> SqlV {
    match v {
        Value::Null => SqlV::Null,
        Value::Bool(b) => SqlV::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(SqlV::Integer).unwrap_or_else(|| SqlV::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlV::Text(s.clone()),
        Value::Array(a) => SqlV::Blob(a.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect()),
        Value::Object(_) => SqlV::Text(v.to_string()),
    }
}
fn to_json(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => json!(i),
        Real(f) => json!(f),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(b) => Value::Array(b.iter().map(|x| json!(x)).collect()),
    }
}

/// 打开（或确认已打开）一个库；返回实际路径。dict 不存在时返回 { path: null }
#[tauri::command]
pub fn db_open(app: AppHandle, dbs: State<'_, Dbs>, name: String) -> Result<Value, String> {
    let mut map = dbs.0.lock().unwrap();
    let path = match name.as_str() {
        "app" => {
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            dir.join("app.db")
        }
        "dict" => match app.path().resolve("dict.db", tauri::path::BaseDirectory::Resource) {
            Ok(p) if p.exists() => p,
            _ => return Ok(json!({ "path": null })),
        },
        _ => return Err("unknown db".into()),
    };
    if !map.contains_key(&name) {
        let conn = if name == "dict" { Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) } else { Connection::open(&path) }.map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        map.insert(name, conn);
    }
    Ok(json!({ "path": path.to_string_lossy() }))
}

fn with<T>(dbs: &State<'_, Dbs>, name: &str, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let map = dbs.0.lock().unwrap();
    let conn = map.get(name).ok_or("db not open")?;
    f(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_exec(dbs: State<'_, Dbs>, name: String, sql: String) -> Result<(), String> {
    // 逐条执行并读完返回的行（PRAGMA journal_mode 之类会返回一行，execute_batch 会当成错误）
    with(&dbs, &name, |c| {
        let mut batch = rusqlite::Batch::new(c, &sql);
        while let Some(mut st) = batch.next()? {
            let mut rows = st.raw_query();
            while rows.next()?.is_some() {}
        }
        Ok(())
    })
}

#[tauri::command]
pub fn db_run(dbs: State<'_, Dbs>, name: String, sql: String, params: Option<Vec<Value>>) -> Result<Value, String> {
    let ps: Vec<SqlV> = params.unwrap_or_default().iter().map(to_sql).collect();
    with(&dbs, &name, |c| {
        let mut st = c.prepare(&sql)?;
        if st.column_count() > 0 {
            // 有返回行的语句（如 PRAGMA journal_mode）：读完丢掉
            let mut rows = st.query(params_from_iter(ps.iter()))?;
            while rows.next()?.is_some() {}
            Ok(json!({ "changes": c.changes() }))
        } else {
            let n = st.execute(params_from_iter(ps.iter()))?;
            Ok(json!({ "changes": n }))
        }
    })
}

#[tauri::command]
pub fn db_all(dbs: State<'_, Dbs>, name: String, sql: String, params: Option<Vec<Value>>) -> Result<Vec<Map<String, Value>>, String> {
    let ps: Vec<SqlV> = params.unwrap_or_default().iter().map(to_sql).collect();
    with(&dbs, &name, |c| {
        let mut st = c.prepare(&sql)?;
        let cols: Vec<String> = st.column_names().into_iter().map(String::from).collect();
        let mut out = Vec::new();
        let mut rows = st.query(params_from_iter(ps.iter()))?;
        while let Some(r) = rows.next()? {
            let mut m = Map::new();
            for (i, k) in cols.iter().enumerate() {
                m.insert(k.clone(), to_json(r.get_ref(i)?));
            }
            out.push(m);
        }
        Ok(out)
    })
}

/// 手机上 Core 自己取 API Key（桌面上是 Core 进程经 stdio 向壳要，界面拿不到）
#[tauri::command]
pub fn keyring_get(r#ref: String) -> Result<Value, String> {
    Ok(json!({ "secret": crate::keys::get(&r#ref).ok().flatten() }))
}

/// 读用户在系统文件选择里挑的文件（手机导入 EPUB / PDF / Word / 图片）：原始字节，不过 JSON
#[tauri::command]
pub fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = path.strip_prefix("file://").unwrap_or(&path);
    std::fs::read(p).map(tauri::ipc::Response::new).map_err(|e| format!("读不了这个文件：{e}"))
}

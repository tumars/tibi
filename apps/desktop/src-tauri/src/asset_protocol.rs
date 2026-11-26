//! 安全的本地 `asset://` 协议处理器（覆盖 Tauri 默认实现）：
//! - 在 Apple 平台（macOS / iOS）上，文件 I/O 仍在后台线程池异步执行，但最终
//!   `responder.respond(...)` 统一切回主线程执行，与 WebKit 的 `webView:startURLSchemeTask:` /
//!   `webView:stopURLSchemeTask:` 严格串行，彻底消除播客 `<audio>` 频繁 Range 请求取消时
//!   跨线程调用 `WKURLSchemeTask`（`didReceiveResponse:` / `didReceiveData:` / `didFinish`）
//!   引发的竞态与 `NSInternalInconsistencyException` 崩溃。
//! - 对 `200` / `206` / `HEAD` 一律声明 `Accept-Ranges: bytes`，按扩展名快速识别常见音频与图片 MIME，
//!   避免每个 Range 分片重复读前 8 KB 探嗅再倒带。

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::path::SafePathBuf;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

/// 单次单段 Range 响应最大 1 MiB：兼顾大音频 seek 响应速度与内存占用
const MAX_RANGE_LEN: u64 = 1024 * 1024;
/// 单次多段 Range 请求允许的最大段数，防止 DoS 放大
const MAX_RANGES: usize = 32;
/// 非 Range 整文件读取上限（64 MiB）；大音频一律走 Range 请求
const MAX_FULL_FILE_LEN: u64 = 64 * 1024 * 1024;
const MULTIPART_BOUNDARY: &str = "tibi_asset_byteranges_boundary_7f9a3c";

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let scope = app.asset_protocol_scope();
    let origin = resolve_allow_origin(&app, &request);

    if request.method() == Method::OPTIONS {
        let resp = empty_response(StatusCode::NO_CONTENT, &origin, |b| {
            b.header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
                .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
                .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
        });
        respond_safely(&app, responder, resp);
        return;
    }

    let method = request.method().clone();
    let raw_path = request.uri().path().as_bytes().to_vec();
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    tauri::async_runtime::spawn_blocking(move || {
        let resp = serve_request(&method, &raw_path, range_header.as_deref(), &origin, |p| {
            scope.is_allowed(p)
        });
        respond_safely(&app, responder, resp);
    });
}

fn respond_safely<R: Runtime>(
    app: &AppHandle<R>,
    responder: UriSchemeResponder,
    response: Response<Vec<u8>>,
) {
    #[cfg(target_vendor = "apple")]
    {
        if let Err(e) = app.run_on_main_thread(move || {
            responder.respond(response);
        }) {
            log::warn!("asset 协议回到主线程响应失败：{e}");
        }
    }
    #[cfg(not(target_vendor = "apple"))]
    {
        let _ = app;
        responder.respond(response);
    }
}

fn resolve_allow_origin<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> String {
    if let Some(origin) = request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if is_local_app_origin(origin) {
            return origin.to_string();
        }
    }
    #[cfg(debug_assertions)]
    if let Some(dev_url) = app.config().build.dev_url.as_ref() {
        if let Some(host) = dev_url.host_str() {
            return match dev_url.port() {
                Some(port) => format!("{}://{host}:{port}", dev_url.scheme()),
                None => format!("{}://{host}", dev_url.scheme()),
            };
        }
    }
    let _ = app;
    if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost".to_string()
    } else {
        "tauri://localhost".to_string()
    }
}

fn is_local_app_origin(origin: &str) -> bool {
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = tauri::Url::parse(origin) {
            return url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
                && url.port().is_some()
                && url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none()
                && url.username().is_empty()
                && url.password().is_none();
        }
    }
    false
}

fn serve_request(
    method: &Method,
    raw_uri_path: &[u8],
    range_header: Option<&str>,
    origin: &str,
    is_allowed: impl FnOnce(&SafePathBuf) -> bool,
) -> Response<Vec<u8>> {
    if method != Method::GET && method != Method::HEAD {
        return empty_response(StatusCode::METHOD_NOT_ALLOWED, origin, |b| b);
    }

    let stripped = raw_uri_path.strip_prefix(b"/").unwrap_or(raw_uri_path);
    let decoded = percent_decode_utf8(stripped);
    if decoded.is_empty() {
        return empty_response(StatusCode::FORBIDDEN, origin, |b| b);
    }

    let safe_path = match SafePathBuf::new(PathBuf::from(&decoded)) {
        Ok(p) => p,
        Err(e) => {
            log::error!("asset 协议路径非法 \"{decoded}\": {e}");
            return empty_response(StatusCode::FORBIDDEN, origin, |b| b);
        }
    };

    if !is_allowed(&safe_path) {
        log::error!("asset 协议路径不在白名单范围内：{decoded}");
        return empty_response(StatusCode::FORBIDDEN, origin, |b| b);
    }

    serve_file(method, safe_path.as_ref(), range_header, origin)
}

fn serve_file(
    method: &Method,
    path: &Path,
    range_header: Option<&str>,
    origin: &str,
) -> Response<Vec<u8>> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            let status = match e.kind() {
                std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log::error!("asset 协议打开文件失败 \"{}\": {e}", path.display());
            return empty_response(status, origin, |b| b);
        }
    };

    let meta = match file.metadata() {
        Ok(m) => m,
        Err(e) => {
            log::error!("asset 协议读取元数据失败 \"{}\": {e}", path.display());
            return empty_response(StatusCode::INTERNAL_SERVER_ERROR, origin, |b| b);
        }
    };
    if !meta.is_file() {
        return empty_response(StatusCode::FORBIDDEN, origin, |b| b);
    }

    let len = meta.len();
    let mime = detect_mime(path, &mut file, len);

    if let Some(range_raw) = range_header {
        let Some(ranges) = parse_byte_ranges(range_raw, len) else {
            return range_not_satisfiable(len, origin);
        };

        if ranges.len() == 1 {
            let (start, mut end) = ranges[0];
            end = start + (end - start).min(MAX_RANGE_LEN - 1);
            let nbytes = end - start + 1;

            let (body, actual_end, actual_len) = if method == Method::HEAD {
                (Vec::new(), end, nbytes)
            } else {
                match read_range(&mut file, start, nbytes) {
                    Ok(buf) => {
                        if buf.is_empty() {
                            return range_not_satisfiable(len, origin);
                        }
                        let got = buf.len() as u64;
                        (buf, start + got - 1, got)
                    }
                    Err(e) => {
                        log::error!("asset 协议读取分片失败 \"{}\": {e}", path.display());
                        return empty_response(StatusCode::INTERNAL_SERVER_ERROR, origin, |b| b);
                    }
                }
            };

            return build_response(
                Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
                    .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{actual_end}/{len}"))
                    .header(header::CONTENT_LENGTH, actual_len),
                body,
                origin,
            );
        }

        // 多段 Range（multipart/byteranges）
        let mut body = Vec::new();
        let mut head_total: u64 = 0;
        for (start, mut end) in ranges {
            end = start + (end - start).min(MAX_RANGE_LEN - 1);
            let nbytes = end - start + 1;
            if method == Method::HEAD {
                let hdr = format!(
                    "\r\n--{MULTIPART_BOUNDARY}\r\nContent-Type: {mime}\r\nContent-Range: bytes {start}-{end}/{len}\r\n\r\n"
                );
                head_total += hdr.len() as u64 + nbytes;
            } else {
                let chunk = match read_range(&mut file, start, nbytes) {
                    Ok(c) => c,
                    Err(e) => {
                        log::error!("asset 协议读取多段分片失败 \"{}\": {e}", path.display());
                        return empty_response(StatusCode::INTERNAL_SERVER_ERROR, origin, |b| b);
                    }
                };
                if chunk.is_empty() {
                    return range_not_satisfiable(len, origin);
                }
                let actual_end = start + chunk.len() as u64 - 1;
                body.extend_from_slice(
                    format!(
                        "\r\n--{MULTIPART_BOUNDARY}\r\nContent-Type: {mime}\r\nContent-Range: bytes {start}-{actual_end}/{len}\r\n\r\n"
                    )
                    .as_bytes(),
                );
                body.extend_from_slice(&chunk);
            }
        }
        let closing = format!("\r\n--{MULTIPART_BOUNDARY}--\r\n");
        let total = if method == Method::HEAD {
            head_total + closing.len() as u64
        } else {
            body.extend_from_slice(closing.as_bytes());
            body.len() as u64
        };
        return build_response(
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_TYPE, format!("multipart/byteranges; boundary={MULTIPART_BOUNDARY}"))
                .header(header::CONTENT_LENGTH, total),
            body,
            origin,
        );
    }

    if method == Method::HEAD {
        return build_response(
            Response::builder()
                .status(StatusCode::OK)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_TYPE, mime)
                .header(header::CONTENT_LENGTH, len),
            Vec::new(),
            origin,
        );
    }

    if len > MAX_FULL_FILE_LEN {
        return empty_response(StatusCode::PAYLOAD_TOO_LARGE, origin, |b| {
            b.header(header::ACCEPT_RANGES, "bytes")
        });
    }

    let mut body = Vec::with_capacity(len as usize);
    if let Err(e) = file.seek(SeekFrom::Start(0)).and_then(|_| file.take(MAX_FULL_FILE_LEN + 1).read_to_end(&mut body)) {
        log::error!("asset 协议读取完整文件失败 \"{}\": {e}", path.display());
        return empty_response(StatusCode::INTERNAL_SERVER_ERROR, origin, |b| b);
    }
    if body.len() as u64 > MAX_FULL_FILE_LEN {
        return empty_response(StatusCode::PAYLOAD_TOO_LARGE, origin, |b| {
            b.header(header::ACCEPT_RANGES, "bytes")
        });
    }

    build_response(
        Response::builder()
            .status(StatusCode::OK)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_LENGTH, body.len()),
        body,
        origin,
    )
}

fn read_range(file: &mut File, start: u64, nbytes: u64) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity(nbytes as usize);
    file.take(nbytes).read_to_end(&mut buf)?;
    Ok(buf)
}

fn range_not_satisfiable(len: u64, origin: &str) -> Response<Vec<u8>> {
    empty_response(StatusCode::RANGE_NOT_SATISFIABLE, origin, |b| {
        b.header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range")
    })
}

fn empty_response(
    status: StatusCode,
    origin: &str,
    extra: impl FnOnce(tauri::http::response::Builder) -> tauri::http::response::Builder,
) -> Response<Vec<u8>> {
    let builder = extra(
        Response::builder()
            .status(status)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::CONTENT_LENGTH, 0),
    );
    build_response(builder, Vec::new(), origin)
}

fn build_response(
    builder: tauri::http::response::Builder,
    body: Vec<u8>,
    origin: &str,
) -> Response<Vec<u8>> {
    match builder.body(body) {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("asset 协议构造响应失败：{e}");
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()))
        }
    }
}

fn percent_decode_utf8(input: &[u8]) -> String {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'%' && i + 2 < input.len() {
            if let (Some(hi), Some(lo)) = (hex_val(input[i + 1]), hex_val(input[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(input[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// 按 RFC 9110 解析 `Range: bytes=...` 请求头，返回非空的 `(start, end)` 闭区间列表。
fn parse_byte_ranges(header_val: &str, file_len: u64) -> Option<Vec<(u64, u64)>> {
    if file_len == 0 {
        return None;
    }
    let trimmed = header_val.trim();
    let spec = trimmed
        .strip_prefix("bytes=")
        .or_else(|| {
            if trimmed.get(..6).is_some_and(|p| p.eq_ignore_ascii_case("bytes=")) {
                trimmed.get(6..)
            } else {
                None
            }
        })?;

    let mut ranges = Vec::new();
    for part in spec.split(',') {
        if ranges.len() >= MAX_RANGES {
            return None;
        }
        let part = part.trim();
        let (start_s, end_s) = part.split_once('-')?;
        let start_s = start_s.trim();
        let end_s = end_s.trim();

        let (start, end) = if start_s.is_empty() {
            // 后缀区间：bytes=-500
            let suffix: u64 = end_s.parse().ok()?;
            if suffix == 0 {
                return None;
            }
            let start = file_len.saturating_sub(suffix);
            (start, file_len - 1)
        } else {
            let start: u64 = start_s.parse().ok()?;
            if start >= file_len {
                return None;
            }
            let end = if end_s.is_empty() {
                file_len - 1
            } else {
                let parsed: u64 = end_s.parse().ok()?;
                if parsed < start {
                    return None;
                }
                parsed.min(file_len - 1)
            };
            (start, end)
        };
        ranges.push((start, end));
    }

    if ranges.is_empty() {
        None
    } else {
        Some(ranges)
    }
}

fn mime_from_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "ogg" | "oga" => Some("audio/ogg"),
        "opus" => Some("audio/opus"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "webm" => Some("audio/webm"),
        "mp4" | "m4v" => Some("video/mp4"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"),
        "vtt" => Some("text/vtt; charset=utf-8"),
        "srt" | "txt" | "md" => Some("text/plain; charset=utf-8"),
        "json" => Some("application/json"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

fn detect_mime(path: &Path, file: &mut File, len: u64) -> &'static str {
    if let Some(m) = mime_from_extension(path) {
        return m;
    }
    if len == 0 {
        return "application/octet-stream";
    }
    let mut head = [0u8; 16];
    let n = file.read(&mut head).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(0));
    sniff_magic_mime(&head[..n])
}

fn sniff_magic_mime(head: &[u8]) -> &'static str {
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if head.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        "image/gif"
    } else if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        "image/webp"
    } else if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WAVE" {
        "audio/wav"
    } else if head.starts_with(b"ID3")
        || (head.len() >= 2 && head[0] == 0xff && (head[1] & 0xe0) == 0xe0)
    {
        "audio/mpeg"
    } else if head.starts_with(b"OggS") {
        "audio/ogg"
    } else if head.starts_with(b"fLaC") {
        "audio/flac"
    } else if head.len() >= 8 && &head[4..8] == b"ftyp" {
        "audio/mp4"
    } else if head.starts_with(b"%PDF-") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_encoded_utf8_paths() {
        assert_eq!(
            percent_decode_utf8(b"%2FUsers%2Ftest%2FApplication%20Support%2F%E7%94%B5%E5%8F%B0.mp3"),
            "/Users/test/Application Support/电台.mp3"
        );
        assert_eq!(percent_decode_utf8(b"bad%ZZseq"), "bad%ZZseq");
    }

    #[test]
    fn parses_valid_and_invalid_byte_ranges() {
        assert_eq!(parse_byte_ranges("bytes=0-1", 100), Some(vec![(0, 1)]));
        assert_eq!(parse_byte_ranges("bytes=10-", 100), Some(vec![(10, 99)]));
        assert_eq!(parse_byte_ranges("bytes=-25", 100), Some(vec![(75, 99)]));
        assert_eq!(parse_byte_ranges("bytes=-200", 100), Some(vec![(0, 99)]));
        assert_eq!(parse_byte_ranges("bytes=50-999", 100), Some(vec![(50, 99)]));
        assert_eq!(parse_byte_ranges("bytes=0-9, 20-29", 100), Some(vec![(0, 9), (20, 29)]));

        assert_eq!(parse_byte_ranges("bytes=100-105", 100), None);
        assert_eq!(parse_byte_ranges("bytes=50-40", 100), None);
        assert_eq!(parse_byte_ranges("bytes=-0", 100), None);
        assert_eq!(parse_byte_ranges("bytes=0-0", 0), None);
        assert_eq!(parse_byte_ranges("items=0-10", 100), None);
    }

    #[test]
    fn serves_audio_range_head_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("tibi-asset-proto-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let mp3 = dir.join("ep.mp3");
        let payload: Vec<u8> = (0..(MAX_RANGE_LEN as usize + 500)).map(|i| (i % 251) as u8).collect();
        std::fs::write(&mp3, &payload).unwrap();

        let encoded = format!(
            "/{}",
            mp3.to_string_lossy()
                .replace('%', "%25")
                .replace('/', "%2F")
                .replace(' ', "%20")
        );

        // 1) 越权路径与目录穿越返回 403
        let denied = serve_request(&Method::GET, b"/..%2Fetc%2Fpasswd", None, "tauri://localhost", |_| true);
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let unscoped = serve_request(&Method::GET, encoded.as_bytes(), None, "tauri://localhost", |_| false);
        assert_eq!(unscoped.status(), StatusCode::FORBIDDEN);

        // 2) HEAD 返回 Accept-Ranges 与总字节数但不读正文
        let head = serve_request(&Method::HEAD, encoded.as_bytes(), None, "tauri://localhost", |_| true);
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers().get(header::ACCEPT_RANGES).unwrap(), "bytes");
        assert_eq!(head.headers().get(header::CONTENT_TYPE).unwrap(), "audio/mpeg");
        assert_eq!(head.headers().get(header::CONTENT_LENGTH).unwrap(), &payload.len().to_string());
        assert!(head.body().is_empty());

        // 3) 开放尾部 Range 自动按 MAX_RANGE_LEN 封顶并返回 206
        let r1 = serve_request(&Method::GET, encoded.as_bytes(), Some("bytes=0-"), "tauri://localhost", |_| true);
        assert_eq!(r1.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r1.body().len(), MAX_RANGE_LEN as usize);
        assert_eq!(
            r1.headers().get(header::CONTENT_RANGE).unwrap(),
            &format!("bytes 0-{}/{}", MAX_RANGE_LEN - 1, payload.len())
        );
        assert_eq!(r1.body(), &payload[..MAX_RANGE_LEN as usize]);

        // 4) 越界 Range 返回 416
        let r416 = serve_request(&Method::GET, encoded.as_bytes(), Some("bytes=99999999-"), "tauri://localhost", |_| true);
        assert_eq!(r416.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            r416.headers().get(header::CONTENT_RANGE).unwrap(),
            &format!("bytes */{}", payload.len())
        );

        // 5) 多段 Range 返回 multipart/byteranges，且 HEAD 返回准确非零 Content-Length
        let multi = serve_request(&Method::GET, encoded.as_bytes(), Some("bytes=0-3, 10-13"), "tauri://localhost", |_| true);
        assert_eq!(multi.status(), StatusCode::PARTIAL_CONTENT);
        assert!(multi.headers().get(header::CONTENT_TYPE).unwrap().to_str().unwrap().starts_with("multipart/byteranges; boundary="));
        assert!(multi.body().ends_with(format!("\r\n--{MULTIPART_BOUNDARY}--\r\n").as_bytes()));

        let multi_head = serve_request(&Method::HEAD, encoded.as_bytes(), Some("bytes=0-3, 10-13"), "tauri://localhost", |_| true);
        assert_eq!(multi_head.status(), StatusCode::PARTIAL_CONTENT);
        assert!(multi_head.body().is_empty());
        assert_eq!(
            multi_head.headers().get(header::CONTENT_LENGTH).unwrap(),
            &multi.body().len().to_string()
        );

        // 6) 超出段数上限（> MAX_RANGES）返回 416
        let too_many = (0..=MAX_RANGES).map(|i| format!("{i}-{i}")).collect::<Vec<_>>().join(",");
        let r_many = serve_request(&Method::GET, encoded.as_bytes(), Some(&format!("bytes={too_many}")), "tauri://localhost", |_| true);
        assert_eq!(r_many.status(), StatusCode::RANGE_NOT_SATISFIABLE);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_local_app_origins_strictly() {
        assert!(is_local_app_origin("tauri://localhost"));
        assert!(is_local_app_origin("http://tauri.localhost"));
        assert!(is_local_app_origin("https://tauri.localhost"));
        assert!(!is_local_app_origin("http://localhost:1420.evil.com"));
        assert!(!is_local_app_origin("tauri://localhost.evil.com"));
        assert!(!is_local_app_origin("https://evil.com"));
        assert!(!is_local_app_origin("not-a-url"));
    }
}

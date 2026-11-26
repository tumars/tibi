//! 桌面托盘与 macOS 顶栏快捷查词面板（Popover）。
//! - macOS：左键点击顶栏图标或按全局快捷键在图标正下方弹出快捷面板；右键弹出原生菜单。
//! - Windows / Linux：保留原生托盘菜单，提供相同的快速跳转入口。
//! - 窗口外观只用公开 AppKit API（Overlay 标题栏 + 隐藏红绿灯），官网版与 Mac App Store 沙盒版一致可用。

use crate::lock_or_recover;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Rect, State, Theme, WindowEvent};

pub const TRAY_ID: &str = "main-tray";
pub const TRAY_WINDOW_LABEL: &str = "tray";
pub const POPOVER_WIDTH: f64 = 392.0;
pub const POPOVER_HEIGHT: f64 = 520.0;
const BLUR_DEBOUNCE: Duration = Duration::from_millis(260);
const POPOVER_GAP_LOGICAL: f64 = 6.0;
const SCREEN_MARGIN_LOGICAL: f64 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonitorRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

struct TrayMenuItems {
    quick: MenuItem<tauri::Wry>,
    open: MenuItem<tauri::Wry>,
    review: MenuItem<tauri::Wry>,
    dict: MenuItem<tauri::Wry>,
    words: MenuItem<tauri::Wry>,
    import: MenuItem<tauri::Wry>,
    #[cfg(feature = "direct-distribution")]
    update: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct TrayUpdateBanner {
    pub version: Option<String>,
    pub stage: Option<String>,
    pub ratio: Option<f64>,
}

#[derive(Default)]
pub struct TrayState {
    pinned: Mutex<bool>,
    last_blur_at: Mutex<Option<Instant>>,
    last_rect: Mutex<Option<Rect>>,
    menu_items: Mutex<Option<TrayMenuItems>>,
    update_banner: Mutex<TrayUpdateBanner>,
}

/// 根据托盘图标矩形（物理坐标）和显示器列表，计算弹出面板的物理坐标，保证贴近图标且不越出屏幕。
pub fn compute_popover_position(
    icon: Option<Bounds>,
    popover_logical: (f64, f64),
    monitors: &[MonitorRect],
    gap_logical: f64,
    margin_logical: f64,
) -> Option<(i32, i32)> {
    if monitors.is_empty() {
        return None;
    }
    let pick_monitor = |pt: (f64, f64)| -> MonitorRect {
        monitors
            .iter()
            .copied()
            .find(|m| pt.0 >= m.x && pt.0 < m.x + m.width && pt.1 >= m.y && pt.1 < m.y + m.height)
            .unwrap_or(monitors[0])
    };
    let Some(icon) = icon else {
        let m = monitors[0];
        let scale = if m.scale > 0.0 { m.scale } else { 1.0 };
        let pw = popover_logical.0 * scale;
        let ph = popover_logical.1 * scale;
        let margin = margin_logical * scale;
        let min_x = m.x + margin;
        let max_x = (m.x + m.width - pw - margin).max(min_x);
        let x = (m.x + (m.width - pw) / 2.0).clamp(min_x, max_x);
        let min_y = m.y + margin;
        let max_y = (m.y + m.height - ph - margin).max(min_y);
        let y = (m.y + 36.0 * scale).clamp(min_y, max_y);
        return Some((x.round() as i32, y.round() as i32));
    };
    let cx = icon.x + icon.width / 2.0;
    let cy = icon.y + icon.height / 2.0;
    let m = pick_monitor((cx, cy));
    let scale = if m.scale > 0.0 { m.scale } else { 1.0 };
    let pw = popover_logical.0 * scale;
    let ph = popover_logical.1 * scale;
    let margin = margin_logical * scale;
    let gap = gap_logical * scale;

    let min_x = m.x + margin;
    let max_x = (m.x + m.width - pw - margin).max(min_x);
    let x = (cx - pw / 2.0).clamp(min_x, max_x);

    let min_y = m.y + margin;
    let max_y = (m.y + m.height - ph - margin).max(min_y);
    let y = (icon.y + icon.height + gap).clamp(min_y, max_y);

    Some((x.round() as i32, y.round() as i32))
}

fn rect_to_bounds(rect: &Rect, fallback_scale: f64) -> Bounds {
    let pos = rect.position.to_physical::<f64>(fallback_scale);
    let size = rect.size.to_physical::<f64>(fallback_scale);
    Bounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    }
}

fn collect_monitors(app: &AppHandle) -> Vec<MonitorRect> {
    let mut out = Vec::new();
    if let Ok(Some(primary)) = app.primary_monitor() {
        out.push(MonitorRect {
            x: primary.position().x as f64,
            y: primary.position().y as f64,
            width: primary.size().width as f64,
            height: primary.size().height as f64,
            scale: primary.scale_factor(),
        });
    }
    if let Ok(list) = app.available_monitors() {
        for m in list {
            let item = MonitorRect {
                x: m.position().x as f64,
                y: m.position().y as f64,
                width: m.size().width as f64,
                height: m.size().height as f64,
                scale: m.scale_factor(),
            };
            if !out.contains(&item) {
                out.push(item);
            }
        }
    }
    out
}

pub fn show_main_window(app: &AppHandle, route: Option<&str>, ask: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if route.is_some() || ask.is_some() {
            let _ = w.emit("tray_navigate", json!({ "route": route, "ask": ask }));
        }
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_popover_window(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton, NSWindowCollectionBehavior};

    let Ok(ptr) = window.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    unsafe {
        let ns_win: &NSWindow = &*(ptr as *const NSWindow);
        for btn_kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(btn) = ns_win.standardWindowButton(btn_kind) {
                let view: &NSView = &btn;
                view.setHidden(true);
            }
        }
        ns_win.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        // NSStatusWindowLevel = 25：高于普通窗口和全屏应用，低于系统弹出菜单
        ns_win.setLevel(25);
        ns_win.setHidesOnDeactivate(false);
        ns_win.setHasShadow(true);
    }
}

#[cfg(target_os = "macos")]
fn ensure_popover_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        return Some(w);
    }
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        TRAY_WINDOW_LABEL,
        tauri::WebviewUrl::App("tray.html".into()),
    )
    .title("Tibi")
    .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
    .resizable(false)
    .visible(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .shadow(true)
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true);

    match builder.build() {
        Ok(w) => {
            configure_macos_popover_window(&w);
            Some(w)
        }
        Err(e) => {
            log::error!("创建托盘快捷面板失败：{e}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn hide_popover_inner(app: &AppHandle, record_blur: bool) {
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = w.hide();
        let _ = w.emit("tray_hidden", json!({}));
    }
    if record_blur {
        if let Some(st) = app.try_state::<TrayState>() {
            *lock_or_recover(&st.last_blur_at) = Some(Instant::now());
        }
    }
}

#[cfg(target_os = "macos")]
fn show_popover_at(app: &AppHandle, rect: Option<Rect>) {
    let Some(w) = ensure_popover_window(app) else {
        return;
    };
    let effective_rect = rect
        .or_else(|| app.tray_by_id(TRAY_ID).and_then(|t| t.rect().ok().flatten()))
        .or_else(|| app.try_state::<TrayState>().and_then(|s| *lock_or_recover(&s.last_rect)));

    let monitors = collect_monitors(app);
    let fallback_scale = monitors.first().map(|m| m.scale).unwrap_or(2.0);
    let icon_bounds = effective_rect.as_ref().map(|r| rect_to_bounds(r, fallback_scale));
    if let Some((x, y)) = compute_popover_position(
        icon_bounds,
        (POPOVER_WIDTH, POPOVER_HEIGHT),
        &monitors,
        POPOVER_GAP_LOGICAL,
        SCREEN_MARGIN_LOGICAL,
    ) {
        let _ = w.set_position(tauri::Position::Physical(PhysicalPosition::new(x, y)));
    }
    let _ = w.show();
    let _ = w.set_focus();
    let banner = app
        .try_state::<TrayState>()
        .map(|s| lock_or_recover(&s.update_banner).clone())
        .unwrap_or_default();
    let _ = w.emit("tray_opened", json!({ "update": banner }));
}

#[cfg(target_os = "macos")]
pub fn toggle_from_click(app: &AppHandle, rect: Rect) {
    if let Some(st) = app.try_state::<TrayState>() {
        *lock_or_recover(&st.last_rect) = Some(rect);
        let recently_blurred = lock_or_recover(&st.last_blur_at)
            .map(|t| t.elapsed() < BLUR_DEBOUNCE)
            .unwrap_or(false);
        if recently_blurred {
            *lock_or_recover(&st.last_blur_at) = None;
            return;
        }
    }
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            hide_popover_inner(app, false);
            return;
        }
    }
    show_popover_at(app, Some(rect));
}

#[cfg(target_os = "macos")]
pub fn toggle_from_hotkey(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            hide_popover_inner(app, false);
            return;
        }
    }
    show_popover_at(app, None);
}

pub fn handle_popover_window_event(window: &tauri::Window, event: &WindowEvent) -> bool {
    if window.label() != TRAY_WINDOW_LABEL {
        return false;
    }
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            #[cfg(target_os = "macos")]
            hide_popover_inner(window.app_handle(), false);
            #[cfg(not(target_os = "macos"))]
            let _ = window.hide();
        }
        WindowEvent::Focused(false) => {
            let pinned = window
                .try_state::<TrayState>()
                .map(|s| *lock_or_recover(&s.pinned))
                .unwrap_or(false);
            if !pinned && window.is_visible().unwrap_or(false) {
                #[cfg(target_os = "macos")]
                hide_popover_inner(window.app_handle(), true);
                #[cfg(not(target_os = "macos"))]
                let _ = window.hide();
            }
        }
        _ => {}
    }
    true
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let quick = MenuItem::with_id(app, "quick", "快速查词", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开 Tibi", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let review = MenuItem::with_id(app, "review", "开始复习", true, None::<&str>)?;
    let dict = MenuItem::with_id(app, "dict", "词典", true, None::<&str>)?;
    let words = MenuItem::with_id(app, "words", "生词本", true, None::<&str>)?;
    let import = MenuItem::with_id(app, "import", "导入文章", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    #[cfg(feature = "direct-distribution")]
    let update = MenuItem::with_id(app, "update", "检查更新…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Tibi", true, None::<&str>)?;

    #[cfg(feature = "direct-distribution")]
    let menu = Menu::with_items(
        app,
        &[&quick, &open, &sep1, &review, &dict, &words, &import, &sep2, &update, &settings, &quit],
    )?;
    #[cfg(not(feature = "direct-distribution"))]
    let menu = Menu::with_items(
        app,
        &[&quick, &open, &sep1, &review, &dict, &words, &import, &sep2, &settings, &quit],
    )?;

    if let Some(st) = app.try_state::<TrayState>() {
        *lock_or_recover(&st.menu_items) = Some(TrayMenuItems {
            quick,
            open,
            review,
            dict,
            words,
            import,
            #[cfg(feature = "direct-distribution")]
            update,
            settings,
            quit,
        });
    }

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Tibi")
        // macOS：左键弹快捷查词面板，右键弹系统菜单；其他平台左键直接开菜单
        .show_menu_on_left_click(!cfg!(target_os = "macos"))
        .on_menu_event(|app, e| match e.id.as_ref() {
            "quick" => {
                #[cfg(target_os = "macos")]
                show_popover_at(app, None);
                #[cfg(not(target_os = "macos"))]
                show_main_window(app, Some("/dict"), None);
            }
            "open" => show_main_window(app, None, None),
            "review" => show_main_window(app, Some("/review?run=1"), None),
            "dict" => show_main_window(app, Some("/dict"), None),
            "words" => show_main_window(app, Some("/words"), None),
            "import" => show_main_window(app, Some("/?compose=1"), None),
            #[cfg(feature = "direct-distribution")]
            "update" => show_main_window(app, Some("__update__"), None),
            "settings" => show_main_window(app, Some("/settings"), None),
            "quit" => {
                if let Some(c) = app.try_state::<Arc<crate::core::CoreProcess>>() {
                    c.stop();
                }
                app.exit(0);
            }
            _ => {}
        });

    #[cfg(target_os = "macos")]
    {
        tray = tray
            .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?)
            .icon_as_template(true)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } = event
                {
                    toggle_from_click(tray.app_handle(), rect);
                }
            });
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    // macOS：启动时预热隐藏的快捷查词面板，首次点击零延迟打开
    #[cfg(target_os = "macos")]
    {
        let handle = app.handle().clone();
        let _ = ensure_popover_window(&handle);
    }

    Ok(())
}

#[tauri::command]
pub fn tray_hide(app: AppHandle) -> Value {
    #[cfg(target_os = "macos")]
    hide_popover_inner(&app, false);
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = w.hide();
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn tray_set_pinned(state: State<'_, TrayState>, pinned: bool) -> Value {
    *lock_or_recover(&state.pinned) = pinned;
    json!({ "ok": true, "pinned": pinned })
}

#[tauri::command]
pub fn tray_open_main(
    app: AppHandle,
    state: State<'_, TrayState>,
    route: Option<String>,
    ask: Option<String>,
) -> Value {
    show_main_window(&app, route.as_deref(), ask.as_deref());
    let pinned = *lock_or_recover(&state.pinned);
    if !pinned {
        #[cfg(target_os = "macos")]
        hide_popover_inner(&app, false);
    }
    json!({ "ok": true })
}

#[cfg(feature = "direct-distribution")]
fn format_update_menu_text(banner: &TrayUpdateBanner, en: bool) -> String {
    match (banner.stage.as_deref(), banner.version.as_deref()) {
        (Some("ready"), Some(v)) => {
            if en { format!("Restart to Update ({v})…") } else { format!("重启以更新 Tibi {v}…") }
        }
        (Some("downloading"), Some(v)) => {
            if en { format!("Downloading Tibi {v}…") } else { format!("正在下载 Tibi {v}…") }
        }
        (Some("available"), Some(v)) => {
            if en { format!("Update Available ({v})…") } else { format!("发现新版本 {v}…") }
        }
        _ => {
            if en { "Check for Updates…".to_string() } else { "检查更新…".to_string() }
        }
    }
}

#[tauri::command]
pub fn tray_update_summary(
    app: AppHandle,
    state: State<'_, TrayState>,
    due: u32,
    lang: Option<String>,
) -> Value {
    let en = lang.as_deref() == Some("en");
    #[cfg(feature = "direct-distribution")]
    let banner = lock_or_recover(&state.update_banner).clone();
    if let Some(items) = lock_or_recover(&state.menu_items).as_ref() {
        let _ = items.quick.set_text(if en { "Quick Lookup" } else { "快速查词" });
        let _ = items.open.set_text(if en { "Open Tibi" } else { "打开 Tibi" });
        let review_text = if due > 0 {
            if en {
                format!("Review ({due} due)")
            } else {
                format!("开始复习（{due} 张待复习）")
            }
        } else if en {
            "Review".to_string()
        } else {
            "开始复习".to_string()
        };
        let _ = items.review.set_text(review_text);
        let _ = items.dict.set_text(if en { "Dictionary" } else { "词典" });
        let _ = items.words.set_text(if en { "Wordbook" } else { "生词本" });
        let _ = items.import.set_text(if en { "Import Article" } else { "导入文章" });
        #[cfg(feature = "direct-distribution")]
        let _ = items.update.set_text(format_update_menu_text(&banner, en));
        let _ = items.settings.set_text(if en { "Settings…" } else { "设置…" });
        let _ = items.quit.set_text(if en { "Quit Tibi" } else { "退出 Tibi" });
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tip = if due > 0 {
            if en {
                format!("Tibi · {due} due for review")
            } else {
                format!("Tibi · {due} 张待复习")
            }
        } else if en {
            "Tibi · Quick Lookup".to_string()
        } else {
            "Tibi · 快速查词".to_string()
        };
        let _ = tray.set_tooltip(Some(&tip));
    }
    json!({ "ok": true })
}

/// 同步更新状态到托盘右键菜单与 macOS 快捷查词面板
#[tauri::command]
pub fn tray_sync_update(
    app: AppHandle,
    state: State<'_, TrayState>,
    version: Option<String>,
    stage: Option<String>,
    ratio: Option<f64>,
    lang: Option<String>,
) -> Value {
    let banner = TrayUpdateBanner { version, stage, ratio };
    *lock_or_recover(&state.update_banner) = banner.clone();
    #[cfg(feature = "direct-distribution")]
    {
        let en = lang.as_deref() == Some("en");
        if let Some(items) = lock_or_recover(&state.menu_items).as_ref() {
            let _ = items.update.set_text(format_update_menu_text(&banner, en));
        }
    }
    #[cfg(not(feature = "direct-distribution"))]
    let _ = lang;
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = w.emit("tray_update", &banner);
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn tray_get_update(state: State<'_, TrayState>) -> TrayUpdateBanner {
    lock_or_recover(&state.update_banner).clone()
}

#[tauri::command]
pub fn tray_sync_theme(app: AppHandle, theme: String) -> Value {
    let win_theme = match theme.as_str() {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    };
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = w.set_theme(win_theme);
        let _ = w.emit("tray_theme", json!({ "theme": theme }));
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn tray_set_hotkey(app: AppHandle, preset: String) -> Result<Value, String> {
    let active = crate::hotkey::apply(&app, &preset)?;
    Ok(json!({ "ok": true, "preset": active }))
}

/// 读取系统剪贴板纯文本（macOS 公开 AppKit API，供快捷面板展示"查剪贴板 / 导入剪贴板网址"建议条）。
#[tauri::command]
pub fn tray_read_clipboard() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        let pb = NSPasteboard::generalPasteboard();
        let text = unsafe { pb.stringForType(NSPasteboardTypeString) }?.to_string();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        // 只取前 2000 字符，避免大块文本复制拖慢 IPC
        let clipped: String = trimmed.chars().take(2000).collect();
        Some(clipped)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_popover_under_tray_icon_on_retina_display() {
        let monitors = [MonitorRect {
            x: 0.0,
            y: 0.0,
            width: 3024.0,
            height: 1964.0,
            scale: 2.0,
        }];
        let icon = Bounds {
            x: 2200.0,
            y: 0.0,
            width: 56.0,
            height: 48.0,
        };
        let pos = compute_popover_position(Some(icon), (392.0, 520.0), &monitors, 6.0, 8.0).unwrap();
        // icon center = 2228, popover width = 784 => x = 2228 - 392 = 1836; y = 48 + 12 = 60
        assert_eq!(pos, (1836, 60));
    }

    #[test]
    fn clamps_popover_to_right_edge_when_icon_near_corner() {
        let monitors = [MonitorRect {
            x: 0.0,
            y: 0.0,
            width: 2880.0,
            height: 1800.0,
            scale: 2.0,
        }];
        let icon = Bounds {
            x: 2800.0,
            y: 0.0,
            width: 48.0,
            height: 48.0,
        };
        let pos = compute_popover_position(Some(icon), (392.0, 520.0), &monitors, 6.0, 8.0).unwrap();
        // max_x = 2880 - 784 - 16 = 2080
        assert_eq!(pos, (2080, 60));
    }

    #[test]
    fn supports_secondary_monitor_with_negative_origin() {
        let monitors = [
            MonitorRect { x: 0.0, y: 0.0, width: 2560.0, height: 1440.0, scale: 2.0 },
            MonitorRect { x: -1920.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
        ];
        let icon = Bounds {
            x: -1910.0,
            y: 0.0,
            width: 28.0,
            height: 24.0,
        };
        let pos = compute_popover_position(Some(icon), (392.0, 520.0), &monitors, 6.0, 8.0).unwrap();
        // Left-clamped on secondary monitor: -1920 + 8 = -1912; y = 24 + 6 = 30
        assert_eq!(pos, (-1912, 30));
    }

    #[test]
    fn falls_back_to_top_center_when_icon_rect_unavailable() {
        let monitors = [MonitorRect {
            x: 0.0,
            y: 0.0,
            width: 2000.0,
            height: 1200.0,
            scale: 2.0,
        }];
        let pos = compute_popover_position(None, (392.0, 520.0), &monitors, 6.0, 8.0).unwrap();
        // (2000 - 784) / 2 = 608; y = 36 * 2 = 72
        assert_eq!(pos, (608, 72));
    }
}

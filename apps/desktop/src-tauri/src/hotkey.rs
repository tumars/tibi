//! macOS 全局快捷键（基于 Carbon HIToolbox `RegisterEventHotKey`）。
//! 公开系统 API，不需要辅助功能权限，Mac App Store 沙盒也可用。

#[cfg(target_os = "macos")]
use std::ffi::c_void;
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};

/// 解析预设快捷键名称 → (macOS virtual keycode, Carbon modifier mask)
pub fn parse_preset(preset: &str) -> Option<(u32, u32)> {
    // <Carbon/HIToolbox/Events.h>
    const CMD_KEY: u32 = 1 << 8;
    const SHIFT_KEY: u32 = 1 << 9;
    const OPTION_KEY: u32 = 1 << 11;
    const CONTROL_KEY: u32 = 1 << 12;

    const VK_ANSI_D: u32 = 0x02;
    const VK_ANSI_T: u32 = 0x11;
    const VK_ANSI_L: u32 = 0x25;
    const VK_SPACE: u32 = 0x31;

    match preset.trim().to_ascii_lowercase().as_str() {
        "" | "off" | "none" => None,
        "alt+shift+d" | "option+shift+d" => Some((VK_ANSI_D, OPTION_KEY | SHIFT_KEY)),
        "ctrl+alt+d" | "ctrl+option+d" => Some((VK_ANSI_D, CONTROL_KEY | OPTION_KEY)),
        "ctrl+alt+t" | "ctrl+option+t" => Some((VK_ANSI_T, CONTROL_KEY | OPTION_KEY)),
        "alt+space" | "option+space" => Some((VK_SPACE, OPTION_KEY)),
        "cmd+shift+l" => Some((VK_ANSI_L, CMD_KEY | SHIFT_KEY)),
        _ => None,
    }
}

pub fn is_valid_preset(preset: &str) -> bool {
    let norm = preset.trim().to_ascii_lowercase();
    matches!(norm.as_str(), "" | "off" | "none") || parse_preset(&norm).is_some()
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use tauri::AppHandle;

    type OSStatus = i32;
    type EventTargetRef = *mut c_void;
    type EventHandlerCallRef = *mut c_void;
    type EventRef = *mut c_void;
    type EventHandlerRef = *mut c_void;
    type EventHotKeyRef = *mut c_void;

    const NO_ERR: OSStatus = 0;
    const EVENT_CLASS_KEYBOARD: u32 = u32::from_be_bytes(*b"keyb");
    const EVENT_HOT_KEY_PRESSED: u32 = 5;
    const EVENT_PARAM_DIRECT_OBJECT: u32 = u32::from_be_bytes(*b"----");
    const TYPE_EVENT_HOT_KEY_ID: u32 = u32::from_be_bytes(*b"hkid");
    const HOTKEY_SIGNATURE: u32 = u32::from_be_bytes(*b"TIBI");
    const HOTKEY_ID: u32 = 1;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct EventTypeSpec {
        event_class: u32,
        event_kind: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct EventHotKeyID {
        signature: u32,
        id: u32,
    }

    type EventHandlerProcPtr = extern "C" fn(EventHandlerCallRef, EventRef, *mut c_void) -> OSStatus;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn GetApplicationEventTarget() -> EventTargetRef;
        fn InstallEventHandler(
            in_target: EventTargetRef,
            in_handler: EventHandlerProcPtr,
            in_num_types: u32,
            in_list: *const EventTypeSpec,
            in_user_data: *mut c_void,
            out_ref: *mut EventHandlerRef,
        ) -> OSStatus;
        fn RegisterEventHotKey(
            in_hot_key_code: u32,
            in_hot_key_modifiers: u32,
            in_hot_key_id: EventHotKeyID,
            in_target: EventTargetRef,
            in_options: u32,
            out_ref: *mut EventHotKeyRef,
        ) -> OSStatus;
        fn UnregisterEventHotKey(in_hot_key: EventHotKeyRef) -> OSStatus;
        fn GetEventParameter(
            in_event: EventRef,
            in_name: u32,
            in_desired_type: u32,
            out_actual_type: *mut u32,
            in_buffer_size: usize,
            out_actual_size: *mut usize,
            out_data: *mut c_void,
        ) -> OSStatus;
    }

    #[derive(Default)]
    struct HotKeySlot {
        handler_installed: bool,
        hotkey_ref: usize,
        preset: String,
    }

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static SLOT: OnceLock<Mutex<HotKeySlot>> = OnceLock::new();

    fn slot() -> &'static Mutex<HotKeySlot> {
        SLOT.get_or_init(|| Mutex::new(HotKeySlot::default()))
    }

    extern "C" fn on_hotkey_event(
        _next: EventHandlerCallRef,
        event: EventRef,
        _user_data: *mut c_void,
    ) -> OSStatus {
        let mut hk = EventHotKeyID::default();
        let status = unsafe {
            GetEventParameter(
                event,
                EVENT_PARAM_DIRECT_OBJECT,
                TYPE_EVENT_HOT_KEY_ID,
                std::ptr::null_mut(),
                std::mem::size_of::<EventHotKeyID>(),
                std::ptr::null_mut(),
                (&mut hk as *mut EventHotKeyID).cast::<c_void>(),
            )
        };
        if status == NO_ERR && hk.signature == HOTKEY_SIGNATURE && hk.id == HOTKEY_ID {
            if let Some(app) = APP_HANDLE.get() {
                crate::tray::toggle_from_hotkey(app);
            }
        }
        NO_ERR
    }

    /// 在主线程注册或取消全局快捷键。返回当前生效的 preset（"off" 表示未启用）。
    pub fn apply(app: &AppHandle, preset: &str) -> Result<String, String> {
        if !is_valid_preset(preset) {
            return Err(format!("不支持的快捷键组合：{preset}"));
        }
        let _ = APP_HANDLE.set(app.clone());
        let normalized = if parse_preset(preset).is_none() {
            "off".to_string()
        } else {
            preset.trim().to_ascii_lowercase()
        };
        let target = parse_preset(&normalized);
        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<String, String>>(1);
        let norm_for_main = normalized.clone();
        app.run_on_main_thread(move || {
            let mut guard = slot().lock().unwrap();
            unsafe {
                if guard.hotkey_ref != 0 {
                    let _ = UnregisterEventHotKey(guard.hotkey_ref as EventHotKeyRef);
                    guard.hotkey_ref = 0;
                }
                let Some((vk, mods)) = target else {
                    guard.preset = "off".into();
                    let _ = tx.send(Ok("off".into()));
                    return;
                };
                if !guard.handler_installed {
                    let spec = EventTypeSpec {
                        event_class: EVENT_CLASS_KEYBOARD,
                        event_kind: EVENT_HOT_KEY_PRESSED,
                    };
                    let mut out_handler: EventHandlerRef = std::ptr::null_mut();
                    let st = InstallEventHandler(
                        GetApplicationEventTarget(),
                        on_hotkey_event,
                        1,
                        &spec,
                        std::ptr::null_mut(),
                        &mut out_handler,
                    );
                    if st != NO_ERR {
                        let _ = tx.send(Err(format!("无法安装快捷键监听（OSStatus {st}）")));
                        return;
                    }
                    guard.handler_installed = true;
                }
                let hk_id = EventHotKeyID {
                    signature: HOTKEY_SIGNATURE,
                    id: HOTKEY_ID,
                };
                let mut out_ref: EventHotKeyRef = std::ptr::null_mut();
                let st = RegisterEventHotKey(
                    vk,
                    mods,
                    hk_id,
                    GetApplicationEventTarget(),
                    0,
                    &mut out_ref,
                );
                if st != NO_ERR || out_ref.is_null() {
                    guard.preset = "off".into();
                    let _ = tx.send(Err("快捷键可能已被其他应用占用".into()));
                    return;
                }
                guard.hotkey_ref = out_ref as usize;
                guard.preset = norm_for_main.clone();
                let _ = tx.send(Ok(norm_for_main));
            }
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
}

#[cfg(target_os = "macos")]
pub use mac::apply;

#[cfg(not(target_os = "macos"))]
pub fn apply(_app: &tauri::AppHandle, preset: &str) -> Result<String, String> {
    if !is_valid_preset(preset) {
        return Err(format!("不支持的快捷键组合：{preset}"));
    }
    Ok("off".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_presets_and_off() {
        assert_eq!(parse_preset("off"), None);
        assert_eq!(parse_preset(""), None);
        assert!(parse_preset("alt+shift+d").is_some());
        assert!(parse_preset("ALT+SHIFT+D").is_some());
        assert!(parse_preset("ctrl+alt+d").is_some());
        assert!(parse_preset("ctrl+alt+t").is_some());
        assert!(parse_preset("alt+space").is_some());
        assert!(parse_preset("cmd+shift+l").is_some());
        assert_eq!(parse_preset("unknown+key"), None);
        assert!(is_valid_preset("off"));
        assert!(is_valid_preset("alt+shift+d"));
        assert!(!is_valid_preset("ctrl+z"));
    }
}

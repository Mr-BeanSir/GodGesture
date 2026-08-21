//! 窗口/进程查询 —— 前台应用解析(exe 名/路径)与全屏检测。
//! 语义对齐 WGestures:
//! - "总是作用于指针下方的窗口"时用 WindowFromPoint,否则 GetForegroundWindow;
//! - 目标窗口取 GetAncestor(GA_ROOT);
//! - exe 路径经 OpenProcess + QueryFullProcessImageNameW 解析,按 pid 缓存;
//! - 全屏检测:前台根窗口矩形 == 所在显示器矩形,且类名不在白名单
//!   (桌面/开始菜单等宿主类)。

use crate::engine::corners::{ScreenInfo, ScreenRect};
use crate::engine::intents::ForegroundApp;
use crate::engine::types::Point;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use windows::core::PWSTR;
use windows::Win32::Foundation::{
    CloseHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE, HWND, POINT, RECT, WIN32_ERROR,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITORINFO,
    MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow, GetParent, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
};

/// pid → (exe_name, exe_path) 缓存(pid 复用风险低,进程退出后条目自然失效)
type ExeIdentity = (String, String, Option<String>);

static EXE_CACHE: Mutex<Option<HashMap<u32, ExeIdentity>>> = Mutex::new(None);

/// Windows input hooks cannot cross from a lower-integrity process into a
/// higher-integrity target without an elevated or uiAccess process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrityLevel {
    Unknown,
    Untrusted,
    Low,
    Medium,
    High,
    System,
    Protected,
}

impl IntegrityLevel {
    pub fn is_higher_than(self, other: Self) -> bool {
        self.rank() > other.rank() && self != Self::Unknown && other != Self::Unknown
    }

    fn rank(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Untrusted => 1,
            Self::Low => 2,
            Self::Medium => 3,
            Self::High => 4,
            Self::System => 5,
            Self::Protected => 6,
        }
    }
}

fn integrity_level_from_rid(rid: u32) -> IntegrityLevel {
    match rid {
        0 => IntegrityLevel::Untrusted,
        0x1000..0x2000 => IntegrityLevel::Low,
        0x2000..0x3000 => IntegrityLevel::Medium,
        0x3000..0x4000 => IntegrityLevel::High,
        0x4000..0x5000 => IntegrityLevel::System,
        0x5000.. => IntegrityLevel::Protected,
        _ => IntegrityLevel::Unknown,
    }
}

fn token_integrity_level(token: HANDLE) -> IntegrityLevel {
    let mut required = 0u32;
    let _ = unsafe { GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut required) };
    if required == 0 {
        return IntegrityLevel::Unknown;
    }

    let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    if unsafe {
        GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr().cast()),
            required,
            &mut required,
        )
    }
    .is_err()
    {
        return IntegrityLevel::Unknown;
    }

    let label = unsafe { &*(buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>()) };
    let count = unsafe { GetSidSubAuthorityCount(label.Label.Sid) };
    if count.is_null() {
        return IntegrityLevel::Unknown;
    }
    let count = unsafe { *count };
    if count == 0 {
        return IntegrityLevel::Unknown;
    }
    let rid = unsafe { GetSidSubAuthority(label.Label.Sid, u32::from(count - 1)) };
    if rid.is_null() {
        return IntegrityLevel::Unknown;
    }
    integrity_level_from_rid(unsafe { *rid })
}

fn process_integrity_level(pid: u32) -> IntegrityLevel {
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
    else {
        return IntegrityLevel::Unknown;
    };
    let mut token = HANDLE::default();
    let result = unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }
        .map(|()| token_integrity_level(token));
    if !token.is_invalid() {
        let _ = unsafe { CloseHandle(token) };
    }
    let _ = unsafe { CloseHandle(process) };
    result.unwrap_or(IntegrityLevel::Unknown)
}

/// Returns the integrity level of the current GodGesture process.
pub fn current_process_integrity_level() -> IntegrityLevel {
    let mut token = HANDLE::default();
    let result = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map(|()| token_integrity_level(token));
    if !token.is_invalid() {
        let _ = unsafe { CloseHandle(token) };
    }
    result.unwrap_or(IntegrityLevel::Unknown)
}

/// Returns the integrity level of the root window under the cursor (or the
/// foreground root window when cursor preference is disabled).
pub fn target_integrity_level(pos: Point, prefer_cursor_window: bool) -> IntegrityLevel {
    let Some(hwnd) = target_root_window(pos, prefer_cursor_window) else {
        return IntegrityLevel::Unknown;
    };
    let pid = window_pid(hwnd);
    if pid == 0 {
        return IntegrityLevel::Unknown;
    }
    process_integrity_level(pid)
}

/// 手势目标窗口:指针下窗口或前台窗口的根窗口
pub fn target_root_window(pos: Point, prefer_cursor_window: bool) -> Option<HWND> {
    unsafe {
        let hwnd = if prefer_cursor_window {
            WindowFromPoint(POINT { x: pos.x, y: pos.y })
        } else {
            GetForegroundWindow()
        };
        if hwnd.is_invalid() {
            return None;
        }
        let root = GetAncestor(hwnd, GA_ROOT);
        if root.is_invalid() {
            Some(hwnd)
        } else {
            Some(root)
        }
    }
}

pub fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid
}

/// 窗口标题(GetWindowTextW);空标题返回 None
pub fn window_title(hwnd: HWND) -> Option<String> {
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if n <= 0 {
        None
    } else {
        Some(String::from_utf16_lossy(&buf[..n as usize]))
    }
}

/// 目标窗口所属进程 exe 的所在目录(供 Cmd 的 auto_set_working_dir)
pub fn exe_dir_of_window(hwnd: HWND) -> Option<PathBuf> {
    let pid = window_pid(hwnd);
    if pid == 0 {
        return None;
    }
    let (_, path, _) = query_exe(pid)?;
    std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_path_buf())
}

/// 前台窗口应用信息(供设置界面"拾取窗口":exe 名/路径/标题/pid)
pub struct WindowAppInfo {
    pub exe_name: String,
    pub exe_path: String,
    pub aumid: Option<String>,
    pub title: String,
    pub pid: u32,
}

/// 指定窗口的应用信息。
pub fn window_info(hwnd: HWND) -> Option<WindowAppInfo> {
    if hwnd.is_invalid() {
        return None;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let hwnd = if root.is_invalid() { hwnd } else { root };
    let pid = window_pid(hwnd);
    if pid == 0 {
        return None;
    }
    let (exe_name, exe_path, aumid) = query_exe(pid)?;
    let title = window_title(hwnd).unwrap_or_default();
    Some(WindowAppInfo {
        exe_name,
        exe_path,
        aumid,
        title,
        pid,
    })
}

pub fn foreground_window_info() -> Option<WindowAppInfo> {
    let hwnd = unsafe { GetForegroundWindow() };
    window_info(hwnd)
}

const SYSTEM_TRAY_CLASSES: &[&str] = &["TrayNotifyWnd", "TrayButton", "NotifyIconOverflowWindow"];

fn is_system_tray_class(class: &str) -> bool {
    SYSTEM_TRAY_CLASSES.contains(&class)
}

/// Returns whether the physical point belongs to Windows' notification area.
/// The toolbar itself is nested below `TrayNotifyWnd`, so inspect the parent
/// chain instead of relying on the localized window title.
pub fn is_system_tray_point(pos: Point) -> bool {
    unsafe {
        let mut hwnd = WindowFromPoint(POINT { x: pos.x, y: pos.y });
        for _ in 0..8 {
            if hwnd.is_invalid() {
                return false;
            }
            let mut class_buf = [0u16; 128];
            let n = GetClassNameW(hwnd, &mut class_buf) as usize;
            if n > 0 && is_system_tray_class(&String::from_utf16_lossy(&class_buf[..n])) {
                return true;
            }
            hwnd = match GetParent(hwnd) {
                Ok(parent) => parent,
                Err(_) => return false,
            };
        }
    }
    false
}

/// Application identity for the root window under the physical cursor.
pub fn cursor_window_info() -> Option<WindowAppInfo> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    window_info(unsafe { WindowFromPoint(point) })
}

fn query_exe(pid: u32) -> Option<(String, String, Option<String>)> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let aumid = query_aumid(handle);
        let _ = CloseHandle(handle);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let name = path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or_default()
            .to_lowercase();
        Some((name, path, aumid))
    }
}

/// 读取进程的 Windows AppUserModelID。
///
/// 普通未打包进程没有 AUMID,这和 API 失败一样属于正常情况,必须 fail-open。
fn query_aumid(handle: windows::Win32::Foundation::HANDLE) -> Option<String> {
    query_aumid_buffer(|length, buffer| unsafe {
        let output = buffer.map(|values| PWSTR(values.as_mut_ptr()));
        GetApplicationUserModelId(handle, length, output)
    })
}

/// 隔离 GetApplicationUserModelId 的两次调用协议,便于覆盖缓冲区/error 行为。
fn query_aumid_buffer<F>(mut query: F) -> Option<String>
where
    F: FnMut(&mut u32, Option<&mut [u16]>) -> WIN32_ERROR,
{
    let mut required = 0u32;
    if query(&mut required, None) != ERROR_INSUFFICIENT_BUFFER || required == 0 || required > 4096 {
        return None;
    }

    let mut buffer = vec![0u16; required as usize];
    let mut written = required;
    if query(&mut written, Some(&mut buffer)) != ERROR_SUCCESS {
        return None;
    }

    let used = (written as usize).min(buffer.len());
    let end = buffer[..used]
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(used);
    if end == 0 {
        return None;
    }
    String::from_utf16(&buffer[..end]).ok()
}

/// 解析手势目标窗口对应的前台应用标识(带 pid 缓存)
pub fn resolve_foreground_app(pos: Point, prefer_cursor_window: bool) -> ForegroundApp {
    let Some(hwnd) = target_root_window(pos, prefer_cursor_window) else {
        return ForegroundApp::default();
    };
    let pid = window_pid(hwnd);
    if pid == 0 {
        return ForegroundApp::default();
    }

    let mut cache = EXE_CACHE.lock();
    let map = cache.get_or_insert_with(HashMap::new);
    let entry = match map.get(&pid) {
        Some(e) => e.clone(),
        None => {
            let Some(e) = query_exe(pid) else {
                return ForegroundApp::default();
            };
            if map.len() > 256 {
                map.clear();
            }
            map.insert(pid, e.clone());
            e
        }
    };

    ForegroundApp {
        exe_name: Some(entry.0),
        exe_path: Some(entry.1),
        aumid: entry.2,
        bundle_id: None,
        native_window: hwnd.0 as isize as i64,
    }
}

/// 非全屏视为正常的宿主窗口类(桌面、开始菜单/搜索等)
const FULLSCREEN_CLASS_WHITELIST: &[&str] = &[
    "WorkerW",
    "Progman",
    "CanvasWindow",
    "ImmersiveLauncher",
    "Windows.UI.Core.CoreWindow",
];

/// 光标所在显示器的边界与 DPI 缩放(触发角/摩擦边判定用)。
///
/// - 用 `rcMonitor`(完整边界,**含任务栏**)而非 `rcWork` —— 与 WGestures 一致:
///   贴着任务栏的屏幕下沿也应该能触发。
/// - 该点不在任何显示器上(`MONITOR_DEFAULTTONULL`)时返回 None,调用方跳过本次判定。
/// - 返回的矩形是**闭区间**:right/bottom 换算成最后一个可达像素。
pub fn screen_at(pos: Point) -> Option<ScreenInfo> {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: pos.x, y: pos.y }, MONITOR_DEFAULTTONULL);
        if monitor.is_invalid() {
            return None;
        }
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
            return None;
        }
        let m = mi.rcMonitor;
        if m.right <= m.left || m.bottom <= m.top {
            return None;
        }
        Some(ScreenInfo {
            bounds: ScreenRect {
                left: m.left,
                top: m.top,
                right: m.right - 1,
                bottom: m.bottom - 1,
            },
            dpi_scale: monitor_dpi_scale(monitor),
        })
    }
}

/// 显示器的有效 DPI 缩放;查询失败按 100% 处理
fn monitor_dpi_scale(monitor: HMONITOR) -> f64 {
    let mut dpi_x = 96u32;
    let mut dpi_y = 96u32;
    unsafe {
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_err() {
            return 1.0;
        }
    }
    if dpi_x == 0 {
        return 1.0;
    }
    dpi_x as f64 / 96.0
}

/// 前台窗口是否真全屏(用于"全屏时自动禁用手势")
pub fn is_foreground_fullscreen() -> bool {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return false;
        }
        let root = GetAncestor(hwnd, GA_ROOT);
        let hwnd = if root.is_invalid() { hwnd } else { root };

        let mut class_buf = [0u16; 256];
        let n = GetClassNameW(hwnd, &mut class_buf) as usize;
        let class = String::from_utf16_lossy(&class_buf[..n]);
        if FULLSCREEN_CLASS_WHITELIST.iter().any(|c| *c == class) {
            return false;
        }

        let mut wr = RECT::default();
        if GetWindowRect(hwnd, &mut wr).is_err() {
            return false;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
            return false;
        }
        let m = mi.rcMonitor;
        wr.left <= m.left && wr.top <= m.top && wr.right >= m.right && wr.bottom >= m.bottom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aumid_buffer_uses_required_length_then_decodes_utf16() {
        let mut calls = 0;
        let aumid = query_aumid_buffer(|length, output| {
            calls += 1;
            match (calls, output) {
                (1, None) => {
                    *length = 8;
                    ERROR_INSUFFICIENT_BUFFER
                }
                (2, Some(buffer)) => {
                    assert_eq!(buffer.len(), 8);
                    buffer[..8].copy_from_slice(&[
                        'T' as u16, 'e' as u16, 's' as u16, 't' as u16, 0, 0, 0, 0,
                    ]);
                    *length = 5;
                    ERROR_SUCCESS
                }
                _ => WIN32_ERROR(1),
            }
        });

        assert_eq!(calls, 2);
        assert_eq!(aumid.as_deref(), Some("Test"));
    }

    #[test]
    fn aumid_buffer_fails_open_for_unpacked_or_invalid_results() {
        assert_eq!(
            query_aumid_buffer(|_, _| windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE),
            None
        );
        assert_eq!(
            query_aumid_buffer(|length, output| match output {
                None => {
                    *length = 2;
                    ERROR_INSUFFICIENT_BUFFER
                }
                Some(_) => WIN32_ERROR(1),
            }),
            None
        );
        assert_eq!(
            query_aumid_buffer(|length, output| match output {
                None => {
                    *length = 1;
                    ERROR_INSUFFICIENT_BUFFER
                }
                Some(buffer) => {
                    buffer[0] = 0;
                    *length = 1;
                    ERROR_SUCCESS
                }
            }),
            None
        );
    }

    #[test]
    fn unpackaged_test_process_has_no_aumid() {
        let handle = unsafe { windows::Win32::System::Threading::GetCurrentProcess() };
        assert_eq!(query_aumid(handle), None);
    }

    #[test]
    fn system_tray_class_matching_ignores_localized_titles() {
        assert!(is_system_tray_class("TrayNotifyWnd"));
        assert!(is_system_tray_class("TrayButton"));
        assert!(is_system_tray_class("NotifyIconOverflowWindow"));
        assert!(!is_system_tray_class("ToolbarWindow32"));
        assert!(!is_system_tray_class("Shell_TrayWnd"));
    }

    #[test]
    fn integrity_level_classifies_standard_windows_rids() {
        assert_eq!(integrity_level_from_rid(4096), IntegrityLevel::Low);
        assert_eq!(integrity_level_from_rid(8192), IntegrityLevel::Medium);
        assert_eq!(integrity_level_from_rid(12288), IntegrityLevel::High);
        assert_eq!(integrity_level_from_rid(16384), IntegrityLevel::System);
        assert!(IntegrityLevel::High.is_higher_than(IntegrityLevel::Medium));
        assert!(!IntegrityLevel::Medium.is_higher_than(IntegrityLevel::High));
    }
}

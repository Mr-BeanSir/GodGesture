//! 窗口/进程查询 —— 前台应用解析(exe 名/路径)与全屏检测。
//! 语义对齐 WGestures:
//! - "总是作用于指针下方的窗口"时用 WindowFromPoint,否则 GetForegroundWindow;
//! - 目标窗口取 GetAncestor(GA_ROOT);
//! - exe 路径经 OpenProcess + QueryFullProcessImageNameW 解析,按 pid 缓存;
//! - 全屏检测:前台根窗口矩形 == 所在显示器矩形,且类名不在白名单
//!   (桌面/开始菜单等宿主类)。

use crate::engine::intents::ForegroundApp;
use crate::engine::types::Point;
use parking_lot::Mutex;
use std::collections::HashMap;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    WindowFromPoint, GA_ROOT,
};

/// pid → (exe_name, exe_path) 缓存(pid 复用风险低,进程退出后条目自然失效)
static EXE_CACHE: Mutex<Option<HashMap<u32, (String, String)>>> = Mutex::new(None);

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

fn query_exe(pid: u32) -> Option<(String, String)> {
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
        let _ = CloseHandle(handle);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let name = path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or_default()
            .to_lowercase();
        Some((name, path))
    }
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
        aumid: None, // TODO(M2): 商店应用 AUMID 解析(GetApplicationUserModelId)
        bundle_id: None,
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

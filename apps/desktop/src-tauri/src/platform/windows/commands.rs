//! 命令执行器 —— 把 12 类 Command 落到 Win32 动作上。
//!
//! 运行在 engine worker(消费)线程,可阻塞(取选中文本要合成 Ctrl+C 并轮询剪贴板);
//! 绝不在钩子线程执行,以免拖慢"吞不吞事件"的同步裁决。
//!
//! Pause / DoNothing 不在此处理:Pause 由 consumer 特判(切换引擎暂停),
//! DoNothing 顾名思义。Script 待 M3(rquickjs)落地,这里先跳过。

use super::{clipboard, input, window};
use crate::engine::config::{Command, WindowOperation};
use crate::engine::runtime::GestureContext;
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LWIN, VK_TAB, VK_VOLUME_DOWN, VK_VOLUME_UP};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, IsZoomed, PostMessageW, SetForegroundWindow, SetWindowPos, ShowWindow,
    GWL_EXSTYLE, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, SW_SHOWNORMAL, WM_CLOSE, WS_EX_TOPMOST,
};

/// 执行一条命令。`ctx` 提供手势起点与目标窗口句柄。
pub fn execute(cmd: &Command, ctx: &GestureContext) {
    match cmd {
        // 由 consumer 特判 / 无动作 / 待 M3
        Command::Pause | Command::DoNothing => {}
        Command::Script { .. } => {
            log::warn!("Script 命令将在 M3(rquickjs)落地,暂跳过");
        }

        Command::HotKey { modifiers, keys } => {
            activate_target(ctx);
            input::synthesize_key_combo(modifiers, keys);
        }
        Command::SendText { text } => {
            activate_target(ctx);
            input::type_text_with_sleeps(text);
        }
        Command::TaskSwitcher => {
            // Win+Tab:任务视图(WGestures 的任务切换)
            input::tap_with_modifiers(&[VK_LWIN], VK_TAB);
        }
        Command::WindowControl { operation } => window_control(*operation, ctx),
        Command::OpenFile { path } => shell_open(path, None),
        Command::GotoUrl { url } => shell_open(url, None),
        Command::WebSearch {
            engine_url, browser, ..
        } => web_search(engine_url, browser.as_deref(), ctx),
        Command::AudioVolume { delta } => audio_volume(*delta),
        Command::Cmd {
            code,
            show_window,
            auto_set_working_dir,
        } => run_cmd(code, *show_window, *auto_set_working_dir, ctx),
    }
}

/// i64 句柄 → HWND(0 视为无)
fn hwnd_of(ctx: &GestureContext) -> Option<HWND> {
    if ctx.native_window == 0 {
        None
    } else {
        Some(HWND(ctx.native_window as *mut core::ffi::c_void))
    }
}

/// 键盘类命令前把目标窗口带到前台(best-effort;前台锁定时静默失败,按键落到当前焦点)
fn activate_target(ctx: &GestureContext) {
    if let Some(hwnd) = hwnd_of(ctx) {
        unsafe {
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

fn window_control(op: WindowOperation, ctx: &GestureContext) {
    let Some(hwnd) = hwnd_of(ctx) else {
        return;
    };
    unsafe {
        match op {
            WindowOperation::MaximizeRestore => {
                if IsZoomed(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                } else {
                    let _ = ShowWindow(hwnd, SW_MAXIMIZE);
                }
            }
            WindowOperation::Minimize => {
                let _ = ShowWindow(hwnd, SW_MINIMIZE);
            }
            WindowOperation::Close => {
                // 发 WM_CLOSE 走正常关闭流程(可弹保存提示),不强杀进程
                let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
            WindowOperation::ToggleTopmost => toggle_topmost(hwnd),
            WindowOperation::DockLeft => dock_half(hwnd, true),
            WindowOperation::DockRight => dock_half(hwnd, false),
        }
    }
}

fn toggle_topmost(hwnd: HWND) {
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let is_topmost = (ex & WS_EX_TOPMOST.0 as isize) != 0;
        let insert_after = if is_topmost { HWND_NOTOPMOST } else { HWND_TOPMOST };
        let _ = SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// 左/右半屏停靠(占所在显示器工作区的一半)
fn dock_half(hwnd: HWND, left: bool) {
    unsafe {
        // 最大化状态下 SetWindowPos 不生效,先还原
        if IsZoomed(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
            return;
        }
        let work = mi.rcWork;
        let half_w = (work.right - work.left) / 2;
        let x = if left { work.left } else { work.left + half_w };
        let _ = SetWindowPos(
            hwnd,
            None,
            x,
            work.top,
            half_w,
            work.bottom - work.top,
            SWP_NOACTIVATE | SWP_NOZORDER,
        );
    }
}

fn audio_volume(delta: i32) {
    let steps = delta.unsigned_abs();
    if steps == 0 {
        return;
    }
    let vk = if delta > 0 { VK_VOLUME_UP } else { VK_VOLUME_DOWN };
    for _ in 0..steps {
        input::tap_vk(vk);
    }
}

/// 取当前选中文本 → URL 编码填入 engine_url 的 `{0}` → 用指定/默认浏览器打开
fn web_search(engine_url: &str, browser: Option<&str>, ctx: &GestureContext) {
    activate_target(ctx);
    let query = clipboard::get_selected_text().unwrap_or_default();
    let url = engine_url.replace("{0}", &url_encode(&query));
    match browser {
        Some(b) if !b.is_empty() => shell_open(b, Some(&url)),
        _ => shell_open(&url, None),
    }
}

fn run_cmd(code: &str, show_window: bool, auto_set_working_dir: bool, ctx: &GestureContext) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    activate_target(ctx);
    let selected_text = clipboard::get_selected_text().unwrap_or_default();
    let mut command = std::process::Command::new("cmd");
    command.arg("/C").arg(code);

    // 暴露手势上下文给脚本(对齐 WGestures 的 WG_* 约定)
    command.env("WG_MOUSE_X", ctx.origin.x.to_string());
    command.env("WG_MOUSE_Y", ctx.origin.y.to_string());
    command.env("WG_SELECTED_TEXT", selected_text);
    if let Some(hwnd) = hwnd_of(ctx) {
        command.env("WG_WINDOW_HWND", ctx.native_window.to_string());
        if let Some(info) = window::window_info(hwnd) {
            command.env("WG_ACTIVE_EXE", &info.exe_name);
            command.env("WG_ACTIVE_EXE_PATH", &info.exe_path);
            command.env("WG_WINDOW_TITLE", &info.title);
            if auto_set_working_dir {
                if let Some(dir) = std::path::Path::new(&info.exe_path).parent() {
                    command.current_dir(dir);
                }
            }
        }
    }
    if !show_window {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    if let Err(e) = command.spawn() {
        log::warn!("Cmd 执行失败: {e}");
    }
}

/// ShellExecuteW "open":打开文件/URL/应用;可带参数(浏览器场景)
fn shell_open(file: &str, params: Option<&str>) {
    let file_w = HSTRING::from(file);
    let params_w = params.map(HSTRING::from);
    let params_ptr = params_w
        .as_ref()
        .map(|h| PCWSTR(h.as_ptr()))
        .unwrap_or_else(PCWSTR::null);
    unsafe {
        let _ = ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(file_w.as_ptr()),
            params_ptr,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// RFC 3986 未保留字符以外一律百分号编码(UTF-8 字节);对齐浏览器查询串习惯
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(hex_digit(b >> 4));
                out.push(hex_digit(b & 0x0F));
            }
        }
    }
    out
}

fn hex_digit(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        _ => (b'A' + (n - 10)) as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_encode_basics() {
        assert_eq!(url_encode("hello world"), "hello%20world");
        assert_eq!(url_encode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(url_encode("100%"), "100%25");
    }

    #[test]
    fn url_encode_utf8_multibyte() {
        // "中" = E4 B8 AD
        assert_eq!(url_encode("中"), "%E4%B8%AD");
    }
}

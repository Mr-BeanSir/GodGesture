//! 命令执行器 —— 把 12 类 Command 落到 Win32 动作上。
//!
//! 运行在 engine worker(消费)线程,可阻塞(取选中文本要合成 Ctrl+C 并轮询剪贴板);
//! 绝不在钩子线程执行,以免拖慢"吞不吞事件"的同步裁决。
//!
//! Pause / Script 不在此处理:consumer 分别负责暂停切换与 QuickJS 生命周期;
//! DoNothing 顾名思义。

use super::{clipboard, hook::EXTRA_INFO_TAG, input, window};
use crate::engine::audio::{audio_volume_action, target_volume_scalar, AudioVolumeAction};
use crate::engine::config::{Command, WindowOperation};
use crate::engine::runtime::GestureContext;
use crate::engine::types::Modifier;
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RPC_E_CHANGED_MODE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VK_MENU, VK_TAB,
};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, SHGetKnownFolderPath, ShellExecuteW, KF_FLAG_DEFAULT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetWindowLongPtrW, IsZoomed, PostMessageW, SetForegroundWindow, SetWindowPos,
    ShowWindowAsync, GWL_EXSTYLE, HWND_NOTOPMOST, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, SW_SHOWNORMAL,
    WM_CLOSE, WS_EX_TOPMOST,
};

/// 执行一条命令。`modifier` 是本次手势修饰,`ctx` 提供手势起点与目标窗口句柄。
pub fn execute(cmd: &Command, modifier: Modifier, ctx: &GestureContext) {
    match cmd {
        // 由 consumer 特判 / 无动作
        Command::Pause | Command::DoNothing => {}
        Command::Script { .. } => {
            log::error!("Script 命令意外到达原生命令分发器");
        }

        Command::HotKey { modifiers, keys } => {
            if is_lock_workstation_hotkey(modifiers, keys) {
                if let Err(error) = unsafe { LockWorkStation() } {
                    log::error!("LockWorkStation 失败: {error}");
                }
            } else {
                activate_target(ctx);
                let _ = input::synthesize_key_combo(modifiers, keys);
            }
        }
        Command::SendText { text } => {
            activate_target(ctx);
            input::type_text_with_sleeps(text);
        }
        Command::TaskSwitcher => {
            // 非手势增量识别路径(触发角、直接执行等)的合理 fallback。
            input::tap_with_modifiers(&[VK_MENU], VK_TAB);
        }
        Command::WindowControl { operation } => window_control(*operation, ctx),
        Command::OpenFile { path } => open_or_log(path, None),
        Command::GotoUrl { url } => match normalize_goto_url(url) {
            Ok(url) => open_or_log(&url, None),
            Err(error) => log::error!("GotoUrl 命令被拒绝: {error}"),
        },
        Command::WebSearch {
            engine_url,
            browser,
            ..
        } => web_search(engine_url, browser.as_deref(), ctx),
        Command::AudioVolume { delta } => {
            if let Err(error) = audio_volume(modifier, *delta) {
                log::error!("音量命令失败: {error}");
            }
        }
        Command::Cmd {
            code,
            show_window,
            auto_set_working_dir,
        } => run_cmd(code, *show_window, *auto_set_working_dir, ctx),
    }
}

fn is_lock_workstation_hotkey(modifiers: &[String], keys: &[String]) -> bool {
    modifiers.len() == 1
        && keys.len() == 1
        && modifiers[0].eq_ignore_ascii_case("meta")
        && keys[0].eq_ignore_ascii_case("l")
}

fn task_switcher_key_input(
    vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    down: bool,
) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if down {
                    KEYBD_EVENT_FLAGS(0)
                } else {
                    KEYEVENTF_KEYUP
                },
                time: 0,
                dwExtraInfo: EXTRA_INFO_TAG,
            },
        },
    }
}

fn send_task_switcher_inputs(inputs: &[INPUT]) -> usize {
    unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) as usize }
}

/// 增量识别首次命中 TaskSwitcher:Alt down + Tab tap,成功后保持 Alt。
/// 返回 false 表示 SendInput 短写;失败路径已 best-effort 释放 Tab/Alt。
pub fn task_switcher_begin() -> bool {
    let inputs = [
        task_switcher_key_input(VK_MENU, true),
        task_switcher_key_input(VK_TAB, true),
        task_switcher_key_input(VK_TAB, false),
    ];
    let inserted = send_task_switcher_inputs(&inputs);
    if inserted == inputs.len() {
        return true;
    }

    log::error!(
        "TaskSwitcher SendInput 短写:仅插入 {inserted}/{} 个输入事件",
        inputs.len()
    );
    // 若 Tab-down 已经进入系统,先释放 Tab；Alt-up 无论 Alt-down 是否成功都补发,
    // 避免 UIPI/短写边界把系统留在修饰键按下状态。
    if inserted >= 2 {
        let recovered = send_task_switcher_inputs(&[task_switcher_key_input(VK_TAB, false)]);
        if recovered != 1 {
            log::error!("TaskSwitcher Tab-up 恢复失败:插入 {recovered}/1 个输入事件");
        }
    }
    task_switcher_end();
    false
}

/// 结束 TaskSwitcher 生命周期。重复 Alt-up 是安全的,所有收尾路径都可调用。
pub fn task_switcher_end() {
    let inserted = send_task_switcher_inputs(&[task_switcher_key_input(VK_MENU, false)]);
    if inserted != 1 {
        log::error!("TaskSwitcher Alt-up SendInput 失败:插入 {inserted}/1 个输入事件");
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

pub(crate) fn activate_target_for_script(ctx: &GestureContext) -> Result<(), String> {
    let hwnd = hwnd_of(ctx).ok_or_else(|| "target window is unavailable".to_string())?;
    if unsafe { SetForegroundWindow(hwnd) }.as_bool() {
        Ok(())
    } else {
        Err("SetForegroundWindow was rejected".into())
    }
}

/// 外壳窗口(桌面/任务栏等)的类名。窗口类命令一律不作用于它们。
///
/// 触发角/摩擦边把命令指向**前台窗口**,而光标停在屏幕角落或边缘时,前台窗口
/// 经常正是这些外壳窗口 —— 给触发角绑一个"关闭窗口",就会朝 `Progman` 发
/// `WM_CLOSE`,足以把资源管理器桌面干掉。手势路径同样可能命中(在桌面上画手势)。
const SHELL_WINDOW_CLASSES: &[&str] = &[
    "Progman",                // 桌面
    "WorkerW",                // 壁纸/桌面工作窗口
    "Shell_TrayWnd",          // 主任务栏
    "Shell_SecondaryTrayWnd", // 副屏任务栏
    "Shell_ChargeBar",
    "NotifyIconOverflowWindow",
    "Windows.UI.Core.CoreWindow", // 开始菜单 / 搜索 / 通知中心等 shell UI
    "XamlExplorerHostIslandWindow",
    "ForegroundStaging",
    "MultitaskingViewFrame", // 任务视图
];

fn is_shell_window(hwnd: HWND) -> bool {
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) } as usize;
    if n == 0 {
        return false;
    }
    let class = String::from_utf16_lossy(&buf[..n]);
    SHELL_WINDOW_CLASSES.iter().any(|c| *c == class)
}

fn window_control(op: WindowOperation, ctx: &GestureContext) {
    let Some(hwnd) = hwnd_of(ctx) else {
        return;
    };
    if is_shell_window(hwnd) {
        log::debug!("窗口命令跳过外壳窗口(桌面/任务栏)");
        return;
    }
    unsafe {
        match op {
            WindowOperation::MaximizeRestore => {
                if IsZoomed(hwnd).as_bool() {
                    enqueue_show_window(hwnd, SW_RESTORE, "还原");
                } else {
                    enqueue_show_window(hwnd, SW_MAXIMIZE, "最大化");
                }
            }
            WindowOperation::Minimize => {
                enqueue_show_window(hwnd, SW_MINIMIZE, "最小化");
            }
            WindowOperation::Close => {
                // 发 WM_CLOSE 走正常关闭流程(可弹保存提示),不强杀进程
                if let Err(error) = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) {
                    log::error!("窗口关闭消息入队失败: {error}");
                }
            }
            WindowOperation::ToggleTopmost => toggle_topmost(hwnd),
            WindowOperation::DockLeft => dock_half(hwnd, true),
            WindowOperation::DockRight => dock_half(hwnd, false),
        }
    }
}

pub(crate) fn window_control_for_script(
    op: WindowOperation,
    ctx: &GestureContext,
) -> Result<(), String> {
    let hwnd = hwnd_of(ctx).ok_or_else(|| "target window is unavailable".to_string())?;
    if is_shell_window(hwnd) {
        return Err("window operations are blocked for shell windows".into());
    }
    window_control(op, ctx);
    Ok(())
}

fn enqueue_show_window(
    hwnd: HWND,
    command: windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD,
    operation: &str,
) {
    if !unsafe { ShowWindowAsync(hwnd, command) }.as_bool() {
        log::error!("窗口{operation}请求入队失败");
    }
}

fn toggle_topmost(hwnd: HWND) {
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let is_topmost = (ex & WS_EX_TOPMOST.0 as isize) != 0;
        let insert_after = if is_topmost {
            HWND_NOTOPMOST
        } else {
            HWND_TOPMOST
        };
        if let Err(error) = SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
        ) {
            log::error!("窗口置顶状态请求入队失败: {error}");
        }
    }
}

/// 左/右半屏停靠(占所在显示器工作区的一半)
fn dock_half(hwnd: HWND, left: bool) {
    unsafe {
        // 最大化状态下 SetWindowPos 不生效,先还原
        if IsZoomed(hwnd).as_bool() {
            enqueue_show_window(hwnd, SW_RESTORE, "还原");
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
        if let Err(error) = SetWindowPos(
            hwnd,
            None,
            x,
            work.top,
            half_w,
            work.bottom - work.top,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS,
        ) {
            log::error!("窗口停靠请求入队失败: {error}");
        }
    }
}

struct AudioComApartment(bool);

impl AudioComApartment {
    fn init() -> Result<Self, String> {
        match unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
            Ok(()) => Ok(Self(true)),
            Err(error) if error.code() == RPC_E_CHANGED_MODE => Ok(Self(false)),
            Err(error) => Err(format!("initialize Core Audio COM: {error}")),
        }
    }
}

impl Drop for AudioComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn default_audio_endpoint() -> Result<(AudioComApartment, IAudioEndpointVolume), String> {
    let apartment = AudioComApartment::init()?;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| format!("create audio device enumerator: {error}"))?;
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
        .map_err(|error| format!("open default render endpoint: {error}"))?;
    let endpoint = unsafe { device.Activate(CLSCTX_INPROC_SERVER, None) }
        .map_err(|error| format!("activate endpoint volume control: {error}"))?;
    Ok((apartment, endpoint))
}

fn audio_volume(modifier: Modifier, delta: i32) -> Result<(), String> {
    let action = audio_volume_action(modifier, delta);
    let (_apartment, endpoint) = default_audio_endpoint()?;
    unsafe {
        match action {
            AudioVolumeAction::Mute => {
                let muted = endpoint
                    .GetMute()
                    .map_err(|error| format!("read endpoint mute state: {error}"))?
                    .as_bool();
                endpoint
                    .SetMute(!muted, std::ptr::null())
                    .map_err(|error| format!("set endpoint mute state: {error}"))
            }
            action => {
                let current = endpoint
                    .GetMasterVolumeLevelScalar()
                    .map_err(|error| format!("read endpoint volume: {error}"))?;
                let target = target_volume_scalar(current, action)
                    .expect("non-mute audio action must have a scalar target");
                endpoint
                    .SetMasterVolumeLevelScalar(target, std::ptr::null())
                    .map_err(|error| format!("set endpoint volume: {error}"))
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum WebSearchPlan {
    NoOp,
    Open(String),
}

/// 先规划 WebSearch,确保错误配置或空选择不会触发任何外部进程。
fn plan_web_search(engine_url: &str, selected_text: &str) -> Result<WebSearchPlan, String> {
    let query = selected_text.trim();
    if query.is_empty() {
        return Ok(WebSearchPlan::NoOp);
    }
    if is_absolute_uri(query) {
        return Ok(WebSearchPlan::Open(query.to_string()));
    }

    let query: String = query.chars().take(100).collect();
    let url = engine_url.trim().replace("{0}", &url_encode(&query));
    if !is_absolute_uri(&url) {
        return Err("搜索引擎 URL 不是有效的绝对 URI".into());
    }
    Ok(WebSearchPlan::Open(url))
}

/// 取当前选中文本 → 规划 URL → 用指定/默认浏览器打开。
fn web_search(engine_url: &str, browser: Option<&str>, ctx: &GestureContext) {
    activate_target(ctx);
    let query = match clipboard::get_selected_text() {
        Some(query) => query,
        None => return,
    };
    let url = match plan_web_search(engine_url, &query) {
        Ok(WebSearchPlan::NoOp) => return,
        Ok(WebSearchPlan::Open(url)) => url,
        Err(error) => {
            log::error!("WebSearch 命令被拒绝: {error}");
            return;
        }
    };

    if let Some(browser) = browser.and_then(existing_browser_path) {
        let params = format!("\"{url}\"");
        open_or_log(browser, Some(&params));
    } else {
        open_or_log(&url, None);
    }
}

fn existing_browser_path(browser: &str) -> Option<&str> {
    let browser = browser.trim();
    let browser = browser
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(browser)
        .trim();
    (!browser.is_empty() && std::path::Path::new(browser).is_file()).then_some(browser)
}

fn normalize_goto_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL 为空".into());
    }
    if is_absolute_uri(url) {
        Ok(url.to_string())
    } else if has_uri_scheme_syntax(url) {
        Err("URL scheme 或 authority 无效".into())
    } else {
        let normalized = format!("http://{url}");
        if is_absolute_uri(&normalized) {
            Ok(normalized)
        } else {
            Err("URL 含无效字符".into())
        }
    }
}

fn is_absolute_uri(value: &str) -> bool {
    if value.is_empty()
        || value != value.trim()
        || value.chars().any(|ch| {
            ch.is_control()
                || ch.is_whitespace()
                || matches!(ch, '"' | '<' | '>' | '\\' | '^' | '`' | '{' | '|' | '}')
        })
    {
        return false;
    }
    let Some((scheme, remainder)) = value.split_once(':') else {
        return false;
    };
    if !has_uri_scheme_syntax(value) {
        return false;
    }
    if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
        let Some(hierarchical) = remainder.strip_prefix("//") else {
            return false;
        };
        return hierarchical
            .split(['/', '?', '#'])
            .next()
            .is_some_and(|authority| !authority.is_empty());
    }
    true
}

fn has_uri_scheme_syntax(value: &str) -> bool {
    let Some((scheme, remainder)) = value.split_once(':') else {
        return false;
    };
    if remainder.is_empty() {
        return false;
    }
    let mut chars = scheme.chars();
    chars.next().is_some_and(|ch| ch.is_ascii_alphabetic())
        && chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
        && !looks_like_host_port(scheme, remainder)
}

fn looks_like_host_port(prefix: &str, remainder: &str) -> bool {
    let numeric_port = remainder
        .split(['/', '?', '#'])
        .next()
        .is_some_and(|port| !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()));
    numeric_port && (prefix.eq_ignore_ascii_case("localhost") || prefix.contains('.'))
}

fn normalize_cmd_code(code: &str) -> String {
    code.split(['\r', '\n'])
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || is_cmd_comment(line) {
                return None;
            }
            let comment = line
                .rfind("::")
                .filter(|index| *index > 0)
                .or_else(|| rfind_ascii_case_insensitive(line, " rem ").filter(|index| *index > 0));
            let command = comment.map_or(line, |index| &line[..index]).trim();
            (!command.is_empty()).then_some(command)
        })
        .collect::<Vec<_>>()
        .join(" & ")
}

fn is_cmd_comment(line: &str) -> bool {
    if line.starts_with("::") {
        return true;
    }
    let mut words = line.splitn(2, char::is_whitespace);
    words
        .next()
        .is_some_and(|word| word.eq_ignore_ascii_case("rem"))
}

fn rfind_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .as_bytes()
        .windows(needle.len())
        .rposition(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

fn desktop_directory() -> Option<std::path::PathBuf> {
    let known = unsafe { SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None) }
        .ok()
        .and_then(|path| {
            let result = unsafe { path.to_string() }
                .ok()
                .map(std::path::PathBuf::from);
            unsafe { CoTaskMemFree(Some(path.0.cast())) };
            result
        })
        .filter(|path| path.is_dir());
    known.or_else(|| {
        std::env::var_os("USERPROFILE")
            .map(std::path::PathBuf::from)
            .map(|profile| profile.join("Desktop"))
            .filter(|path| path.is_dir())
    })
}

fn cmd_working_directory(
    auto_set: bool,
    window_info: Option<&window::WindowAppInfo>,
) -> Option<std::path::PathBuf> {
    let desktop = desktop_directory();
    if !auto_set {
        return desktop;
    }
    let Some(info) = window_info else {
        return desktop;
    };
    // Explorer 的 exe 目录是 Windows 目录,不是用户当前浏览的文件夹。
    // 在没有可靠 ShellWindows 查询前明确回退 Desktop。
    if info.exe_name.eq_ignore_ascii_case("explorer.exe") {
        return desktop;
    }
    std::path::Path::new(&info.exe_path)
        .parent()
        .filter(|path| path.is_dir())
        .map(std::path::Path::to_path_buf)
        .or(desktop)
}

fn run_cmd(code: &str, show_window: bool, auto_set_working_dir: bool, ctx: &GestureContext) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let code = normalize_cmd_code(code);
    if code.is_empty() {
        log::debug!("Cmd 命令规范化后为空,跳过执行");
        return;
    }
    activate_target(ctx);
    // 只有脚本真的引用了 WG_SELECTED_TEXT 才去取选中文本。
    // 取选中文本要朝前台窗口合成 Ctrl+C —— 无条件做的话,在控制台
    // (cmd / PowerShell / WSL / 正在跑的编译)上画一次 Cmd 手势就会
    // 把 Ctrl+C 打进去中断那个进程,而且每次白白阻塞 200ms~1.4s。
    // 参考实现的 CmdCommand 根本不提供这个变量,这里算是折中保留。
    let wants_selection = code.contains("WG_SELECTED_TEXT");
    let selected_text = if wants_selection {
        clipboard::get_selected_text().unwrap_or_default()
    } else {
        String::new()
    };
    let command_interpreter = std::env::var_os("COMSPEC")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "cmd.exe".into());
    let mut command = std::process::Command::new(command_interpreter);
    command
        .arg("/D")
        .arg("/S")
        .arg(if show_window { "/K" } else { "/C" })
        .raw_arg(&code);

    // 保留 GodGesture 既有变量,并补齐 WGestures 的上下文变量。
    command.env("WG_MOUSE_X", ctx.origin.x.to_string());
    command.env("WG_MOUSE_Y", ctx.origin.y.to_string());
    command.env("WG_STARTPOINT_X", ctx.origin.x.to_string());
    command.env("WG_STARTPOINT_Y", ctx.origin.y.to_string());
    command.env("WG_ENDPOINT_X", ctx.endpoint.x.to_string());
    command.env("WG_ENDPOINT_Y", ctx.endpoint.y.to_string());
    command.env("WG_SELECTED_TEXT", selected_text);
    let info = hwnd_of(ctx).and_then(window::window_info);
    if hwnd_of(ctx).is_some() {
        command.env("WG_WINID", ctx.native_window.to_string());
        command.env("WG_WINDOW_HWND", ctx.native_window.to_string());
        if let Some(info) = &info {
            command.env("WG_PROCID", info.pid.to_string());
            command.env("WG_ACTIVE_EXE", &info.exe_name);
            command.env("WG_ACTIVE_EXE_PATH", &info.exe_path);
            command.env("WG_WINDOW_TITLE", &info.title);
        }
    }
    if let Some(directory) = cmd_working_directory(auto_set_working_dir, info.as_ref()) {
        command.current_dir(directory);
    }
    if !show_window {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    if let Err(e) = command.spawn() {
        log::warn!("Cmd 执行失败: {e}");
    }
}

fn open_or_log(file: &str, params: Option<&str>) {
    if let Err(error) = shell_open(file, params) {
        log::error!("ShellExecuteW 打开 {file:?} 失败: {error}");
    }
}

/// ShellExecuteW "open":打开文件/URL/应用;可带参数(浏览器场景)。
fn shell_open(file: &str, params: Option<&str>) -> Result<(), String> {
    if file.trim().is_empty() {
        return Err("目标为空".into());
    }
    let file_w = HSTRING::from(file);
    let params_w = params.map(HSTRING::from);
    let params_ptr = params_w
        .as_ref()
        .map(|h| PCWSTR(h.as_ptr()))
        .unwrap_or_else(PCWSTR::null);
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(file_w.as_ptr()),
            params_ptr,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    let code = result.0 as isize;
    if code <= 32 {
        Err(format!("返回错误码 {code}"))
    } else {
        Ok(())
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

    #[test]
    fn web_search_trims_and_ignores_empty_selection() {
        assert_eq!(
            plan_web_search("https://example.com/?q={0}", " \r\n ").unwrap(),
            WebSearchPlan::NoOp
        );
    }

    #[test]
    fn web_search_opens_absolute_uri_without_using_the_engine() {
        assert_eq!(
            plan_web_search("invalid engine", "  mailto:user@example.com  ").unwrap(),
            WebSearchPlan::Open("mailto:user@example.com".into())
        );
    }

    #[test]
    fn web_search_limits_query_to_one_hundred_unicode_characters() {
        let query = format!("{}tail", "中".repeat(100));
        let WebSearchPlan::Open(url) =
            plan_web_search("https://example.com/?q={0}", &query).unwrap()
        else {
            panic!("expected URL plan");
        };
        assert_eq!(url.matches("%E4%B8%AD").count(), 100);
        assert!(!url.contains("tail"));
    }

    #[test]
    fn web_search_rejects_invalid_engine_url() {
        assert!(plan_web_search("example.com/?q={0}", "query").is_err());
        assert!(plan_web_search("https://example.com/{other}", "query").is_err());
    }

    #[test]
    fn goto_url_trims_and_adds_http_only_without_a_scheme() {
        assert_eq!(
            normalize_goto_url("  example.com/path  ").unwrap(),
            "http://example.com/path"
        );
        assert_eq!(
            normalize_goto_url("localhost:3000/path").unwrap(),
            "http://localhost:3000/path"
        );
        assert_eq!(
            normalize_goto_url("https://example.com").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_goto_url("my-app:open/settings").unwrap(),
            "my-app:open/settings"
        );
        assert!(normalize_goto_url(" \t ").is_err());
        assert!(normalize_goto_url("bad host/path").is_err());
        assert!(normalize_goto_url("https://").is_err());
        assert!(normalize_goto_url("http:example.com").is_err());
    }

    #[test]
    fn browser_path_removes_only_outer_quotes_and_must_exist() {
        let current_exe = std::env::current_exe().unwrap();
        let current_exe = current_exe.to_string_lossy();
        let quoted = format!("  \"{current_exe}\"  ");
        assert_eq!(existing_browser_path(&quoted), Some(current_exe.as_ref()));
        assert_eq!(existing_browser_path("missing-browser.exe"), None);
    }

    #[test]
    fn cmd_normalization_removes_comments_and_preserves_shell_syntax() {
        let code = concat!(
            ":: description\r\n",
            "  echo \"a b\" | findstr \"a\"  \r\n",
            "REM full comment\n",
            "echo second :: inline comment\n",
            "echo third ReM trailing note\n",
            "\n"
        );
        assert_eq!(
            normalize_cmd_code(code),
            "echo \"a b\" | findstr \"a\" & echo second & echo third"
        );
    }

    #[test]
    fn cmd_normalization_handles_mixed_newlines_and_empty_scripts() {
        assert_eq!(
            normalize_cmd_code("echo one\recho two\n\r\necho three"),
            "echo one & echo two & echo three"
        );
        assert_eq!(normalize_cmd_code(" \r\n:: note\nrem\tcomment"), "");
    }

    #[test]
    fn only_exact_meta_l_uses_the_lock_workstation_api() {
        assert!(is_lock_workstation_hotkey(&["meta".into()], &["l".into()]));
        assert!(is_lock_workstation_hotkey(&["META".into()], &["L".into()]));
        assert!(!is_lock_workstation_hotkey(
            &["ctrl".into(), "meta".into()],
            &["l".into()]
        ));
        assert!(!is_lock_workstation_hotkey(
            &["meta".into()],
            &["l".into(), "x".into()]
        ));
        assert!(!is_lock_workstation_hotkey(&["win".into()], &["l".into()]));
    }
}

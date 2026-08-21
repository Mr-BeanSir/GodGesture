//! WH_MOUSE_LL 低级鼠标钩子 —— 专用线程 + 消息泵。
//!
//! 语义对齐 WGestures MouseHook:
//! - 钩子跑在专用高优先级线程上,回调必须极快;
//! - 吞事件 = 返回非零而不调 CallNextHookEx;
//! - 自己合成的事件带 EXTRA_INFO_TAG,回调里直接放行(防自反馈);
//! - 光标位置用 GetCursorPos 而非 MSLLHOOKSTRUCT(规避个别软件把坐标折半的兼容病);
//! - 卸载 = 向钩子线程 Post WM_QUIT 后 join。
//!
//! 回调把决策委托给注册的 `HookHandler`(引擎侧闭包,内部即 PathTracker,
//! 决策是同步的 —— 这是"吞不吞这条事件"必须当场回答所决定的)。

use crate::engine::tracker::{Input, MouseButton};
use crate::engine::types::Point;
use crossbeam_channel::{bounded, unbounded, Receiver, Sender, TrySendError};
use serde::Serialize;
use std::cell::Cell;
use std::collections::VecDeque;
use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RAWKEYBOARD, RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
    GetMessageW, PostThreadMessageW, RegisterClassW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, HHOOK, HWND_MESSAGE, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL,
    WH_MOUSE_LL, WM_INPUT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
    WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_XBUTTONDOWN,
    WM_XBUTTONUP, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

/// 我们合成的输入事件的标记(WGestures 用 19900620,沿用向它致敬)
pub const EXTRA_INFO_TAG: usize = 19900620;

/// 钩子回调的裁决:是否吞掉这条事件
pub trait HookHandler: Send + Sync {
    fn on_event(&self, input: Input) -> bool;
}

/// 原生快捷键录制事件。录制期间由低级键盘钩子尝试阻断系统快捷键,
/// 再通过有界通道转发给 WebView 中的同一套和弦解析器。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardCaptureEvent {
    pub code: String,
    pub pressed: bool,
    pub repeat: bool,
}

pub struct KeyboardCapture {
    active: AtomicBool,
    tx: Sender<KeyboardCaptureEvent>,
    rx: Mutex<Option<Receiver<KeyboardCaptureEvent>>>,
}

impl Default for KeyboardCapture {
    fn default() -> Self {
        let (tx, rx) = bounded(128);
        Self {
            active: AtomicBool::new(false),
            tx,
            rx: Mutex::new(Some(rx)),
        }
    }
}

impl KeyboardCapture {
    pub fn start(&self) {
        self.active.store(true, Ordering::Release);
    }

    pub fn stop(&self) {
        self.active.store(false, Ordering::Release);
    }

    pub fn take_events(&self) -> Option<Receiver<KeyboardCaptureEvent>> {
        self.rx
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }

    fn dispatch(&self, event: KeyboardCaptureEvent) -> bool {
        if !self.active.load(Ordering::Acquire) {
            return false;
        }
        match self.tx.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                log::warn!("快捷键录制事件队列已满,丢弃本次键盘事件");
                // Fail open when the forwarding queue is saturated. Keeping
                // the user's key usable is safer than swallowing an event we
                // cannot deliver to the recorder.
                return false;
            }
            Err(TrySendError::Disconnected(_)) => {
                self.active.store(false, Ordering::Release);
                return false;
            }
        }
        true
    }
}

static HANDLER: Mutex<Option<Arc<dyn HookHandler>>> = Mutex::new(None);
const KEYBOARD_DEDUP_WINDOW: Duration = Duration::from_millis(100);

#[derive(Clone, Copy)]
struct LowLevelKeyboardEvent {
    vk_code: u32,
    pressed: bool,
    observed_at: Instant,
}

static LAST_LOW_LEVEL_KEYBOARD_EVENT: Mutex<Option<LowLevelKeyboardEvent>> = Mutex::new(None);

thread_local! {
    static DISPATCHING: Cell<bool> = const { Cell::new(false) };
}

static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
const WM_REPLAY_CLICK: u32 = 0x8000 + 0x47;
const MAX_PENDING_CLICKS: usize = 32;
static NEXT_MOUSE_EVENT_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_CLICK_REPLAY_ID: AtomicU64 = AtomicU64::new(1);
const RAW_KEYBOARD_USAGE_PAGE: u16 = 0x01;
const RAW_KEYBOARD_USAGE: u16 = 0x06;
const RI_KEY_BREAK: u16 = 0x01;
const MAX_RAW_INPUT_BYTES: u32 = 4096;

#[derive(Debug, Clone, Copy)]
pub struct ClickReplay {
    pub replay_id: u64,
    pub button: MouseButton,
    pub pos: Point,
    pub queued_at: Instant,
}

pub fn next_click_replay_id() -> u64 {
    NEXT_CLICK_REPLAY_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ReplayTiming {
    queue_wait_us: u128,
    worker_wait_us: u128,
    injection_us: u128,
    request_to_completion_us: u128,
}

impl ReplayTiming {
    fn from_durations(queue_wait: Duration, worker_wait: Duration, injection: Duration) -> Self {
        let queue_wait_us = queue_wait.as_micros();
        let worker_wait_us = worker_wait.as_micros();
        let injection_us = injection.as_micros();
        Self {
            queue_wait_us,
            worker_wait_us,
            injection_us,
            request_to_completion_us: queue_wait_us + worker_wait_us + injection_us,
        }
    }
}

#[derive(Default)]
pub struct ClickReplayQueue {
    pending: Mutex<VecDeque<ClickReplay>>,
    hook_thread_id: AtomicU32,
}

impl ClickReplayQueue {
    pub fn enqueue(&self, replay: ClickReplay) -> Result<usize, String> {
        let thread_id = self.hook_thread_id.load(Ordering::SeqCst);
        if thread_id == 0 {
            return Err("mouse hook thread is unavailable".into());
        }
        self.enqueue_with(replay, || unsafe {
            PostThreadMessageW(thread_id, WM_REPLAY_CLICK, WPARAM(0), LPARAM(0))
                .map_err(|error| error.to_string())
        })
    }

    fn enqueue_with(
        &self,
        replay: ClickReplay,
        wake: impl FnOnce() -> Result<(), String>,
    ) -> Result<usize, String> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if pending.len() >= MAX_PENDING_CLICKS {
            return Err(format!(
                "mouse click replay queue is full ({MAX_PENDING_CLICKS})"
            ));
        }
        pending.push_back(replay);
        if let Err(error) = wake() {
            pending.pop_back();
            return Err(format!("cannot wake mouse hook thread: {error}"));
        }
        Ok(pending.len())
    }

    fn take(&self) -> Option<ClickReplay> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front()
    }

    fn pending_depth(&self) -> usize {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    fn attach(&self, thread_id: u32) {
        self.hook_thread_id.store(thread_id, Ordering::SeqCst);
    }

    fn detach(&self) {
        self.hook_thread_id.store(0, Ordering::SeqCst);
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }
}

pub struct MouseHook {
    thread: Option<JoinHandle<()>>,
    replay_worker: Option<ReplayWorker>,
}

#[derive(Debug, Clone, Copy)]
struct ReplayDispatch {
    replay: ClickReplay,
    dispatched_at: Instant,
}

struct ReplayWorker {
    tx: Sender<ReplayDispatch>,
    thread: Option<JoinHandle<()>>,
}

impl ReplayWorker {
    fn start(replay_click: impl Fn(ClickReplay) + Send + 'static) -> Self {
        let (tx, rx) = unbounded::<ReplayDispatch>();
        let thread = std::thread::Builder::new()
            .name("gg-click-replay".into())
            .spawn(move || {
                while let Ok(dispatch) = rx.recv() {
                    let worker_started_at = Instant::now();
                    log::debug!(
                        target: "platform.windows",
                        "event=replay_worker_started replay_id={} worker_wait_us={}",
                        dispatch.replay.replay_id,
                        worker_started_at
                            .duration_since(dispatch.dispatched_at)
                            .as_micros()
                    );
                    replay_click(dispatch.replay);
                    let queue_wait = dispatch
                        .dispatched_at
                        .duration_since(dispatch.replay.queued_at);
                    let worker_wait = worker_started_at.duration_since(dispatch.dispatched_at);
                    let timing = ReplayTiming::from_durations(
                        queue_wait,
                        worker_wait,
                        worker_started_at.elapsed(),
                    );
                    log::debug!(
                        target: "platform.windows",
                        "event=replay_completed replay_id={} queue_wait_us={} worker_wait_us={} injection_us={} request_to_completion_us={}",
                        dispatch.replay.replay_id,
                        timing.queue_wait_us,
                        timing.worker_wait_us,
                        timing.injection_us,
                        timing.request_to_completion_us
                    );
                }
            })
            .expect("failed to spawn click replay worker");
        Self {
            tx,
            thread: Some(thread),
        }
    }

    fn sender(&self) -> Sender<ReplayDispatch> {
        self.tx.clone()
    }

    fn shutdown(mut self) {
        drop(self.tx);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl MouseHook {
    /// 安装钩子。`handler` 在钩子线程上被调用,必须快且不可 panic。
    pub fn install(
        handler: Box<dyn HookHandler>,
        replay_queue: Arc<ClickReplayQueue>,
        keyboard_capture: Arc<KeyboardCapture>,
        replay_click: impl Fn(ClickReplay) + Send + 'static,
    ) -> Self {
        let replay_worker = ReplayWorker::start(replay_click);
        let replay_sender = replay_worker.sender();
        let thread = std::thread::Builder::new()
            .name("gg-mouse-hook".into())
            .spawn(move || hook_thread_main(handler, replay_queue, keyboard_capture, replay_sender))
            .expect("failed to spawn hook thread");
        Self {
            thread: Some(thread),
            replay_worker: Some(replay_worker),
        }
    }
}

impl Drop for MouseHook {
    fn drop(&mut self) {
        let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        if let Some(worker) = self.replay_worker.take() {
            worker.shutdown();
        }
    }
}

fn hook_thread_main(
    handler: Box<dyn HookHandler>,
    replay_queue: Arc<ClickReplayQueue>,
    keyboard_capture: Arc<KeyboardCapture>,
    replay_sender: Sender<ReplayDispatch>,
) {
    *HANDLER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::from(handler));
    *KEYBOARD_CAPTURE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::clone(&keyboard_capture));
    let thread_id = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };

    let hook: HHOOK = unsafe {
        match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) {
            Ok(h) => h,
            Err(e) => {
                log::error!("SetWindowsHookExW(WH_MOUSE_LL) 失败: {e}");
                clear_handler();
                clear_keyboard_capture();
                return;
            }
        }
    };
    let keyboard_hook: Option<HHOOK> = unsafe {
        match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) {
            Ok(h) => Some(h),
            Err(e) => {
                log::error!("SetWindowsHookExW(WH_KEYBOARD_LL) 失败: {e}");
                None
            }
        }
    };

    let raw_input_window = match unsafe { create_raw_input_window() } {
        Ok(hwnd) => Some(hwnd),
        Err(error) => {
            log::error!("创建 Windows Raw Input 窗口失败: {error}");
            None
        }
    };
    let raw_input_registered =
        raw_input_window.is_some_and(|hwnd| unsafe { register_raw_keyboard(hwnd) });

    if keyboard_hook.is_none() && !raw_input_registered {
        log::error!("低级键盘钩子与 Raw Input 均不可用");
        if let Some(hwnd) = raw_input_window {
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
        }
        let _ = unsafe { UnhookWindowsHookEx(hook) };
        clear_handler();
        clear_keyboard_capture();
        return;
    }

    HOOK_THREAD_ID.store(thread_id, Ordering::SeqCst);
    replay_queue.attach(thread_id);
    log::info!(
        "鼠标输入已安装，键盘输入源: low_level={}, raw_input={}",
        keyboard_hook.is_some(),
        raw_input_registered
    );

    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_REPLAY_CLICK {
                if let Some(replay) = replay_queue.take() {
                    let dispatched_at = Instant::now();
                    let queue_wait = dispatched_at.duration_since(replay.queued_at);
                    log::debug!(
                        target: "platform.windows",
                        "event=replay_dispatched replay_id={} queue_depth={} queue_wait_us={}",
                        replay.replay_id,
                        replay_queue.pending_depth(),
                        queue_wait.as_micros()
                    );
                    if let Err(error) = replay_sender.send(ReplayDispatch {
                        replay,
                        dispatched_at,
                    }) {
                        log::error!(
                            target: "platform.windows",
                            "event=replay_dispatch_failed replay_id={} queue_wait_us={} error={error}",
                            replay.replay_id,
                            queue_wait.as_micros()
                        );
                    }
                }
                continue;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if raw_input_registered {
            unregister_raw_keyboard();
        }
        if let Some(hwnd) = raw_input_window {
            let _ = DestroyWindow(hwnd);
        }
        let _ = UnhookWindowsHookEx(hook);
        if let Some(keyboard_hook) = keyboard_hook {
            let _ = UnhookWindowsHookEx(keyboard_hook);
        }
    }
    clear_handler();
    clear_keyboard_capture();
    replay_queue.detach();
    HOOK_THREAD_ID.store(0, Ordering::SeqCst);
    log::info!("鼠标钩子已卸载");
}

unsafe extern "system" fn keyboard_proc(hook_code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if hook_code < 0 {
        return unsafe { CallNextHookEx(None, hook_code, wparam, lparam) };
    }
    let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
    if info.dwExtraInfo == EXTRA_INFO_TAG {
        return unsafe { CallNextHookEx(None, hook_code, wparam, lparam) };
    }
    let pressed = matches!(wparam.0 as u32, 0x0100 | 0x0104);
    let released = matches!(wparam.0 as u32, 0x0101 | 0x0105);
    if !pressed && !released {
        return unsafe { CallNextHookEx(None, hook_code, wparam, lparam) };
    }
    let key_code = keyboard_code(info.vkCode);
    if let Some(key_code) = key_code {
        remember_low_level_keyboard_event(info.vkCode, pressed);
        let swallow = dispatch_keyboard_event(
            KeyboardCaptureEvent {
                code: key_code.clone(),
                pressed,
                repeat: false,
            },
            "keyboard_hook",
        );

        // Suppress only when the event reached either native recorder or the
        // gesture engine. A saturated recorder queue fails open so the user's
        // key remains usable.
        if swallow {
            return LRESULT(1);
        }
    }
    unsafe { CallNextHookEx(None, hook_code, wparam, lparam) }
}

static KEYBOARD_CAPTURE: Mutex<Option<Arc<KeyboardCapture>>> = Mutex::new(None);

fn clear_keyboard_capture() {
    *KEYBOARD_CAPTURE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

fn clear_handler() {
    *HANDLER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

unsafe fn create_raw_input_window() -> Result<HWND, String> {
    let hinstance = GetModuleHandleW(None).map_err(|error| error.to_string())?;
    let class_name = w!("GodGestureRawInput");
    let class = WNDCLASSW {
        lpfnWndProc: Some(raw_input_window_proc),
        hInstance: hinstance.into(),
        lpszClassName: class_name,
        ..Default::default()
    };
    // RegisterClassW returns zero when the class already exists. That is safe
    // here because the class is process-local and uses the same callback.
    let _ = RegisterClassW(&class);

    CreateWindowExW(
        WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        class_name,
        w!(""),
        WS_POPUP,
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        None,
        Some(hinstance.into()),
        None,
    )
    .map_err(|error| error.to_string())
}

unsafe fn register_raw_keyboard(hwnd: HWND) -> bool {
    let device = RAWINPUTDEVICE {
        usUsagePage: RAW_KEYBOARD_USAGE_PAGE,
        usUsage: RAW_KEYBOARD_USAGE,
        dwFlags: RIDEV_INPUTSINK,
        hwndTarget: hwnd,
    };
    match RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32) {
        Ok(()) => {
            log::info!(target: "platform.windows", "Windows Raw Input 键盘设备已注册");
            true
        }
        Err(error) => {
            log::error!(target: "platform.windows", "注册 Windows Raw Input 键盘设备失败: {error}");
            false
        }
    }
}

unsafe fn unregister_raw_keyboard() {
    let device = RAWINPUTDEVICE {
        usUsagePage: RAW_KEYBOARD_USAGE_PAGE,
        usUsage: RAW_KEYBOARD_USAGE,
        dwFlags: RIDEV_REMOVE,
        hwndTarget: HWND::default(),
    };
    if let Err(error) =
        RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32)
    {
        log::warn!(target: "platform.windows", "注销 Windows Raw Input 键盘设备失败: {error}");
    }
}

unsafe extern "system" fn raw_input_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_INPUT {
        process_raw_keyboard_input(lparam);
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

unsafe fn process_raw_keyboard_input(lparam: LPARAM) {
    let raw_input = HRAWINPUT(lparam.0 as *mut c_void);
    let header_size = std::mem::size_of::<windows::Win32::UI::Input::RAWINPUTHEADER>() as u32;
    let mut input_size = 0u32;
    let queried = GetRawInputData(raw_input, RID_INPUT, None, &mut input_size, header_size);
    if queried == u32::MAX || input_size == 0 || input_size > MAX_RAW_INPUT_BYTES {
        log::debug!(
            target: "platform.windows",
            "忽略异常 Windows Raw Input 数据: size={input_size} result={queried}"
        );
        return;
    }

    let word_count = (input_size as usize).div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; word_count.max(1)];
    let mut copied_size = input_size;
    let copied = GetRawInputData(
        raw_input,
        RID_INPUT,
        Some(buffer.as_mut_ptr().cast::<c_void>()),
        &mut copied_size,
        header_size,
    );
    let min_keyboard_bytes =
        std::mem::size_of::<RAWINPUTHEADER>() + std::mem::size_of::<RAWKEYBOARD>();
    if copied == u32::MAX || (copied as usize) < min_keyboard_bytes {
        log::debug!(
            target: "platform.windows",
            "忽略无法读取的 Windows Raw Input 数据: size={copied_size} result={copied}"
        );
        return;
    }

    let buffer_ptr = buffer.as_ptr().cast::<u8>();
    let header = &*(buffer_ptr.cast::<RAWINPUTHEADER>());
    if header.dwType != RIM_TYPEKEYBOARD.0 {
        return;
    }
    let keyboard = std::ptr::read_unaligned(
        buffer_ptr
            .add(std::mem::size_of::<RAWINPUTHEADER>())
            .cast::<RAWKEYBOARD>(),
    );
    if keyboard.ExtraInformation as usize == EXTRA_INFO_TAG {
        return;
    }
    let Some(code) = keyboard_code(keyboard.VKey as u32) else {
        return;
    };
    let pressed = keyboard.Flags & RI_KEY_BREAK == 0;
    if is_recent_low_level_keyboard_event(keyboard.VKey as u32, pressed) {
        if code == "KeyQ" {
            log::debug!(
                target: "platform.windows",
                "event=raw_input_duplicate_suppressed key=KeyQ pressed={pressed}"
            );
        }
        return;
    }
    let _ = dispatch_keyboard_event(
        KeyboardCaptureEvent {
            code,
            pressed,
            repeat: false,
        },
        "raw_input",
    );
}

fn remember_low_level_keyboard_event(vk_code: u32, pressed: bool) {
    *LAST_LOW_LEVEL_KEYBOARD_EVENT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(LowLevelKeyboardEvent {
        vk_code,
        pressed,
        observed_at: Instant::now(),
    });
}

fn is_recent_low_level_keyboard_event(vk_code: u32, pressed: bool) -> bool {
    LAST_LOW_LEVEL_KEYBOARD_EVENT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .is_some_and(|event| {
            event.vk_code == vk_code
                && event.pressed == pressed
                && event.observed_at.elapsed() <= KEYBOARD_DEDUP_WINDOW
        })
}

fn dispatch_keyboard_event(event: KeyboardCaptureEvent, source: &str) -> bool {
    let is_probe_key = event.code == "KeyQ";
    if is_probe_key {
        log::debug!(
            target: "platform.windows",
            "event={source}_received key=KeyQ pressed={}",
            event.pressed
        );
    }

    let capture_swallow = KEYBOARD_CAPTURE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .is_some_and(|capture| capture.dispatch(event.clone()));
    let input = if event.pressed {
        Input::KeyDown(event.code.clone())
    } else {
        Input::KeyUp(event.code.clone())
    };
    let engine_swallow = dispatch_input(input);
    if is_probe_key {
        log::debug!(
            target: "platform.windows",
            "event={source}_dispatched key=KeyQ pressed={} capture_swallow={capture_swallow} engine_swallow={engine_swallow}",
            event.pressed
        );
    }
    capture_swallow || engine_swallow
}

fn keyboard_code(vk: u32) -> Option<String> {
    let code = match vk {
        0x08 => "Backspace".into(),
        0x09 => "Tab".into(),
        0x0D => "Enter".into(),
        0x13 => "Pause".into(),
        0x14 => "CapsLock".into(),
        0x1B => "Escape".into(),
        0x20 => "Space".into(),
        0x21 => "PageUp".into(),
        0x22 => "PageDown".into(),
        0x23 => "End".into(),
        0x24 => "Home".into(),
        0x25 => "ArrowLeft".into(),
        0x26 => "ArrowUp".into(),
        0x27 => "ArrowRight".into(),
        0x28 => "ArrowDown".into(),
        0x2C => "PrintScreen".into(),
        0x2D => "Insert".into(),
        0x2E => "Delete".into(),
        0x30..=0x39 => format!("Digit{}", (vk - 0x30) as u8 as char),
        0x41..=0x5A => format!("Key{}", (vk as u8) as char),
        0x5B => "MetaLeft".into(),
        0x5C => "MetaRight".into(),
        0x5D => "ContextMenu".into(),
        0x60..=0x69 => format!("Numpad{}", vk - 0x60),
        0x6A => "NumpadMultiply".into(),
        0x6B => "NumpadAdd".into(),
        0x6D => "NumpadSubtract".into(),
        0x6E => "NumpadDecimal".into(),
        0x6F => "NumpadDivide".into(),
        0x70..=0x87 => format!("F{}", vk - 0x70 + 1),
        0x90 => "NumLock".into(),
        0x91 => "ScrollLock".into(),
        0xA0 => "ShiftLeft".into(),
        0xA1 => "ShiftRight".into(),
        0xA2 => "ControlLeft".into(),
        0xA3 => "ControlRight".into(),
        0xA4 => "AltLeft".into(),
        0xA5 => "AltRight".into(),
        0xA6 => "BrowserBack".into(),
        0xA7 => "BrowserForward".into(),
        0xA8 => "BrowserRefresh".into(),
        0xA9 => "BrowserStop".into(),
        0xAA => "BrowserSearch".into(),
        0xAB => "BrowserFavorites".into(),
        0xAC => "BrowserHome".into(),
        0xAD => "AudioVolumeMute".into(),
        0xAE => "AudioVolumeDown".into(),
        0xAF => "AudioVolumeUp".into(),
        0xB0 => "MediaTrackNext".into(),
        0xB1 => "MediaTrackPrevious".into(),
        0xB2 => "MediaStop".into(),
        0xB3 => "MediaPlayPause".into(),
        0xBA => "Semicolon".into(),
        0xBB => "Equal".into(),
        0xBC => "Comma".into(),
        0xBD => "Minus".into(),
        0xBE => "Period".into(),
        0xBF => "Slash".into(),
        0xC0 => "Backquote".into(),
        0xDB => "BracketLeft".into(),
        0xDC => "Backslash".into(),
        0xDD => "BracketRight".into(),
        0xDE => "Quote".into(),
        0xE2 => "IntlBackslash".into(),
        _ => return None,
    };
    Some(code)
}

fn dispatch_input(input: Input) -> bool {
    let Some(handler) = HANDLER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
    else {
        return false;
    };

    // SendInput can synchronously re-enter this hook. Let the nested event pass
    // through instead of recursively invoking the engine.
    DISPATCHING.with(|dispatching| {
        if dispatching.replace(true) {
            return false;
        }
        let result = catch_unwind(AssertUnwindSafe(|| handler.on_event(input)));
        dispatching.set(false);
        match result {
            Ok(swallow) => swallow,
            Err(_) => {
                log::error!("鼠标钩子处理器发生 panic，已放行当前事件");
                false
            }
        }
    })
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };

    // 自己合成的事件直接放行
    if info.dwExtraInfo == EXTRA_INFO_TAG {
        if matches!(
            wparam.0 as u32,
            WM_LBUTTONDOWN
                | WM_LBUTTONUP
                | WM_MBUTTONDOWN
                | WM_MBUTTONUP
                | WM_RBUTTONDOWN
                | WM_RBUTTONUP
                | WM_XBUTTONDOWN
                | WM_XBUTTONUP
        ) {
            log::debug!(
                target: "platform.windows",
                "event=mouse_injected_ignored message=0x{:X} x={} y={} extra_info={}",
                wparam.0 as u32,
                info.pt.x,
                info.pt.y,
                info.dwExtraInfo
            );
        }
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    // 位置:优先 GetCursorPos(兼容性),失败退回钩子数据
    let mut cp = POINT::default();
    let pos = if unsafe { GetCursorPos(&mut cp) }.is_ok() {
        Point { x: cp.x, y: cp.y }
    } else {
        Point {
            x: info.pt.x,
            y: info.pt.y,
        }
    };

    let input = match wparam.0 as u32 {
        WM_MOUSEMOVE => Some(Input::Move(pos)),
        WM_RBUTTONDOWN => Some(Input::ButtonDown(MouseButton::Right, pos)),
        WM_RBUTTONUP => Some(Input::ButtonUp(MouseButton::Right, pos)),
        WM_MBUTTONDOWN => Some(Input::ButtonDown(MouseButton::Middle, pos)),
        WM_MBUTTONUP => Some(Input::ButtonUp(MouseButton::Middle, pos)),
        WM_LBUTTONDOWN => Some(Input::ButtonDown(MouseButton::Left, pos)),
        WM_LBUTTONUP => Some(Input::ButtonUp(MouseButton::Left, pos)),
        WM_XBUTTONDOWN | WM_XBUTTONUP => {
            let which = (info.mouseData >> 16) as u16;
            let btn = if which == 1 {
                MouseButton::X1
            } else {
                MouseButton::X2
            };
            if wparam.0 as u32 == WM_XBUTTONDOWN {
                Some(Input::ButtonDown(btn, pos))
            } else {
                Some(Input::ButtonUp(btn, pos))
            }
        }
        WM_MOUSEWHEEL => {
            let delta = (info.mouseData >> 16) as i16;
            Some(Input::Wheel {
                forward: delta > 0,
                pos,
            })
        }
        _ => None,
    };

    if let Some(input) = input {
        let button_event = match &input {
            Input::ButtonDown(button, point) => Some(("down", *button, *point)),
            Input::ButtonUp(button, point) => Some(("up", *button, *point)),
            _ => None,
        };
        let event_id = button_event.map(|_| NEXT_MOUSE_EVENT_ID.fetch_add(1, Ordering::Relaxed));
        if let (Some(event_id), Some((phase, button, point))) = (event_id, button_event) {
            log::debug!(
                target: "platform.windows",
                "event=mouse_button_received mouse_event_id={} phase={} button={:?} x={} y={}",
                event_id,
                phase,
                button,
                point.x,
                point.y
            );
        }
        let input_kind = match &input {
            Input::Move(_) => "move",
            Input::ButtonDown(_, _) => "button_down",
            Input::ButtonUp(_, _) => "button_up",
            Input::KeyDown(_) => "key_down",
            Input::KeyUp(_) => "key_up",
            Input::Wheel { .. } => "wheel",
        };
        let dispatch_started = Instant::now();
        let swallowed = dispatch_input(input);
        let dispatch_us = dispatch_started.elapsed().as_micros();
        if dispatch_us >= 1_000 {
            log::debug!(
                target: "platform.windows",
                "event=mouse_input_slow input_kind={} swallowed={} dispatch_us={}",
                input_kind,
                swallowed,
                dispatch_us
            );
        }
        if let (Some(event_id), Some((phase, button, point))) = (event_id, button_event) {
            log::debug!(
                target: "platform.windows",
                "event=mouse_button_completed mouse_event_id={} phase={} button={:?} x={} y={} swallowed={} dispatch_us={}",
                event_id,
                phase,
                button,
                point.x,
                point.y,
                swallowed,
                dispatch_us
            );
        }
        if swallowed {
            return LRESULT(1);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    fn point() -> Point {
        Point { x: 10, y: 20 }
    }

    static HANDLER_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn install_test_handler(handler: impl HookHandler + 'static) {
        let mut slot = HANDLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(slot.is_none());
        *slot = Some(Arc::new(handler));
    }

    fn remove_test_handler() {
        clear_handler();
    }

    struct ReentrantHandler {
        calls: Arc<AtomicUsize>,
    }

    impl HookHandler for ReentrantHandler {
        fn on_event(&self, _input: Input) -> bool {
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert!(!dispatch_input(Input::Move(point())));
            true
        }
    }

    #[test]
    fn reentrant_dispatch_passes_nested_event_and_restores_handler() {
        let _test_lock = HANDLER_TEST_LOCK.lock().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        install_test_handler(ReentrantHandler {
            calls: Arc::clone(&calls),
        });

        assert!(dispatch_input(Input::Move(point())));
        assert!(dispatch_input(Input::Move(point())));
        assert_eq!(calls.load(Ordering::SeqCst), 2);

        remove_test_handler();
    }

    struct PanicOnceHandler {
        calls: Arc<AtomicUsize>,
    }

    impl HookHandler for PanicOnceHandler {
        fn on_event(&self, _input: Input) -> bool {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("test panic");
            }
            true
        }
    }

    #[test]
    fn panic_is_caught_and_handler_is_restored() {
        let _test_lock = HANDLER_TEST_LOCK.lock().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        install_test_handler(PanicOnceHandler {
            calls: Arc::clone(&calls),
        });

        assert!(!dispatch_input(Input::Move(point())));
        assert!(dispatch_input(Input::Move(point())));
        assert_eq!(calls.load(Ordering::SeqCst), 2);

        remove_test_handler();
    }

    #[test]
    fn keyboard_dispatch_reaches_handler_from_another_callback_thread() {
        let _test_lock = HANDLER_TEST_LOCK.lock().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        struct CountingHandler {
            calls: Arc<AtomicUsize>,
        }

        impl HookHandler for CountingHandler {
            fn on_event(&self, _input: Input) -> bool {
                self.calls.fetch_add(1, Ordering::SeqCst);
                true
            }
        }

        install_test_handler(CountingHandler {
            calls: Arc::clone(&calls),
        });

        let result = std::thread::spawn(|| {
            let mut info = KBDLLHOOKSTRUCT {
                vkCode: 0x51,
                ..Default::default()
            };
            unsafe {
                keyboard_proc(
                    0,
                    WPARAM(0x0100),
                    LPARAM((&mut info as *mut KBDLLHOOKSTRUCT).cast::<u8>() as isize),
                )
            }
        })
        .join()
        .unwrap();

        assert_eq!(result, LRESULT(1));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        remove_test_handler();
    }

    #[test]
    fn click_replay_queue_is_fifo() {
        let queue = ClickReplayQueue::default();
        let first = ClickReplay {
            replay_id: 41,
            button: MouseButton::Right,
            pos: Point { x: 10, y: 20 },
            queued_at: Instant::now(),
        };
        let second = ClickReplay {
            replay_id: 42,
            button: MouseButton::Middle,
            pos: Point { x: 30, y: 40 },
            queued_at: Instant::now(),
        };

        assert_eq!(queue.enqueue_with(first, || Ok(())).unwrap(), 1);
        assert_eq!(queue.enqueue_with(second, || Ok(())).unwrap(), 2);

        let replay = queue.take().unwrap();
        assert_eq!(replay.replay_id, first.replay_id);
        assert_eq!((replay.button, replay.pos), (first.button, first.pos));
        assert_eq!(queue.pending_depth(), 1);
        let replay = queue.take().unwrap();
        assert_eq!(replay.replay_id, second.replay_id);
        assert_eq!((replay.button, replay.pos), (second.button, second.pos));
        assert!(queue.take().is_none());
    }

    #[test]
    fn failed_wake_rolls_back_replay() {
        let queue = ClickReplayQueue::default();
        let error = queue
            .enqueue_with(
                ClickReplay {
                    replay_id: 43,
                    button: MouseButton::Right,
                    pos: point(),
                    queued_at: Instant::now(),
                },
                || Err("post failed".into()),
            )
            .unwrap_err();

        assert!(error.contains("post failed"));
        assert!(queue.take().is_none());
    }

    #[test]
    fn replay_queue_is_bounded() {
        let queue = ClickReplayQueue::default();
        for index in 0..MAX_PENDING_CLICKS {
            queue
                .enqueue_with(
                    ClickReplay {
                        replay_id: 44 + index as u64,
                        button: MouseButton::Right,
                        pos: Point {
                            x: index as i32,
                            y: 0,
                        },
                        queued_at: Instant::now(),
                    },
                    || Ok(()),
                )
                .unwrap();
        }

        let error = queue
            .enqueue_with(
                ClickReplay {
                    replay_id: 100,
                    button: MouseButton::Right,
                    pos: point(),
                    queued_at: Instant::now(),
                },
                || Ok(()),
            )
            .unwrap_err();
        assert!(error.contains("queue is full"));
    }

    #[test]
    fn replay_timing_keeps_queue_wait_and_injection_duration_separate() {
        let timing = ReplayTiming::from_durations(
            Duration::from_micros(12),
            Duration::from_micros(8),
            Duration::from_micros(34),
        );

        assert_eq!(timing.queue_wait_us, 12);
        assert_eq!(timing.worker_wait_us, 8);
        assert_eq!(timing.injection_us, 34);
        assert_eq!(timing.request_to_completion_us, 54);
    }

    #[test]
    fn replay_worker_dispatch_does_not_wait_for_injection_to_finish() {
        let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
        let worker = ReplayWorker::start(move |_replay| {
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        });
        let replay = ClickReplay {
            replay_id: 45,
            button: MouseButton::Right,
            pos: point(),
            queued_at: Instant::now(),
        };

        let dispatch_started = Instant::now();
        worker
            .sender()
            .send(ReplayDispatch {
                replay,
                dispatched_at: Instant::now(),
            })
            .unwrap();
        assert!(started_rx.recv_timeout(Duration::from_secs(1)).is_ok());
        assert!(dispatch_started.elapsed() < Duration::from_millis(100));

        release_tx.send(()).unwrap();
        worker.shutdown();
    }

    #[test]
    fn keyboard_capture_only_swallow_events_while_active() {
        let capture = KeyboardCapture::default();
        let events = capture.take_events().expect("capture receiver");
        let event = KeyboardCaptureEvent {
            code: "MetaLeft".into(),
            pressed: true,
            repeat: false,
        };

        assert!(!capture.dispatch(event.clone()));
        assert!(events.try_recv().is_err());

        capture.start();
        assert!(capture.dispatch(event.clone()));
        assert_eq!(events.try_recv().expect("captured event").code, "MetaLeft");

        capture.stop();
        assert!(!capture.dispatch(event));
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn keyboard_code_maps_windows_shortcut_keys_to_web_codes() {
        assert_eq!(keyboard_code(0x5B).as_deref(), Some("MetaLeft"));
        assert_eq!(keyboard_code(0x57).as_deref(), Some("KeyW"));
        assert_eq!(keyboard_code(0xA2).as_deref(), Some("ControlLeft"));
    }
}

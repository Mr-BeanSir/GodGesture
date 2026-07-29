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
use std::cell::RefCell;
use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, PostThreadMessageW,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HHOOK, MSG, MSLLHOOKSTRUCT,
    WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE,
    WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

/// 我们合成的输入事件的标记(WGestures 用 19900620,沿用向它致敬)
pub const EXTRA_INFO_TAG: usize = 19900620;

/// 钩子回调的裁决:是否吞掉这条事件
pub trait HookHandler: Send {
    fn on_event(&mut self, input: Input) -> bool;
}

thread_local! {
    static HANDLER: RefCell<Option<Box<dyn HookHandler>>> = const { RefCell::new(None) };
}

static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
const WM_REPLAY_CLICK: u32 = 0x8000 + 0x47;
const MAX_PENDING_CLICKS: usize = 32;

#[derive(Debug, Clone, Copy)]
pub struct ClickReplay {
    pub button: MouseButton,
    pub pos: Point,
    pub queued_at: Instant,
}

#[derive(Default)]
pub struct ClickReplayQueue {
    pending: Mutex<VecDeque<ClickReplay>>,
    hook_thread_id: AtomicU32,
}

impl ClickReplayQueue {
    pub fn enqueue(&self, replay: ClickReplay) -> Result<(), String> {
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
    ) -> Result<(), String> {
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
        Ok(())
    }

    fn take(&self) -> Option<ClickReplay> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front()
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
}

impl MouseHook {
    /// 安装钩子。`handler` 在钩子线程上被调用,必须快且不可 panic。
    pub fn install(
        handler: Box<dyn HookHandler>,
        replay_queue: Arc<ClickReplayQueue>,
        replay_click: impl Fn(ClickReplay) + Send + 'static,
    ) -> Self {
        let thread = std::thread::Builder::new()
            .name("gg-mouse-hook".into())
            .spawn(move || hook_thread_main(handler, replay_queue, Box::new(replay_click)))
            .expect("failed to spawn hook thread");
        Self {
            thread: Some(thread),
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
    }
}

fn hook_thread_main(
    handler: Box<dyn HookHandler>,
    replay_queue: Arc<ClickReplayQueue>,
    replay_click: Box<dyn Fn(ClickReplay) + Send>,
) {
    HANDLER.with(|h| *h.borrow_mut() = Some(handler));
    let thread_id = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };

    let hook: HHOOK = unsafe {
        match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) {
            Ok(h) => h,
            Err(e) => {
                log::error!("SetWindowsHookExW(WH_MOUSE_LL) 失败: {e}");
                return;
            }
        }
    };
    HOOK_THREAD_ID.store(thread_id, Ordering::SeqCst);
    replay_queue.attach(thread_id);
    log::info!("鼠标钩子已安装");

    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_REPLAY_CLICK {
                if let Some(replay) = replay_queue.take() {
                    log::debug!(
                        "鼠标点击重放调度耗时: {} us",
                        replay.queued_at.elapsed().as_micros()
                    );
                    replay_click(replay);
                }
                continue;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = UnhookWindowsHookEx(hook);
    }
    HANDLER.with(|h| *h.borrow_mut() = None);
    replay_queue.detach();
    HOOK_THREAD_ID.store(0, Ordering::SeqCst);
    log::info!("鼠标钩子已卸载");
}

fn dispatch_input(input: Input) -> bool {
    HANDLER.with(|slot| {
        // SendInput can synchronously re-enter this hook. Move the handler out so
        // a nested callback observes None instead of borrowing the RefCell twice.
        let Some(mut handler) = slot.borrow_mut().take() else {
            return false;
        };
        let result = catch_unwind(AssertUnwindSafe(|| handler.on_event(input)));
        *slot.borrow_mut() = Some(handler);
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
        if dispatch_input(input) {
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

    fn install_test_handler(handler: impl HookHandler + 'static) {
        HANDLER.with(|slot| {
            assert!(slot.borrow().is_none());
            *slot.borrow_mut() = Some(Box::new(handler));
        });
    }

    fn remove_test_handler() {
        HANDLER.with(|slot| {
            slot.borrow_mut().take();
        });
    }

    struct ReentrantHandler {
        calls: Arc<AtomicUsize>,
    }

    impl HookHandler for ReentrantHandler {
        fn on_event(&mut self, _input: Input) -> bool {
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert!(!dispatch_input(Input::Move(point())));
            true
        }
    }

    #[test]
    fn reentrant_dispatch_passes_nested_event_and_restores_handler() {
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
        fn on_event(&mut self, _input: Input) -> bool {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("test panic");
            }
            true
        }
    }

    #[test]
    fn panic_is_caught_and_handler_is_restored() {
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
    fn click_replay_queue_is_fifo() {
        let queue = ClickReplayQueue::default();
        let first = ClickReplay {
            button: MouseButton::Right,
            pos: Point { x: 10, y: 20 },
            queued_at: Instant::now(),
        };
        let second = ClickReplay {
            button: MouseButton::Middle,
            pos: Point { x: 30, y: 40 },
            queued_at: Instant::now(),
        };

        queue.enqueue_with(first, || Ok(())).unwrap();
        queue.enqueue_with(second, || Ok(())).unwrap();

        let replay = queue.take().unwrap();
        assert_eq!((replay.button, replay.pos), (first.button, first.pos));
        let replay = queue.take().unwrap();
        assert_eq!((replay.button, replay.pos), (second.button, second.pos));
        assert!(queue.take().is_none());
    }

    #[test]
    fn failed_wake_rolls_back_replay() {
        let queue = ClickReplayQueue::default();
        let error = queue
            .enqueue_with(
                ClickReplay {
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
                    button: MouseButton::Right,
                    pos: point(),
                    queued_at: Instant::now(),
                },
                || Ok(()),
            )
            .unwrap_err();
        assert!(error.contains("queue is full"));
    }
}

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
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread::JoinHandle;
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

pub struct MouseHook {
    thread: Option<JoinHandle<()>>,
}

impl MouseHook {
    /// 安装钩子。`handler` 在钩子线程上被调用,必须快且不可 panic。
    pub fn install(handler: Box<dyn HookHandler>) -> Self {
        let thread = std::thread::Builder::new()
            .name("gg-mouse-hook".into())
            .spawn(move || hook_thread_main(handler))
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

fn hook_thread_main(handler: Box<dyn HookHandler>) {
    HANDLER.with(|h| *h.borrow_mut() = Some(handler));
    HOOK_THREAD_ID.store(
        unsafe { windows::Win32::System::Threading::GetCurrentThreadId() },
        Ordering::SeqCst,
    );

    let hook: HHOOK = unsafe {
        match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) {
            Ok(h) => h,
            Err(e) => {
                log::error!("SetWindowsHookExW(WH_MOUSE_LL) 失败: {e}");
                return;
            }
        }
    };
    log::info!("鼠标钩子已安装");

    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = UnhookWindowsHookEx(hook);
    }
    HANDLER.with(|h| *h.borrow_mut() = None);
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
}

//! Windows 平台实现。

pub mod clipboard;
pub mod commands;
pub mod hook;
pub mod icon;
pub mod input;
pub mod keys;
pub mod overlay;
pub mod script;
pub mod startup;
pub mod window;

use crate::engine::corners::ScreenInfo;
use crate::engine::intents::ForegroundApp;
use crate::engine::runtime::{EngineShared, PlatformServices};
use crate::engine::tracker::{Input, MouseButton};
use crate::engine::types::Point;
use hook::{ClickReplay, ClickReplayQueue, HookHandler, MouseHook};
use std::sync::Arc;
use std::time::Instant;

#[derive(Default)]
pub struct WindowsPlatform {
    click_replays: Arc<ClickReplayQueue>,
}

impl PlatformServices for WindowsPlatform {
    fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp {
        window::resolve_foreground_app(pos, prefer_cursor_window)
    }

    fn is_fullscreen(&self) -> bool {
        window::is_foreground_fullscreen()
    }

    fn synthesize_click(&self, button: MouseButton, pos: Point) {
        if let Err(error) = self.click_replays.enqueue(ClickReplay {
            button,
            pos,
            queued_at: Instant::now(),
        }) {
            log::error!("无法投递鼠标点击重放: {error}");
        }
    }

    fn synthesize_down(&self, button: MouseButton, pos: Point) {
        input::synthesize_down(button, pos);
    }

    fn synthesize_wheel(&self, forward: bool) {
        if let Err(error) = input::wheel(if forward { 120 } else { -120 }) {
            log::error!("无法重放鼠标滚轮: {error}");
        }
    }

    fn screen_at(&self, pos: Point) -> Option<ScreenInfo> {
        window::screen_at(pos)
    }
}

struct EngineHookHandler {
    shared: Arc<EngineShared>,
}

impl HookHandler for EngineHookHandler {
    fn on_event(&mut self, input: Input) -> bool {
        self.shared.on_hook_event(input)
    }
}

/// 安装钩子并启动定时线程;返回值须持有(Drop 即卸载钩子)
pub fn start(shared: Arc<EngineShared>, platform: Arc<WindowsPlatform>) -> MouseHook {
    shared.spawn_timer_thread();
    // 有效点距 = 主屏宽 * 0.025(WGestures 行为)
    let width = unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
            windows::Win32::UI::WindowsAndMessaging::SM_CXSCREEN,
        )
    };
    if width > 0 {
        shared.set_effective_move_px(width as f64 * 0.025);
    }
    MouseHook::install(
        Box::new(EngineHookHandler { shared }),
        Arc::clone(&platform.click_replays),
        |replay| input::synthesize_click(replay.button, replay.pos),
    )
}

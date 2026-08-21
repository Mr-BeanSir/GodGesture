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
use crate::engine::runtime::{EngineShared, InputIntegrity, PlatformServices};
use crate::engine::tracker::{Input, MouseButton};
use crate::engine::types::Point;
use crossbeam_channel::Receiver;
use hook::{
    next_click_replay_id, ClickReplay, ClickReplayQueue, HookHandler, KeyboardCapture,
    KeyboardCaptureEvent, MouseHook,
};
use std::sync::Arc;
use std::time::Instant;

const CLICK_REPLAY_LOG_EVENT: &str = "mouse_replay_requested";

pub struct WindowsPlatform {
    click_replays: Arc<ClickReplayQueue>,
    keyboard_capture: Arc<KeyboardCapture>,
}

impl Default for WindowsPlatform {
    fn default() -> Self {
        Self {
            click_replays: Arc::new(ClickReplayQueue::default()),
            keyboard_capture: Arc::new(KeyboardCapture::default()),
        }
    }
}

impl WindowsPlatform {
    pub fn keyboard_capture(&self) -> Arc<KeyboardCapture> {
        Arc::clone(&self.keyboard_capture)
    }

    pub fn take_keyboard_events(&self) -> Option<Receiver<KeyboardCaptureEvent>> {
        self.keyboard_capture.take_events()
    }
}

impl PlatformServices for WindowsPlatform {
    fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp {
        window::resolve_foreground_app(pos, prefer_cursor_window)
    }

    fn is_fullscreen(&self) -> bool {
        window::is_foreground_fullscreen()
    }

    fn synthesize_click(&self, button: MouseButton, pos: Point) {
        let replay = ClickReplay {
            replay_id: next_click_replay_id(),
            button,
            pos,
            queued_at: Instant::now(),
        };
        log::debug!(
            target: "platform.windows",
            "event={} replay_id={} button={:?} x={} y={}",
            CLICK_REPLAY_LOG_EVENT,
            replay.replay_id,
            replay.button,
            replay.pos.x,
            replay.pos.y
        );
        let enqueue_started = Instant::now();
        match self.click_replays.enqueue(replay) {
            Ok(queue_depth) => log::debug!(
                target: "platform.windows",
                "event=replay_enqueued replay_id={} queue_depth={} enqueue_us={}",
                replay.replay_id,
                queue_depth,
                enqueue_started.elapsed().as_micros()
            ),
            Err(error) => log::error!(
                target: "platform.windows",
                "event=replay_enqueue_failed replay_id={} enqueue_us={} error={error}",
                replay.replay_id,
                enqueue_started.elapsed().as_micros()
            ),
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

    fn is_system_tray_point(&self, pos: Point) -> bool {
        window::is_system_tray_point(pos)
    }

    fn input_integrity(
        &self,
        pos: Point,
        prefer_cursor_window: bool,
    ) -> (InputIntegrity, InputIntegrity) {
        fn map(level: window::IntegrityLevel) -> InputIntegrity {
            match level {
                window::IntegrityLevel::Unknown => InputIntegrity::Unknown,
                window::IntegrityLevel::Untrusted => InputIntegrity::Untrusted,
                window::IntegrityLevel::Low => InputIntegrity::Low,
                window::IntegrityLevel::Medium => InputIntegrity::Medium,
                window::IntegrityLevel::High => InputIntegrity::High,
                window::IntegrityLevel::System => InputIntegrity::System,
                window::IntegrityLevel::Protected => InputIntegrity::Protected,
            }
        }

        (
            map(window::current_process_integrity_level()),
            map(window::target_integrity_level(pos, prefer_cursor_window)),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::CLICK_REPLAY_LOG_EVENT;

    #[test]
    fn click_replay_log_is_not_boundary_specific() {
        assert_eq!(CLICK_REPLAY_LOG_EVENT, "mouse_replay_requested");
    }
}

struct EngineHookHandler {
    shared: Arc<EngineShared>,
}

impl HookHandler for EngineHookHandler {
    fn on_event(&self, input: Input) -> bool {
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
        Arc::clone(&platform.keyboard_capture),
        |replay| input::synthesize_click(replay.replay_id, replay.button, replay.pos),
    )
}

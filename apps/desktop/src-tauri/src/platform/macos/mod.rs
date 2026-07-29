//! macOS platform implementation.

pub mod clipboard;
pub mod commands;
pub mod hook;
pub mod input;
pub mod icon;
pub mod keys;
pub mod overlay;
pub mod permissions;
pub mod script;
pub mod startup;
pub mod window;

use crate::engine::corners::ScreenInfo;
use crate::engine::intents::ForegroundApp;
use crate::engine::runtime::{EngineShared, PlatformServices};
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct MacPlatform;

#[derive(Default)]
pub struct EngineState {
    tap: Mutex<Option<hook::EventTap>>,
    last_error: Mutex<Option<String>>,
}

impl EngineState {
    pub fn try_start(&self, shared: Arc<EngineShared>) -> bool {
        let mut tap = self
            .tap
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if tap.is_some() {
            return true;
        }
        match start(shared) {
            Ok(installed) => {
                *tap = Some(installed);
                *self
                    .last_error
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
                true
            }
            Err(error) => {
                *self
                    .last_error
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(error.to_string());
                false
            }
        }
    }

    pub fn status(&self) -> (bool, Option<String>) {
        let running = self
            .tap
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        let error = self
            .last_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        (running, error)
    }
}

impl PlatformServices for MacPlatform {
    fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp {
        window::resolve_foreground_app(pos, prefer_cursor_window)
    }

    fn is_fullscreen(&self) -> bool {
        window::is_foreground_fullscreen()
    }

    fn synthesize_click(&self, button: MouseButton, pos: Point) {
        if let Err(error) = input::synthesize_click(button, pos) {
            log::error!("macOS click synthesis failed: {error}");
        }
    }

    fn synthesize_down(&self, button: MouseButton, pos: Point) {
        if let Err(error) = input::synthesize_down(button, pos) {
            log::error!("macOS button synthesis failed: {error}");
        }
    }

    fn screen_at(&self, pos: Point) -> Option<ScreenInfo> {
        window::screen_at(pos)
    }
}

pub fn start(shared: Arc<EngineShared>) -> Result<hook::EventTap, hook::EventTapError> {
    if !permissions::is_trusted() {
        return Err(hook::EventTapError(
            "Accessibility, input monitoring, or event posting permission is missing".into(),
        ));
    }
    let width = window::main_display_width();
    if width > 0.0 {
        shared.set_effective_move_px(width * 0.025);
    }
    hook::EventTap::install(shared)
}

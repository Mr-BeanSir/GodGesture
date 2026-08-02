//! Windows implementation of the Node plugin host boundary.

use super::{clipboard, commands, input};
use crate::engine::config::WindowOperation;
use crate::engine::runtime::GestureContext;
use crate::engine::script_host::{ScriptHost, ScriptMouseButton};
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use std::sync::Arc;
use tauri::Manager;

pub struct WindowsScriptHost {
    clipboard_owner_window: i64,
}

impl WindowsScriptHost {
    pub fn new(clipboard_owner_window: i64) -> Self {
        Self {
            clipboard_owner_window,
        }
    }
}

pub fn create_host(app: &tauri::AppHandle) -> Arc<dyn ScriptHost> {
    let clipboard_owner = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as i64)
        .unwrap_or_default();
    Arc::new(WindowsScriptHost::new(clipboard_owner))
}

impl ScriptHost for WindowsScriptHost {
    fn key_combo(&self, modifiers: Vec<String>, keys: Vec<String>) -> Result<(), String> {
        input::synthesize_key_combo(&modifiers, &keys)
    }

    fn send_text(&self, text: String) -> Result<(), String> {
        input::try_type_text_with_sleeps(&text)
    }

    fn mouse_click(&self, button: ScriptMouseButton) -> Result<(), String> {
        input::synthesize_click_checked(mouse_button(button))
    }

    fn mouse_button(&self, button: ScriptMouseButton, down: bool) -> Result<(), String> {
        input::synthesize_button(mouse_button(button), down)
    }

    fn move_pointer(&self, x: i32, y: i32) -> Result<(), String> {
        input::move_pointer(Point { x, y })
    }

    fn wheel(&self, delta: i32) -> Result<(), String> {
        input::wheel(delta)
    }

    fn activate_target(&self, context: GestureContext) -> Result<(), String> {
        commands::activate_target_for_script(&context)
    }

    fn window_operation(
        &self,
        operation: WindowOperation,
        context: GestureContext,
    ) -> Result<(), String> {
        commands::window_control_for_script(operation, &context)
    }

    fn clipboard_read_text(&self) -> Result<Option<String>, String> {
        Ok(clipboard::read_text())
    }

    fn clipboard_write_text(&self, text: String) -> Result<(), String> {
        clipboard::write_text(&text, self.clipboard_owner_window)
    }

    fn clipboard_selected_text(&self) -> Result<Option<String>, String> {
        Ok(clipboard::get_selected_text())
    }
}

fn mouse_button(button: ScriptMouseButton) -> MouseButton {
    match button {
        ScriptMouseButton::Left => MouseButton::Left,
        ScriptMouseButton::Right => MouseButton::Right,
        ScriptMouseButton::Middle => MouseButton::Middle,
        ScriptMouseButton::X1 => MouseButton::X1,
        ScriptMouseButton::X2 => MouseButton::X2,
    }
}

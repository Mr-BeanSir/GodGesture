// macOS QuickJS host boundary.

use crate::engine::config::WindowOperation;
use crate::engine::runtime::GestureContext;
use crate::engine::script::{ScriptHost, ScriptMouseButton};
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use std::sync::Arc;

struct MacScriptHost;

pub fn create_host(_app: &tauri::AppHandle) -> Arc<dyn ScriptHost> {
    Arc::new(MacScriptHost)
}

impl ScriptHost for MacScriptHost {
    fn key_combo(&self, modifiers: Vec<String>, keys: Vec<String>) -> Result<(), String> {
        super::input::synthesize_key_combo(&modifiers, &keys)
    }

    fn send_text(&self, text: String) -> Result<(), String> {
        super::input::try_type_text_with_sleeps(&text)
    }

    fn mouse_click(&self, button: ScriptMouseButton) -> Result<(), String> {
        super::input::synthesize_click_at_pointer(mouse_button(button))
    }

    fn mouse_button(&self, button: ScriptMouseButton, down: bool) -> Result<(), String> {
        super::input::synthesize_button(mouse_button(button), down)
    }

    fn move_pointer(&self, x: i32, y: i32) -> Result<(), String> {
        super::input::move_pointer(Point { x, y })
    }

    fn wheel(&self, delta: i32) -> Result<(), String> {
        super::input::wheel(delta)
    }

    fn activate_target(&self, context: GestureContext) -> Result<(), String> {
        super::window::activate_target(context.native_window)
    }

    fn window_operation(
        &self,
        operation: WindowOperation,
        context: GestureContext,
    ) -> Result<(), String> {
        super::commands::window_control_for_script(operation, &context)
    }

    fn clipboard_read_text(&self) -> Result<Option<String>, String> {
        Ok(super::clipboard::read_text())
    }

    fn clipboard_write_text(&self, text: String) -> Result<(), String> {
        super::clipboard::write_text(&text)
    }

    fn clipboard_selected_text(&self) -> Result<Option<String>, String> {
        Ok(super::clipboard::get_selected_text())
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

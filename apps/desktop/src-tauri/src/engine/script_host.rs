//! Native host boundary shared by the Node.js plugin runtime.

use super::config::WindowOperation;
use super::runtime::GestureContext;
use super::types::{Modifier, TriggerButton};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptMouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptSlot {
    Init,
    Execute,
    GestureRecognized,
    ModifierTriggered,
    GestureEnded,
}

impl ScriptSlot {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::Execute => "execute",
            Self::GestureRecognized => "gestureRecognized",
            Self::ModifierTriggered => "modifierTriggered",
            Self::GestureEnded => "gestureEnded",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ScriptInvocation {
    pub gesture: GestureContext,
    pub trigger: Option<TriggerButton>,
    pub modifier: Modifier,
}

pub trait ScriptHost: Send + Sync + 'static {
    fn key_combo(&self, modifiers: Vec<String>, keys: Vec<String>) -> Result<(), String>;
    fn send_text(&self, text: String) -> Result<(), String>;
    fn mouse_click(&self, button: ScriptMouseButton) -> Result<(), String>;
    fn mouse_button(&self, button: ScriptMouseButton, down: bool) -> Result<(), String>;
    fn move_pointer(&self, x: i32, y: i32) -> Result<(), String>;
    fn wheel(&self, delta: i32) -> Result<(), String>;
    fn activate_target(&self, context: GestureContext) -> Result<(), String>;
    fn window_operation(
        &self,
        operation: WindowOperation,
        context: GestureContext,
    ) -> Result<(), String>;
    fn clipboard_read_text(&self) -> Result<Option<String>, String>;
    fn clipboard_write_text(&self, text: String) -> Result<(), String>;
    fn clipboard_selected_text(&self) -> Result<Option<String>, String>;
}

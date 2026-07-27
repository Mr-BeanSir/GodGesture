//! QuickJS script runtime and platform host boundary.
//!
//! One `ScriptEngine` owns the process runtime on the engine consumer thread.
//! Logical commands receive isolated, lazily-created contexts whose globals
//! survive until their script definition changes.

use super::config::{Command, ConfigDocument, WindowOperation};
use super::runtime::GestureContext;
use super::types::{Modifier, TriggerButton};
use parking_lot::Mutex;
use rquickjs::{function::Func, Context as QuickJsContext, Ctx, Error, Object, Runtime};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

const SCRIPT_MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const SCRIPT_STACK_LIMIT: usize = 256 * 1024;
const SCRIPT_TIME_LIMIT: Duration = Duration::from_millis(200);
const MAX_STATUS_CHARS: usize = 256;
const LOCK_HOST_API: &str = r#"
Object.freeze(Input);
Object.freeze(Window);
Object.freeze(Clipboard);
Object.defineProperties(Context, {
  origin: { value: null, writable: true, enumerable: true, configurable: false },
  endpoint: { value: null, writable: true, enumerable: true, configurable: false },
  triggerButton: { value: null, writable: true, enumerable: true, configurable: false },
  modifier: { value: "none", writable: true, enumerable: true, configurable: false },
  phase: { value: "init", writable: true, enumerable: true, configurable: false },
  targetWindowAvailable: { value: false, writable: true, enumerable: true, configurable: false },
  activateTargetWindow: { writable: false, configurable: false }
});
Object.seal(Context);
for (const name of ["Input", "Context", "Window", "Clipboard", "ReportStatus"]) {
  Object.defineProperty(globalThis, name, { writable: false, configurable: false });
}
"#;

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
    fn name(self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::Execute => "execute",
            Self::GestureRecognized => "gestureRecognized",
            Self::ModifierTriggered => "modifierTriggered",
            Self::GestureEnded => "gestureEnded",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptDefinition {
    pub language: String,
    pub init_script: String,
    pub script: String,
    pub handle_modifiers: bool,
    pub gesture_recognized_script: String,
    pub modifier_triggered_script: String,
    pub gesture_ended_script: String,
}

impl ScriptDefinition {
    pub fn from_command(command: &Command) -> Option<Self> {
        let Command::Script {
            language,
            init_script,
            script,
            handle_modifiers,
            gesture_recognized_script,
            modifier_triggered_script,
            gesture_ended_script,
        } = command
        else {
            return None;
        };
        Some(Self {
            language: language.clone(),
            init_script: init_script.clone(),
            script: script.clone(),
            handle_modifiers: *handle_modifiers,
            gesture_recognized_script: gesture_recognized_script.clone(),
            modifier_triggered_script: modifier_triggered_script.clone(),
            gesture_ended_script: gesture_ended_script.clone(),
        })
    }

    fn source(&self, slot: ScriptSlot) -> &str {
        match slot {
            ScriptSlot::Init => &self.init_script,
            ScriptSlot::Execute => &self.script,
            ScriptSlot::GestureRecognized => &self.gesture_recognized_script,
            ScriptSlot::ModifierTriggered => &self.modifier_triggered_script,
            ScriptSlot::GestureEnded => &self.gesture_ended_script,
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

struct CachedContext {
    definition: ScriptDefinition,
    context: QuickJsContext,
}

#[derive(Debug, Clone, Copy)]
struct InvocationState {
    invocation: ScriptInvocation,
    phase: ScriptSlot,
}

struct HostBindings {
    host: Arc<dyn ScriptHost>,
    invocation: Mutex<InvocationState>,
    reported_status: Mutex<Option<String>>,
}

impl HostBindings {
    fn invocation(&self) -> ScriptInvocation {
        self.invocation.lock().invocation
    }
}

pub struct ScriptEngine {
    // Contexts must be dropped before their Runtime.
    contexts: HashMap<String, CachedContext>,
    runtime: Runtime,
    deadline: Arc<Mutex<Option<Instant>>>,
    bindings: Arc<HostBindings>,
}

impl ScriptEngine {
    pub fn new(host: Arc<dyn ScriptHost>) -> Result<Self, String> {
        let runtime = Runtime::new().map_err(|error| error.to_string())?;
        runtime.set_memory_limit(SCRIPT_MEMORY_LIMIT);
        runtime.set_max_stack_size(SCRIPT_STACK_LIMIT);

        let deadline = Arc::new(Mutex::new(None::<Instant>));
        let interrupt_deadline = Arc::clone(&deadline);
        runtime.set_interrupt_handler(Some(Box::new(move || {
            interrupt_deadline
                .lock()
                .is_some_and(|deadline| Instant::now() >= deadline)
        })));

        let empty_invocation = ScriptInvocation {
            gesture: GestureContext::default(),
            trigger: None,
            modifier: Modifier::None,
        };
        Ok(Self {
            contexts: HashMap::new(),
            runtime,
            deadline,
            bindings: Arc::new(HostBindings {
                host,
                invocation: Mutex::new(InvocationState {
                    invocation: empty_invocation,
                    phase: ScriptSlot::Init,
                }),
                reported_status: Mutex::new(None),
            }),
        })
    }

    pub fn run(
        &mut self,
        key: &str,
        definition: &ScriptDefinition,
        slot: ScriptSlot,
        invocation: ScriptInvocation,
    ) -> Result<Option<String>, String> {
        if !definition.language.eq_ignore_ascii_case("js") {
            return Err(format!(
                "script language '{}' is not executable",
                definition.language
            ));
        }

        let context = self.ensure_context(key, definition, invocation)?;
        self.evaluate(&context, key, slot, definition.source(slot), invocation)
    }

    pub fn retain_keys(&mut self, live_keys: &HashSet<String>) {
        self.contexts.retain(|key, _| live_keys.contains(key));
    }

    fn ensure_context(
        &mut self,
        key: &str,
        definition: &ScriptDefinition,
        invocation: ScriptInvocation,
    ) -> Result<QuickJsContext, String> {
        let is_current = self
            .contexts
            .get(key)
            .is_some_and(|cached| cached.definition == *definition);
        if is_current {
            return Ok(self.contexts[key].context.clone());
        }
        self.contexts.remove(key);

        let context = QuickJsContext::full(&self.runtime).map_err(|error| error.to_string())?;
        context
            .with(|ctx| install_host_api(&ctx, Arc::clone(&self.bindings)))
            .map_err(|error| format!("installing script host API failed: {error}"))?;

        if !definition.init_script.trim().is_empty() {
            self.evaluate(
                &context,
                key,
                ScriptSlot::Init,
                &definition.init_script,
                invocation,
            )?;
        }
        self.contexts.insert(
            key.to_string(),
            CachedContext {
                definition: definition.clone(),
                context: context.clone(),
            },
        );
        Ok(context)
    }

    fn evaluate(
        &self,
        context: &QuickJsContext,
        key: &str,
        slot: ScriptSlot,
        source: &str,
        invocation: ScriptInvocation,
    ) -> Result<Option<String>, String> {
        {
            let mut state = self.bindings.invocation.lock();
            state.invocation = invocation;
            state.phase = slot;
        }
        *self.bindings.reported_status.lock() = None;

        if source.trim().is_empty() {
            return Ok(None);
        }

        *self.deadline.lock() = Some(Instant::now() + SCRIPT_TIME_LIMIT);
        let result = context.with(|ctx| {
            update_context_object(&ctx, invocation, slot).map_err(|error| error.to_string())?;
            match ctx.eval::<(), _>(source.as_bytes()) {
                Ok(()) => Ok(()),
                Err(Error::Exception) => Err(format!("{:?}", ctx.catch())),
                Err(error) => Err(error.to_string()),
            }
        });
        let timed_out = self
            .deadline
            .lock()
            .is_some_and(|deadline| Instant::now() >= deadline);
        *self.deadline.lock() = None;

        result.map_err(|error| {
            if timed_out {
                format!("script '{key}' slot '{}' timed out", slot.name())
            } else {
                format!("script '{key}' slot '{}' failed: {error}", slot.name())
            }
        })?;
        Ok(self.bindings.reported_status.lock().take())
    }
}

pub fn gesture_script_key(intent_id: &str) -> String {
    format!("intent:{intent_id}")
}

pub fn hot_corner_script_key(slot: &str) -> String {
    format!("hot-corner:{slot}")
}

pub fn rub_edge_script_key(slot: &str) -> String {
    format!("rub-edge:{slot}")
}

pub fn live_script_keys(config: &ConfigDocument) -> Vec<String> {
    let mut keys = Vec::new();
    keys.extend(
        config
            .global
            .intents
            .iter()
            .filter(|intent| matches!(&intent.command, Command::Script { .. }))
            .map(|intent| gesture_script_key(&intent.id)),
    );
    for app in &config.apps {
        keys.extend(
            app.intents
                .iter()
                .filter(|intent| matches!(&intent.command, Command::Script { .. }))
                .map(|intent| gesture_script_key(&intent.id)),
        );
    }
    keys.extend(
        config
            .hot_corners
            .commands
            .iter()
            .filter(|(_, command)| matches!(command, Command::Script { .. }))
            .map(|(slot, _)| hot_corner_script_key(slot)),
    );
    keys.extend(
        config
            .rub_edges
            .commands
            .iter()
            .filter(|(_, command)| matches!(command, Command::Script { .. }))
            .map(|(slot, _)| rub_edge_script_key(slot)),
    );
    keys
}

fn install_host_api(ctx: &Ctx<'_>, bindings: Arc<HostBindings>) -> Result<(), Error> {
    let globals = ctx.globals();

    let input = Object::new(ctx.clone())?;
    let key_bindings = Arc::clone(&bindings);
    input.set(
        "keyCombo",
        Func::from(move |modifiers: Vec<String>, keys: Vec<String>| {
            key_bindings
                .host
                .key_combo(modifiers, keys)
                .map_err(host_error)
        }),
    )?;
    let text_bindings = Arc::clone(&bindings);
    input.set(
        "sendText",
        Func::from(move |text: String| text_bindings.host.send_text(text).map_err(host_error)),
    )?;
    let click_bindings = Arc::clone(&bindings);
    input.set(
        "mouseClick",
        Func::from(move |button_name: String| {
            let parsed = parse_mouse_button(&button_name)
                .ok_or_else(|| host_error(format!("unknown mouse button '{button_name}'")))?;
            click_bindings.host.mouse_click(parsed).map_err(host_error)
        }),
    )?;
    for (name, down) in [("mouseDown", true), ("mouseUp", false)] {
        let mouse_bindings = Arc::clone(&bindings);
        input.set(
            name,
            Func::from(move |button_name: String| {
                let parsed = parse_mouse_button(&button_name)
                    .ok_or_else(|| host_error(format!("unknown mouse button '{button_name}'")))?;
                mouse_bindings
                    .host
                    .mouse_button(parsed, down)
                    .map_err(host_error)
            }),
        )?;
    }
    let move_bindings = Arc::clone(&bindings);
    input.set(
        "movePointer",
        Func::from(move |x: i32, y: i32| move_bindings.host.move_pointer(x, y).map_err(host_error)),
    )?;
    let wheel_bindings = Arc::clone(&bindings);
    input.set(
        "wheel",
        Func::from(move |delta: i32| wheel_bindings.host.wheel(delta).map_err(host_error)),
    )?;
    globals.set("Input", input)?;

    let context = Object::new(ctx.clone())?;
    let activate_bindings = Arc::clone(&bindings);
    context.set(
        "activateTargetWindow",
        Func::from(move || {
            activate_bindings
                .host
                .activate_target(activate_bindings.invocation().gesture)
                .map_err(host_error)
        }),
    )?;
    globals.set("Context", context)?;

    let window = Object::new(ctx.clone())?;
    let window_bindings = Arc::clone(&bindings);
    window.set(
        "perform",
        Func::from(move |operation: String| {
            let operation = parse_window_operation(&operation)
                .ok_or_else(|| host_error(format!("unknown window operation '{operation}'")))?;
            window_bindings
                .host
                .window_operation(operation, window_bindings.invocation().gesture)
                .map_err(host_error)
        }),
    )?;
    globals.set("Window", window)?;

    let clipboard = Object::new(ctx.clone())?;
    let read_bindings = Arc::clone(&bindings);
    clipboard.set(
        "readText",
        Func::from(move || read_bindings.host.clipboard_read_text().map_err(host_error)),
    )?;
    let write_bindings = Arc::clone(&bindings);
    clipboard.set(
        "writeText",
        Func::from(move |text: String| {
            write_bindings
                .host
                .clipboard_write_text(text)
                .map_err(host_error)
        }),
    )?;
    let selected_bindings = Arc::clone(&bindings);
    clipboard.set(
        "selectedText",
        Func::from(move || {
            selected_bindings
                .host
                .clipboard_selected_text()
                .map_err(host_error)
        }),
    )?;
    globals.set("Clipboard", clipboard)?;

    let report_bindings = Arc::clone(&bindings);
    globals.set(
        "ReportStatus",
        Func::from(move |status: String| {
            let status: String = status.chars().take(MAX_STATUS_CHARS).collect();
            *report_bindings.reported_status.lock() = Some(status);
        }),
    )?;
    ctx.eval::<(), _>(LOCK_HOST_API.as_bytes())?;
    Ok(())
}

fn update_context_object(
    ctx: &Ctx<'_>,
    invocation: ScriptInvocation,
    slot: ScriptSlot,
) -> Result<(), Error> {
    let context: Object<'_> = ctx.globals().get("Context")?;
    let origin = Object::new(ctx.clone())?;
    origin.set("x", invocation.gesture.origin.x)?;
    origin.set("y", invocation.gesture.origin.y)?;
    let endpoint = Object::new(ctx.clone())?;
    endpoint.set("x", invocation.gesture.endpoint.x)?;
    endpoint.set("y", invocation.gesture.endpoint.y)?;
    context.set("origin", origin)?;
    context.set("endpoint", endpoint)?;
    context.set("triggerButton", invocation.trigger.map(trigger_button_name))?;
    context.set("modifier", modifier_name(invocation.modifier))?;
    context.set("phase", slot.name())?;
    context.set(
        "targetWindowAvailable",
        invocation.gesture.native_window != 0,
    )?;
    Ok(())
}

fn host_error(message: String) -> Error {
    Error::new_from_js_message("host", "JavaScript", message)
}

fn parse_mouse_button(name: &str) -> Option<ScriptMouseButton> {
    match name.to_ascii_lowercase().as_str() {
        "left" => Some(ScriptMouseButton::Left),
        "right" => Some(ScriptMouseButton::Right),
        "middle" => Some(ScriptMouseButton::Middle),
        "x1" => Some(ScriptMouseButton::X1),
        "x2" => Some(ScriptMouseButton::X2),
        _ => None,
    }
}

fn parse_window_operation(name: &str) -> Option<WindowOperation> {
    match name {
        "maximizeRestore" => Some(WindowOperation::MaximizeRestore),
        "minimize" => Some(WindowOperation::Minimize),
        "close" => Some(WindowOperation::Close),
        "toggleTopmost" => Some(WindowOperation::ToggleTopmost),
        "dockLeft" => Some(WindowOperation::DockLeft),
        "dockRight" => Some(WindowOperation::DockRight),
        _ => None,
    }
}

fn trigger_button_name(trigger: TriggerButton) -> &'static str {
    match trigger {
        TriggerButton::Right => "right",
        TriggerButton::Middle => "middle",
        TriggerButton::X1 => "x1",
        TriggerButton::X2 => "x2",
    }
}

fn modifier_name(modifier: Modifier) -> &'static str {
    match modifier {
        Modifier::None => "none",
        Modifier::WheelForward => "wheelForward",
        Modifier::WheelBackward => "wheelBackward",
        Modifier::LeftButtonDown => "leftButtonDown",
        Modifier::MiddleButtonDown => "middleButtonDown",
        Modifier::RightButtonDown => "rightButtonDown",
        Modifier::X1Down => "x1Down",
        Modifier::X2Down => "x2Down",
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::Point;
    use super::*;

    #[derive(Default)]
    struct FakeHost;

    impl ScriptHost for FakeHost {
        fn key_combo(&self, _: Vec<String>, _: Vec<String>) -> Result<(), String> {
            Ok(())
        }
        fn send_text(&self, _: String) -> Result<(), String> {
            Ok(())
        }
        fn mouse_click(&self, _: ScriptMouseButton) -> Result<(), String> {
            Ok(())
        }
        fn mouse_button(&self, _: ScriptMouseButton, _: bool) -> Result<(), String> {
            Ok(())
        }
        fn move_pointer(&self, _: i32, _: i32) -> Result<(), String> {
            Ok(())
        }
        fn wheel(&self, _: i32) -> Result<(), String> {
            Ok(())
        }
        fn activate_target(&self, _: GestureContext) -> Result<(), String> {
            Ok(())
        }
        fn window_operation(&self, _: WindowOperation, _: GestureContext) -> Result<(), String> {
            Ok(())
        }
        fn clipboard_read_text(&self) -> Result<Option<String>, String> {
            Ok(Some("read".into()))
        }
        fn clipboard_write_text(&self, _: String) -> Result<(), String> {
            Ok(())
        }
        fn clipboard_selected_text(&self) -> Result<Option<String>, String> {
            Ok(Some("selected".into()))
        }
    }

    fn invocation(x: i32) -> ScriptInvocation {
        ScriptInvocation {
            gesture: GestureContext {
                origin: Point { x, y: 2 },
                endpoint: Point { x: x + 3, y: 4 },
                native_window: 1,
            },
            trigger: Some(TriggerButton::Right),
            modifier: Modifier::None,
        }
    }

    fn definition(init: &str, script: &str) -> ScriptDefinition {
        ScriptDefinition {
            language: "js".into(),
            init_script: init.into(),
            script: script.into(),
            handle_modifiers: false,
            gesture_recognized_script: String::new(),
            modifier_triggered_script: String::new(),
            gesture_ended_script: String::new(),
        }
    }

    #[test]
    fn context_is_lazy_reused_and_isolated_by_key() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let def = definition("globalThis.count = 0", "ReportStatus(String(++count))");
        assert_eq!(
            engine
                .run("a", &def, ScriptSlot::Execute, invocation(1))
                .unwrap(),
            Some("1".into())
        );
        assert_eq!(
            engine
                .run("a", &def, ScriptSlot::Execute, invocation(2))
                .unwrap(),
            Some("2".into())
        );
        assert_eq!(
            engine
                .run("b", &def, ScriptSlot::Execute, invocation(3))
                .unwrap(),
            Some("1".into())
        );
    }

    #[test]
    fn changed_definition_recreates_only_that_context() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let first = definition("globalThis.count = 10", "ReportStatus(String(++count))");
        let second = definition("globalThis.count = 20", "ReportStatus(String(++count))");
        assert_eq!(
            engine
                .run("a", &first, ScriptSlot::Execute, invocation(1))
                .unwrap(),
            Some("11".into())
        );
        assert_eq!(
            engine
                .run("a", &second, ScriptSlot::Execute, invocation(1))
                .unwrap(),
            Some("21".into())
        );
    }

    #[test]
    fn context_values_and_clipboard_api_are_available() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let def = definition(
            "",
            "ReportStatus(`${Context.origin.x}:${Context.phase}:${Clipboard.readText()}`)",
        );
        assert_eq!(
            engine
                .run("a", &def, ScriptSlot::Execute, invocation(7))
                .unwrap(),
            Some("7:execute:read".into())
        );
    }

    #[test]
    fn host_bindings_and_methods_cannot_be_replaced() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let def = definition(
            "",
            "try { Input = null } catch {} try { Context.activateTargetWindow = null } catch {} ReportStatus(`${typeof Input.keyCombo}:${typeof Context.activateTargetWindow}`)",
        );
        assert_eq!(
            engine
                .run("a", &def, ScriptSlot::Execute, invocation(1))
                .unwrap(),
            Some("function:function".into())
        );
    }

    #[test]
    fn modifier_lifecycle_slots_share_state_and_context() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let mut def = definition("globalThis.events = ['init']", "");
        def.handle_modifiers = true;
        def.gesture_recognized_script = "events.push(Context.phase)".into();
        def.modifier_triggered_script = "events.push(Context.modifier)".into();
        def.gesture_ended_script =
            "events.push(Context.phase); ReportStatus(JSON.stringify(events))".into();

        let mut current = invocation(1);
        engine
            .run("a", &def, ScriptSlot::GestureRecognized, current)
            .unwrap();
        current.modifier = Modifier::WheelForward;
        engine
            .run("a", &def, ScriptSlot::ModifierTriggered, current)
            .unwrap();
        assert_eq!(
            engine
                .run("a", &def, ScriptSlot::GestureEnded, current)
                .unwrap(),
            Some("[\"init\",\"gestureRecognized\",\"wheelForward\",\"gestureEnded\"]".into())
        );
    }

    #[test]
    fn status_is_bounded_and_removed_contexts_restart_lazily() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let def = definition(
            "globalThis.count = 0",
            "ReportStatus('x'.repeat(++count === 1 ? 300 : 2))",
        );
        let first = engine
            .run("a", &def, ScriptSlot::Execute, invocation(1))
            .unwrap()
            .unwrap();
        assert_eq!(first.chars().count(), MAX_STATUS_CHARS);

        engine.retain_keys(&HashSet::new());
        let restarted = engine
            .run("a", &def, ScriptSlot::Execute, invocation(1))
            .unwrap()
            .unwrap();
        assert_eq!(restarted.chars().count(), MAX_STATUS_CHARS);
    }

    #[test]
    fn exceptions_do_not_poison_the_context() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let failing = definition("", "throw new Error('boom')");
        assert!(engine
            .run("a", &failing, ScriptSlot::Execute, invocation(1))
            .is_err());
        let recovered = definition("", "ReportStatus('ok')");
        assert_eq!(
            engine
                .run("a", &recovered, ScriptSlot::Execute, invocation(1))
                .unwrap(),
            Some("ok".into())
        );
    }

    #[test]
    fn runaway_script_is_interrupted() {
        let mut engine = ScriptEngine::new(Arc::new(FakeHost)).unwrap();
        let def = definition("", "while (true) {}");
        let started = Instant::now();
        let error = engine
            .run("loop", &def, ScriptSlot::Execute, invocation(1))
            .unwrap_err();
        assert!(error.contains("timed out"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}

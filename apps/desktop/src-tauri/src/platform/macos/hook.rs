// CGEventTap capture and synchronous suppression.

use super::input::SYNTHETIC_EVENT_MARKER;
use crate::engine::runtime::EngineShared;
use crate::engine::tracker::{Input, MouseButton};
use crate::engine::types::Point;
use objc2_core_foundation::{kCFRunLoopCommonModes, CFMachPort, CFRunLoop};
use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventMask, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventTapProxy, CGEventType,
};
use std::collections::HashSet;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;

#[derive(Debug)]
pub struct EventTapError(pub String);

impl std::fmt::Display for EventTapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

struct CallbackContext {
    shared: Arc<EngineShared>,
    tap: Option<NonNull<CFMachPort>>,
    held_modifier_keys: HashSet<i64>,
}

pub struct EventTap {
    stopping: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

unsafe impl Send for EventTap {}
unsafe impl Sync for EventTap {}

impl EventTap {
    pub fn install(shared: Arc<EngineShared>) -> Result<Self, EventTapError> {
        let stopping = Arc::new(AtomicBool::new(false));
        let thread_stopping = Arc::clone(&stopping);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = std::thread::Builder::new()
            .name("gg-cgevent-tap".into())
            .spawn(move || event_tap_thread(shared, thread_stopping, ready_tx))
            .map_err(|error| EventTapError(format!("start CGEventTap thread: {error}")))?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                stopping,
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(EventTapError(error))
            }
            Err(error) => {
                let _ = thread.join();
                Err(EventTapError(format!(
                    "CGEventTap thread ended before startup: {error}"
                )))
            }
        }
    }
}

impl Drop for EventTap {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn event_tap_thread(
    shared: Arc<EngineShared>,
    stopping: Arc<AtomicBool>,
    ready: mpsc::SyncSender<Result<(), String>>,
) {
    let mut context = Box::new(CallbackContext {
        shared,
        tap: None,
        held_modifier_keys: HashSet::new(),
    });
    let tap = unsafe {
        CGEvent::tap_create(
            CGEventTapLocation::SessionEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            event_mask(),
            Some(event_tap_callback),
            (&mut *context as *mut CallbackContext).cast(),
        )
    };
    let Some(tap) = tap else {
        let _ = ready.send(Err(
            "create CGEventTap (Accessibility permission may be missing)".into(),
        ));
        return;
    };
    context.tap = Some(NonNull::from(&*tap));
    let Some(source) = CFMachPort::new_run_loop_source(None, Some(&tap), 0) else {
        let _ = ready.send(Err("create CGEventTap run-loop source".into()));
        return;
    };
    let Some(run_loop) = CFRunLoop::current() else {
        let _ = ready.send(Err("resolve CGEventTap run loop".into()));
        return;
    };
    let mode = unsafe { kCFRunLoopCommonModes };
    run_loop.add_source(Some(&source), mode);
    CGEvent::tap_enable(&tap, true);
    let _ = ready.send(Ok(()));
    while !stopping.load(Ordering::Acquire) {
        CFRunLoop::run_in_mode(mode, 0.1, false);
    }
    run_loop.remove_source(Some(&source), mode);
    tap.invalidate();
}

fn event_mask() -> CGEventMask {
    [
        CGEventType::LeftMouseDown,
        CGEventType::LeftMouseUp,
        CGEventType::RightMouseDown,
        CGEventType::RightMouseUp,
        CGEventType::MouseMoved,
        CGEventType::LeftMouseDragged,
        CGEventType::RightMouseDragged,
        CGEventType::ScrollWheel,
        CGEventType::OtherMouseDown,
        CGEventType::OtherMouseUp,
        CGEventType::OtherMouseDragged,
        CGEventType::KeyDown,
        CGEventType::KeyUp,
        CGEventType::FlagsChanged,
    ]
    .into_iter()
    .fold(0, |mask, event_type| mask | (1_u64 << event_type.0))
}

unsafe extern "C-unwind" fn event_tap_callback(
    _proxy: CGEventTapProxy,
    event_type: CGEventType,
    event: NonNull<CGEvent>,
    user_info: *mut c_void,
) -> *mut CGEvent {
    let original = event.as_ptr();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let context = unsafe { &mut *user_info.cast::<CallbackContext>() };
        if matches!(
            event_type,
            CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
        ) {
            if let Some(tap) = context.tap {
                CGEvent::tap_enable(unsafe { tap.as_ref() }, true);
            }
            return false;
        }
        let event_ref = unsafe { event.as_ref() };
        if CGEvent::integer_value_field(Some(event_ref), CGEventField::EventSourceUserData)
            == SYNTHETIC_EVENT_MARKER
        {
            return false;
        }
        map_event(event_type, event_ref, &mut context.held_modifier_keys)
            .is_some_and(|input| context.shared.on_hook_event(input))
    }));
    match outcome {
        Ok(true) => std::ptr::null_mut(),
        Ok(false) => original,
        Err(_) => {
            log::error!("panic crossed macOS event-tap handler; event passed through");
            original
        }
    }
}

fn map_event(
    event_type: CGEventType,
    event: &CGEvent,
    held_modifier_keys: &mut HashSet<i64>,
) -> Option<Input> {
    let location = CGEvent::location(Some(event));
    let point = Point {
        x: location.x.round() as i32,
        y: location.y.round() as i32,
    };
    match event_type {
        CGEventType::MouseMoved
        | CGEventType::LeftMouseDragged
        | CGEventType::RightMouseDragged
        | CGEventType::OtherMouseDragged => Some(Input::Move(point)),
        CGEventType::LeftMouseDown => Some(Input::ButtonDown(MouseButton::Left, point)),
        CGEventType::LeftMouseUp => Some(Input::ButtonUp(MouseButton::Left, point)),
        CGEventType::RightMouseDown => Some(Input::ButtonDown(MouseButton::Right, point)),
        CGEventType::RightMouseUp => Some(Input::ButtonUp(MouseButton::Right, point)),
        CGEventType::OtherMouseDown => {
            other_button(event).map(|button| Input::ButtonDown(button, point))
        }
        CGEventType::OtherMouseUp => {
            other_button(event).map(|button| Input::ButtonUp(button, point))
        }
        CGEventType::ScrollWheel => {
            let delta =
                CGEvent::integer_value_field(Some(event), CGEventField::ScrollWheelEventDeltaAxis1);
            (delta != 0).then_some(Input::Wheel {
                forward: delta > 0,
                pos: point,
            })
        }
        CGEventType::KeyDown => keyboard_event(event, true),
        CGEventType::KeyUp => keyboard_event(event, false),
        CGEventType::FlagsChanged => modifier_event(event, held_modifier_keys),
        _ => None,
    }
}

fn keyboard_event(event: &CGEvent, pressed: bool) -> Option<Input> {
    let key = keyboard_code(CGEvent::integer_value_field(
        Some(event),
        CGEventField::KeyboardEventKeycode,
    ))?;
    Some(if pressed {
        Input::KeyDown(key)
    } else {
        Input::KeyUp(key)
    })
}

fn modifier_event(event: &CGEvent, held_modifier_keys: &mut HashSet<i64>) -> Option<Input> {
    let keycode = CGEvent::integer_value_field(Some(event), CGEventField::KeyboardEventKeycode);
    let flag = modifier_flag(keycode)?;
    let flags_set = CGEvent::flags(Some(event)).contains(flag);
    let pressed = if flags_set && !held_modifier_keys.contains(&keycode) {
        held_modifier_keys.insert(keycode);
        true
    } else {
        held_modifier_keys.remove(&keycode);
        false
    };
    let key = keyboard_code(keycode)?;
    Some(if pressed {
        Input::KeyDown(key)
    } else {
        Input::KeyUp(key)
    })
}

fn modifier_flag(keycode: i64) -> Option<objc2_core_graphics::CGEventFlags> {
    match keycode {
        54 | 55 => Some(objc2_core_graphics::CGEventFlags::MaskCommand),
        56 | 60 => Some(objc2_core_graphics::CGEventFlags::MaskShift),
        58 | 61 => Some(objc2_core_graphics::CGEventFlags::MaskAlternate),
        59 | 62 => Some(objc2_core_graphics::CGEventFlags::MaskControl),
        57 => Some(objc2_core_graphics::CGEventFlags::MaskAlphaShift),
        _ => None,
    }
}

fn keyboard_code(keycode: i64) -> Option<String> {
    let code = match keycode {
        0 => "KeyA",
        1 => "KeyS",
        2 => "KeyD",
        3 => "KeyF",
        4 => "KeyH",
        5 => "KeyG",
        6 => "KeyZ",
        7 => "KeyX",
        8 => "KeyC",
        9 => "KeyV",
        11 => "KeyB",
        12 => "KeyQ",
        13 => "KeyW",
        14 => "KeyE",
        15 => "KeyR",
        16 => "KeyY",
        17 => "KeyT",
        18 => "Digit1",
        19 => "Digit2",
        20 => "Digit3",
        21 => "Digit4",
        22 => "Digit6",
        23 => "Digit5",
        24 => "Equal",
        25 => "Digit9",
        26 => "Digit7",
        27 => "Minus",
        28 => "Digit8",
        29 => "Digit0",
        30 => "BracketRight",
        31 => "KeyO",
        32 => "KeyU",
        33 => "BracketLeft",
        34 => "KeyI",
        35 => "KeyP",
        36 => "Enter",
        37 => "KeyL",
        38 => "KeyJ",
        39 => "Quote",
        40 => "KeyK",
        41 => "Semicolon",
        42 => "Backslash",
        43 => "Comma",
        44 => "Slash",
        45 => "KeyN",
        46 => "KeyM",
        47 => "Period",
        48 => "Tab",
        49 => "Space",
        50 => "Backquote",
        51 => "Backspace",
        53 => "Escape",
        54 => "MetaRight",
        55 => "MetaLeft",
        56 => "ShiftLeft",
        57 => "CapsLock",
        58 => "AltLeft",
        59 => "ControlLeft",
        60 => "ShiftRight",
        61 => "AltRight",
        62 => "ControlRight",
        63 => "Fn",
        64 => "F17",
        65 => "NumpadDecimal",
        67 => "NumpadMultiply",
        69 => "NumpadAdd",
        71 => "Clear",
        72 => "AudioVolumeUp",
        73 => "AudioVolumeDown",
        74 => "AudioVolumeMute",
        75 => "NumpadDivide",
        76 => "NumpadEnter",
        78 => "NumpadSubtract",
        79 => "F18",
        80 => "F19",
        81 => "NumpadEqual",
        82 => "Numpad0",
        83 => "Numpad1",
        84 => "Numpad2",
        85 => "Numpad3",
        86 => "Numpad4",
        87 => "Numpad5",
        88 => "Numpad6",
        89 => "Numpad7",
        90 => "F20",
        91 => "Numpad8",
        92 => "Numpad9",
        93 => "IntlYen",
        94 => "IntlRo",
        95 => "NumpadComma",
        96 => "F5",
        97 => "F6",
        98 => "F7",
        99 => "F3",
        100 => "F8",
        101 => "F9",
        103 => "F11",
        105 => "F13",
        106 => "F16",
        107 => "F14",
        108 => "F10",
        109 => "F12",
        110 => "F15",
        114 => "Help",
        115 => "Home",
        116 => "PageUp",
        117 => "Delete",
        118 => "F4",
        119 => "End",
        120 => "F2",
        121 => "PageDown",
        122 => "F1",
        123 => "ArrowLeft",
        124 => "ArrowRight",
        125 => "ArrowDown",
        126 => "ArrowUp",
        _ => return None,
    };
    Some(code.into())
}

fn other_button(event: &CGEvent) -> Option<MouseButton> {
    match CGEvent::integer_value_field(Some(event), CGEventField::MouseEventButtonNumber) {
        2 => Some(MouseButton::Middle),
        3 => Some(MouseButton::X1),
        4 => Some(MouseButton::X2),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_mask_contains_every_supported_physical_event() {
        let mask = event_mask();
        for event_type in [
            CGEventType::MouseMoved,
            CGEventType::LeftMouseDown,
            CGEventType::RightMouseDown,
            CGEventType::OtherMouseDown,
            CGEventType::ScrollWheel,
            CGEventType::KeyDown,
            CGEventType::KeyUp,
            CGEventType::FlagsChanged,
        ] {
            assert_ne!(mask & (1_u64 << event_type.0), 0);
        }
    }
}

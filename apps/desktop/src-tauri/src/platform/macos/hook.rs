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
    let mut context = Box::new(CallbackContext { shared, tap: None });
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
        map_event(event_type, event_ref).is_some_and(|input| context.shared.on_hook_event(input))
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

fn map_event(event_type: CGEventType, event: &CGEvent) -> Option<Input> {
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
        _ => None,
    }
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
        ] {
            assert_ne!(mask & (1_u64 << event_type.0), 0);
        }
    }
}

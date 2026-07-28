// macOS application identity, target registry, display geometry, and AX window actions.

use crate::engine::config::WindowOperation;
use crate::engine::corners::{ScreenInfo, ScreenRect};
use crate::engine::intents::ForegroundApp;
use crate::engine::types::Point;
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use objc2_application_services::{AXError, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{
    kCFBooleanTrue, CFArray, CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType,
    CGPoint, CGSize,
};
use objc2_core_graphics::{
    kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowNumber, kCGWindowOwnerPID,
    CGDisplayBounds, CGDisplayPixelsWide, CGGetDisplaysWithPoint, CGMainDisplayID,
    CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TARGET_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_TARGETS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowTarget {
    pub pid: i32,
    pub window_id: u32,
}

#[derive(Debug, Clone, Copy)]
struct RegisteredTarget {
    token: i64,
    target: WindowTarget,
    created_at: Instant,
}

#[derive(Default)]
struct TargetRegistry {
    entries: VecDeque<RegisteredTarget>,
}

impl TargetRegistry {
    fn insert(&mut self, target: WindowTarget, now: Instant, token: i64) -> i64 {
        self.prune(now);
        if let Some(existing) = self.entries.iter_mut().find(|entry| entry.target == target) {
            existing.created_at = now;
            return existing.token;
        }
        self.entries.push_back(RegisteredTarget {
            token,
            target,
            created_at: now,
        });
        while self.entries.len() > MAX_TARGETS {
            self.entries.pop_front();
        }
        token
    }

    fn get(&mut self, token: i64, now: Instant) -> Option<WindowTarget> {
        self.prune(now);
        self.entries
            .iter()
            .find(|entry| entry.token == token)
            .map(|entry| entry.target)
    }

    fn prune(&mut self, now: Instant) {
        self.entries
            .retain(|entry| now.duration_since(entry.created_at) <= TARGET_TTL);
    }
}

static TARGETS: OnceLock<Mutex<TargetRegistry>> = OnceLock::new();
static NEXT_TARGET_TOKEN: AtomicI64 = AtomicI64::new(1);

fn target_registry() -> &'static Mutex<TargetRegistry> {
    TARGETS.get_or_init(|| Mutex::new(TargetRegistry::default()))
}

fn register_target(target: WindowTarget) -> i64 {
    let token = NEXT_TARGET_TOKEN.fetch_add(1, Ordering::Relaxed).max(1);
    target_registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(target, Instant::now(), token)
}

pub fn target_for_token(token: i64) -> Result<WindowTarget, String> {
    if token == 0 {
        return Err("target window is unavailable".into());
    }
    target_registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(token, Instant::now())
        .ok_or_else(|| "target window token is invalid or expired".into())
}

fn number(dictionary: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<i64> {
    dictionary.get(key)?.downcast::<CFNumber>().ok()?.as_i64()
}

fn rect(dictionary: &CFDictionary<CFString, CFType>) -> Option<objc2_core_foundation::CGRect> {
    let bounds = dictionary
        .get(unsafe { kCGWindowBounds })?
        .downcast::<CFDictionary>()
        .ok()?;
    let mut rect = objc2_core_foundation::CGRect::default();
    unsafe { CGRectMakeWithDictionaryRepresentation(Some(&bounds), &mut rect).then_some(rect) }
}

fn window_list() -> Vec<(WindowTarget, objc2_core_foundation::CGRect)> {
    let options =
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let Some(list) = CGWindowListCopyWindowInfo(options, kCGNullWindowID) else {
        return Vec::new();
    };
    let list: CFRetained<CFArray<CFDictionary<CFString, CFType>>> =
        unsafe { CFRetained::cast_unchecked(list) };
    list.iter()
        .filter_map(|dictionary| {
            let layer = number(&dictionary, unsafe { kCGWindowLayer })?;
            if layer != 0 {
                return None;
            }
            let pid = number(&dictionary, unsafe { kCGWindowOwnerPID })?;
            let window_id = number(&dictionary, unsafe { kCGWindowNumber })?;
            let bounds = rect(&dictionary)?;
            if pid <= 0
                || pid > i32::MAX as i64
                || window_id <= 0
                || window_id > u32::MAX as i64
                || bounds.size.width <= 1.0
                || bounds.size.height <= 1.0
            {
                return None;
            }
            Some((
                WindowTarget {
                    pid: pid as i32,
                    window_id: window_id as u32,
                },
                bounds,
            ))
        })
        .collect()
}

fn frontmost_pid() -> Option<i32> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|application| application.processIdentifier())
        .filter(|pid| *pid > 0)
}

fn target_at(point: Point) -> Option<WindowTarget> {
    let own_pid = std::process::id() as i32;
    target_from_windows(&window_list(), point, own_pid)
}

fn target_from_windows(
    windows: &[(WindowTarget, objc2_core_foundation::CGRect)],
    point: Point,
    own_pid: i32,
) -> Option<WindowTarget> {
    let (target, _) = windows.iter().find(|(_, bounds)| {
        (point.x as f64) >= bounds.origin.x
            && (point.x as f64) < bounds.origin.x + bounds.size.width
            && (point.y as f64) >= bounds.origin.y
            && (point.y as f64) < bounds.origin.y + bounds.size.height
    })?;
    (target.pid != own_pid).then_some(*target)
}

fn target_for_pid(pid: i32) -> WindowTarget {
    window_list()
        .into_iter()
        .find(|(target, _)| target.pid == pid)
        .map(|(target, _)| target)
        .unwrap_or(WindowTarget { pid, window_id: 0 })
}

fn bundle_id_for_pid(pid: i32) -> Option<String> {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .and_then(|application| application.bundleIdentifier())
        .map(|bundle_id| bundle_id.to_string())
}

pub fn application_at(pos: Point) -> Option<(String, String)> {
    let target = target_at(pos)?;
    let application = NSRunningApplication::runningApplicationWithProcessIdentifier(target.pid)?;
    let bundle_id = application.bundleIdentifier()?.to_string();
    let app_name = application
        .localizedName()
        .map(|name| name.to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| bundle_id.clone());
    Some((bundle_id, app_name))
}

pub fn resolve_foreground_app(pos: Point, prefer_cursor_window: bool) -> ForegroundApp {
    let target = if prefer_cursor_window {
        target_at(pos).or_else(|| frontmost_pid().map(target_for_pid))
    } else {
        frontmost_pid().map(target_for_pid)
    };
    let Some(target) = target else {
        return ForegroundApp::default();
    };
    ForegroundApp {
        bundle_id: bundle_id_for_pid(target.pid),
        native_window: register_target(target),
        ..Default::default()
    }
}

pub fn main_display_width() -> f64 {
    CGDisplayPixelsWide(CGMainDisplayID()) as f64
}

pub fn screen_at(pos: Point) -> Option<ScreenInfo> {
    let mut display = 0;
    let mut count = 0;
    let result = unsafe {
        CGGetDisplaysWithPoint(
            CGPoint::new(pos.x as f64, pos.y as f64),
            1,
            &mut display,
            &mut count,
        )
    };
    if result.0 != 0 || count == 0 {
        return None;
    }
    let bounds = CGDisplayBounds(display);
    let pixel_width = CGDisplayPixelsWide(display) as f64;
    let scale = if bounds.size.width > 0.0 {
        pixel_width / bounds.size.width
    } else {
        1.0
    };
    Some(ScreenInfo {
        bounds: ScreenRect {
            left: bounds.origin.x.round() as i32,
            top: bounds.origin.y.round() as i32,
            right: (bounds.origin.x + bounds.size.width).round() as i32 - 1,
            bottom: (bounds.origin.y + bounds.size.height).round() as i32 - 1,
        },
        dpi_scale: scale.max(1.0),
    })
}

fn attribute<T: objc2_core_foundation::ConcreteType>(
    element: &AXUIElement,
    name: &str,
) -> Result<CFRetained<T>, String> {
    let name = CFString::from_str(name);
    let mut value: *const CFType = std::ptr::null();
    let error = unsafe { element.copy_attribute_value(&name, NonNull::from(&mut value)) };
    if error != AXError::Success {
        return Err(format!("AX attribute {name} failed: {error:?}"));
    }
    let value = NonNull::new(value.cast_mut())
        .ok_or_else(|| format!("AX attribute {name} returned null"))?;
    let value = unsafe { CFRetained::<CFType>::from_raw(value) };
    value
        .downcast::<T>()
        .map_err(|_| format!("AX attribute {name} returned an unexpected type"))
}

fn ax_window(target: WindowTarget) -> Result<CFRetained<AXUIElement>, String> {
    let application = unsafe { AXUIElement::new_application(target.pid) };
    if target.window_id != 0 {
        if let Ok(windows) = attribute::<CFArray>(&application, "AXWindows") {
            let windows: CFRetained<CFArray<AXUIElement>> =
                unsafe { CFRetained::cast_unchecked(windows) };
            for window in windows.to_vec() {
                if attribute::<CFNumber>(&window, "AXWindowNumber")
                    .ok()
                    .and_then(|number| number.as_i64())
                    == Some(target.window_id as i64)
                {
                    return Ok(window);
                }
            }
        }
    }
    attribute::<AXUIElement>(&application, "AXFocusedWindow")
}

fn activate_pid(pid: i32) -> Result<(), String> {
    let application = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .ok_or_else(|| "target application is no longer running".to_string())?;
    application
        .activateWithOptions(NSApplicationActivationOptions::empty())
        .then_some(())
        .ok_or_else(|| "NSRunningApplication activation was rejected".into())
}

pub fn activate_target(token: i64) -> Result<(), String> {
    activate_pid(target_for_token(token)?.pid)
}

fn perform(element: &AXUIElement, action: &str) -> Result<(), String> {
    let action = CFString::from_str(action);
    let error = unsafe { element.perform_action(&action) };
    (error == AXError::Success)
        .then_some(())
        .ok_or_else(|| format!("AX action {action} failed: {error:?}"))
}

fn set_attribute<T>(element: &AXUIElement, name: &str, value: &T) -> Result<(), String>
where
    T: objc2_core_foundation::Type + AsRef<CFType> + ?Sized,
{
    let name = CFString::from_str(name);
    let error = unsafe { element.set_attribute_value(&name, value.as_ref()) };
    (error == AXError::Success)
        .then_some(())
        .ok_or_else(|| format!("set AX attribute {name} failed: {error:?}"))
}

fn ax_value<T>(kind: AXValueType, value: &mut T) -> Result<CFRetained<AXValue>, String> {
    unsafe { AXValue::new(kind, NonNull::from(value).cast::<c_void>()) }
        .ok_or_else(|| "create AXValue".into())
}

fn set_frame(window: &AXUIElement, origin: CGPoint, size: CGSize) -> Result<(), String> {
    let mut origin = origin;
    let mut size = size;
    let origin = ax_value(AXValueType::CGPoint, &mut origin)?;
    let size = ax_value(AXValueType::CGSize, &mut size)?;
    set_attribute(window, "AXPosition", &*origin)?;
    set_attribute(window, "AXSize", &*size)
}

fn window_rect(window: &AXUIElement) -> Option<objc2_core_foundation::CGRect> {
    let position = attribute::<AXValue>(window, "AXPosition").ok()?;
    let size = attribute::<AXValue>(window, "AXSize").ok()?;
    let mut point = CGPoint::default();
    let mut dimensions = CGSize::default();
    let point_ok =
        unsafe { position.value(AXValueType::CGPoint, NonNull::from(&mut point).cast()) };
    let size_ok = unsafe { size.value(AXValueType::CGSize, NonNull::from(&mut dimensions).cast()) };
    (point_ok && size_ok).then_some(objc2_core_foundation::CGRect::new(point, dimensions))
}

fn dock(window: &AXUIElement, left: bool) -> Result<(), String> {
    let rect =
        window_rect(window).ok_or_else(|| "target window frame is unavailable".to_string())?;
    let center = Point {
        x: (rect.origin.x + rect.size.width / 2.0).round() as i32,
        y: (rect.origin.y + rect.size.height / 2.0).round() as i32,
    };
    let screen = screen_at(center).ok_or_else(|| "target display is unavailable".to_string())?;
    let width = screen.bounds.width() as f64 / 2.0;
    let origin = CGPoint::new(
        if left {
            screen.bounds.left as f64
        } else {
            screen.bounds.left as f64 + width
        },
        screen.bounds.top as f64,
    );
    let size = CGSize::new(width, screen.bounds.height() as f64);
    set_frame(window, origin, size)
}

pub fn window_operation(operation: WindowOperation, token: i64) -> Result<(), String> {
    if operation == WindowOperation::ToggleTopmost {
        return Err("toggle topmost is unsupported on macOS".into());
    }
    let target = target_for_token(token)?;
    activate_pid(target.pid)?;
    let window = ax_window(target)?;
    match operation {
        WindowOperation::MaximizeRestore => {
            let zoom = attribute::<AXUIElement>(&window, "AXZoomButton")?;
            perform(&zoom, "AXPress")
        }
        WindowOperation::Minimize => {
            let value = unsafe { kCFBooleanTrue }
                .ok_or_else(|| "CoreFoundation true value is unavailable".to_string())?;
            set_attribute(&window, "AXMinimized", value)
        }
        WindowOperation::Close => {
            let close = attribute::<AXUIElement>(&window, "AXCloseButton")?;
            perform(&close, "AXPress")
        }
        WindowOperation::DockLeft => dock(&window, true),
        WindowOperation::DockRight => dock(&window, false),
        WindowOperation::ToggleTopmost => unreachable!(),
    }
}

pub fn is_foreground_fullscreen() -> bool {
    let Some(pid) = frontmost_pid() else {
        return false;
    };
    let target = target_for_pid(pid);
    let Ok(window) = ax_window(target) else {
        return false;
    };
    if let Ok(fullscreen) = attribute::<CFBoolean>(&window, "AXFullScreen") {
        if fullscreen.value() {
            return true;
        }
    }
    let Some(rect) = window_rect(&window) else {
        return false;
    };
    let Some(screen) = screen_at(Point {
        x: (rect.origin.x + rect.size.width / 2.0).round() as i32,
        y: (rect.origin.y + rect.size.height / 2.0).round() as i32,
    }) else {
        return false;
    };
    rect.origin.x <= screen.bounds.left as f64
        && rect.origin.y <= screen.bounds.top as f64
        && rect.origin.x + rect.size.width >= (screen.bounds.right + 1) as f64
        && rect.origin.y + rect.size.height >= (screen.bounds.bottom + 1) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_reuses_targets_and_expires_old_entries() {
        let start = Instant::now();
        let target = WindowTarget {
            pid: 42,
            window_id: 7,
        };
        let mut registry = TargetRegistry::default();
        assert_eq!(registry.insert(target, start, 10), 10);
        assert_eq!(registry.insert(target, start, 11), 10);
        assert_eq!(registry.get(10, start), Some(target));
        assert_eq!(
            registry.get(10, start + TARGET_TTL + Duration::from_secs(1)),
            None
        );
    }

    #[test]
    fn registry_is_bounded() {
        let now = Instant::now();
        let mut registry = TargetRegistry::default();
        for index in 0..MAX_TARGETS + 10 {
            registry.insert(
                WindowTarget {
                    pid: index as i32 + 1,
                    window_id: index as u32 + 1,
                },
                now,
                index as i64 + 1,
            );
        }
        assert_eq!(registry.entries.len(), MAX_TARGETS);
    }

    #[test]
    fn pointer_target_rejects_own_topmost_window_instead_of_selecting_below() {
        let bounds =
            objc2_core_foundation::CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(100.0, 100.0));
        let windows = [
            (
                WindowTarget {
                    pid: 42,
                    window_id: 1,
                },
                bounds,
            ),
            (
                WindowTarget {
                    pid: 7,
                    window_id: 2,
                },
                bounds,
            ),
        ];
        assert_eq!(
            target_from_windows(&windows, Point { x: 50, y: 50 }, 42),
            None
        );
    }
}

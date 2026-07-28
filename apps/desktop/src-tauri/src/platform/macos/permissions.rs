// Accessibility and event-access permission checks.

use objc2_app_kit::NSWorkspace;
use objc2_application_services::{AXIsProcessTrusted, AXIsProcessTrustedWithOptions};
use objc2_core_foundation::{
    kCFBooleanTrue, kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionary,
};
use objc2_core_graphics::{
    CGPreflightListenEventAccess, CGPreflightPostEventAccess, CGRequestListenEventAccess,
    CGRequestPostEventAccess,
};
use objc2_foundation::{NSString, NSURL};
use serde::Serialize;
use std::ffi::c_void;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub input_monitoring: bool,
    pub event_posting: bool,
}

impl PermissionStatus {
    pub fn granted(self) -> bool {
        self.accessibility && self.input_monitoring && self.event_posting
    }
}

pub fn status() -> PermissionStatus {
    PermissionStatus {
        accessibility: unsafe { AXIsProcessTrusted() },
        input_monitoring: CGPreflightListenEventAccess(),
        event_posting: CGPreflightPostEventAccess(),
    }
}

pub fn is_trusted() -> bool {
    status().granted()
}

pub fn request_trust() -> bool {
    let prompt = unsafe { objc2_application_services::kAXTrustedCheckOptionPrompt };
    let Some(value) = (unsafe { kCFBooleanTrue.as_ref() }) else {
        return false;
    };
    let mut keys = [prompt as *const _ as *const c_void];
    let mut values = [value as *const _ as *const c_void];
    let Some(options) = (unsafe {
        CFDictionary::new(
            None,
            keys.as_mut_ptr(),
            values.as_mut_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        )
    }) else {
        return false;
    };
    let _ = unsafe { AXIsProcessTrustedWithOptions(Some(&options)) };
    let _ = CGRequestListenEventAccess();
    let _ = CGRequestPostEventAccess();
    is_trusted()
}

pub fn open_settings() -> Result<(), String> {
    let value = NSString::from_str(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    let url = NSURL::URLWithString(&value)
        .ok_or_else(|| "create Accessibility System Settings URL".to_string())?;
    NSWorkspace::sharedWorkspace()
        .openURL(&url)
        .then_some(())
        .ok_or_else(|| "System Settings rejected the Accessibility URL".into())
}

// macOS login-item reconciliation through SMAppService.mainAppService.

use objc2::msg_send;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyClass, AnyObject};
use objc2_foundation::NSError;
use serde::Serialize;

#[link(name = "ServiceManagement", kind = "framework")]
extern "C" {}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MachineRuntimeStatus {
    pub healthy: bool,
    pub code: Option<String>,
    pub message: Option<String>,
}

impl MachineRuntimeStatus {
    pub fn healthy() -> Self {
        Self {
            healthy: true,
            code: None,
            message: None,
        }
    }

    pub fn failed(error: &StartupError) -> Self {
        Self {
            healthy: false,
            code: Some(error.code.to_string()),
            message: Some(error.message.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartupError {
    pub code: &'static str,
    pub message: String,
    pub rollback_errors: Vec<String>,
}

impl StartupError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            rollback_errors: Vec::new(),
        }
    }

    pub fn rollback_incomplete(message: impl Into<String>, errors: Vec<String>) -> Self {
        Self {
            code: "rollback_incomplete",
            message: message.into(),
            rollback_errors: errors,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginItemStatus {
    NotRegistered,
    Enabled,
    RequiresApproval,
}

fn service() -> Result<Retained<AnyObject>, StartupError> {
    autoreleasepool(|_| {
        let class = AnyClass::get(c"SMAppService").ok_or_else(|| {
            StartupError::new(
                "login_item_unavailable",
                "SMAppService requires macOS 13 or newer",
            )
        })?;
        let service: *mut AnyObject = unsafe { msg_send![class, mainAppService] };
        unsafe { Retained::retain_autoreleased(service) }.ok_or_else(|| {
            StartupError::new(
                "login_item_unavailable",
                "SMAppService.mainAppService returned no service",
            )
        })
    })
}

fn raw_status(service: &AnyObject) -> isize {
    unsafe { msg_send![service, status] }
}

pub fn status() -> Result<LoginItemStatus, StartupError> {
    let service = service()?;
    match raw_status(&service) {
        0 => Ok(LoginItemStatus::NotRegistered),
        1 => Ok(LoginItemStatus::Enabled),
        2 => Ok(LoginItemStatus::RequiresApproval),
        3 => Err(StartupError::new(
            "login_item_unavailable",
            "the registered login item cannot be found",
        )),
        value => Err(StartupError::new(
            "login_item_unavailable",
            format!("SMAppService returned unknown status {value}"),
        )),
    }
}

fn operation_error(code: &'static str, action: &str, error: *mut NSError) -> StartupError {
    let detail = unsafe { error.as_ref() }
        .map(|error| error.localizedDescription().to_string())
        .unwrap_or_else(|| "no NSError detail was returned".into());
    StartupError::new(code, format!("{action}: {detail}"))
}

fn set_registered(enabled: bool) -> Result<(), StartupError> {
    let service = service()?;
    let mut error: *mut NSError = std::ptr::null_mut();
    let success: bool = if enabled {
        unsafe { msg_send![&*service, registerAndReturnError: &mut error] }
    } else {
        unsafe { msg_send![&*service, unregisterAndReturnError: &mut error] }
    };
    success.then_some(()).ok_or_else(|| {
        operation_error(
            "login_item_failed",
            if enabled {
                "register login item"
            } else {
                "unregister login item"
            },
            error,
        )
    })
}

pub fn reconcile(enabled: bool) -> Result<(), StartupError> {
    let current = status()?;
    let already_matches = if enabled {
        matches!(
            current,
            LoginItemStatus::Enabled | LoginItemStatus::RequiresApproval
        )
    } else {
        current == LoginItemStatus::NotRegistered
    };
    if already_matches {
        Ok(())
    } else {
        set_registered(enabled)
    }
}

pub fn restore(snapshot: LoginItemStatus) -> Result<(), StartupError> {
    reconcile(matches!(
        snapshot,
        LoginItemStatus::Enabled | LoginItemStatus::RequiresApproval
    ))
}

pub fn runtime_status(auto_start: bool) -> MachineRuntimeStatus {
    if !auto_start {
        return MachineRuntimeStatus::healthy();
    }
    match status() {
        Ok(LoginItemStatus::Enabled) => MachineRuntimeStatus::healthy(),
        Ok(LoginItemStatus::RequiresApproval) => MachineRuntimeStatus::failed(&StartupError::new(
            "login_item_requires_approval",
            "the login item requires approval in System Settings",
        )),
        Ok(LoginItemStatus::NotRegistered) => MachineRuntimeStatus::failed(&StartupError::new(
            "login_item_not_registered",
            "start at login is enabled in GodGesture but the login item is not registered",
        )),
        Err(error) => MachineRuntimeStatus::failed(&error),
    }
}

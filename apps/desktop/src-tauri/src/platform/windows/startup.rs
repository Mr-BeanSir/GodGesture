//! Windows login startup and manual elevation integration.

use crate::engine::config::MachineLocalSettings;
use serde::Serialize;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows::core::{Error as WinError, BSTR, HRESULT};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_CANCELLED, HANDLE, RPC_E_CHANGED_MODE,
    SCHED_E_SERVICE_NOT_AVAILABLE, SCHED_E_SERVICE_NOT_INSTALLED, SCHED_E_SERVICE_NOT_RUNNING,
    WAIT_FAILED, WAIT_OBJECT_0,
};
use windows::Win32::Security::{
    GetTokenInformation, TokenElevation, TokenElevationType, TokenElevationTypeFull,
    TokenElevationTypeLimited, TokenUser, TOKEN_ELEVATION, TOKEN_ELEVATION_TYPE, TOKEN_QUERY,
    TOKEN_USER,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::TaskScheduler::{
    ITaskFolder, ITaskService, TaskScheduler, TASK_CREATE_OR_UPDATE, TASK_LOGON_INTERACTIVE_TOKEN,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
    SHELLEXECUTEINFOW,
};

const OWNER_MARKER: &str = "GodGesture startup task v1";
const TASK_PREFIX: &str = "GodGesture Startup ";
const AUTOSTART_ARG: &str = "--autostart";
const HELPER_ACCESS_DENIED: u32 = 20;
const HELPER_SERVICE_UNAVAILABLE: u32 = 21;
const HELPER_OWNERSHIP_COLLISION: u32 = 22;
const HELPER_SCHEDULER_FAILED: u32 = 23;
const HELPER_TOKEN_FAILED: u32 = 24;
const HELPER_EXECUTABLE_FAILED: u32 = 25;
const HELPER_OTHER_FAILED: u32 = 26;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupPolicy {
    pub enabled: bool,
}

impl From<&MachineLocalSettings> for StartupPolicy {
    fn from(value: &MachineLocalSettings) -> Self {
        Self {
            enabled: value.auto_start,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskSnapshot {
    xml: Option<String>,
}

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

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MachineApplyProgress {
    pub file_attempted: bool,
    pub task_attempted: bool,
    pub tray_attempted: bool,
}

pub(crate) trait MachineEffects {
    type Snapshot;

    fn snapshot(&mut self) -> Result<Self::Snapshot, StartupError>;
    fn save_machine(&mut self) -> Result<(), StartupError>;
    fn reconcile_task(&mut self) -> Result<(), StartupError>;
    fn apply_tray(&mut self) -> Result<(), StartupError>;
    fn rollback(
        &mut self,
        snapshot: &Self::Snapshot,
        progress: MachineApplyProgress,
    ) -> Vec<String>;
}

pub(crate) fn apply_machine_settings<E: MachineEffects>(
    effects: &mut E,
) -> Result<(), StartupError> {
    let snapshot = effects.snapshot()?;
    let mut progress = MachineApplyProgress {
        file_attempted: true,
        ..MachineApplyProgress::default()
    };
    if let Err(error) = effects.save_machine() {
        return rollback_machine(effects, &snapshot, progress, error);
    }

    progress.task_attempted = true;
    if let Err(error) = effects.reconcile_task() {
        return rollback_machine(effects, &snapshot, progress, error);
    }

    progress.tray_attempted = true;
    if let Err(error) = effects.apply_tray() {
        return rollback_machine(effects, &snapshot, progress, error);
    }
    Ok(())
}

fn rollback_machine<E: MachineEffects>(
    effects: &mut E,
    snapshot: &E::Snapshot,
    progress: MachineApplyProgress,
    primary: StartupError,
) -> Result<(), StartupError> {
    let errors = effects.rollback(snapshot, progress);
    if errors.is_empty() {
        Err(primary)
    } else {
        Err(StartupError::rollback_incomplete(primary.message, errors))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EarlyMode {
    Interactive,
    Autostart,
    TaskHelper { enabled: bool },
}

impl EarlyMode {
    pub fn requires_elevation(self) -> bool {
        matches!(self, Self::Interactive | Self::Autostart)
    }

    pub fn elevation_parameters(self) -> &'static str {
        match self {
            Self::Autostart => AUTOSTART_ARG,
            Self::Interactive | Self::TaskHelper { .. } => "",
        }
    }
}

pub fn parse_early_mode(args: impl IntoIterator<Item = String>) -> Result<EarlyMode, StartupError> {
    let args = args.into_iter().skip(1).collect::<Vec<_>>();
    let parse_enabled = |value: &str| match value {
        "0" => Ok(false),
        "1" => Ok(true),
        _ => Err(StartupError::new(
            "invalid_helper_args",
            "invalid startup helper arguments",
        )),
    };
    match args.as_slice() {
        [] => Ok(EarlyMode::Interactive),
        [value] if value == AUTOSTART_ARG => Ok(EarlyMode::Autostart),
        [helper, enabled] if helper == "--startup-helper" => {
            let enabled = parse_enabled(enabled)?;
            Ok(EarlyMode::TaskHelper { enabled })
        }
        // COMPAT-0001: accept the pre-0.2.4 helper's ignored highest flag.
        [helper, enabled, legacy_highest] if helper == "--startup-helper" => {
            let enabled = parse_enabled(enabled)?;
            let _ = parse_enabled(legacy_highest)?;
            Ok(EarlyMode::TaskHelper { enabled })
        }
        _ => Err(StartupError::new(
            "invalid_helper_args",
            "invalid internal startup mode",
        )),
    }
}

pub fn task_name_for_sid(sid: &str) -> String {
    format!("{TASK_PREFIX}{sid}")
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn task_xml(_policy: &StartupPolicy, sid: &str, exe: &Path) -> String {
    let command = xml_escape(&exe.to_string_lossy());
    let working_dir = xml_escape(
        &exe.parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy(),
    );
    let sid = xml_escape(sid);
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>{OWNER_MARKER}</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{sid}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>{sid}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Author"><Exec><Command>{command}</Command><Arguments>{AUTOSTART_ARG}</Arguments><WorkingDirectory>{working_dir}</WorkingDirectory></Exec></Actions>
</Task>"#
    )
}

pub fn is_owned_xml(xml: &str) -> bool {
    xml.contains(&format!("<Description>{OWNER_MARKER}</Description>"))
}

fn task_matches(xml: &str, _policy: &StartupPolicy, sid: &str, exe: &Path) -> bool {
    let command = xml_escape(&exe.to_string_lossy());
    let working_dir = xml_escape(
        &exe.parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy(),
    );
    is_owned_xml(xml)
        && xml.contains(&format!("<UserId>{}</UserId>", xml_escape(sid)))
        && xml.contains("<RunLevel>HighestAvailable</RunLevel>")
        && xml.contains(&format!("<Command>{command}</Command>"))
        && xml.contains(&format!("<Arguments>{AUTOSTART_ARG}</Arguments>"))
        && xml.contains(&format!(
            "<WorkingDirectory>{working_dir}</WorkingDirectory>"
        ))
}

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

struct ComApartment(bool);

impl ComApartment {
    fn init() -> Result<Self, StartupError> {
        match unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
            Ok(()) => Ok(Self(true)),
            Err(err) if err.code() == RPC_E_CHANGED_MODE => Ok(Self(false)),
            Err(err) => Err(map_task_error("initialize Task Scheduler COM", err)),
        }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

fn task_root() -> Result<(ComApartment, ITaskFolder), StartupError> {
    let apartment = ComApartment::init()?;
    let service: ITaskService =
        unsafe { CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER) }
            .map_err(|err| map_task_error("create Task Scheduler service", err))?;
    let empty = VARIANT::default();
    unsafe { service.Connect(&empty, &empty, &empty, &empty) }
        .map_err(|err| map_task_error("connect to Task Scheduler service", err))?;
    let root = unsafe { service.GetFolder(&BSTR::from("\\")) }
        .map_err(|err| map_task_error("open Task Scheduler root", err))?;
    Ok((apartment, root))
}

fn is_not_found(err: &WinError) -> bool {
    err.code() == HRESULT::from_win32(2)
}

fn map_task_error(action: &str, err: WinError) -> StartupError {
    let code = if err.code() == HRESULT::from_win32(5) {
        "task_access_denied"
    } else if matches!(
        err.code(),
        SCHED_E_SERVICE_NOT_AVAILABLE | SCHED_E_SERVICE_NOT_INSTALLED | SCHED_E_SERVICE_NOT_RUNNING
    ) {
        "task_service_unavailable"
    } else {
        "task_scheduler_failed"
    };
    StartupError::new(code, format!("{action}: {err}"))
}

fn current_exe() -> Result<PathBuf, StartupError> {
    std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|err| StartupError::new("executable_path_failed", err.to_string()))
}

fn get_task_xml(root: &ITaskFolder, name: &str) -> Result<Option<String>, StartupError> {
    match unsafe { root.GetTask(&BSTR::from(name)) } {
        Ok(task) => unsafe { task.Xml() }
            .map(|xml| Some(xml.to_string()))
            .map_err(|err| map_task_error("read startup task", err)),
        Err(err) if is_not_found(&err) => Ok(None),
        Err(err) => Err(map_task_error("query startup task", err)),
    }
}

pub fn snapshot(sid: &str) -> Result<TaskSnapshot, StartupError> {
    let (_apartment, root) = task_root()?;
    let xml = get_task_xml(&root, &task_name_for_sid(sid))?;
    if xml.as_deref().is_some_and(|xml| !is_owned_xml(xml)) {
        return Err(StartupError::new(
            "task_ownership_collision",
            "a task with the GodGesture name is not owned by GodGesture",
        ));
    }
    Ok(TaskSnapshot { xml })
}

fn register_xml(root: &ITaskFolder, name: &str, xml: &str, sid: &str) -> Result<(), StartupError> {
    let empty = VARIANT::default();
    let user = VARIANT::from(BSTR::from(sid));
    unsafe {
        root.RegisterTask(
            &BSTR::from(name),
            &BSTR::from(xml),
            TASK_CREATE_OR_UPDATE.0,
            &user,
            &empty,
            TASK_LOGON_INTERACTIVE_TOKEN,
            &empty,
        )
    }
    .map(|_| ())
    .map_err(|err| map_task_error("register startup task", err))
}

pub fn reconcile(policy: &StartupPolicy, sid: &str) -> Result<(), StartupError> {
    let exe = current_exe()?;
    reconcile_for_exe(policy, sid, &exe)
}

fn reconcile_for_exe(policy: &StartupPolicy, sid: &str, exe: &Path) -> Result<(), StartupError> {
    reconcile_for_exe_named(policy, sid, exe, &task_name_for_sid(sid))
}

fn reconcile_for_exe_named(
    policy: &StartupPolicy,
    sid: &str,
    exe: &Path,
    name: &str,
) -> Result<(), StartupError> {
    let (_apartment, root) = task_root()?;
    let current = get_task_xml(&root, name)?;
    if current.as_deref().is_some_and(|xml| !is_owned_xml(xml)) {
        return Err(StartupError::new(
            "task_ownership_collision",
            "a task with the GodGesture name is not owned by GodGesture",
        ));
    }
    if !policy.enabled {
        if current.is_some() {
            unsafe { root.DeleteTask(&BSTR::from(name), 0) }
                .map_err(|err| map_task_error("delete startup task", err))?;
        }
        return Ok(());
    }
    let desired = task_xml(policy, sid, exe);
    if !current
        .as_deref()
        .is_some_and(|xml| task_matches(xml, policy, sid, exe))
    {
        register_xml(&root, name, &desired, sid)?;
    }
    Ok(())
}

pub fn restore(snapshot: &TaskSnapshot, sid: &str) -> Result<(), StartupError> {
    let (_apartment, root) = task_root()?;
    let name = task_name_for_sid(sid);
    let current = get_task_xml(&root, &name)?;
    if current == snapshot.xml {
        return Ok(());
    }
    if current.as_deref().is_some_and(|xml| !is_owned_xml(xml)) {
        return Err(StartupError::new(
            "task_ownership_collision",
            "refusing to restore over an unowned task",
        ));
    }
    match &snapshot.xml {
        Some(xml) => register_xml(&root, &name, xml, sid),
        None if current.is_some() => unsafe { root.DeleteTask(&BSTR::from(name), 0) }
            .map_err(|err| map_task_error("restore absent startup task", err)),
        None => Ok(()),
    }
}

pub fn restore_with_elevation(snapshot: &TaskSnapshot, sid: &str) -> Result<(), StartupError> {
    match restore(snapshot, sid) {
        Ok(()) => Ok(()),
        Err(error) if error.code == "task_access_denied" => {
            let policy = StartupPolicy {
                enabled: snapshot.xml.is_some(),
            };
            run_elevated_helper(&policy)
        }
        Err(error) => Err(error),
    }
}

fn process_token() -> Result<OwnedHandle, StartupError> {
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|err| StartupError::new("token_query_failed", err.to_string()))?;
    Ok(OwnedHandle(token))
}

fn token_info<T: Copy>(
    token: HANDLE,
    class: windows::Win32::Security::TOKEN_INFORMATION_CLASS,
) -> Result<T, StartupError> {
    let mut value = std::mem::MaybeUninit::<T>::uninit();
    let mut returned = 0;
    unsafe {
        GetTokenInformation(
            token,
            class,
            Some(value.as_mut_ptr().cast()),
            std::mem::size_of::<T>() as u32,
            &mut returned,
        )
    }
    .map_err(|err| StartupError::new("token_query_failed", err.to_string()))?;
    Ok(unsafe { value.assume_init() })
}

pub fn elevation_state() -> Result<(bool, bool), StartupError> {
    let token = process_token()?;
    let elevation: TOKEN_ELEVATION_TYPE = token_info(token.0, TokenElevationType)?;
    let elevated: TOKEN_ELEVATION = token_info(token.0, TokenElevation)?;
    Ok((
        elevated.TokenIsElevated != 0 || elevation == TokenElevationTypeFull,
        elevation == TokenElevationTypeLimited,
    ))
}

pub fn current_user_sid() -> Result<String, StartupError> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;

    let token = process_token()?;
    let mut needed = 0;
    let _ = unsafe { GetTokenInformation(token.0, TokenUser, None, 0, &mut needed) };
    if needed == 0 {
        return Err(StartupError::new(
            "token_query_failed",
            "Windows did not return a TokenUser buffer size",
        ));
    }
    let words = (needed as usize).div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )
    }
    .map_err(|err| StartupError::new("token_query_failed", err.to_string()))?;
    let user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
    let mut text = windows::core::PWSTR::null();
    unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) }
        .map_err(|err| StartupError::new("token_query_failed", err.to_string()))?;
    let result = unsafe { text.to_string() }
        .map_err(|err| StartupError::new("token_query_failed", err.to_string()));
    unsafe {
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(text.0.cast())));
    }
    result
}

fn shell_runas(parameters: &str, wait: bool) -> Result<u32, StartupError> {
    let exe = current_exe()?;
    let verb = windows::core::w!("runas");
    let exe_w = exe
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let params_w = parameters.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let directory = exe.parent().unwrap_or_else(|| Path::new("."));
    let directory_w = directory
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        lpVerb: verb,
        lpFile: windows::core::PCWSTR(exe_w.as_ptr()),
        lpParameters: windows::core::PCWSTR(params_w.as_ptr()),
        lpDirectory: windows::core::PCWSTR(directory_w.as_ptr()),
        nShow: windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL.0,
        ..Default::default()
    };
    if let Err(err) = unsafe { ShellExecuteExW(&mut info) } {
        return Err(if err.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
            StartupError::new("uac_cancelled", "administrator elevation was cancelled")
        } else {
            StartupError::new("elevation_failed", err.to_string())
        });
    }
    if info.hProcess.is_invalid() {
        return Err(StartupError::new(
            "elevation_failed",
            "runas returned no process handle",
        ));
    }
    let process = OwnedHandle(info.hProcess);
    if !wait {
        return Ok(0);
    }
    match unsafe { WaitForSingleObject(process.0, INFINITE) } {
        WAIT_OBJECT_0 => {}
        WAIT_FAILED => {
            let error = WinError::from_hresult(HRESULT::from_win32(unsafe { GetLastError() }.0));
            return Err(StartupError::new("helper_failed", error.to_string()));
        }
        other => {
            return Err(StartupError::new(
                "helper_failed",
                format!("unexpected wait result: {other:?}"),
            ))
        }
    }
    let mut exit_code = 1;
    unsafe { GetExitCodeProcess(process.0, &mut exit_code) }
        .map_err(|err| StartupError::new("helper_failed", err.to_string()))?;
    Ok(exit_code)
}

pub fn elevate_interactive(parameters: &str) -> Result<(), StartupError> {
    shell_runas(parameters, false).map(|_| ())
}

pub fn reconcile_with_elevation(policy: &StartupPolicy, sid: &str) -> Result<(), StartupError> {
    match reconcile(policy, sid) {
        Ok(()) => Ok(()),
        Err(err) if err.code == "task_access_denied" => run_elevated_helper(policy),
        Err(err) => Err(err),
    }
}

fn run_elevated_helper(policy: &StartupPolicy) -> Result<(), StartupError> {
    let (elevated, split_token) = elevation_state()?;
    if !elevated && !split_token {
        return Err(StartupError::new(
            "admin_account_required",
            "startup task elevation requires this account to own an elevatable split token",
        ));
    }
    let exit = shell_runas(&format!("--startup-helper {}", policy.enabled as u8), true)?;
    if exit == 0 {
        Ok(())
    } else {
        Err(error_from_helper_exit(exit))
    }
}

pub fn helper_exit_code(result: &Result<(), StartupError>) -> i32 {
    match result {
        Ok(()) => 0,
        Err(error) => {
            (match error.code {
                "task_access_denied" => HELPER_ACCESS_DENIED,
                "task_service_unavailable" => HELPER_SERVICE_UNAVAILABLE,
                "task_ownership_collision" => HELPER_OWNERSHIP_COLLISION,
                "task_scheduler_failed" => HELPER_SCHEDULER_FAILED,
                "token_query_failed" => HELPER_TOKEN_FAILED,
                "executable_path_failed" => HELPER_EXECUTABLE_FAILED,
                _ => HELPER_OTHER_FAILED,
            }) as i32
        }
    }
}

fn error_from_helper_exit(exit: u32) -> StartupError {
    let code = match exit {
        HELPER_ACCESS_DENIED => "task_access_denied",
        HELPER_SERVICE_UNAVAILABLE => "task_service_unavailable",
        HELPER_OWNERSHIP_COLLISION => "task_ownership_collision",
        HELPER_SCHEDULER_FAILED => "task_scheduler_failed",
        HELPER_TOKEN_FAILED => "token_query_failed",
        HELPER_EXECUTABLE_FAILED => "executable_path_failed",
        _ => "helper_failed",
    };
    StartupError::new(code, format!("startup helper exited with code {exit}"))
}

pub fn run_helper(policy: &StartupPolicy) -> Result<(), StartupError> {
    let sid = current_user_sid()?;
    reconcile(policy, &sid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MockMachineEffects {
        events: Vec<&'static str>,
        fail_at: Option<&'static str>,
        rollback_errors: Vec<String>,
        rollback_progress: Option<MachineApplyProgress>,
    }

    impl MockMachineEffects {
        fn step(&mut self, name: &'static str) -> Result<(), StartupError> {
            self.events.push(name);
            if self.fail_at == Some(name) {
                Err(StartupError::new(
                    if name == "task" {
                        "uac_cancelled"
                    } else {
                        "apply_failed"
                    },
                    format!("{name} failed"),
                ))
            } else {
                Ok(())
            }
        }
    }

    impl MachineEffects for MockMachineEffects {
        type Snapshot = ();

        fn snapshot(&mut self) -> Result<Self::Snapshot, StartupError> {
            self.step("snapshot")
        }

        fn save_machine(&mut self) -> Result<(), StartupError> {
            self.step("file")
        }

        fn reconcile_task(&mut self) -> Result<(), StartupError> {
            self.step("task")
        }

        fn apply_tray(&mut self) -> Result<(), StartupError> {
            self.step("tray")
        }

        fn rollback(
            &mut self,
            _snapshot: &Self::Snapshot,
            progress: MachineApplyProgress,
        ) -> Vec<String> {
            self.events.push("rollback");
            self.rollback_progress = Some(progress);
            std::mem::take(&mut self.rollback_errors)
        }
    }

    #[test]
    fn startup_modes_require_elevation_except_task_helpers() {
        assert!(EarlyMode::Interactive.requires_elevation());
        assert!(EarlyMode::Autostart.requires_elevation());
        assert!(!EarlyMode::TaskHelper { enabled: true }.requires_elevation());
        assert_eq!(EarlyMode::Interactive.elevation_parameters(), "");
        assert_eq!(EarlyMode::Autostart.elevation_parameters(), AUTOSTART_ARG);
    }

    #[test]
    fn machine_settings_only_control_startup_task_presence() {
        for (auto_start, expected) in [(false, false), (true, true)] {
            let settings = MachineLocalSettings {
                auto_start,
                tray_icon_visible: true,
            };
            assert_eq!(
                StartupPolicy::from(&settings),
                StartupPolicy { enabled: expected }
            );
        }
    }

    #[test]
    fn task_identity_and_definition_are_stable_and_structured() {
        let sid = "S-1-5-21-100";
        let exe = Path::new(r"C:\Program Files\GodGesture\GodGesture.exe");
        let xml = task_xml(&StartupPolicy { enabled: true }, sid, exe);
        assert_eq!(task_name_for_sid(sid), "GodGesture Startup S-1-5-21-100");
        assert!(is_owned_xml(&xml));
        assert!(xml.contains("<LogonType>InteractiveToken</LogonType>"));
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<Arguments>--autostart</Arguments>"));
        assert!(xml.contains(r"<WorkingDirectory>C:\Program Files\GodGesture</WorkingDirectory>"));
    }

    #[test]
    fn startup_task_always_uses_highest_available() {
        let xml = task_xml(
            &StartupPolicy { enabled: true },
            "S-1-5-21-1",
            Path::new(r"C:\GodGesture\GodGesture.exe"),
        );
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(!xml.contains("<RunLevel>LeastPrivilege</RunLevel>"));
    }

    #[test]
    fn startup_task_xml_escapes_paths() {
        let xml = task_xml(
            &StartupPolicy { enabled: true },
            "S-1-5-21-1",
            Path::new(r"C:\A & B\GodGesture.exe"),
        );
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains(r"C:\A &amp; B\GodGesture.exe"));
    }

    #[test]
    fn ownership_requires_exact_registration_marker() {
        assert!(is_owned_xml(&format!(
            "<Description>{OWNER_MARKER}</Description>"
        )));
        assert!(!is_owned_xml(
            "<Description>another application</Description>"
        ));
    }

    #[test]
    fn normalized_task_xml_can_be_recognized_without_byte_equality() {
        let policy = StartupPolicy { enabled: true };
        let exe = Path::new(r"C:\GodGesture\GodGesture.exe");
        let xml = task_xml(&policy, "S-1-5-21-1", exe).replace("\n", "");
        assert!(task_matches(&xml, &policy, "S-1-5-21-1", exe));
    }

    #[test]
    fn early_modes_are_strict_and_helpers_do_not_accept_paths() {
        assert_eq!(
            parse_early_mode(["app".into()]).unwrap(),
            EarlyMode::Interactive
        );
        assert_eq!(
            parse_early_mode(["app".into(), "--autostart".into()]).unwrap(),
            EarlyMode::Autostart
        );
        assert_eq!(
            parse_early_mode(["app".into(), "--startup-helper".into(), "1".into(),]).unwrap(),
            EarlyMode::TaskHelper { enabled: true }
        );
        for legacy_highest in ["0", "1"] {
            assert_eq!(
                parse_early_mode([
                    "app".into(),
                    "--startup-helper".into(),
                    "1".into(),
                    legacy_highest.into(),
                ])
                .unwrap(),
                EarlyMode::TaskHelper { enabled: true }
            );
        }
        assert!(parse_early_mode([
            "app".into(),
            "--startup-helper".into(),
            "1".into(),
            "0".into(),
            "C:\\other.exe".into()
        ])
        .is_err());
    }

    #[test]
    fn helper_exit_codes_preserve_stable_failure_categories() {
        for code in [
            "task_access_denied",
            "task_service_unavailable",
            "task_ownership_collision",
            "task_scheduler_failed",
            "token_query_failed",
            "executable_path_failed",
        ] {
            let result = Err(StartupError::new(code, "failure"));
            let exit = helper_exit_code(&result) as u32;
            assert_eq!(error_from_helper_exit(exit).code, code);
        }
        assert_eq!(
            error_from_helper_exit(HELPER_OTHER_FAILED).code,
            "helper_failed"
        );
    }

    #[test]
    fn machine_transaction_applies_file_task_then_tray() {
        let mut effects = MockMachineEffects::default();
        assert_eq!(apply_machine_settings(&mut effects), Ok(()));
        assert_eq!(effects.events, ["snapshot", "file", "task", "tray"]);
    }

    #[test]
    fn machine_transaction_rolls_back_every_attempted_failure_point() {
        for (failure, expected) in [
            (
                "file",
                MachineApplyProgress {
                    file_attempted: true,
                    task_attempted: false,
                    tray_attempted: false,
                },
            ),
            (
                "task",
                MachineApplyProgress {
                    file_attempted: true,
                    task_attempted: true,
                    tray_attempted: false,
                },
            ),
            (
                "tray",
                MachineApplyProgress {
                    file_attempted: true,
                    task_attempted: true,
                    tray_attempted: true,
                },
            ),
        ] {
            let mut effects = MockMachineEffects {
                fail_at: Some(failure),
                ..Default::default()
            };
            let error = apply_machine_settings(&mut effects).unwrap_err();
            assert_eq!(
                error.code,
                if failure == "task" {
                    "uac_cancelled"
                } else {
                    "apply_failed"
                }
            );
            assert_eq!(effects.rollback_progress, Some(expected));
            assert_eq!(effects.events.last(), Some(&"rollback"));
        }
    }

    #[test]
    fn machine_transaction_promotes_any_rollback_error() {
        let mut effects = MockMachineEffects {
            fail_at: Some("task"),
            rollback_errors: vec!["task restore failed".into()],
            ..Default::default()
        };
        let error = apply_machine_settings(&mut effects).unwrap_err();
        assert_eq!(error.code, "rollback_incomplete");
        assert_eq!(error.message, "task failed");
        assert_eq!(error.rollback_errors, ["task restore failed"]);
    }

    #[test]
    #[ignore = "creates and removes a uniquely named current-user Task Scheduler task"]
    fn windows_task_scheduler_smoke() {
        let sid = current_user_sid().expect("current SID");
        let exe = current_exe().expect("current executable");
        let name = format!("GodGesture Startup Test {}", std::process::id());
        let enabled = StartupPolicy { enabled: true };
        let disabled = StartupPolicy { enabled: false };

        let result = (|| {
            reconcile_for_exe_named(&enabled, &sid, &exe, &name)?;
            let (_apartment, root) = task_root()?;
            let xml = get_task_xml(&root, &name)?.ok_or_else(|| {
                StartupError::new("task_scheduler_failed", "smoke task was not registered")
            })?;
            if !task_matches(&xml, &enabled, &sid, &exe) {
                return Err(StartupError::new(
                    "task_scheduler_failed",
                    "smoke task fields did not match the requested policy",
                ));
            }
            Ok(())
        })();
        let cleanup = reconcile_for_exe_named(&disabled, &sid, &exe, &name);
        assert!(cleanup.is_ok(), "smoke task cleanup failed: {cleanup:?}");
        assert!(result.is_ok(), "Task Scheduler smoke failed: {result:?}");
    }
}

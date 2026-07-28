//! Application identity acquisition for the settings window.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedWindow {
    pub exe_name: String,
    pub exe_path: String,
    pub aumid: Option<String>,
    pub bundle_id: Option<String>,
    pub app_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppAcquisitionError {
    pub code: &'static str,
    pub message: String,
}

impl AppAcquisitionError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{AppAcquisitionError, PickedWindow};
    use crate::platform::windows::window;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::{HWND, RPC_E_CHANGED_MODE};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_RAWPATH, SLR_NO_UI};

    const PICK_TIMEOUT: Duration = Duration::from_secs(15);
    const PICK_POLL_INTERVAL: Duration = Duration::from_millis(16);

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum PickerDecision {
        Continue,
        Cancel,
        Select,
    }

    fn picker_decision(left_down: bool, escape_down: bool, elapsed: Duration) -> PickerDecision {
        if escape_down || elapsed >= PICK_TIMEOUT {
            PickerDecision::Cancel
        } else if left_down {
            PickerDecision::Continue
        } else {
            PickerDecision::Select
        }
    }

    fn key_down(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
        unsafe { GetAsyncKeyState(key.0 as i32) < 0 }
    }

    pub(super) fn pick_window() -> Option<PickedWindow> {
        // The command starts from pointer-down. A delayed invoke after release is cancellation.
        if !key_down(VK_LBUTTON) {
            return None;
        }

        let started = Instant::now();
        loop {
            match picker_decision(key_down(VK_LBUTTON), key_down(VK_ESCAPE), started.elapsed()) {
                PickerDecision::Continue => std::thread::sleep(PICK_POLL_INTERVAL),
                PickerDecision::Cancel => return None,
                PickerDecision::Select => break,
            }
        }

        picked_from_window_info(window::cursor_window_info()?, std::process::id())
    }

    fn picked_from_window_info(info: window::WindowAppInfo, own_pid: u32) -> Option<PickedWindow> {
        (info.pid != own_pid).then(|| from_window_info(info))
    }

    fn from_window_info(info: window::WindowAppInfo) -> PickedWindow {
        let app_name = if info.title.trim().is_empty() {
            executable_stem(&info.exe_name).unwrap_or_else(|| info.exe_name.clone())
        } else {
            info.title
        };
        PickedWindow {
            exe_name: info.exe_name,
            exe_path: info.exe_path,
            aumid: info.aumid,
            bundle_id: None,
            app_name,
        }
    }

    struct ComApartment(bool);

    impl ComApartment {
        fn init() -> Result<Self, AppAcquisitionError> {
            match unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
                Ok(()) => Ok(Self(true)),
                Err(error) if error.code() == RPC_E_CHANGED_MODE => Ok(Self(false)),
                Err(error) => Err(AppAcquisitionError::new(
                    "shortcut_resolution_failed",
                    format!("initialize shortcut COM: {error}"),
                )),
            }
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn shortcut_target(path: &Path) -> Result<PathBuf, AppAcquisitionError> {
        let _apartment = ComApartment::init()?;
        let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| {
                AppAcquisitionError::new(
                    "shortcut_resolution_failed",
                    format!("create shortcut resolver: {error}"),
                )
            })?;
        let persist: IPersistFile = link.cast().map_err(|error| {
            AppAcquisitionError::new(
                "shortcut_resolution_failed",
                format!("open shortcut persistence interface: {error}"),
            )
        })?;
        let wide = path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        unsafe { persist.Load(PCWSTR(wide.as_ptr()), STGM_READ) }.map_err(|error| {
            AppAcquisitionError::new(
                "shortcut_resolution_failed",
                format!("load shortcut: {error}"),
            )
        })?;
        let _ = unsafe { link.Resolve(HWND::default(), SLR_NO_UI.0 as u32) };

        let mut target = vec![0u16; 32_768];
        unsafe { link.GetPath(&mut target, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32) }.map_err(
            |error| {
                AppAcquisitionError::new(
                    "shortcut_resolution_failed",
                    format!("read shortcut target: {error}"),
                )
            },
        )?;
        let end = target
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(target.len());
        if end == 0 {
            return Err(AppAcquisitionError::new(
                "shortcut_resolution_failed",
                "shortcut has no filesystem target",
            ));
        }
        Ok(PathBuf::from(String::from_utf16_lossy(&target[..end])))
    }

    fn executable_stem(value: &str) -> Option<String> {
        Path::new(value)
            .file_stem()
            .and_then(|name| name.to_str())
            .map(str::to_string)
    }

    fn lowercase_extension(path: &Path) -> Option<String> {
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_lowercase)
    }

    fn display_path(path: &Path) -> Result<String, AppAcquisitionError> {
        let value = path.to_str().ok_or_else(|| {
            AppAcquisitionError::new(
                "app_file_unavailable",
                "application path is not valid Unicode",
            )
        })?;
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            Ok(format!(r"\\{rest}"))
        } else {
            Ok(value.strip_prefix(r"\\?\").unwrap_or(value).to_string())
        }
    }

    pub(super) fn resolve_app_file(path: &Path) -> Result<PickedWindow, AppAcquisitionError> {
        let metadata = std::fs::metadata(path).map_err(|error| {
            AppAcquisitionError::new(
                "app_file_unavailable",
                format!("read dropped application file: {error}"),
            )
        })?;
        if !metadata.is_file() {
            return Err(AppAcquisitionError::new(
                "unsupported_app_file",
                "dropped path is not a file",
            ));
        }

        let source_name = path
            .file_stem()
            .and_then(|name| name.to_str())
            .map(str::to_string);
        let target = match lowercase_extension(path).as_deref() {
            Some("exe") => path.to_path_buf(),
            Some("lnk") => shortcut_target(path)?,
            _ => {
                return Err(AppAcquisitionError::new(
                    "unsupported_app_file",
                    "only .exe files and .lnk shortcuts are supported",
                ))
            }
        };

        if lowercase_extension(&target).as_deref() != Some("exe") {
            return Err(AppAcquisitionError::new(
                "shortcut_resolution_failed",
                "shortcut target is not an executable",
            ));
        }
        let canonical = std::fs::canonicalize(&target).map_err(|error| {
            AppAcquisitionError::new(
                "app_file_unavailable",
                format!("resolve executable path: {error}"),
            )
        })?;
        if !canonical.is_file() {
            return Err(AppAcquisitionError::new(
                "app_file_unavailable",
                "resolved executable is not a file",
            ));
        }
        let exe_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AppAcquisitionError::new(
                    "app_file_unavailable",
                    "resolved executable has no valid file name",
                )
            })?
            .to_lowercase();
        let app_name = source_name
            .or_else(|| executable_stem(&exe_name))
            .unwrap_or_else(|| exe_name.clone());

        Ok(PickedWindow {
            exe_name,
            exe_path: display_path(&canonical)?,
            aumid: None,
            bundle_id: None,
            app_name,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn picker_decision_distinguishes_hold_release_cancel_and_timeout() {
            assert_eq!(
                picker_decision(true, false, Duration::from_secs(1)),
                PickerDecision::Continue
            );
            assert_eq!(
                picker_decision(false, false, Duration::from_secs(1)),
                PickerDecision::Select
            );
            assert_eq!(
                picker_decision(true, true, Duration::from_secs(1)),
                PickerDecision::Cancel
            );
            assert_eq!(
                picker_decision(true, false, PICK_TIMEOUT),
                PickerDecision::Cancel
            );
        }

        #[test]
        fn picker_rejects_the_settings_process() {
            let info = window::WindowAppInfo {
                exe_name: "godgesture.exe".into(),
                exe_path: r"C:\GodGesture\godgesture.exe".into(),
                aumid: None,
                title: "GodGesture".into(),
                pid: 42,
            };

            assert_eq!(picked_from_window_info(info, 42), None);
        }

        #[test]
        fn executable_drop_builds_canonical_payload() {
            let executable = std::env::current_exe().expect("current test executable");
            let picked = resolve_app_file(&executable).expect("resolve executable");
            assert!(picked.exe_name.ends_with(".exe"));
            assert!(picked.exe_path.to_lowercase().ends_with(&picked.exe_name));
            assert_eq!(picked.aumid, None);
        }

        #[test]
        fn unsupported_and_missing_files_return_stable_codes() {
            let missing = std::env::temp_dir()
                .join(format!("godgesture-missing-{}.exe", uuid::Uuid::new_v4()));
            assert_eq!(
                resolve_app_file(&missing).unwrap_err().code,
                "app_file_unavailable"
            );

            let unsupported = std::env::temp_dir().join(format!(
                "godgesture-unsupported-{}.txt",
                uuid::Uuid::new_v4()
            ));
            std::fs::write(&unsupported, b"test").expect("write unsupported test file");
            let result = resolve_app_file(&unsupported);
            let _ = std::fs::remove_file(&unsupported);
            assert_eq!(result.unwrap_err().code, "unsupported_app_file");
        }

        #[test]
        fn shell_link_drop_resolves_its_executable_target() {
            let target = std::env::current_exe().expect("current test executable");
            let shortcut = std::env::temp_dir()
                .join(format!("godgesture-shortcut-{}.lnk", uuid::Uuid::new_v4()));
            create_shortcut(&shortcut, &target).expect("create test shortcut");
            let result = resolve_app_file(&shortcut);
            let _ = std::fs::remove_file(&shortcut);
            let picked = result.expect("resolve test shortcut");
            assert_eq!(
                picked.exe_name,
                target.file_name().unwrap().to_string_lossy().to_lowercase()
            );
            assert!(picked.app_name.starts_with("godgesture-shortcut-"));
        }

        #[test]
        fn malformed_shortcut_returns_stable_error_code() {
            let shortcut = std::env::temp_dir().join(format!(
                "godgesture-invalid-shortcut-{}.lnk",
                uuid::Uuid::new_v4()
            ));
            std::fs::write(&shortcut, b"not a shell link").expect("write invalid shortcut");
            let result = resolve_app_file(&shortcut);
            let _ = std::fs::remove_file(&shortcut);

            assert_eq!(result.unwrap_err().code, "shortcut_resolution_failed");
        }

        fn create_shortcut(path: &Path, target: &Path) -> Result<(), AppAcquisitionError> {
            let _apartment = ComApartment::init()?;
            let link: IShellLinkW =
                unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }.map_err(
                    |error| {
                        AppAcquisitionError::new(
                            "shortcut_resolution_failed",
                            format!("create test shortcut: {error}"),
                        )
                    },
                )?;
            let target_wide = target
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            unsafe { link.SetPath(PCWSTR(target_wide.as_ptr())) }.map_err(|error| {
                AppAcquisitionError::new(
                    "shortcut_resolution_failed",
                    format!("set test shortcut target: {error}"),
                )
            })?;
            let persist: IPersistFile = link.cast().map_err(|error| {
                AppAcquisitionError::new(
                    "shortcut_resolution_failed",
                    format!("open test shortcut persistence interface: {error}"),
                )
            })?;
            let path_wide = path
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            unsafe { persist.Save(PCWSTR(path_wide.as_ptr()), true) }.map_err(|error| {
                AppAcquisitionError::new(
                    "shortcut_resolution_failed",
                    format!("save test shortcut: {error}"),
                )
            })
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{AppAcquisitionError, PickedWindow};
    use crate::platform::macos::{input, window};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGMouseButton};
    use objc2_foundation::{NSBundle, NSString};
    use std::path::Path;
    use std::time::{Duration, Instant};

    const PICK_TIMEOUT: Duration = Duration::from_secs(15);
    const PICK_POLL_INTERVAL: Duration = Duration::from_millis(16);
    const ESCAPE_KEY_CODE: u16 = 53;

    fn left_button_down() -> bool {
        CGEventSource::button_state(CGEventSourceStateID::HIDSystemState, CGMouseButton::Left)
    }

    fn escape_down() -> bool {
        CGEventSource::key_state(CGEventSourceStateID::HIDSystemState, ESCAPE_KEY_CODE)
    }

    pub(super) fn pick_window() -> Option<PickedWindow> {
        if !left_button_down() {
            return None;
        }

        let started = Instant::now();
        while left_button_down() {
            if escape_down() || started.elapsed() >= PICK_TIMEOUT {
                return None;
            }
            std::thread::sleep(PICK_POLL_INTERVAL);
        }
        if escape_down() {
            return None;
        }

        let (bundle_id, app_name) = window::application_at(input::current_pointer().ok()?)?;
        Some(PickedWindow {
            exe_name: String::new(),
            exe_path: String::new(),
            aumid: None,
            bundle_id: Some(bundle_id),
            app_name,
        })
    }

    fn info_string(bundle: &NSBundle, key: &str) -> Option<String> {
        let key = NSString::from_str(key);
        let value: Retained<AnyObject> = bundle.objectForInfoDictionaryKey(&key)?;
        value
            .downcast::<NSString>()
            .ok()
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty())
    }

    pub(super) fn resolve_app_file(path: &Path) -> Result<PickedWindow, AppAcquisitionError> {
        let metadata = std::fs::metadata(path).map_err(|error| {
            AppAcquisitionError::new(
                "app_file_unavailable",
                format!("read dropped application bundle: {error}"),
            )
        })?;
        let is_app = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
        if !metadata.is_dir() || !is_app {
            return Err(AppAcquisitionError::new(
                "unsupported_app_file",
                "only macOS .app bundles are supported",
            ));
        }

        let canonical = std::fs::canonicalize(path).map_err(|error| {
            AppAcquisitionError::new(
                "app_file_unavailable",
                format!("resolve application bundle path: {error}"),
            )
        })?;
        let path_string = canonical.to_str().ok_or_else(|| {
            AppAcquisitionError::new(
                "app_file_unavailable",
                "application bundle path is not valid Unicode",
            )
        })?;
        let bundle =
            NSBundle::bundleWithPath(&NSString::from_str(path_string)).ok_or_else(|| {
                AppAcquisitionError::new(
                    "unsupported_app_file",
                    "dropped directory is not a valid application bundle",
                )
            })?;
        let bundle_id = bundle
            .bundleIdentifier()
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppAcquisitionError::new(
                    "unsupported_app_file",
                    "application bundle has no Bundle ID",
                )
            })?;
        let fallback_name = canonical
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(&bundle_id)
            .to_string();
        let app_name = info_string(&bundle, "CFBundleDisplayName")
            .or_else(|| info_string(&bundle, "CFBundleName"))
            .unwrap_or(fallback_name);

        Ok(PickedWindow {
            exe_name: String::new(),
            exe_path: String::new(),
            aumid: None,
            bundle_id: Some(bundle_id),
            app_name,
        })
    }
}

pub(crate) fn pick_window() -> Option<PickedWindow> {
    #[cfg(windows)]
    {
        windows_impl::pick_window()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::pick_window()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        None
    }
}

pub(crate) fn resolve_app_file(path: &Path) -> Result<PickedWindow, AppAcquisitionError> {
    #[cfg(windows)]
    {
        windows_impl::resolve_app_file(path)
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::resolve_app_file(path)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = path;
        Err(AppAcquisitionError::new(
            "unsupported_platform",
            "application files are unsupported on this platform",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picked_window_matches_frontend_contract() {
        let json = serde_json::to_value(PickedWindow {
            exe_name: "calculatorapp.exe".into(),
            exe_path: "C:\\Program Files\\WindowsApps\\CalculatorApp.exe".into(),
            aumid: Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".into()),
            bundle_id: None,
            app_name: "Calculator".into(),
        })
        .unwrap();

        assert_eq!(json["exeName"], "calculatorapp.exe");
        assert_eq!(
            json["aumid"],
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        );
        assert!(json["bundleId"].is_null());
        assert!(json.get("exe_name").is_none());
    }
}

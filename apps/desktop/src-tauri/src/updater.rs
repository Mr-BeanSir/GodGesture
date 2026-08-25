use parking_lot::Mutex;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Error as NativeUpdaterError, Update, UpdaterExt};
use url::Url;

const DEFAULT_UPDATE_ENDPOINT: &str =
    "https://github.com/Mr-BeanSir/GodGesture/releases/latest/download/latest.json";
const MACOS_UNIVERSAL_TARGET: &str = "darwin-universal";
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RELEASE_NOTES_CHARS: usize = 16 * 1024;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum UpdaterOperation {
    #[default]
    Idle,
    Checking,
    Installing,
}

#[derive(Default)]
struct UpdaterSession {
    operation: UpdaterOperation,
    pending: Option<Update>,
}

#[derive(Default)]
pub struct DesktopUpdaterState(Mutex<UpdaterSession>);

impl DesktopUpdaterState {
    fn begin(&self, operation: UpdaterOperation) -> Result<(), UpdaterCommandError> {
        let mut session = self.0.lock();
        if session.operation != UpdaterOperation::Idle {
            return Err(UpdaterCommandError::new(
                "update_busy",
                "another update operation is already running",
            ));
        }
        session.operation = operation;
        Ok(())
    }

    fn finish(&self) {
        self.0.lock().operation = UpdaterOperation::Idle;
    }

    fn replace_pending(&self, update: Option<Update>) {
        self.0.lock().pending = update;
    }

    fn take_pending(&self) -> Option<Update> {
        self.0.lock().pending.take()
    }

    fn cancel_pending(&self) -> Result<(), UpdaterCommandError> {
        let mut session = self.0.lock();
        if session.operation != UpdaterOperation::Idle {
            return Err(UpdaterCommandError::new(
                "update_busy",
                "another update operation is already running",
            ));
        }
        session.pending = None;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    current_version: String,
    version: String,
    notes: Option<String>,
    published_at: Option<String>,
}

impl From<&Update> for UpdateMetadata {
    fn from(update: &Update) -> Self {
        Self {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            notes: update.body.as_deref().map(bounded_release_notes),
            published_at: update.date.map(|value| value.to_string()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "event",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateDownloadEvent {
    Started {
        content_length: Option<u64>,
    },
    Progress {
        chunk_length: usize,
        downloaded: u64,
    },
    Finished {
        downloaded: u64,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdaterCommandError {
    code: &'static str,
    message: String,
}

impl UpdaterCommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn from_native(error: NativeUpdaterError, phase: UpdatePhase) -> Self {
        let code = match &error {
            NativeUpdaterError::InsecureTransportProtocol
            | NativeUpdaterError::UrlParse(_)
            | NativeUpdaterError::EmptyEndpoints => "update_configuration_invalid",
            NativeUpdaterError::UnsupportedArch | NativeUpdaterError::UnsupportedOs => {
                "update_unsupported_platform"
            }
            NativeUpdaterError::TargetNotFound(_) | NativeUpdaterError::TargetsNotFound(_) => {
                "update_manifest_platform_missing"
            }
            NativeUpdaterError::Serialization(_) | NativeUpdaterError::ReleaseNotFound => {
                "update_manifest_invalid"
            }
            NativeUpdaterError::Reqwest(_) | NativeUpdaterError::Network(_) => "update_network",
            NativeUpdaterError::Minisign(_)
            | NativeUpdaterError::Base64(_)
            | NativeUpdaterError::SignatureUtf8(_) => "update_signature_invalid",
            _ if phase == UpdatePhase::Check => "update_check_failed",
            _ => "update_install_failed",
        };
        log::warn!(
            target: "updater",
            "event=operation_failed phase={phase:?} code={code}"
        );
        Self::new(code, error.to_string())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UpdatePhase {
    Check,
    Install,
}

#[derive(Default)]
struct DownloadProgress {
    started: bool,
    downloaded: u64,
}

impl DownloadProgress {
    fn record(&mut self, chunk_length: usize) -> u64 {
        self.started = true;
        self.downloaded = self.downloaded.saturating_add(chunk_length as u64);
        self.downloaded
    }
}

fn bounded_release_notes(notes: &str) -> String {
    notes.chars().take(MAX_RELEASE_NOTES_CHARS).collect()
}

fn validate_update_endpoint(value: &str) -> Result<Url, UpdaterCommandError> {
    let endpoint = Url::parse(value.trim()).map_err(|error| {
        UpdaterCommandError::new(
            "update_configuration_invalid",
            format!("invalid update endpoint: {error}"),
        )
    })?;
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.host_str().is_none()
    {
        return Err(UpdaterCommandError::new(
            "update_configuration_invalid",
            "update endpoint must be an HTTPS URL without credentials",
        ));
    }
    Ok(endpoint)
}

fn safe_update_endpoint(endpoint: &Url) -> String {
    let mut safe = endpoint.clone();
    let _ = safe.set_username("");
    let _ = safe.set_password(None);
    safe.set_query(None);
    safe.set_fragment(None);
    safe.to_string()
}

fn configured_update_endpoint() -> Result<Url, UpdaterCommandError> {
    validate_update_endpoint(
        option_env!("GODGESTURE_UPDATE_ENDPOINT").unwrap_or(DEFAULT_UPDATE_ENDPOINT),
    )
}

fn manifest_target_for_os(os: &str) -> Option<&'static str> {
    (os == "macos").then_some(MACOS_UNIVERSAL_TARGET)
}

async fn check_native_update(app: &AppHandle) -> Result<Option<Update>, UpdaterCommandError> {
    let endpoint = configured_update_endpoint()?;
    let started_at = std::time::Instant::now();
    log::debug!(
        target: "updater",
        "event=check_started endpoint={}",
        safe_update_endpoint(&endpoint)
    );
    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| UpdaterCommandError::from_native(error, UpdatePhase::Check))?
        .timeout(CHECK_TIMEOUT);
    if let Some(target) = manifest_target_for_os(std::env::consts::OS) {
        builder = builder.target(target);
    }
    let updater = builder
        .build()
        .map_err(|error| UpdaterCommandError::from_native(error, UpdatePhase::Check))?;
    let result = updater
        .check()
        .await
        .map_err(|error| UpdaterCommandError::from_native(error, UpdatePhase::Check));
    match &result {
        Ok(Some(update)) => log::info!(
            target: "updater",
            "event=check_completed available=true version={} durationMs={}",
            update.version,
            started_at.elapsed().as_millis()
        ),
        Ok(None) => log::info!(
            target: "updater",
            "event=check_completed available=false durationMs={}",
            started_at.elapsed().as_millis()
        ),
        Err(_) => {}
    }
    result
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, DesktopUpdaterState>,
) -> Result<Option<UpdateMetadata>, UpdaterCommandError> {
    state.begin(UpdaterOperation::Checking)?;
    state.replace_pending(None);
    log::info!(target: "updater", "event=check_command_started");
    let result = check_native_update(&app).await;
    let metadata = match result {
        Ok(update) => {
            let metadata = update.as_ref().map(UpdateMetadata::from);
            state.replace_pending(update);
            Ok(metadata)
        }
        Err(error) => Err(error),
    };
    if metadata.is_err() {
        log::warn!(target: "updater", "event=check_command_failed");
    }
    state.finish();
    metadata
}

#[tauri::command]
pub fn update_cancel(state: State<'_, DesktopUpdaterState>) -> Result<(), UpdaterCommandError> {
    let result = state.cancel_pending();
    if result.is_ok() {
        log::info!(target: "updater", "event=cancel_completed");
    }
    result
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, DesktopUpdaterState>,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<(), UpdaterCommandError> {
    state.begin(UpdaterOperation::Installing)?;
    let started_at = std::time::Instant::now();
    log::info!(target: "updater", "event=install_started");
    let Some(update) = state.take_pending() else {
        state.finish();
        log::warn!(target: "updater", "event=install_failed code=update_not_pending");
        return Err(UpdaterCommandError::new(
            "update_not_pending",
            "there is no checked update ready to install",
        ));
    };

    let progress = Arc::new(Mutex::new(DownloadProgress::default()));
    let download_started_at = std::time::Instant::now();
    let chunk_progress = Arc::clone(&progress);
    let finish_progress = Arc::clone(&progress);
    let chunk_events = on_event.clone();
    let finish_events = on_event;
    let result = update
        .download_and_install(
            move |chunk_length, content_length| {
                let mut progress = chunk_progress.lock();
                if !progress.started {
                    log::debug!(
                        target: "updater",
                        "event=download_started contentLength={}",
                        content_length.map_or_else(|| "-".to_owned(), |value| value.to_string())
                    );
                    let _ = chunk_events.send(UpdateDownloadEvent::Started { content_length });
                }
                let downloaded = progress.record(chunk_length);
                log::debug!(
                    target: "updater",
                    "event=download_progress chunkLength={} downloaded={}",
                    chunk_length,
                    downloaded
                );
                let _ = chunk_events.send(UpdateDownloadEvent::Progress {
                    chunk_length,
                    downloaded,
                });
            },
            move || {
                let downloaded = finish_progress.lock().downloaded;
                log::debug!(
                    target: "updater",
                    "event=download_finished downloaded={} durationMs={}",
                    downloaded,
                    download_started_at.elapsed().as_millis()
                );
                let _ = finish_events.send(UpdateDownloadEvent::Finished { downloaded });
            },
        )
        .await;

    if let Err(error) = result {
        state.finish();
        log::error!(target: "updater", "event=install_failed code=update_install_failed");
        return Err(UpdaterCommandError::from_native(
            error,
            UpdatePhase::Install,
        ));
    }

    state.finish();
    log::info!(
        target: "updater",
        "event=install_completed durationMs={}",
        started_at.elapsed().as_millis()
    );
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_requires_https_without_credentials() {
        assert!(validate_update_endpoint(DEFAULT_UPDATE_ENDPOINT).is_ok());
        for value in [
            "http://example.com/latest.json",
            "https://user@example.com/latest.json",
            "not a URL",
        ] {
            assert_eq!(
                validate_update_endpoint(value).unwrap_err().code,
                "update_configuration_invalid"
            );
        }
    }

    #[test]
    fn logged_endpoint_removes_credentials_query_and_fragment() {
        let endpoint =
            Url::parse("https://user:password@example.test/latest.json?token=secret#part").unwrap();

        let safe = safe_update_endpoint(&endpoint);

        assert_eq!(safe, "https://example.test/latest.json");
        assert!(!safe.contains("password"));
        assert!(!safe.contains("secret"));
    }

    #[test]
    fn universal_target_is_macos_only() {
        assert_eq!(manifest_target_for_os("macos"), Some("darwin-universal"));
        assert_eq!(manifest_target_for_os("windows"), None);
        assert_eq!(manifest_target_for_os("linux"), None);
    }

    #[test]
    fn operation_gate_serializes_checks_and_installs() {
        let state = DesktopUpdaterState::default();
        state.begin(UpdaterOperation::Checking).unwrap();
        assert_eq!(
            state.begin(UpdaterOperation::Installing).unwrap_err().code,
            "update_busy"
        );
        assert_eq!(state.cancel_pending().unwrap_err().code, "update_busy");
        state.finish();
        state.begin(UpdaterOperation::Installing).unwrap();
        state.finish();
    }

    #[test]
    fn progress_saturates_and_release_notes_are_bounded() {
        let mut progress = DownloadProgress {
            started: false,
            downloaded: u64::MAX - 1,
        };
        assert_eq!(progress.record(8), u64::MAX);
        assert!(progress.started);
        assert_eq!(
            bounded_release_notes(&"界".repeat(MAX_RELEASE_NOTES_CHARS + 10))
                .chars()
                .count(),
            MAX_RELEASE_NOTES_CHARS
        );
    }

    #[test]
    fn progress_event_json_matches_frontend_contract() {
        assert_eq!(
            serde_json::to_value(UpdateDownloadEvent::Started {
                content_length: Some(1024)
            })
            .unwrap(),
            serde_json::json!({
                "event": "started",
                "data": { "contentLength": 1024 }
            })
        );
        assert_eq!(
            serde_json::to_value(UpdateDownloadEvent::Progress {
                chunk_length: 128,
                downloaded: 512
            })
            .unwrap(),
            serde_json::json!({
                "event": "progress",
                "data": { "chunkLength": 128, "downloaded": 512 }
            })
        );
    }

    #[test]
    fn native_errors_map_to_stable_phase_aware_codes() {
        let cases = [
            (
                NativeUpdaterError::EmptyEndpoints,
                UpdatePhase::Check,
                "update_configuration_invalid",
            ),
            (
                NativeUpdaterError::UnsupportedArch,
                UpdatePhase::Check,
                "update_unsupported_platform",
            ),
            (
                NativeUpdaterError::TargetNotFound("windows-x86_64".into()),
                UpdatePhase::Check,
                "update_manifest_platform_missing",
            ),
            (
                NativeUpdaterError::ReleaseNotFound,
                UpdatePhase::Check,
                "update_manifest_invalid",
            ),
            (
                NativeUpdaterError::Network("offline".into()),
                UpdatePhase::Check,
                "update_network",
            ),
            (
                NativeUpdaterError::SignatureUtf8("invalid".into()),
                UpdatePhase::Install,
                "update_signature_invalid",
            ),
            (
                NativeUpdaterError::PackageInstallFailed,
                UpdatePhase::Check,
                "update_check_failed",
            ),
            (
                NativeUpdaterError::PackageInstallFailed,
                UpdatePhase::Install,
                "update_install_failed",
            ),
        ];

        for (error, phase, expected) in cases {
            assert_eq!(
                UpdaterCommandError::from_native(error, phase).code,
                expected
            );
        }
    }
}

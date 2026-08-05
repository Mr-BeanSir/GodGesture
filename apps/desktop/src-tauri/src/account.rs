use crate::engine::config::{ConfigStore, SyncMetadata};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};
use url::Url;

const CREDENTIAL_SERVICE: &str = "com.godgesture.app.cloud";
const CALLBACK_PATH: &str = "/oauth/callback";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_HTTP_HEADER_BYTES: usize = 8 * 1024;

static CREDENTIAL_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccountError {
    pub code: String,
    pub message: String,
}

impl NativeAccountError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthLoopbackStart {
    pub attempt_id: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthLoopbackResult {
    pub code: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDeviceInfo {
    pub name: String,
    pub platform: &'static str,
}

struct OAuthAttempt {
    receiver: Option<mpsc::Receiver<Result<OAuthLoopbackResult, NativeAccountError>>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct OAuthLoopbackState {
    attempts: Mutex<HashMap<String, OAuthAttempt>>,
}

impl Drop for OAuthLoopbackState {
    fn drop(&mut self) {
        for attempt in self.attempts.get_mut().values() {
            attempt.cancelled.store(true, Ordering::Release);
        }
    }
}

fn normalize_api_origin(value: &str) -> Result<String, NativeAccountError> {
    let parsed = Url::parse(value).map_err(|_| {
        NativeAccountError::new("invalid_api_origin", "API origin is not a valid URL")
    })?;
    let local_http =
        parsed.scheme() == "http" && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    if parsed.scheme() != "https" && !local_http {
        return Err(NativeAccountError::new(
            "invalid_api_origin",
            "API origin must use HTTPS except for local development",
        ));
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        return Err(NativeAccountError::new(
            "invalid_api_origin",
            "API origin must not contain credentials, a path, query, or fragment",
        ));
    }
    Ok(parsed.origin().ascii_serialization())
}

fn credential_entry(api_origin: &str) -> Result<keyring::Entry, NativeAccountError> {
    let username = normalize_api_origin(api_origin)?;
    keyring::Entry::new(CREDENTIAL_SERVICE, &username).map_err(|err| {
        NativeAccountError::new(
            "credential_store_unavailable",
            format!("cannot open the operating-system credential store: {err}"),
        )
    })
}

fn credential_store_lock() -> parking_lot::MutexGuard<'static, ()> {
    CREDENTIAL_STORE_LOCK.get_or_init(|| Mutex::new(())).lock()
}

fn credential_get_inner(api_origin: &str) -> Result<Option<String>, NativeAccountError> {
    let _store_guard = credential_store_lock();
    let entry = credential_entry(api_origin)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(NativeAccountError::new(
            "credential_read_failed",
            format!("cannot read the saved session credential: {err}"),
        )),
    }
}

fn credential_set_inner(api_origin: &str, refresh_token: &str) -> Result<(), NativeAccountError> {
    if refresh_token.is_empty() {
        return Err(NativeAccountError::new(
            "credential_write_failed",
            "refusing to store an empty session credential",
        ));
    }
    let _store_guard = credential_store_lock();
    credential_entry(api_origin)?
        .set_password(refresh_token)
        .map_err(|err| {
            NativeAccountError::new(
                "credential_write_failed",
                format!("cannot save the session credential: {err}"),
            )
        })
}

fn credential_delete_inner(api_origin: &str) -> Result<(), NativeAccountError> {
    let _store_guard = credential_store_lock();
    let entry = credential_entry(api_origin)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(NativeAccountError::new(
            "credential_delete_failed",
            format!("cannot remove the saved session credential: {err}"),
        )),
    }
}

#[tauri::command]
pub async fn account_credential_get(
    api_origin: String,
) -> Result<Option<String>, NativeAccountError> {
    tauri::async_runtime::spawn_blocking(move || credential_get_inner(&api_origin))
        .await
        .map_err(|err| {
            NativeAccountError::new(
                "credential_read_failed",
                format!("credential worker failed: {err}"),
            )
        })?
}

#[tauri::command]
pub async fn account_credential_set(
    api_origin: String,
    refresh_token: String,
) -> Result<(), NativeAccountError> {
    tauri::async_runtime::spawn_blocking(move || credential_set_inner(&api_origin, &refresh_token))
        .await
        .map_err(|err| {
            NativeAccountError::new(
                "credential_write_failed",
                format!("credential worker failed: {err}"),
            )
        })?
}

#[tauri::command]
pub async fn account_credential_delete(api_origin: String) -> Result<(), NativeAccountError> {
    tauri::async_runtime::spawn_blocking(move || credential_delete_inner(&api_origin))
        .await
        .map_err(|err| {
            NativeAccountError::new(
                "credential_delete_failed",
                format!("credential worker failed: {err}"),
            )
        })?
}

#[tauri::command]
pub async fn sync_metadata_get(
    store: tauri::State<'_, Arc<ConfigStore>>,
) -> Result<Option<SyncMetadata>, NativeAccountError> {
    let store = Arc::clone(&store);
    tauri::async_runtime::spawn_blocking(move || store.load_sync_metadata())
        .await
        .map_err(|err| {
            NativeAccountError::new(
                "sync_metadata_read_failed",
                format!("sync metadata worker failed: {err}"),
            )
        })
}

#[tauri::command]
pub async fn sync_metadata_set(
    metadata: SyncMetadata,
    store: tauri::State<'_, Arc<ConfigStore>>,
) -> Result<(), NativeAccountError> {
    let store = Arc::clone(&store);
    tauri::async_runtime::spawn_blocking(move || store.save_sync_metadata(&metadata))
        .await
        .map_err(|err| {
            NativeAccountError::new(
                "sync_metadata_write_failed",
                format!("sync metadata worker failed: {err}"),
            )
        })?
        .map_err(|err| {
            NativeAccountError::new(
                "sync_metadata_write_failed",
                format!("cannot save sync metadata: {err}"),
            )
        })
}

#[tauri::command]
pub fn account_device_info() -> DesktopDeviceInfo {
    let fallback = format!("GodGesture on {}", current_platform_label());
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or(fallback);
    let trimmed = raw.trim();
    let source = if trimmed.is_empty() {
        format!("GodGesture on {}", current_platform_label())
    } else {
        trimmed.to_string()
    };
    DesktopDeviceInfo {
        name: source.chars().take(64).collect(),
        platform: current_platform(),
    }
}

#[cfg(windows)]
fn current_platform() -> &'static str {
    "windows"
}

#[cfg(target_os = "macos")]
fn current_platform() -> &'static str {
    "macos"
}

#[cfg(not(any(windows, target_os = "macos")))]
fn current_platform() -> &'static str {
    "unsupported"
}

fn current_platform_label() -> &'static str {
    match current_platform() {
        "windows" => "Windows",
        "macos" => "macOS",
        _ => "Desktop",
    }
}

fn valid_client_state(state: &str) -> bool {
    (16..=256).contains(&state.len())
        && state
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[tauri::command]
pub fn oauth_loopback_start(
    client_state: String,
    state: tauri::State<'_, OAuthLoopbackState>,
) -> Result<OAuthLoopbackStart, NativeAccountError> {
    if !valid_client_state(&client_state) {
        return Err(NativeAccountError::new(
            "invalid_oauth_state",
            "OAuth client state must be 16-256 base64url characters",
        ));
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|err| {
        NativeAccountError::new(
            "oauth_loopback_bind_failed",
            format!("cannot bind an OAuth loopback port: {err}"),
        )
    })?;
    listener.set_nonblocking(true).map_err(|err| {
        NativeAccountError::new(
            "oauth_loopback_bind_failed",
            format!("cannot configure the OAuth loopback listener: {err}"),
        )
    })?;
    let port = listener
        .local_addr()
        .map_err(|err| {
            NativeAccountError::new(
                "oauth_loopback_bind_failed",
                format!("cannot inspect the OAuth loopback listener: {err}"),
            )
        })?
        .port();
    let attempt_id = uuid::Uuid::new_v4().to_string();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = Arc::clone(&cancelled);
    let (sender, receiver) = mpsc::channel();

    {
        let mut attempts = state.attempts.lock();
        for attempt in attempts.values() {
            attempt.cancelled.store(true, Ordering::Release);
        }
        attempts.clear();
        attempts.insert(
            attempt_id.clone(),
            OAuthAttempt {
                receiver: Some(receiver),
                cancelled,
            },
        );
    }

    std::thread::Builder::new()
        .name("gg-oauth-loopback".into())
        .spawn(move || {
            let result = wait_for_oauth_callback(listener, &client_state, &worker_cancelled);
            let _ = sender.send(result);
        })
        .map_err(|err| {
            state.attempts.lock().remove(&attempt_id);
            NativeAccountError::new(
                "oauth_loopback_start_failed",
                format!("cannot start the OAuth loopback worker: {err}"),
            )
        })?;

    Ok(OAuthLoopbackStart {
        attempt_id,
        redirect_uri,
    })
}

#[tauri::command]
pub async fn oauth_loopback_finish(
    attempt_id: String,
    state: tauri::State<'_, OAuthLoopbackState>,
) -> Result<OAuthLoopbackResult, NativeAccountError> {
    let receiver = {
        let mut attempts = state.attempts.lock();
        attempts
            .get_mut(&attempt_id)
            .and_then(|attempt| attempt.receiver.take())
            .ok_or_else(|| {
                NativeAccountError::new(
                    "oauth_attempt_not_found",
                    "OAuth loopback attempt is missing or already being awaited",
                )
            })?
    };
    let waited = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(OAUTH_TIMEOUT + Duration::from_secs(5))
    })
    .await
    .map_err(|err| {
        NativeAccountError::new(
            "oauth_loopback_failed",
            format!("OAuth loopback worker failed: {err}"),
        )
    });
    state.attempts.lock().remove(&attempt_id);
    match waited? {
        Ok(result) => result,
        Err(_) => Err(NativeAccountError::new(
            "oauth_loopback_timeout",
            "OAuth loopback callback timed out",
        )),
    }
}

#[tauri::command]
pub fn oauth_loopback_cancel(attempt_id: String, state: tauri::State<'_, OAuthLoopbackState>) {
    if let Some(attempt) = state.attempts.lock().remove(&attempt_id) {
        attempt.cancelled.store(true, Ordering::Release);
    }
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    expected_state: &str,
    cancelled: &AtomicBool,
) -> Result<OAuthLoopbackResult, NativeAccountError> {
    let deadline = Instant::now() + OAUTH_TIMEOUT;
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(NativeAccountError::new(
                "oauth_cancelled",
                "OAuth login was cancelled",
            ));
        }
        if Instant::now() >= deadline {
            return Err(NativeAccountError::new(
                "oauth_loopback_timeout",
                "OAuth login timed out",
            ));
        }
        match listener.accept() {
            Ok((mut stream, _)) => match read_callback(&mut stream, expected_state) {
                Ok(result) => {
                    respond(
                        &mut stream,
                        200,
                        "OAuth complete. You can return to GodGesture.",
                    );
                    return Ok(result);
                }
                Err(err) => {
                    respond(&mut stream, 400, "Invalid OAuth callback.");
                    log::debug!("ignored OAuth loopback request: {}", err.code);
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(err) => {
                return Err(NativeAccountError::new(
                    "oauth_loopback_failed",
                    format!("OAuth loopback listener failed: {err}"),
                ));
            }
        }
    }
}

fn read_callback(
    stream: &mut TcpStream,
    expected_state: &str,
) -> Result<OAuthLoopbackResult, NativeAccountError> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|err| NativeAccountError::new("invalid_oauth_callback", err.to_string()))?;
    let mut bytes = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while bytes.len() < MAX_HTTP_HEADER_BYTES {
        let read = stream
            .read(&mut chunk)
            .map_err(|err| NativeAccountError::new("invalid_oauth_callback", err.to_string()))?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    if bytes.len() >= MAX_HTTP_HEADER_BYTES {
        return Err(NativeAccountError::new(
            "invalid_oauth_callback",
            "OAuth callback headers are too large",
        ));
    }
    let request = std::str::from_utf8(&bytes).map_err(|_| {
        NativeAccountError::new("invalid_oauth_callback", "OAuth callback is not UTF-8")
    })?;
    let request_line = request.lines().next().ok_or_else(|| {
        NativeAccountError::new("invalid_oauth_callback", "OAuth callback is empty")
    })?;
    let mut parts = request_line.split_ascii_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let protocol = parts.next().unwrap_or_default();
    if method != "GET" || !protocol.starts_with("HTTP/1.") || parts.next().is_some() {
        return Err(NativeAccountError::new(
            "invalid_oauth_callback",
            "OAuth callback request line is invalid",
        ));
    }
    parse_callback_target(target, expected_state)
}

fn parse_callback_target(
    target: &str,
    expected_state: &str,
) -> Result<OAuthLoopbackResult, NativeAccountError> {
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| {
        NativeAccountError::new("invalid_oauth_callback", "OAuth callback target is invalid")
    })?;
    if url.path() != CALLBACK_PATH {
        return Err(NativeAccountError::new(
            "invalid_oauth_callback",
            "OAuth callback path does not match",
        ));
    }
    let mut state = None;
    let mut code = None;
    let mut error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "state" if state.is_none() => state = Some(value.into_owned()),
            "code" if code.is_none() => code = Some(value.into_owned()),
            "error" if error.is_none() => error = Some(value.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Err(NativeAccountError::new(
            "oauth_state_mismatch",
            "OAuth callback state does not match",
        ));
    }
    match (code, error) {
        (Some(code), None) if !code.is_empty() && code.len() <= 512 => Ok(OAuthLoopbackResult {
            code: Some(code),
            error: None,
        }),
        (None, Some(error)) if !error.is_empty() && error.len() <= 128 => Ok(OAuthLoopbackResult {
            code: None,
            error: Some(error),
        }),
        _ => Err(NativeAccountError::new(
            "invalid_oauth_callback",
            "OAuth callback must contain exactly one code or error",
        )),
    }
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = if status == 200 { "OK" } else { "Bad Request" };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn api_origin_accepts_https_and_loopback_only() {
        assert_eq!(
            normalize_api_origin("https://api.example.com").unwrap(),
            "https://api.example.com"
        );
        assert_eq!(
            normalize_api_origin("http://127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000"
        );
        assert_eq!(
            normalize_api_origin("http://localhost:3000").unwrap(),
            "http://localhost:3000"
        );
        assert!(normalize_api_origin("http://api.example.com").is_err());
        assert!(normalize_api_origin("https://user@example.com").is_err());
        assert!(normalize_api_origin("https://api.example.com/path").is_err());
    }

    #[test]
    fn callback_parser_accepts_code_and_normalized_error() {
        assert_eq!(
            parse_callback_target(
                &format!("{CALLBACK_PATH}?code=one-time-code&state={STATE}"),
                STATE,
            )
            .unwrap(),
            OAuthLoopbackResult {
                code: Some("one-time-code".into()),
                error: None,
            }
        );
        assert_eq!(
            parse_callback_target(
                &format!("{CALLBACK_PATH}?error=oauth_access_denied&state={STATE}"),
                STATE,
            )
            .unwrap(),
            OAuthLoopbackResult {
                code: None,
                error: Some("oauth_access_denied".into()),
            }
        );
    }

    #[test]
    fn callback_parser_rejects_wrong_path_state_and_ambiguous_payload() {
        assert_eq!(
            parse_callback_target(&format!("/favicon.ico?state={STATE}"), STATE)
                .unwrap_err()
                .code,
            "invalid_oauth_callback"
        );
        assert_eq!(
            parse_callback_target(
                &format!("{CALLBACK_PATH}?code=code&state=wrong-state-value"),
                STATE,
            )
            .unwrap_err()
            .code,
            "oauth_state_mismatch"
        );
        assert!(parse_callback_target(
            &format!("{CALLBACK_PATH}?code=code&error=failed&state={STATE}"),
            STATE,
        )
        .is_err());
    }

    #[test]
    fn client_state_is_bounded_base64url() {
        assert!(valid_client_state(STATE));
        assert!(!valid_client_state("short"));
        assert!(!valid_client_state("0123456789abcdef+not-base64url"));
        assert!(!valid_client_state(&"a".repeat(257)));
    }

    #[test]
    fn device_identity_is_non_empty_and_bounded() {
        let info = account_device_info();
        assert!(!info.name.is_empty());
        assert!(info.name.chars().count() <= 64);
        assert!(matches!(info.platform, "windows" | "macos" | "unsupported"));
    }
}

// macOS command execution boundary. Runs on the engine consumer thread.

use super::{clipboard, input, window};
use crate::engine::audio::{audio_volume_action, AudioVolumeAction, AudioVolumeState};
use crate::engine::config::{Command, WindowOperation};
use crate::engine::runtime::GestureContext;
use crate::engine::types::Modifier;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSString, NSURL};

pub fn execute(
    command: &Command,
    modifier: Modifier,
    context: &GestureContext,
) -> Option<AudioVolumeState> {
    let result = match command {
        Command::DoNothing => Ok(None),
        Command::NodePlugin { .. } => Err("Script reached the native command dispatcher".into()),
        Command::HotKey { modifiers, keys } => {
            activate_best_effort(context);
            input::synthesize_key_combo(modifiers, keys).map(|_| None)
        }
        Command::SendText { text } => {
            activate_best_effort(context);
            input::try_type_text_with_sleeps(text).map(|_| None)
        }
        Command::TaskSwitcher => mission_control().map(|_| None),
        Command::WindowControl { operation } => {
            window::window_operation(*operation, context.native_window).map(|_| None)
        }
        Command::OpenFile { path } => open_file(path).map(|_| None),
        Command::GotoUrl { url } => normalize_goto_url(url)
            .and_then(|url| open_url(&url, None))
            .map(|_| None),
        Command::WebSearch {
            engine_url,
            browser,
            ..
        } => web_search(engine_url, browser.as_deref(), context).map(|_| None),
        Command::AudioVolume { delta } => audio_volume(modifier, *delta).map(Some),
        Command::Cmd {
            code,
            show_window,
            auto_set_working_dir,
        } => run_command(code, *show_window, *auto_set_working_dir, context).map(|_| None),
        Command::PowerShell {
            code,
            show_window,
            auto_set_working_dir,
        } => run_powershell(code, *show_window, *auto_set_working_dir, context).map(|_| None),
    };
    match result {
        Ok(feedback) => feedback,
        Err(error) => {
            log::error!("macOS command {command:?} failed: {error}");
            None
        }
    }
}

fn activate_best_effort(context: &GestureContext) {
    if let Err(error) = window::activate_target(context.native_window) {
        log::debug!("macOS target activation skipped: {error}");
    }
}

fn mission_control() -> Result<(), String> {
    input::synthesize_key_combo(&["ctrl".into()], &["up".into()])
}

fn open_file(path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("file path is empty".into());
    }
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    NSWorkspace::sharedWorkspace()
        .openURL(&url)
        .then_some(())
        .ok_or_else(|| format!("NSWorkspace rejected file {path:?}"))
}

fn open_url(url: &str, browser: Option<&str>) -> Result<(), String> {
    if let Some(browser) = browser.map(str::trim).filter(|browser| !browser.is_empty()) {
        std::process::Command::new("/usr/bin/open")
            .arg("-a")
            .arg(browser)
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("open URL with {browser:?}: {error}"))
    } else {
        let url = NSURL::URLWithString(&NSString::from_str(url))
            .ok_or_else(|| "NSURL rejected URL".to_string())?;
        NSWorkspace::sharedWorkspace()
            .openURL(&url)
            .then_some(())
            .ok_or_else(|| "NSWorkspace rejected URL".into())
    }
}

#[derive(Debug, PartialEq, Eq)]
enum WebSearchPlan {
    NoOp,
    Open(String),
}

fn plan_web_search(engine_url: &str, selected_text: &str) -> Result<WebSearchPlan, String> {
    let query = selected_text.trim();
    if query.is_empty() {
        return Ok(WebSearchPlan::NoOp);
    }
    if is_absolute_uri(query) {
        return Ok(WebSearchPlan::Open(query.to_string()));
    }
    let query: String = query.chars().take(100).collect();
    let url = engine_url.trim().replace("{0}", &url_encode(&query));
    if !is_absolute_uri(&url) {
        return Err("search engine URL is not an absolute URI".into());
    }
    Ok(WebSearchPlan::Open(url))
}

fn web_search(
    engine_url: &str,
    browser: Option<&str>,
    context: &GestureContext,
) -> Result<(), String> {
    activate_best_effort(context);
    let Some(query) = clipboard::get_selected_text() else {
        return Ok(());
    };
    match plan_web_search(engine_url, &query)? {
        WebSearchPlan::NoOp => Ok(()),
        WebSearchPlan::Open(url) => open_url(&url, browser),
    }
}

fn audio_volume(modifier: Modifier, delta: i32) -> Result<AudioVolumeState, String> {
    let mutation = match audio_volume_action(modifier, delta) {
        AudioVolumeAction::Mute => concat!(
            "set currentMuted to output muted of (get volume settings)\n",
            "set volume output muted (not currentMuted)"
        )
        .to_string(),
        AudioVolumeAction::Up(points) => format!(
            "set currentVolume to output volume of (get volume settings)\nset volume output volume (currentVolume + {points})"
        ),
        AudioVolumeAction::Down(points) => format!(
            "set currentVolume to output volume of (get volume settings)\nset volume output volume (currentVolume - {points})"
        ),
    };
    let script = format!(
        "{mutation}\nset finalSettings to get volume settings\nreturn ((output volume of finalSettings) as text) & \"|\" & ((output muted of finalSettings) as text)"
    );
    let output = std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("launch volume AppleScript: {error}"))?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_volume_state_output(&stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("volume AppleScript failed: {}", stderr.trim()))
    }
}

fn parse_volume_state_output(output: &str) -> Result<AudioVolumeState, String> {
    let output = output.trim();
    if output.is_empty() {
        return Err("volume AppleScript returned empty output".into());
    }

    let fields = output.split('|').collect::<Vec<_>>();
    if fields.len() != 2 {
        return Err("volume AppleScript returned malformed state".into());
    }

    let volume = fields[0]
        .trim()
        .parse::<u16>()
        .map_err(|_| "volume AppleScript returned an invalid volume".to_string())?;
    if volume > 100 {
        return Err("volume AppleScript returned an out-of-range volume".into());
    }

    let muted = match fields[1].trim() {
        "true" => true,
        "false" => false,
        _ => return Err("volume AppleScript returned an invalid mute state".into()),
    };

    Ok(if muted {
        AudioVolumeState::Muted
    } else {
        AudioVolumeState::Percent(volume as u8)
    })
}

fn run_command(
    code: &str,
    show_window: bool,
    auto_set_working_dir: bool,
    context: &GestureContext,
) -> Result<(), String> {
    let code = code.trim();
    if code.is_empty() {
        return Ok(());
    }
    activate_best_effort(context);
    let selected = if code.contains("WG_SELECTED_TEXT") {
        clipboard::get_selected_text().unwrap_or_default()
    } else {
        String::new()
    };
    let target = window::target_for_token(context.native_window).ok();
    let mut environment = vec![
        ("WG_MOUSE_X", context.origin.x.to_string()),
        ("WG_MOUSE_Y", context.origin.y.to_string()),
        ("WG_STARTPOINT_X", context.origin.x.to_string()),
        ("WG_STARTPOINT_Y", context.origin.y.to_string()),
        ("WG_ENDPOINT_X", context.endpoint.x.to_string()),
        ("WG_ENDPOINT_Y", context.endpoint.y.to_string()),
        ("WG_SELECTED_TEXT", selected),
        (
            "WG_WINID",
            target.map_or(0, |target| target.window_id).to_string(),
        ),
    ];
    if let Some(target) = target {
        environment.push(("WG_PROCID", target.pid.to_string()));
    }

    if show_window {
        let exports = environment
            .iter()
            .map(|(key, value)| format!("export {key}={};", shell_quote(value)))
            .collect::<Vec<_>>()
            .join(" ");
        let terminal_code = format!("{exports} {code}");
        let script = concat!(
            "on run argv\n",
            "tell application \"Terminal\"\n",
            "activate\n",
            "do script \"/bin/zsh -lc \" & quoted form of (item 1 of argv)\n",
            "end tell\n",
            "end run"
        );
        std::process::Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .arg(&terminal_code)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("launch Terminal command: {error}"))
    } else {
        let mut command = std::process::Command::new("/bin/zsh");
        command.arg("-lc").arg(code);
        for (key, value) in environment {
            command.env(key, value);
        }
        if auto_set_working_dir {
            if let Some(directory) = desktop_directory() {
                command.current_dir(directory);
            }
        }
        command
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("launch zsh command: {error}"))
    }
}

fn run_powershell(
    code: &str,
    show_window: bool,
    auto_set_working_dir: bool,
    context: &GestureContext,
) -> Result<(), String> {
    let code = code.trim();
    if code.is_empty() {
        return Ok(());
    }
    activate_best_effort(context);
    let selected = if code.contains("WG_SELECTED_TEXT") {
        clipboard::get_selected_text().unwrap_or_default()
    } else {
        String::new()
    };
    let target = window::target_for_token(context.native_window).ok();
    let mut environment = vec![
        ("WG_MOUSE_X", context.origin.x.to_string()),
        ("WG_MOUSE_Y", context.origin.y.to_string()),
        ("WG_STARTPOINT_X", context.origin.x.to_string()),
        ("WG_STARTPOINT_Y", context.origin.y.to_string()),
        ("WG_ENDPOINT_X", context.endpoint.x.to_string()),
        ("WG_ENDPOINT_Y", context.endpoint.y.to_string()),
        ("WG_SELECTED_TEXT", selected),
        (
            "WG_WINID",
            target.map_or(0, |target| target.window_id).to_string(),
        ),
    ];
    if let Some(target) = target {
        environment.push(("WG_PROCID", target.pid.to_string()));
    }
    let executable = powershell_executable();
    if show_window {
        let exports = environment
            .iter()
            .map(|(key, value)| format!("export {key}={};", shell_quote(value)))
            .collect::<Vec<_>>()
            .join(" ");
        let terminal_code = format!(
            "{exports} {} -NoProfile -NoExit -Command {}",
            shell_quote(&executable),
            shell_quote(code)
        );
        let script = concat!(
            "on run argv\n",
            "tell application \"Terminal\"\n",
            "activate\n",
            "do script \"/bin/zsh -lc \" & quoted form of (item 1 of argv)\n",
            "end tell\n",
            "end run"
        );
        return std::process::Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .arg(&terminal_code)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("launch Terminal PowerShell command: {error}"));
    }
    let mut command = std::process::Command::new(executable);
    command.arg("-NoProfile").arg("-Command").arg(code);
    for (key, value) in environment {
        command.env(key, value);
    }
    if auto_set_working_dir {
        if let Some(directory) = desktop_directory() {
            command.current_dir(directory);
        }
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("launch PowerShell: {error}"))
}

fn powershell_executable() -> String {
    if let Some(value) = std::env::var_os("GODGESTURE_POWERSHELL").filter(|value| !value.is_empty())
    {
        return value.to_string_lossy().into_owned();
    }
    for candidate in ["/opt/homebrew/bin/pwsh", "/usr/local/bin/pwsh"] {
        if std::path::Path::new(candidate).is_file() {
            return candidate.into();
        }
    }
    "pwsh".into()
}

fn desktop_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|home| home.join("Desktop"))
        .filter(|path| path.is_dir())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn normalize_goto_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL is empty".into());
    }
    if is_absolute_uri(url) {
        Ok(url.to_string())
    } else if has_uri_scheme_syntax(url) {
        Err("URL scheme or authority is invalid".into())
    } else {
        let normalized = format!("http://{url}");
        is_absolute_uri(&normalized)
            .then_some(normalized)
            .ok_or_else(|| "URL contains invalid characters".into())
    }
}

fn is_absolute_uri(value: &str) -> bool {
    if value.is_empty()
        || value != value.trim()
        || value.chars().any(|character| {
            character.is_control()
                || character.is_whitespace()
                || matches!(
                    character,
                    '"' | '<' | '>' | '\\' | '^' | '`' | '{' | '|' | '}'
                )
        })
    {
        return false;
    }
    let Some((scheme, remainder)) = value.split_once(':') else {
        return false;
    };
    if !has_uri_scheme_syntax(value) {
        return false;
    }
    if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
        let Some(hierarchical) = remainder.strip_prefix("//") else {
            return false;
        };
        return hierarchical
            .split(['/', '?', '#'])
            .next()
            .is_some_and(|authority| !authority.is_empty());
    }
    true
}

fn has_uri_scheme_syntax(value: &str) -> bool {
    let Some((scheme, remainder)) = value.split_once(':') else {
        return false;
    };
    if remainder.is_empty() {
        return false;
    }
    let mut characters = scheme.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
        })
        && !looks_like_host_port(scheme, remainder)
}

fn looks_like_host_port(prefix: &str, remainder: &str) -> bool {
    let numeric_port = remainder
        .split(['/', '?', '#'])
        .next()
        .is_some_and(|port| !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()));
    numeric_port && (prefix.eq_ignore_ascii_case("localhost") || prefix.contains('.'))
}

fn url_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

pub(crate) fn window_control_for_script(
    operation: WindowOperation,
    context: &GestureContext,
) -> Result<(), String> {
    window::window_operation(operation, context.native_window)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::audio::AudioVolumeState;

    #[test]
    fn parses_final_macos_volume_state() {
        assert_eq!(
            parse_volume_state_output("42|false\n").unwrap(),
            AudioVolumeState::Percent(42)
        );
        assert_eq!(
            parse_volume_state_output("0|true\n").unwrap(),
            AudioVolumeState::Muted
        );
        assert!(parse_volume_state_output("not-a-state").is_err());
        assert!(parse_volume_state_output("101|false").is_err());
        assert!(parse_volume_state_output("").is_err());
        assert!(parse_volume_state_output("42|maybe").is_err());
        assert!(parse_volume_state_output("42|false|extra").is_err());
    }

    #[test]
    fn non_audio_commands_return_no_feedback_at_execute_boundary() {
        assert_eq!(
            execute(
                &Command::DoNothing,
                Modifier::None,
                &GestureContext::default()
            ),
            None
        );
    }

    #[test]
    fn goto_url_adds_http_only_when_no_scheme_exists() {
        assert_eq!(
            normalize_goto_url("example.com").unwrap(),
            "http://example.com"
        );
        assert_eq!(
            normalize_goto_url("https://example.com/a").unwrap(),
            "https://example.com/a"
        );
        assert!(normalize_goto_url("http:/broken").is_err());
    }

    #[test]
    fn web_search_encodes_and_limits_query() {
        assert_eq!(
            plan_web_search("https://search.test/?q={0}", "rust + macOS").unwrap(),
            WebSearchPlan::Open("https://search.test/?q=rust%20%2B%20macOS".into())
        );
    }

    #[test]
    fn shell_quote_preserves_single_quotes() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }
}

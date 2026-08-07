// CoreGraphics input synthesis with event-tap re-entry tagging.

use super::keys;
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use objc2_core_foundation::CGPoint;
use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation,
    CGEventType, CGMouseButton, CGScrollEventUnit,
};

pub(crate) const SYNTHETIC_EVENT_MARKER: i64 = 0x4747_4d41_434f_5301;

fn event_source() -> Result<objc2_core_foundation::CFRetained<CGEventSource>, String> {
    CGEventSource::new(CGEventSourceStateID::Private)
        .ok_or_else(|| "create CGEventSource".to_string())
}

fn tag(event: &CGEvent) {
    CGEvent::set_integer_value_field(
        Some(event),
        CGEventField::EventSourceUserData,
        SYNTHETIC_EVENT_MARKER,
    );
}

fn post(event: &CGEvent) {
    CGEvent::post(CGEventTapLocation::HIDEventTap, Some(event));
}

fn cg_button(button: MouseButton) -> CGMouseButton {
    match button {
        MouseButton::Left => CGMouseButton::Left,
        MouseButton::Right => CGMouseButton::Right,
        MouseButton::Middle => CGMouseButton::Center,
        MouseButton::X1 => CGMouseButton(3),
        MouseButton::X2 => CGMouseButton(4),
    }
}

fn mouse_event_type(button: MouseButton, down: bool) -> CGEventType {
    match (button, down) {
        (MouseButton::Left, true) => CGEventType::LeftMouseDown,
        (MouseButton::Left, false) => CGEventType::LeftMouseUp,
        (MouseButton::Right, true) => CGEventType::RightMouseDown,
        (MouseButton::Right, false) => CGEventType::RightMouseUp,
        (_, true) => CGEventType::OtherMouseDown,
        (_, false) => CGEventType::OtherMouseUp,
    }
}

pub fn current_pointer() -> Result<Point, String> {
    let event = CGEvent::new(None).ok_or_else(|| "create pointer query event".to_string())?;
    let point = CGEvent::location(Some(&event));
    Ok(Point {
        x: point.x.round() as i32,
        y: point.y.round() as i32,
    })
}

fn post_button(button: MouseButton, down: bool, pos: Point) -> Result<(), String> {
    let source = event_source()?;
    let event = CGEvent::new_mouse_event(
        Some(&source),
        mouse_event_type(button, down),
        CGPoint::new(pos.x as f64, pos.y as f64),
        cg_button(button),
    )
    .ok_or_else(|| "create mouse CGEvent".to_string())?;
    tag(&event);
    post(&event);
    Ok(())
}

pub fn synthesize_down(button: MouseButton, pos: Point) -> Result<(), String> {
    post_button(button, true, pos)
}

pub fn synthesize_button(button: MouseButton, down: bool) -> Result<(), String> {
    post_button(button, down, current_pointer()?)
}

pub fn synthesize_click(button: MouseButton, pos: Point) -> Result<(), String> {
    post_button(button, true, pos)?;
    post_button(button, false, pos)
}

pub fn synthesize_click_at_pointer(button: MouseButton) -> Result<(), String> {
    synthesize_click(button, current_pointer()?)
}

pub fn move_pointer(pos: Point) -> Result<(), String> {
    let source = event_source()?;
    let event = CGEvent::new_mouse_event(
        Some(&source),
        CGEventType::MouseMoved,
        CGPoint::new(pos.x as f64, pos.y as f64),
        CGMouseButton::Left,
    )
    .ok_or_else(|| "create pointer-move CGEvent".to_string())?;
    tag(&event);
    post(&event);
    Ok(())
}

pub fn wheel(delta: i32) -> Result<(), String> {
    if delta == 0 || !(-12_000..=12_000).contains(&delta) {
        return Err("wheel delta must be between -12000 and 12000 and non-zero".into());
    }
    let source = event_source()?;
    let lines = if delta.abs() >= 120 {
        delta / 120
    } else {
        delta.signum()
    };
    let event =
        CGEvent::new_scroll_wheel_event2(Some(&source), CGScrollEventUnit::Line, 1, lines, 0, 0)
            .ok_or_else(|| "create scroll-wheel CGEvent".to_string())?;
    tag(&event);
    post(&event);
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct KeyEventSpec {
    code: u16,
    down: bool,
    flags: CGEventFlags,
}

fn resolve_key_names(
    names: &[String],
    role: &str,
    expect_modifier: bool,
) -> Result<Vec<keys::Key>, String> {
    names
        .iter()
        .map(|name| {
            if keys::is_modifier_name(name) != expect_modifier {
                return Err(format!("{role} contains a misplaced key name: {name:?}"));
            }
            keys::name_to_key(name)
                .ok_or_else(|| format!("{role} contains an unsupported key name: {name:?}"))
        })
        .collect()
}

fn post_key_specs(specs: &[KeyEventSpec]) -> Result<(), String> {
    let source = event_source()?;
    let mut events = Vec::with_capacity(specs.len());
    for spec in specs {
        let event = CGEvent::new_keyboard_event(Some(&source), spec.code, spec.down)
            .ok_or_else(|| format!("create keyboard CGEvent for key code {}", spec.code))?;
        CGEvent::set_flags(Some(&event), spec.flags);
        tag(&event);
        events.push(event);
    }
    for event in events {
        post(&event);
    }
    Ok(())
}

pub fn synthesize_key_combo(modifiers: &[String], key_names: &[String]) -> Result<(), String> {
    let modifiers = resolve_key_names(modifiers, "modifier list", true)?;
    let key_names = resolve_key_names(key_names, "key list", false)?;
    let mut flags = CGEventFlags::empty();
    let mut specs = Vec::with_capacity((modifiers.len() + key_names.len()) * 2);

    for key in &modifiers {
        flags.insert(key.flag);
        specs.push(KeyEventSpec {
            code: key.code,
            down: true,
            flags,
        });
    }
    for key in &key_names {
        specs.push(KeyEventSpec {
            code: key.code,
            down: true,
            flags,
        });
    }
    for key in key_names.iter().rev() {
        specs.push(KeyEventSpec {
            code: key.code,
            down: false,
            flags,
        });
    }
    for key in modifiers.iter().rev() {
        flags.remove(key.flag);
        specs.push(KeyEventSpec {
            code: key.code,
            down: false,
            flags,
        });
    }
    post_key_specs(&specs)
}

pub fn tap_key(name: &str) -> Result<(), String> {
    synthesize_key_combo(&[], &[name.to_string()])
}

pub fn type_unicode(text: &str) -> Result<(), String> {
    let source = event_source()?;
    let mut events = Vec::with_capacity(text.chars().count() * 2);
    let mut encoded = [0_u16; 2];
    for character in text.chars() {
        let units = character.encode_utf16(&mut encoded);
        for down in [true, false] {
            let event = CGEvent::new_keyboard_event(Some(&source), 0, down)
                .ok_or_else(|| "create Unicode keyboard CGEvent".to_string())?;
            unsafe {
                CGEvent::keyboard_set_unicode_string(
                    Some(&event),
                    units.len() as u64,
                    units.as_ptr(),
                );
            }
            tag(&event);
            events.push(event);
        }
    }
    for event in events {
        post(&event);
    }
    Ok(())
}

pub fn type_text_with_sleeps(text: &str) {
    if let Err(error) = try_type_text_with_sleeps(text) {
        log::error!("SendText command failed: {error}");
    }
}

pub fn try_type_text_with_sleeps(text: &str) -> Result<(), String> {
    for action in parse_sequence_dsl(text)? {
        match action {
            SendTextAction::Text(text) => type_unicode(&text)?,
            SendTextAction::Key { modifiers, key } => synthesize_key_combo(&modifiers, &[key])?,
            SendTextAction::Sleep(milliseconds) => {
                std::thread::sleep(std::time::Duration::from_millis(milliseconds));
            }
        }
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum SendTextAction {
    Text(String),
    Key { modifiers: Vec<String>, key: String },
    Sleep(u64),
}

const MAX_SLEEP_MS: u64 = 10_000;

fn parse_sequence_dsl(source: &str) -> Result<Vec<SendTextAction>, String> {
    let mut actions = Vec::new();
    for (line_index, raw_line) in source.lines().enumerate() {
        let line_number = line_index + 1;
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let (keyword, argument) = line.split_once(' ').unwrap_or((line, ""));
        let argument = argument.trim();
        match keyword.to_ascii_lowercase().as_str() {
            "text" => actions.push(SendTextAction::Text(
                serde_json::from_str(argument)
                    .map_err(|_| format!("line {line_number}: text must be a JSON string"))?,
            )),
            "key" => actions.push(SendTextAction::Key {
                modifiers: Vec::new(),
                key: dsl_key(argument).ok_or_else(|| format!("line {line_number}: unknown key"))?,
            }),
            "hotkey" => {
                let parts = argument
                    .split('+')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                if parts.len() < 2 {
                    return Err(format!(
                        "line {line_number}: hotkey requires modifiers and a key"
                    ));
                }
                let key = dsl_key(parts[parts.len() - 1])
                    .ok_or_else(|| format!("line {line_number}: unknown key"))?;
                let modifiers = parts[..parts.len() - 1]
                    .iter()
                    .map(|part| dsl_modifier(part))
                    .collect::<Option<Vec<_>>>()
                    .ok_or_else(|| format!("line {line_number}: unknown modifier"))?;
                actions.push(SendTextAction::Key { modifiers, key });
            }
            "sleep" => {
                let milliseconds = argument
                    .parse::<u64>()
                    .map_err(|_| format!("line {line_number}: sleep requires milliseconds"))?;
                if milliseconds > MAX_SLEEP_MS {
                    return Err(format!(
                        "line {line_number}: sleep is limited to {MAX_SLEEP_MS} ms"
                    ));
                }
                actions.push(SendTextAction::Sleep(milliseconds));
            }
            _ => return Err(format!("line {line_number}: unknown statement")),
        }
    }
    Ok(actions)
}

fn dsl_modifier(value: &str) -> Option<String> {
    match value.to_ascii_lowercase().as_str() {
        "ctrl" => Some("ctrl".into()),
        "alt" => Some("alt".into()),
        "shift" => Some("shift".into()),
        "meta" | "cmd" => Some("command".into()),
        _ => None,
    }
}

fn dsl_key(value: &str) -> Option<String> {
    named_key(value).or_else(|| {
        let mut chars = value.chars();
        let ch = chars.next()?;
        if chars.next().is_none() {
            modified_char_key_name(ch)
        } else {
            None
        }
    })
}

fn named_key(token: &str) -> Option<String> {
    let upper = token.to_ascii_uppercase();
    let canonical = match upper.as_str() {
        "ENTER" => "enter",
        "TAB" => "tab",
        "ESC" | "ESCAPE" => "esc",
        "BACKSPACE" => "backspace",
        "DELETE" => "delete",
        "LEFT" => "left",
        "UP" => "up",
        "RIGHT" => "right",
        "DOWN" => "down",
        _ => {
            let suffix = upper.strip_prefix('F')?;
            let number = suffix.parse::<u8>().ok()?;
            if !(1..=20).contains(&number) || suffix != number.to_string() {
                return None;
            }
            return Some(format!("f{number}"));
        }
    };
    Some(canonical.to_string())
}

fn modified_char_key_name(character: char) -> Option<String> {
    let canonical = match character {
        'a'..='z' => return Some(character.to_string()),
        'A'..='Z' => return Some(character.to_ascii_lowercase().to_string()),
        '0'..='9' => return Some(character.to_string()),
        ' ' => "space",
        '-' => "minus",
        '=' => "equals",
        ',' => "comma",
        '.' => "period",
        '/' => "slash",
        ';' => "semicolon",
        '\'' => "quote",
        '[' => "bracketLeft",
        ']' => "bracketRight",
        '\\' => "backslash",
        '`' => "backquote",
        _ => return None,
    };
    Some(canonical.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extra_buttons_use_other_mouse_events() {
        assert_eq!(
            mouse_event_type(MouseButton::X1, true),
            CGEventType::OtherMouseDown
        );
        assert_eq!(cg_button(MouseButton::X2), CGMouseButton(4));
    }

    #[test]
    fn dsl_parser_builds_ordered_actions() {
        assert_eq!(
            parse_sequence_dsl(
                r#"text "before"
sleep 1
hotkey ctrl+c
hotkey alt+f4
text "after""#,
            )
            .unwrap(),
            [
                SendTextAction::Text("before".into()),
                SendTextAction::Sleep(1),
                SendTextAction::Key {
                    modifiers: vec!["ctrl".into()],
                    key: "c".into(),
                },
                SendTextAction::Key {
                    modifiers: vec!["alt".into()],
                    key: "f4".into(),
                },
                SendTextAction::Text("after".into()),
            ]
        );
    }

    #[test]
    fn dsl_syntax_errors_are_rejected_before_execution() {
        for source in ["text nope", "key UNKNOWN", "hotkey ctrl", "sleep 10001"] {
            assert!(
                parse_sequence_dsl(source).is_err(),
                "should reject {source:?}"
            );
        }
    }
}

// CoreGraphics input synthesis with event-tap re-entry tagging.

use super::keys;
use crate::engine::config::SendTextStep;
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
    for action in parse_send_keys(text)? {
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

pub fn try_type_text_steps(steps: &[SendTextStep]) -> Result<(), String> {
    for step in steps {
        match step {
            SendTextStep::Text { text } => type_unicode(text)?,
            SendTextStep::Key { modifiers, key } => {
                synthesize_key_combo(modifiers, std::slice::from_ref(key))?
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

enum BracedAtom {
    Text(char),
    Key(String),
    Sleep(u64),
}

struct SendKeysParser<'a> {
    source: &'a str,
    position: usize,
    actions: Vec<SendTextAction>,
}

fn parse_send_keys(source: &str) -> Result<Vec<SendTextAction>, String> {
    SendKeysParser {
        source,
        position: 0,
        actions: Vec::new(),
    }
    .parse()
}

impl SendKeysParser<'_> {
    fn parse(mut self) -> Result<Vec<SendTextAction>, String> {
        while let Some(character) = self.peek() {
            let modifiers = self.take_modifiers();
            if !modifiers.is_empty() {
                self.parse_modified_atom(modifiers)?;
                continue;
            }
            match character {
                '{' => match self.take_braced_atom()? {
                    BracedAtom::Text(character) => self.push_text(character),
                    BracedAtom::Key(key) => self.actions.push(SendTextAction::Key {
                        modifiers: Vec::new(),
                        key,
                    }),
                    BracedAtom::Sleep(milliseconds) => {
                        self.actions.push(SendTextAction::Sleep(milliseconds))
                    }
                },
                '}' => return Err(self.error("unescaped right brace; use {}}")),
                _ => {
                    self.take();
                    self.push_text(character);
                }
            }
        }
        Ok(self.actions)
    }

    fn parse_modified_atom(&mut self, modifiers: Vec<String>) -> Result<(), String> {
        let Some(character) = self.peek() else {
            return Err(self.error("modifier is missing a key"));
        };
        let key = if character == '{' {
            match self.take_braced_atom()? {
                BracedAtom::Key(key) => key,
                BracedAtom::Sleep(_) => return Err(self.error("sleep cannot have modifiers")),
                BracedAtom::Text(_) => {
                    return Err(self.error("escaped characters cannot have modifiers"))
                }
            }
        } else {
            if character == '}' {
                return Err(self.error("unescaped right brace; use {}}"));
            }
            self.take();
            modified_char_key_name(character).ok_or_else(|| {
                self.error(&format!("unsupported modified character {character:?}"))
            })?
        };
        self.actions.push(SendTextAction::Key { modifiers, key });
        Ok(())
    }

    fn take_modifiers(&mut self) -> Vec<String> {
        let mut modifiers = Vec::new();
        while let Some(character) = self.peek() {
            let modifier = match character {
                '^' => "ctrl",
                '%' => "alt",
                '+' => "shift",
                _ => break,
            };
            self.take();
            if !modifiers.iter().any(|existing| existing == modifier) {
                modifiers.push(modifier.to_string());
            }
        }
        modifiers
    }

    fn take_braced_atom(&mut self) -> Result<BracedAtom, String> {
        let rest = &self.source[self.position..];
        for (syntax, literal) in [
            ("{{}", '{'),
            ("{}}", '}'),
            ("{^}", '^'),
            ("{%}", '%'),
            ("{+}", '+'),
        ] {
            if rest.starts_with(syntax) {
                self.position += syntax.len();
                return Ok(BracedAtom::Text(literal));
            }
        }

        let token_start = self.position;
        self.take();
        let Some(end_offset) = self.source[self.position..].find('}') else {
            return Err(self.error_at(token_start, "unclosed named key or sleep token"));
        };
        let end = self.position + end_offset;
        let token = &self.source[self.position..end];
        self.position = end + 1;

        if token
            .get(.."sleep".len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("sleep"))
        {
            let digits = token["sleep".len()..].trim_start_matches(' ');
            if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(self.error_at(token_start, "sleep must contain milliseconds"));
            }
            let milliseconds = digits.bytes().fold(0_u64, |value, byte| {
                value
                    .saturating_mul(10)
                    .saturating_add((byte - b'0') as u64)
            });
            return Ok(BracedAtom::Sleep(milliseconds.min(MAX_SLEEP_MS)));
        }

        named_key(token)
            .map(BracedAtom::Key)
            .ok_or_else(|| self.error_at(token_start, &format!("unknown named key {{{token}}}")))
    }

    fn push_text(&mut self, character: char) {
        match self.actions.last_mut() {
            Some(SendTextAction::Text(text)) => text.push(character),
            _ => self
                .actions
                .push(SendTextAction::Text(character.to_string())),
        }
    }

    fn peek(&self) -> Option<char> {
        self.source[self.position..].chars().next()
    }

    fn take(&mut self) -> Option<char> {
        let character = self.peek()?;
        self.position += character.len_utf8();
        Some(character)
    }

    fn error(&self, message: &str) -> String {
        self.error_at(self.position, message)
    }

    fn error_at(&self, position: usize, message: &str) -> String {
        format!("SendKeys byte position {position}: {message}")
    }
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
    fn send_keys_parser_builds_ordered_actions() {
        assert_eq!(
            parse_send_keys("before{sleep1}^c%{F4}after").unwrap(),
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
    fn syntax_errors_are_rejected_before_execution() {
        for source in ["prefix{UNKNOWN}", "prefix{ENTER", "prefix}", "prefix^"] {
            assert!(parse_send_keys(source).is_err(), "should reject {source:?}");
        }
    }
}

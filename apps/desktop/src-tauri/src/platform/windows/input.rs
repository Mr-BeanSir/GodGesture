//! 输入合成 —— SendInput 封装。
//! 所有合成事件带 EXTRA_INFO_TAG,钩子据此放行,避免自反馈。
//! 右键合成尊重系统的主/副键交换设置(SM_SWAPBUTTON)。

use super::hook::EXTRA_INFO_TAG;
use super::keys;
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK,
    MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SetCursorPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_SWAPBUTTON,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

fn button_flags(button: MouseButton, down: bool) -> (MOUSE_EVENT_FLAGS, u32) {
    // 主/副键交换时,逻辑右键要发左键事件才能到达目标语义
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    match (button, swapped) {
        (MouseButton::Left, false) | (MouseButton::Right, true) => (
            if down {
                MOUSEEVENTF_LEFTDOWN
            } else {
                MOUSEEVENTF_LEFTUP
            },
            0,
        ),
        (MouseButton::Right, false) | (MouseButton::Left, true) => (
            if down {
                MOUSEEVENTF_RIGHTDOWN
            } else {
                MOUSEEVENTF_RIGHTUP
            },
            0,
        ),
        (MouseButton::Middle, _) => (
            if down {
                MOUSEEVENTF_MIDDLEDOWN
            } else {
                MOUSEEVENTF_MIDDLEUP
            },
            0,
        ),
        (MouseButton::X1, _) => (
            if down {
                MOUSEEVENTF_XDOWN
            } else {
                MOUSEEVENTF_XUP
            },
            1,
        ),
        (MouseButton::X2, _) => (
            if down {
                MOUSEEVENTF_XDOWN
            } else {
                MOUSEEVENTF_XUP
            },
            2,
        ),
    }
}

fn button_input(button: MouseButton, down: bool) -> INPUT {
    let (flags, xdata) = button_flags(button, down);
    let mut input = INPUT {
        r#type: INPUT_MOUSE,
        ..Default::default()
    };
    input.Anonymous.mi.dwFlags = flags;
    // 注意:SendInput 的 mouseData 直接取 XBUTTON1/XBUTTON2(不移位;
    // 高位移位是 WM_XBUTTON* 消息与钩子结构的编码方式)
    input.Anonymous.mi.mouseData = xdata;
    input.Anonymous.mi.dwExtraInfo = EXTRA_INFO_TAG;
    input
}

fn send_button(button: MouseButton, down: bool, _pos: Point) -> Result<(), String> {
    send_inputs(&[button_input(button, down)]).map_err(|error| error.to_string())
}

/// 合成一次按下(用于起始超时转普通拖拽)
pub fn synthesize_down(button: MouseButton, pos: Point) {
    if let Err(error) = send_button(button, true, pos) {
        log::error!("合成鼠标按下失败: {error}");
    }
}

/// 合成一次完整点击(down + up)
pub fn synthesize_click(button: MouseButton, pos: Point) {
    if let Err(error) = unsafe { SetCursorPos(pos.x, pos.y) } {
        log::warn!("无法在点击重放前恢复光标位置: {error}");
    }
    if let Err(error) = synthesize_click_checked(button) {
        log::error!("合成鼠标点击失败: {error}");
    }
}

pub fn synthesize_click_checked(button: MouseButton) -> Result<(), String> {
    let down = button_input(button, true);
    let up = button_input(button, false);
    match send_inputs(&[down, up]) {
        Ok(()) => Ok(()),
        Err(error) => {
            if error.inserted == 1 {
                let _ = send_inputs(&[up]);
            }
            Err(error.to_string())
        }
    }
}

/// Script host mouse button primitive. The current pointer location is used.
pub fn synthesize_button(button: MouseButton, down: bool) -> Result<(), String> {
    send_button(button, down, Point::default())
}

/// Move the pointer in virtual-screen physical coordinates with a tagged SendInput event.
pub fn move_pointer(pos: Point) -> Result<(), String> {
    let left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if width <= 1 || height <= 1 {
        return Err("virtual screen bounds are unavailable".into());
    }

    let normalize = |value: i32, start: i32, length: i32| -> i32 {
        let relative = (value as i64 - start as i64).clamp(0, length as i64 - 1);
        (relative * 65_535 / (length as i64 - 1)) as i32
    };
    let mut input = INPUT {
        r#type: INPUT_MOUSE,
        ..Default::default()
    };
    input.Anonymous.mi.dx = normalize(pos.x, left, width);
    input.Anonymous.mi.dy = normalize(pos.y, top, height);
    input.Anonymous.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    input.Anonymous.mi.dwExtraInfo = EXTRA_INFO_TAG;
    send_inputs(&[input]).map_err(|error| error.to_string())
}

/// Send a signed wheel delta. One standard wheel notch is 120.
pub fn wheel(delta: i32) -> Result<(), String> {
    if delta == 0 || !(-12_000..=12_000).contains(&delta) {
        return Err("wheel delta must be between -12000 and 12000 and non-zero".into());
    }
    let mut input = INPUT {
        r#type: INPUT_MOUSE,
        ..Default::default()
    };
    input.Anonymous.mi.mouseData = delta as u32;
    input.Anonymous.mi.dwFlags = MOUSEEVENTF_WHEEL;
    input.Anonymous.mi.dwExtraInfo = EXTRA_INFO_TAG;
    send_inputs(&[input]).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// 键盘合成(hotKey / sendText 命令)
// ---------------------------------------------------------------------------

fn vk_input(vk: VIRTUAL_KEY, down: bool) -> INPUT {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if keys::is_extended(vk) {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if !down {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: EXTRA_INFO_TAG,
            },
        },
    }
}

fn unicode_input(unit: u16, down: bool) -> INPUT {
    let mut flags = KEYEVENTF_UNICODE;
    if !down {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: unit,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: EXTRA_INFO_TAG,
            },
        },
    }
}

#[derive(Debug, PartialEq, Eq)]
struct SendInputShortWrite {
    inserted: usize,
    requested: usize,
}

impl std::fmt::Display for SendInputShortWrite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "SendInput 短写: 仅插入 {}/{} 个输入事件",
            self.inserted, self.requested
        )
    }
}

fn send_inputs(inputs: &[INPUT]) -> Result<(), SendInputShortWrite> {
    if inputs.is_empty() {
        return Ok(());
    }
    let inserted = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) } as usize;
    if inserted == inputs.len() {
        Ok(())
    } else {
        let error = SendInputShortWrite {
            inserted,
            requested: inputs.len(),
        };
        // SendInput 被 UIPI 拦截时不保证 GetLastError 有有效值,因此以返回条数
        // 作为唯一可靠证据,避免在日志中附上过期的 Win32 错误。
        log::error!("{error}");
        Err(error)
    }
}

type KeyTransition = (VIRTUAL_KEY, bool);

/// SendInput 返回的是已插入的有序前缀长度。重放该前缀的 down/up 状态，找出
/// 仍可能按下的所有虚拟键，而不只修饰键；恢复顺序与按下顺序相反。
fn key_releases_after_prefix(transitions: &[KeyTransition], inserted: usize) -> Vec<VIRTUAL_KEY> {
    let mut pressed = Vec::new();
    for &(vk, down) in transitions.iter().take(inserted) {
        if down {
            pressed.push(vk);
        } else if let Some(index) = pressed.iter().rposition(|pressed_vk| *pressed_vk == vk) {
            pressed.remove(index);
        }
    }
    pressed.reverse();
    pressed
}

fn recover_pressed_keys(transitions: &[KeyTransition], inserted: usize) {
    let releases = key_releases_after_prefix(transitions, inserted);
    if releases.is_empty() {
        return;
    }
    log::warn!(
        "SendInput 短写后尝试逆序释放 {} 个已按下的键",
        releases.len()
    );
    // 分开补发,避免恢复批次自身再次短写时,前一个失败阻断
    // 后续按键的释放尝试。每个失败仍由 send_inputs 明确记录。
    for vk in releases {
        let _ = send_inputs(&[vk_input(vk, false)]);
    }
}

fn push_vk_transition(
    inputs: &mut Vec<INPUT>,
    transitions: &mut Vec<KeyTransition>,
    vk: VIRTUAL_KEY,
    down: bool,
) {
    inputs.push(vk_input(vk, down));
    transitions.push((vk, down));
}

fn resolve_key_names(
    names: &[String],
    role: &str,
    expect_modifier: bool,
) -> Result<Vec<VIRTUAL_KEY>, String> {
    names
        .iter()
        .map(|name| {
            if keys::is_modifier_name(name) != expect_modifier {
                let message = format!("{role}包含类型错位的键名: {name:?}");
                log::error!("拒绝执行 HotKey 命令: {message}");
                return Err(message);
            }
            keys::name_to_vk(name).ok_or_else(|| {
                let message = format!("{role}包含未知 canonical 键名: {name:?}");
                log::error!("拒绝执行 HotKey 命令: {message}");
                message
            })
        })
        .collect()
}

/// 合成一次组合键:按住所有修饰键 → 依次按下/抬起主键 → 逆序释放修饰键。
/// modifiers/keys 用 shared canonical 键名;任一未知值都会让整条命令失败并记录日志,
/// 禁止部分执行(例如静默丢掉主键却仍按下修饰键)。
pub fn synthesize_key_combo(modifiers: &[String], keys: &[String]) -> Result<(), String> {
    let mod_vks = resolve_key_names(modifiers, "修饰键", true)?;
    let key_vks = resolve_key_names(keys, "主键", false)?;
    if key_vks.is_empty() && mod_vks.is_empty() {
        return Ok(());
    }

    let mut inputs: Vec<INPUT> = Vec::new();
    let mut transitions = Vec::new();
    for &m in &mod_vks {
        push_vk_transition(&mut inputs, &mut transitions, m, true);
    }
    // 主键按顺序按下,再逆序抬起(支持如 Ctrl+K Ctrl+C 之外的同时组合)
    for &k in &key_vks {
        push_vk_transition(&mut inputs, &mut transitions, k, true);
    }
    for &k in key_vks.iter().rev() {
        push_vk_transition(&mut inputs, &mut transitions, k, false);
    }
    for &m in mod_vks.iter().rev() {
        push_vk_transition(&mut inputs, &mut transitions, m, false);
    }
    match send_inputs(&inputs) {
        Ok(()) => Ok(()),
        Err(error) => {
            recover_pressed_keys(&transitions, error.inserted);
            Err(error.to_string())
        }
    }
}

/// 敲一个虚拟键(down+up),用于音量键、任务切换等。
pub fn tap_vk(vk: VIRTUAL_KEY) {
    let transitions = [(vk, true), (vk, false)];
    let inputs = [vk_input(vk, true), vk_input(vk, false)];
    if let Err(error) = send_inputs(&inputs) {
        recover_pressed_keys(&transitions, error.inserted);
    }
}

/// 按住若干修饰键并敲一个主键(如 Win+Tab)
pub fn tap_with_modifiers(mods: &[VIRTUAL_KEY], key: VIRTUAL_KEY) {
    let mut inputs = Vec::new();
    let mut transitions = Vec::new();
    for &m in mods {
        push_vk_transition(&mut inputs, &mut transitions, m, true);
    }
    push_vk_transition(&mut inputs, &mut transitions, key, true);
    push_vk_transition(&mut inputs, &mut transitions, key, false);
    for &m in mods.iter().rev() {
        push_vk_transition(&mut inputs, &mut transitions, m, false);
    }
    if let Err(error) = send_inputs(&inputs) {
        recover_pressed_keys(&transitions, error.inserted);
    }
}

/// 输入 v8 按键/文字 DSL。必须先完整解析成功才执行，避免在尾部语法错误时已经输入前缀。
pub fn type_text_with_sleeps(text: &str) {
    if let Err(error) = try_type_text_with_sleeps(text) {
        log::error!("SendText 命令执行失败，已停止剩余序列: {error}");
    }
}

pub fn try_type_text_with_sleeps(text: &str) -> Result<(), String> {
    let actions = parse_sequence_dsl(text)?;
    for action in actions {
        let result = match action {
            SendTextAction::Text(text) => type_text(&text),
            SendTextAction::Key { modifiers, key } => synthesize_key_combo(&modifiers, &[key]),
            SendTextAction::Sleep(ms) => {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                Ok(())
            }
        };
        result?;
    }
    Ok(())
}

fn type_text(text: &str) -> Result<(), String> {
    let mut inputs: Vec<INPUT> = Vec::with_capacity(text.len() * 2);
    let mut transitions = Vec::with_capacity(text.len() * 2);
    let mut buf = [0u16; 2];
    for ch in text.chars() {
        for unit in ch.encode_utf16(&mut buf) {
            inputs.push(unicode_input(*unit, true));
            transitions.push((*unit, true));
            inputs.push(unicode_input(*unit, false));
            transitions.push((*unit, false));
        }
    }
    match send_inputs(&inputs) {
        Ok(()) => Ok(()),
        Err(error) => {
            recover_unicode_units(&transitions, error.inserted);
            Err(error.to_string())
        }
    }
}

fn recover_unicode_units(transitions: &[(u16, bool)], inserted: usize) {
    for unit in unicode_releases_after_prefix(transitions, inserted) {
        let _ = send_inputs(&[unicode_input(unit, false)]);
    }
}

fn unicode_releases_after_prefix(transitions: &[(u16, bool)], inserted: usize) -> Vec<u16> {
    let mut pressed = Vec::new();
    for &(unit, down) in transitions.iter().take(inserted) {
        if down {
            pressed.push(unit);
        } else if let Some(index) = pressed
            .iter()
            .rposition(|pressed_unit| *pressed_unit == unit)
        {
            pressed.remove(index);
        }
    }
    pressed.reverse();
    pressed
}

#[derive(Debug, PartialEq, Eq)]
enum SendTextAction {
    Text(String),
    Key { modifiers: Vec<String>, key: String },
    Sleep(u64),
}

/// 单个 sleep 语句的最大生效时长
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
            "text" => {
                let text: String = serde_json::from_str(argument)
                    .map_err(|_| format!("Line {line_number}: text must be a JSON string"))?;
                actions.push(SendTextAction::Text(text));
            }
            "key" => actions.push(SendTextAction::Key {
                modifiers: Vec::new(),
                key: dsl_key(argument).ok_or_else(|| format!("Line {line_number}: unknown key"))?,
            }),
            "hotkey" => {
                let parts = argument
                    .split('+')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                if parts.len() < 2 {
                    return Err(format!(
                        "Line {line_number}: hotkey requires modifiers and a key"
                    ));
                }
                let key = dsl_key(parts[parts.len() - 1])
                    .ok_or_else(|| format!("Line {line_number}: unknown key"))?;
                let modifiers = parts[..parts.len() - 1]
                    .iter()
                    .map(|part| dsl_modifier(part))
                    .collect::<Option<Vec<_>>>()
                    .ok_or_else(|| format!("Line {line_number}: unknown modifier"))?;
                actions.push(SendTextAction::Key { modifiers, key });
            }
            "sleep" => {
                let milliseconds = argument
                    .parse::<u64>()
                    .map_err(|_| format!("Line {line_number}: sleep requires milliseconds"))?;
                if milliseconds > MAX_SLEEP_MS {
                    return Err(format!(
                        "Line {line_number}: sleep is limited to {MAX_SLEEP_MS} ms"
                    ));
                }
                actions.push(SendTextAction::Sleep(milliseconds));
            }
            _ => return Err(format!("Line {line_number}: unknown statement")),
        }
    }
    Ok(actions)
}

fn dsl_modifier(value: &str) -> Option<String> {
    match value.to_ascii_lowercase().as_str() {
        "ctrl" => Some("ctrl".into()),
        "alt" => Some("alt".into()),
        "shift" => Some("shift".into()),
        "meta" | "win" | "cmd" => Some("win".into()),
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
            if !(1..=24).contains(&number) || suffix != number.to_string() {
                return None;
            }
            return Some(format!("f{number}"));
        }
    };
    Some(canonical.to_string())
}

fn modified_char_key_name(ch: char) -> Option<String> {
    let canonical = match ch {
        'a'..='z' => return Some(ch.to_string()),
        'A'..='Z' => return Some(ch.to_ascii_lowercase().to_string()),
        '0'..='9' => return Some(ch.to_string()),
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

    const CTRL: VIRTUAL_KEY = VIRTUAL_KEY(1);
    const ALT: VIRTUAL_KEY = VIRTUAL_KEY(2);
    const META: VIRTUAL_KEY = VIRTUAL_KEY(3);

    #[test]
    fn short_write_during_key_down_releases_only_inserted_prefix() {
        let transitions = [
            (CTRL, true),
            (ALT, true),
            (META, true),
            (VIRTUAL_KEY(4), true),
            (VIRTUAL_KEY(4), false),
            (META, false),
            (ALT, false),
            (CTRL, false),
        ];

        assert_eq!(key_releases_after_prefix(&transitions, 0), []);
        assert_eq!(key_releases_after_prefix(&transitions, 2), [ALT, CTRL]);
        assert_eq!(
            key_releases_after_prefix(&transitions, 4),
            [VIRTUAL_KEY(4), META, ALT, CTRL]
        );
    }

    #[test]
    fn short_write_during_main_keys_releases_every_unmatched_down() {
        let transitions = [
            (CTRL, true),
            (ALT, true),
            (VIRTUAL_KEY(4), true),
            (VIRTUAL_KEY(5), true),
            (VIRTUAL_KEY(5), false),
        ];
        assert_eq!(
            key_releases_after_prefix(&transitions, transitions.len()),
            [VIRTUAL_KEY(4), ALT, CTRL]
        );
    }

    #[test]
    fn short_write_during_modifier_up_skips_already_released_suffix() {
        let transitions = [
            (CTRL, true),
            (ALT, true),
            (META, true),
            (VIRTUAL_KEY(4), true),
            (VIRTUAL_KEY(4), false),
            (META, false),
        ];
        assert_eq!(
            key_releases_after_prefix(&transitions, transitions.len()),
            [ALT, CTRL]
        );
    }

    #[test]
    fn complete_batch_needs_no_key_recovery() {
        let transitions = [
            (CTRL, true),
            (VIRTUAL_KEY(4), true),
            (VIRTUAL_KEY(4), false),
            (CTRL, false),
        ];
        assert_eq!(
            key_releases_after_prefix(&transitions, transitions.len()),
            []
        );
    }

    #[test]
    fn unknown_key_rejects_the_whole_combo() {
        let names = vec!["c".to_string(), "not-a-real-key".to_string()];
        let error = resolve_key_names(&names, "主键", false).unwrap_err();
        assert!(error.contains("not-a-real-key"));
    }

    #[test]
    fn misplaced_modifier_rejects_the_whole_combo() {
        let error = resolve_key_names(&["ctrl".to_string()], "主键", false).unwrap_err();
        assert!(error.contains("类型错位"));
    }

    fn send_key(modifiers: &[&str], key: &str) -> SendTextAction {
        SendTextAction::Key {
            modifiers: modifiers
                .iter()
                .map(|modifier| modifier.to_string())
                .collect(),
            key: key.to_string(),
        }
    }

    #[test]
    fn dsl_parser_builds_the_complete_ordered_sequence() {
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
                SendTextAction::Text("before".to_string()),
                SendTextAction::Sleep(1),
                send_key(&["ctrl"], "c"),
                send_key(&["alt"], "f4"),
                SendTextAction::Text("after".to_string()),
            ]
        );
    }

    #[test]
    fn dsl_parser_keeps_escaped_unicode_as_text() {
        assert_eq!(
            parse_sequence_dsl(r#"text "Hello 世界\r\n""#).unwrap(),
            [SendTextAction::Text("Hello 世界\r\n".to_string())]
        );
    }

    #[test]
    fn dsl_parser_supports_named_keys_case_insensitively() {
        assert_eq!(
            parse_sequence_dsl(
                "key ENTER\nkey tab\nkey Esc\nkey BACKSPACE\nkey delete\nkey LEFT\nkey UP\nkey RIGHT\nkey DOWN\nkey F1\nkey f12\nkey F24",
            )
            .unwrap(),
            [
                send_key(&[], "enter"),
                send_key(&[], "tab"),
                send_key(&[], "esc"),
                send_key(&[], "backspace"),
                send_key(&[], "delete"),
                send_key(&[], "left"),
                send_key(&[], "up"),
                send_key(&[], "right"),
                send_key(&[], "down"),
                send_key(&[], "f1"),
                send_key(&[], "f12"),
                send_key(&[], "f24"),
            ]
        );
    }

    #[test]
    fn dsl_parser_supports_modifier_combinations() {
        assert_eq!(
            parse_sequence_dsl(
                "hotkey ctrl+c\nhotkey alt+f4\nhotkey shift+tab\nhotkey ctrl+shift+A"
            )
            .unwrap(),
            [
                send_key(&["ctrl"], "c"),
                send_key(&["alt"], "f4"),
                send_key(&["shift"], "tab"),
                send_key(&["ctrl", "shift"], "a"),
            ]
        );
    }

    #[test]
    fn dsl_parser_supports_json_text_escapes() {
        assert_eq!(
            parse_sequence_dsl(r#"text "{}^%+""#).unwrap(),
            [SendTextAction::Text("{}^%+".to_string())]
        );
    }

    #[test]
    fn dsl_sleep_is_case_insensitive_and_bounded() {
        assert_eq!(
            parse_sequence_dsl("sleep 0\nSLEEP 10\nsLeEp 20").unwrap(),
            [
                SendTextAction::Sleep(0),
                SendTextAction::Sleep(10),
                SendTextAction::Sleep(20),
            ]
        );
    }

    #[test]
    fn dsl_syntax_errors_reject_the_entire_sequence_before_execution() {
        for source in [
            "text nope",
            "key UNKNOWN",
            "hotkey ctrl",
            "sleep 10001",
            "unknown value",
        ] {
            assert!(
                parse_sequence_dsl(source).is_err(),
                "should reject {source:?}"
            );
        }
    }

    #[test]
    fn unicode_short_write_releases_only_unmatched_units_in_reverse() {
        let transitions = [
            (0x0041, true),
            (0x0041, false),
            (0xD83D, true),
            (0xDE00, true),
        ];
        assert_eq!(
            unicode_releases_after_prefix(&transitions, transitions.len()),
            [0xDE00, 0xD83D]
        );
    }
}

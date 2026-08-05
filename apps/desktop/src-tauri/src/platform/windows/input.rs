//! 输入合成 —— SendInput 封装。
//! 所有合成事件带 EXTRA_INFO_TAG,钩子据此放行,避免自反馈。
//! 右键合成尊重系统的主/副键交换设置(SM_SWAPBUTTON)。

use super::hook::EXTRA_INFO_TAG;
use super::keys;
use crate::engine::config::SendTextStep;
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

/// 输入 SendKeys 序列。必须先完整解析成功才执行，避免在尾部语法错误时已经输入前缀。
pub fn type_text_with_sleeps(text: &str) {
    if let Err(error) = try_type_text_with_sleeps(text) {
        log::error!("SendText 命令执行失败，已停止剩余序列: {error}");
    }
}

pub fn try_type_text_with_sleeps(text: &str) -> Result<(), String> {
    let actions = parse_send_keys(text)?;
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

/// Execute the structured text/key sequence. The sequence is parsed and
/// validated by the shared config schema before reaching this platform layer.
pub fn type_text_steps(steps: &[SendTextStep]) {
    if let Err(error) = try_type_text_steps(steps) {
        log::error!("结构化文字/按键序列执行失败，已停止剩余序列: {error}");
    }
}

pub fn try_type_text_steps(steps: &[SendTextStep]) -> Result<(), String> {
    for step in steps {
        match step {
            SendTextStep::Text { text } => type_text(text)?,
            SendTextStep::Key { modifiers, key } => {
                synthesize_key_combo(modifiers, std::slice::from_ref(key))?
            }
        }
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

/// 单个 `{sleep N}` 的最大生效时长
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
        while let Some(ch) = self.peek() {
            let modifiers = self.take_modifiers();
            if !modifiers.is_empty() {
                self.parse_modified_atom(modifiers)?;
                continue;
            }
            match ch {
                '{' => match self.take_braced_atom()? {
                    BracedAtom::Text(ch) => self.push_text(ch),
                    BracedAtom::Key(key) => self.actions.push(SendTextAction::Key {
                        modifiers: Vec::new(),
                        key,
                    }),
                    BracedAtom::Sleep(ms) => self.actions.push(SendTextAction::Sleep(ms)),
                },
                '}' => return Err(self.error("未转义的右花括号；请写成 {}}")),
                _ => {
                    self.take();
                    self.push_text(ch);
                }
            }
        }
        Ok(self.actions)
    }

    fn parse_modified_atom(&mut self, modifiers: Vec<String>) -> Result<(), String> {
        let Some(ch) = self.peek() else {
            return Err(self.error("修饰符后缺少按键"));
        };
        let key = if ch == '{' {
            match self.take_braced_atom()? {
                BracedAtom::Key(key) => key,
                BracedAtom::Sleep(_) => return Err(self.error("sleep 不能带键盘修饰符")),
                BracedAtom::Text(_) => return Err(self.error("转义字符不能带键盘修饰符")),
            }
        } else {
            if ch == '}' {
                return Err(self.error("未转义的右花括号；请写成 {}}"));
            }
            self.take();
            modified_char_key_name(ch)
                .ok_or_else(|| self.error(&format!("修饰符不支持作用于字符 {ch:?}")))?
        };
        self.actions.push(SendTextAction::Key { modifiers, key });
        Ok(())
    }

    fn take_modifiers(&mut self) -> Vec<String> {
        let mut modifiers = Vec::new();
        while let Some(ch) = self.peek() {
            let modifier = match ch {
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
        self.take(); // '{'
        let Some(end_offset) = self.source[self.position..].find('}') else {
            return Err(self.error_at(token_start, "未闭合的命名键或 sleep token"));
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
                return Err(
                    self.error_at(token_start, "sleep 必须写成 {sleep毫秒} 或 {sleep 毫秒}")
                );
            }
            let ms = digits.bytes().fold(0u64, |value, byte| {
                value
                    .saturating_mul(10)
                    .saturating_add((byte - b'0') as u64)
            });
            return Ok(BracedAtom::Sleep(ms.min(MAX_SLEEP_MS)));
        }

        named_key(token)
            .map(BracedAtom::Key)
            .ok_or_else(|| self.error_at(token_start, &format!("未知命名键 {{{token}}}")))
    }

    fn push_text(&mut self, ch: char) {
        match self.actions.last_mut() {
            Some(SendTextAction::Text(text)) => text.push(ch),
            _ => self.actions.push(SendTextAction::Text(ch.to_string())),
        }
    }

    fn peek(&self) -> Option<char> {
        self.source[self.position..].chars().next()
    }

    fn take(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.position += ch.len_utf8();
        Some(ch)
    }

    fn error(&self, message: &str) -> String {
        self.error_at(self.position, message)
    }

    fn error_at(&self, position: usize, message: &str) -> String {
        format!("SendKeys 字节位置 {position}: {message}")
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
    fn send_keys_parser_builds_the_complete_ordered_sequence() {
        assert_eq!(
            parse_send_keys("before{sleep1}^c%{F4}after").unwrap(),
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
    fn send_keys_parser_keeps_plain_unicode_as_text() {
        assert_eq!(
            parse_send_keys("Hello 世界\r\n").unwrap(),
            [SendTextAction::Text("Hello 世界\r\n".to_string())]
        );
    }

    #[test]
    fn send_keys_parser_supports_all_named_keys_case_insensitively() {
        let source = concat!(
            "{ENTER}{tab}{Esc}{BACKSPACE}{delete}",
            "{LEFT}{UP}{RIGHT}{DOWN}",
            "{F1}{f12}{F24}"
        );
        assert_eq!(
            parse_send_keys(source).unwrap(),
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
    fn send_keys_modifiers_apply_only_to_the_next_key() {
        assert_eq!(
            parse_send_keys("^c%{F4}+{TAB}^+A").unwrap(),
            [
                send_key(&["ctrl"], "c"),
                send_key(&["alt"], "f4"),
                send_key(&["shift"], "tab"),
                send_key(&["ctrl", "shift"], "a"),
            ]
        );
    }

    #[test]
    fn send_keys_parser_supports_reserved_character_escapes() {
        assert_eq!(
            parse_send_keys("{{}{}}{^}{%}{+}").unwrap(),
            [SendTextAction::Text("{}^%+".to_string())]
        );
    }

    #[test]
    fn sleep_is_case_insensitive_allows_zero_spaces_and_is_bounded() {
        assert_eq!(
            parse_send_keys(
                "{sleep0}{SLEEP10}{sLeEp 20}{sleep    999999999999999999999999999999999}"
            )
            .unwrap(),
            [
                SendTextAction::Sleep(0),
                SendTextAction::Sleep(10),
                SendTextAction::Sleep(20),
                SendTextAction::Sleep(MAX_SLEEP_MS),
            ]
        );
    }

    #[test]
    fn syntax_errors_reject_the_entire_sequence_before_execution() {
        for source in [
            "prefix{UNKNOWN}",
            "prefix{ENTER",
            "prefix}",
            "prefix^",
            "prefix{sleep}",
            "prefix{sleep nope}",
            "prefix{F25}",
            "prefix^{sleep 1}",
        ] {
            assert!(parse_send_keys(source).is_err(), "should reject {source:?}");
        }
    }

    #[test]
    fn modified_non_ascii_character_is_rejected() {
        let error = parse_send_keys("^中").unwrap_err();
        assert!(error.contains("不支持作用于字符"));
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

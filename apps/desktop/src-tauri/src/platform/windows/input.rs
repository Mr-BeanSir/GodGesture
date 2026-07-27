//! 输入合成 —— SendInput 封装。
//! 所有合成事件带 EXTRA_INFO_TAG,钩子据此放行,避免自反馈。
//! 右键合成尊重系统的主/副键交换设置(SM_SWAPBUTTON)。

use super::hook::EXTRA_INFO_TAG;
use super::keys;
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

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

fn send_button(button: MouseButton, down: bool, _pos: Point) {
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
    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

/// 合成一次按下(用于起始超时转普通拖拽)
pub fn synthesize_down(button: MouseButton, pos: Point) {
    send_button(button, true, pos);
}

/// 合成一次完整点击(down + up)
pub fn synthesize_click(button: MouseButton, pos: Point) {
    send_button(button, true, pos);
    send_button(button, false, pos);
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

/// 输入一段文本(Unicode 直接注入,不受键盘布局影响)。
/// 支持 `{sleep 毫秒}` 占位:在该处暂停,便于目标程序处理前一段输入。
pub fn type_text_with_sleeps(text: &str) {
    for segment in split_sleep_tokens(text) {
        match segment {
            TextSegment::Text(s) => type_text(&s),
            TextSegment::Sleep(ms) => std::thread::sleep(std::time::Duration::from_millis(ms)),
        }
    }
}

fn type_text(text: &str) {
    let mut inputs: Vec<INPUT> = Vec::with_capacity(text.len() * 2);
    let mut buf = [0u16; 2];
    for ch in text.chars() {
        for unit in ch.encode_utf16(&mut buf) {
            inputs.push(unicode_input(*unit, true));
            inputs.push(unicode_input(*unit, false));
        }
    }
    let _ = send_inputs(&inputs);
}

enum TextSegment {
    Text(String),
    Sleep(u64),
}

/// 单个 `{sleep N}` 的最大生效时长
const MAX_SLEEP_MS: u64 = 10_000;

/// 把含 `{sleep N}` 的文本拆成文本段与休眠段。
fn split_sleep_tokens(text: &str) -> Vec<TextSegment> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("{sleep ") {
        if let Some(end_rel) = rest[start..].find('}') {
            let end = start + end_rel;
            let inner = &rest[start + "{sleep ".len()..end];
            if let Ok(ms) = inner.trim().parse::<u64>() {
                if start > 0 {
                    out.push(TextSegment::Text(rest[..start].to_string()));
                }
                // 封顶 10s:这段休眠跑在命令执行线程上,一个手改(或从别的设备
                // 同步过来)的 {sleep 99999999999} 会把该线程永久挂住,
                // 之后所有手势命令都不再执行,只能重启。
                out.push(TextSegment::Sleep(ms.min(MAX_SLEEP_MS)));
                rest = &rest[end + 1..];
                continue;
            }
        }
        // 不是合法的 sleep 记号:把 '{' 之前(含)当普通文本继续扫描
        out.push(TextSegment::Text(rest[..start + 1].to_string()));
        rest = &rest[start + 1..];
    }
    if !rest.is_empty() {
        out.push(TextSegment::Text(rest.to_string()));
    }
    out
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
}

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
        (MouseButton::X1, _) => (if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 1),
        (MouseButton::X2, _) => (if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 2),
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

fn send_inputs(inputs: &[INPUT]) {
    if inputs.is_empty() {
        return;
    }
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// 合成一次组合键:按住所有修饰键 → 依次按下/抬起主键 → 逆序释放修饰键。
/// modifiers/keys 用统一键名(见 keys.rs),无法识别的键名忽略。
pub fn synthesize_key_combo(modifiers: &[String], keys: &[String]) {
    let mod_vks: Vec<VIRTUAL_KEY> = modifiers.iter().filter_map(|m| keys::name_to_vk(m)).collect();
    let key_vks: Vec<VIRTUAL_KEY> = keys.iter().filter_map(|k| keys::name_to_vk(k)).collect();
    if key_vks.is_empty() && mod_vks.is_empty() {
        return;
    }

    let mut inputs: Vec<INPUT> = Vec::new();
    for &m in &mod_vks {
        inputs.push(vk_input(m, true));
    }
    // 主键按顺序按下,再逆序抬起(支持如 Ctrl+K Ctrl+C 之外的同时组合)
    for &k in &key_vks {
        inputs.push(vk_input(k, true));
    }
    for &k in key_vks.iter().rev() {
        inputs.push(vk_input(k, false));
    }
    for &m in mod_vks.iter().rev() {
        inputs.push(vk_input(m, false));
    }
    send_inputs(&inputs);
}

/// 敲一个虚拟键(down+up),用于音量键、任务切换等。
pub fn tap_vk(vk: VIRTUAL_KEY) {
    send_inputs(&[vk_input(vk, true), vk_input(vk, false)]);
}

/// 按住若干修饰键并敲一个主键(如 Win+Tab)
pub fn tap_with_modifiers(mods: &[VIRTUAL_KEY], key: VIRTUAL_KEY) {
    let mut inputs = Vec::new();
    for &m in mods {
        inputs.push(vk_input(m, true));
    }
    inputs.push(vk_input(key, true));
    inputs.push(vk_input(key, false));
    for &m in mods.iter().rev() {
        inputs.push(vk_input(m, false));
    }
    send_inputs(&inputs);
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
    send_inputs(&inputs);
}

enum TextSegment {
    Text(String),
    Sleep(u64),
}

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
                out.push(TextSegment::Sleep(ms));
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

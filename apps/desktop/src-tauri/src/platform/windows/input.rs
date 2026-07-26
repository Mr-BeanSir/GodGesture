//! 输入合成 —— SendInput 封装。
//! 所有合成事件带 EXTRA_INFO_TAG,钩子据此放行,避免自反馈。
//! 右键合成尊重系统的主/副键交换设置(SM_SWAPBUTTON)。

use super::hook::EXTRA_INFO_TAG;
use crate::engine::tracker::MouseButton;
use crate::engine::types::Point;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSE_EVENT_FLAGS,
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

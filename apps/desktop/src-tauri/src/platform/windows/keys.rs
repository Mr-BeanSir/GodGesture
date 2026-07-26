//! 键名 ↔ 虚拟键码映射。
//! 键名是跨平台的统一标识(见 packages/shared,hotKey 命令的 modifiers/keys 用它),
//! 这里负责 Windows VK 侧的翻译;macOS 在 M4 各自实现同一套键名。

use windows::Win32::UI::Input::KeyboardAndMouse::*;

/// 键名 → VK。未知返回 None。键名统一小写。
pub fn name_to_vk(name: &str) -> Option<VIRTUAL_KEY> {
    let vk = match name.to_ascii_lowercase().as_str() {
        // 修饰键
        "ctrl" | "control" => VK_CONTROL,
        "shift" => VK_SHIFT,
        "alt" | "menu" => VK_MENU,
        "win" | "meta" | "super" => VK_LWIN,
        // 字母
        c if c.len() == 1 && c.as_bytes()[0].is_ascii_lowercase() => {
            VIRTUAL_KEY(c.as_bytes()[0].to_ascii_uppercase() as u16)
        }
        // 数字
        d if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() => {
            VIRTUAL_KEY(d.as_bytes()[0] as u16)
        }
        // 功能键
        "f1" => VK_F1, "f2" => VK_F2, "f3" => VK_F3, "f4" => VK_F4,
        "f5" => VK_F5, "f6" => VK_F6, "f7" => VK_F7, "f8" => VK_F8,
        "f9" => VK_F9, "f10" => VK_F10, "f11" => VK_F11, "f12" => VK_F12,
        "f13" => VK_F13, "f14" => VK_F14, "f15" => VK_F15, "f16" => VK_F16,
        "f17" => VK_F17, "f18" => VK_F18, "f19" => VK_F19, "f20" => VK_F20,
        "f21" => VK_F21, "f22" => VK_F22, "f23" => VK_F23, "f24" => VK_F24,
        // 导航与编辑
        "left" => VK_LEFT, "right" => VK_RIGHT, "up" => VK_UP, "down" => VK_DOWN,
        "enter" | "return" => VK_RETURN,
        "esc" | "escape" => VK_ESCAPE,
        "space" => VK_SPACE,
        "tab" => VK_TAB,
        "backspace" | "back" => VK_BACK,
        "delete" | "del" => VK_DELETE,
        "insert" | "ins" => VK_INSERT,
        "home" => VK_HOME,
        "end" => VK_END,
        "pageup" | "pgup" => VK_PRIOR,
        "pagedown" | "pgdn" => VK_NEXT,
        "capslock" => VK_CAPITAL,
        "printscreen" | "prtsc" => VK_SNAPSHOT,
        "pause" => VK_PAUSE,
        "menu_key" | "apps" => VK_APPS,
        // 符号
        "-" | "minus" => VK_OEM_MINUS,
        "=" | "equals" => VK_OEM_PLUS,
        "," | "comma" => VK_OEM_COMMA,
        "." | "period" => VK_OEM_PERIOD,
        "/" | "slash" => VK_OEM_2,
        ";" | "semicolon" => VK_OEM_1,
        "'" | "quote" => VK_OEM_7,
        "[" | "leftbracket" => VK_OEM_4,
        "]" | "rightbracket" => VK_OEM_6,
        "\\" | "backslash" => VK_OEM_5,
        "`" | "grave" => VK_OEM_3,
        // 媒体键
        "volumeup" => VK_VOLUME_UP,
        "volumedown" => VK_VOLUME_DOWN,
        "volumemute" => VK_VOLUME_MUTE,
        "medianext" => VK_MEDIA_NEXT_TRACK,
        "mediaprev" => VK_MEDIA_PREV_TRACK,
        "mediaplay" | "mediaplaypause" => VK_MEDIA_PLAY_PAUSE,
        "mediastop" => VK_MEDIA_STOP,
        // 小键盘
        "num0" => VK_NUMPAD0, "num1" => VK_NUMPAD1, "num2" => VK_NUMPAD2,
        "num3" => VK_NUMPAD3, "num4" => VK_NUMPAD4, "num5" => VK_NUMPAD5,
        "num6" => VK_NUMPAD6, "num7" => VK_NUMPAD7, "num8" => VK_NUMPAD8,
        "num9" => VK_NUMPAD9,
        "numadd" => VK_ADD, "numsub" => VK_SUBTRACT,
        "nummul" => VK_MULTIPLY, "numdiv" => VK_DIVIDE,
        _ => return None,
    };
    Some(vk)
}

/// 是否扩展键(方向/编辑/小键盘 Enter 等,SendInput 需 KEYEVENTF_EXTENDEDKEY)
pub fn is_extended(vk: VIRTUAL_KEY) -> bool {
    matches!(
        vk,
        VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN
            | VK_HOME | VK_END | VK_PRIOR | VK_NEXT
            | VK_INSERT | VK_DELETE
            | VK_RCONTROL | VK_RMENU
            | VK_LWIN | VK_RWIN | VK_APPS
            | VK_SNAPSHOT | VK_DIVIDE | VK_NUMLOCK
    )
}

//! 键名 ↔ 虚拟键码映射。
//! 键名是跨平台的统一标识(见 packages/shared,hotKey 命令的 modifiers/keys 用它),
//! 这里负责 Windows VK 侧的翻译;macOS 在 M4 各自实现同一套键名。

use windows::Win32::UI::Input::KeyboardAndMouse::*;

/// canonical 修饰名及旧别名。用于阻止主键/修饰数组放错类型。
pub fn is_modifier_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "ctrl"
            | "control"
            | "ctl"
            | "shift"
            | "alt"
            | "option"
            | "menu"
            | "win"
            | "windows"
            | "meta"
            | "super"
            | "command"
            | "cmd"
    )
}

/// 键名 → VK。未知返回 None。键名统一小写。
pub fn name_to_vk(name: &str) -> Option<VIRTUAL_KEY> {
    let vk = match name.to_ascii_lowercase().as_str() {
        // 修饰键
        "ctrl" | "control" | "ctl" => VK_CONTROL,
        "shift" => VK_SHIFT,
        "alt" | "option" | "menu" => VK_MENU,
        "win" | "windows" | "meta" | "super" | "command" | "cmd" => VK_LWIN,
        // 旧版 UI 按 KeyboardEvent.key 保存了布局后的字符。迁移为同一物理键,
        // 修饰状态仍由 modifiers 数组表达。
        "!" => VIRTUAL_KEY(b'1' as u16),
        "@" => VIRTUAL_KEY(b'2' as u16),
        "#" => VIRTUAL_KEY(b'3' as u16),
        "$" => VIRTUAL_KEY(b'4' as u16),
        "%" => VIRTUAL_KEY(b'5' as u16),
        "^" => VIRTUAL_KEY(b'6' as u16),
        "&" => VIRTUAL_KEY(b'7' as u16),
        "*" => VIRTUAL_KEY(b'8' as u16),
        "(" => VIRTUAL_KEY(b'9' as u16),
        ")" => VIRTUAL_KEY(b'0' as u16),
        // 字母
        c if c.len() == 1 && c.as_bytes()[0].is_ascii_lowercase() => {
            VIRTUAL_KEY(c.as_bytes()[0].to_ascii_uppercase() as u16)
        }
        // 数字
        d if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() => {
            VIRTUAL_KEY(d.as_bytes()[0] as u16)
        }
        // 功能键
        "f1" => VK_F1,
        "f2" => VK_F2,
        "f3" => VK_F3,
        "f4" => VK_F4,
        "f5" => VK_F5,
        "f6" => VK_F6,
        "f7" => VK_F7,
        "f8" => VK_F8,
        "f9" => VK_F9,
        "f10" => VK_F10,
        "f11" => VK_F11,
        "f12" => VK_F12,
        "f13" => VK_F13,
        "f14" => VK_F14,
        "f15" => VK_F15,
        "f16" => VK_F16,
        "f17" => VK_F17,
        "f18" => VK_F18,
        "f19" => VK_F19,
        "f20" => VK_F20,
        "f21" => VK_F21,
        "f22" => VK_F22,
        "f23" => VK_F23,
        "f24" => VK_F24,
        // 导航与编辑
        "left" => VK_LEFT,
        "right" => VK_RIGHT,
        "up" => VK_UP,
        "down" => VK_DOWN,
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
        "clear" => VK_CLEAR,
        "pausebreak" | "pause" => VK_PAUSE,
        "contextmenu" | "menu_key" | "apps" => VK_APPS,
        "sleep" => VK_SLEEP,
        "numlock" => VK_NUMLOCK,
        "scrolllock" => VK_SCROLL,
        // 符号
        "-" | "_" | "minus" => VK_OEM_MINUS,
        "=" | "+" | "equals" => VK_OEM_PLUS,
        "," | "<" | "comma" => VK_OEM_COMMA,
        "." | ">" | "period" => VK_OEM_PERIOD,
        "/" | "?" | "slash" => VK_OEM_2,
        ";" | ":" | "semicolon" => VK_OEM_1,
        "'" | "\"" | "quote" => VK_OEM_7,
        "[" | "{" | "bracketleft" | "leftbracket" => VK_OEM_4,
        "]" | "}" | "bracketright" | "rightbracket" => VK_OEM_6,
        "\\" | "|" | "backslash" => VK_OEM_5,
        "`" | "~" | "backquote" | "grave" => VK_OEM_3,
        "intlbackslash" => VK_OEM_102,
        // 浏览器 / 启动键
        "browserback" => VK_BROWSER_BACK,
        "browserforward" => VK_BROWSER_FORWARD,
        "browserrefresh" => VK_BROWSER_REFRESH,
        "browserstop" => VK_BROWSER_STOP,
        "browsersearch" => VK_BROWSER_SEARCH,
        "browserfavorites" => VK_BROWSER_FAVORITES,
        "browserhome" => VK_BROWSER_HOME,
        // 媒体键
        "volumeup" => VK_VOLUME_UP,
        "volumedown" => VK_VOLUME_DOWN,
        "volumemute" => VK_VOLUME_MUTE,
        "medianext" | "medianexttrack" => VK_MEDIA_NEXT_TRACK,
        "mediaprev" | "mediaprevtrack" => VK_MEDIA_PREV_TRACK,
        "mediaplay" | "mediaplaypause" => VK_MEDIA_PLAY_PAUSE,
        "mediastop" => VK_MEDIA_STOP,
        "launchmail" => VK_LAUNCH_MAIL,
        "launchmediaselect" => VK_LAUNCH_MEDIA_SELECT,
        "launchapp1" => VK_LAUNCH_APP1,
        "launchapp2" => VK_LAUNCH_APP2,
        // 小键盘
        "numpad0" | "num0" => VK_NUMPAD0,
        "numpad1" | "num1" => VK_NUMPAD1,
        "numpad2" | "num2" => VK_NUMPAD2,
        "numpad3" | "num3" => VK_NUMPAD3,
        "numpad4" | "num4" => VK_NUMPAD4,
        "numpad5" | "num5" => VK_NUMPAD5,
        "numpad6" | "num6" => VK_NUMPAD6,
        "numpad7" | "num7" => VK_NUMPAD7,
        "numpad8" | "num8" => VK_NUMPAD8,
        "numpad9" | "num9" => VK_NUMPAD9,
        "numpadadd" | "numadd" => VK_ADD,
        "numpadsubtract" | "numsub" => VK_SUBTRACT,
        "numpadmultiply" | "nummul" => VK_MULTIPLY,
        "numpaddivide" | "numdiv" => VK_DIVIDE,
        "numpadseparator" => VK_SEPARATOR,
        "numpaddecimal" => VK_DECIMAL,
        "numpadenter" => VK_RETURN,
        "numpadequal" => VK_OEM_NEC_EQUAL,
        _ => return None,
    };
    Some(vk)
}

/// 是否扩展键(方向/编辑/小键盘 Enter 等,SendInput 需 KEYEVENTF_EXTENDEDKEY)
pub fn is_extended(vk: VIRTUAL_KEY) -> bool {
    matches!(
        vk,
        VK_LEFT
            | VK_RIGHT
            | VK_UP
            | VK_DOWN
            | VK_HOME
            | VK_END
            | VK_PRIOR
            | VK_NEXT
            | VK_INSERT
            | VK_DELETE
            | VK_RCONTROL
            | VK_RMENU
            | VK_LWIN
            | VK_RWIN
            | VK_APPS
            | VK_SNAPSHOT
            | VK_DIVIDE
            | VK_NUMLOCK
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shared_canonical_key_name_maps_to_a_vk() {
        let fixed = [
            "backspace",
            "tab",
            "clear",
            "enter",
            "pauseBreak",
            "capsLock",
            "esc",
            "space",
            "pageUp",
            "pageDown",
            "end",
            "home",
            "left",
            "up",
            "right",
            "down",
            "printScreen",
            "insert",
            "delete",
            "contextMenu",
            "sleep",
            "numpadMultiply",
            "numpadAdd",
            "numpadSeparator",
            "numpadSubtract",
            "numpadDecimal",
            "numpadDivide",
            "numpadEnter",
            "numpadEqual",
            "numLock",
            "scrollLock",
            "browserBack",
            "browserForward",
            "browserRefresh",
            "browserStop",
            "browserSearch",
            "browserFavorites",
            "browserHome",
            "volumeMute",
            "volumeDown",
            "volumeUp",
            "mediaNextTrack",
            "mediaPrevTrack",
            "mediaStop",
            "mediaPlayPause",
            "launchMail",
            "launchMediaSelect",
            "launchApp1",
            "launchApp2",
            "semicolon",
            "equals",
            "comma",
            "minus",
            "period",
            "slash",
            "backquote",
            "bracketLeft",
            "backslash",
            "bracketRight",
            "quote",
            "intlBackslash",
        ];
        for name in fixed {
            assert!(name_to_vk(name).is_some(), "missing canonical key {name}");
        }
        for byte in b'a'..=b'z' {
            assert!(name_to_vk(&(byte as char).to_string()).is_some());
        }
        for digit in 0..=9 {
            assert!(name_to_vk(&digit.to_string()).is_some());
            assert!(name_to_vk(&format!("numpad{digit}")).is_some());
        }
        for function in 1..=24 {
            assert!(name_to_vk(&format!("f{function}")).is_some());
        }
    }

    #[test]
    fn canonical_modifiers_and_legacy_aliases_remain_executable() {
        for name in ["ctrl", "shift", "alt", "meta"] {
            assert!(name_to_vk(name).is_some(), "missing modifier {name}");
            assert!(is_modifier_name(name));
        }
        assert_eq!(name_to_vk("win"), Some(VK_LWIN));
        assert_eq!(name_to_vk("pageup"), Some(VK_PRIOR));
        assert_eq!(name_to_vk("leftbracket"), Some(VK_OEM_4));
        assert_eq!(name_to_vk("num0"), Some(VK_NUMPAD0));
        assert_eq!(name_to_vk("@"), Some(VIRTUAL_KEY(b'2' as u16)));
        assert_eq!(name_to_vk("not-a-real-key"), None);
    }
}

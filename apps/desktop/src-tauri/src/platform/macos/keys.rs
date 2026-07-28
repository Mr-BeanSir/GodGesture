// macOS virtual-key mapping for shared canonical key names.

use objc2_core_graphics::{CGEventFlags, CGKeyCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key {
    pub code: CGKeyCode,
    pub flag: CGEventFlags,
}

impl Key {
    const fn plain(code: CGKeyCode) -> Self {
        Self {
            code,
            flag: CGEventFlags::empty(),
        }
    }

    const fn modifier(code: CGKeyCode, flag: CGEventFlags) -> Self {
        Self { code, flag }
    }
}

pub fn is_modifier_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "ctrl" | "control" | "shift" | "alt" | "option" | "meta" | "cmd" | "command"
    )
}

pub fn name_to_key(name: &str) -> Option<Key> {
    let lower = name.to_ascii_lowercase();
    let key = match lower.as_str() {
        "ctrl" | "control" => Key::modifier(59, CGEventFlags::MaskControl),
        "shift" => Key::modifier(56, CGEventFlags::MaskShift),
        "alt" | "option" => Key::modifier(58, CGEventFlags::MaskAlternate),
        "meta" | "cmd" | "command" => Key::modifier(55, CGEventFlags::MaskCommand),

        "a" => Key::plain(0),
        "s" => Key::plain(1),
        "d" => Key::plain(2),
        "f" => Key::plain(3),
        "h" => Key::plain(4),
        "g" => Key::plain(5),
        "z" => Key::plain(6),
        "x" => Key::plain(7),
        "c" => Key::plain(8),
        "v" => Key::plain(9),
        "b" => Key::plain(11),
        "q" => Key::plain(12),
        "w" => Key::plain(13),
        "e" => Key::plain(14),
        "r" => Key::plain(15),
        "y" => Key::plain(16),
        "t" => Key::plain(17),
        "o" => Key::plain(31),
        "u" => Key::plain(32),
        "i" => Key::plain(34),
        "p" => Key::plain(35),
        "l" => Key::plain(37),
        "j" => Key::plain(38),
        "k" => Key::plain(40),
        "n" => Key::plain(45),
        "m" => Key::plain(46),

        "1" => Key::plain(18),
        "2" => Key::plain(19),
        "3" => Key::plain(20),
        "4" => Key::plain(21),
        "5" => Key::plain(23),
        "6" => Key::plain(22),
        "7" => Key::plain(26),
        "8" => Key::plain(28),
        "9" => Key::plain(25),
        "0" => Key::plain(29),

        "enter" | "return" => Key::plain(36),
        "tab" => Key::plain(48),
        "space" => Key::plain(49),
        "backspace" | "back" => Key::plain(51),
        "esc" | "escape" => Key::plain(53),
        "capslock" => Key::plain(57),
        "volumeup" => Key::plain(72),
        "volumedown" => Key::plain(73),
        "volumemute" => Key::plain(74),
        "clear" => Key::plain(71),
        "home" => Key::plain(115),
        "pageup" | "pgup" => Key::plain(116),
        "delete" | "del" => Key::plain(117),
        "end" => Key::plain(119),
        "pagedown" | "pgdn" => Key::plain(121),
        "left" => Key::plain(123),
        "right" => Key::plain(124),
        "down" => Key::plain(125),
        "up" => Key::plain(126),

        "-" | "_" | "minus" => Key::plain(27),
        "=" | "+" | "equals" => Key::plain(24),
        "," | "<" | "comma" => Key::plain(43),
        "." | ">" | "period" => Key::plain(47),
        "/" | "?" | "slash" => Key::plain(44),
        ";" | ":" | "semicolon" => Key::plain(41),
        "'" | "\"" | "quote" => Key::plain(39),
        "[" | "{" | "bracketleft" | "leftbracket" => Key::plain(33),
        "]" | "}" | "bracketright" | "rightbracket" => Key::plain(30),
        "\\" | "|" | "backslash" | "intlbackslash" => Key::plain(42),
        "`" | "~" | "backquote" | "grave" => Key::plain(50),

        "f1" => Key::plain(122),
        "f2" => Key::plain(120),
        "f3" => Key::plain(99),
        "f4" => Key::plain(118),
        "f5" => Key::plain(96),
        "f6" => Key::plain(97),
        "f7" => Key::plain(98),
        "f8" => Key::plain(100),
        "f9" => Key::plain(101),
        "f10" => Key::plain(109),
        "f11" => Key::plain(103),
        "f12" => Key::plain(111),
        "f13" => Key::plain(105),
        "f14" => Key::plain(107),
        "f15" => Key::plain(113),
        "f16" => Key::plain(106),
        "f17" => Key::plain(64),
        "f18" => Key::plain(79),
        "f19" => Key::plain(80),
        "f20" => Key::plain(90),

        "numpad0" | "num0" => Key::plain(82),
        "numpad1" | "num1" => Key::plain(83),
        "numpad2" | "num2" => Key::plain(84),
        "numpad3" | "num3" => Key::plain(85),
        "numpad4" | "num4" => Key::plain(86),
        "numpad5" | "num5" => Key::plain(87),
        "numpad6" | "num6" => Key::plain(88),
        "numpad7" | "num7" => Key::plain(89),
        "numpad8" | "num8" => Key::plain(91),
        "numpad9" | "num9" => Key::plain(92),
        "numpaddecimal" => Key::plain(65),
        "numpadmultiply" | "nummul" => Key::plain(67),
        "numpadadd" | "numadd" => Key::plain(69),
        "numpaddivide" | "numdiv" => Key::plain(75),
        "numpadenter" => Key::plain(76),
        "numpadsubtract" | "numsub" => Key::plain(78),
        "numpadequal" => Key::plain(81),
        _ => return None,
    };
    Some(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_letters_digits_and_primary_modifiers_map() {
        for name in ["a", "z", "0", "9", "ctrl", "shift", "alt", "meta"] {
            assert!(name_to_key(name).is_some(), "missing key {name}");
        }
        assert!(is_modifier_name("command"));
        assert!(!is_modifier_name("c"));
    }

    #[test]
    fn unsupported_platform_keys_are_rejected() {
        assert_eq!(name_to_key("browserBack"), None);
        assert_eq!(name_to_key("f24"), None);
        assert_eq!(name_to_key("not-a-real-key"), None);
    }
}

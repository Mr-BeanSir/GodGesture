//! 手势领域核心类型 —— JSON 形状必须与 packages/shared 的 zod Schema 严格一致
//! (serde rename 规则以 shared 为准;两处不同步即为 bug)。

use serde::{Deserialize, Serialize};

/// 触发键:按住即进入手势状态的鼠标键
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TriggerButton {
    Right,
    Middle,
    X1,
    X2,
}

/// 笔画方向(8 向)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Up,
    RightUp,
    Right,
    RightDown,
    Down,
    LeftDown,
    Left,
    LeftUp,
}

impl Direction {
    /// 是否为斜向(仅允许出现在首笔)
    pub fn is_diagonal(self) -> bool {
        matches!(
            self,
            Direction::RightUp | Direction::RightDown | Direction::LeftDown | Direction::LeftUp
        )
    }

    /// 斜向的 4 向回写等价(WGestures: 首笔斜向在次笔转向时可被改写为 4 向)
    pub fn to_cardinal(self) -> Direction {
        match self {
            Direction::RightUp | Direction::LeftUp => Direction::Up,
            Direction::RightDown | Direction::LeftDown => Direction::Down,
            other => other,
        }
    }

    /// 助记符(UI/日志)
    pub fn mnemonic(self) -> &'static str {
        match self {
            Direction::Up => "↑",
            Direction::RightUp => "↗",
            Direction::Right => "→",
            Direction::RightDown => "↘",
            Direction::Down => "↓",
            Direction::LeftDown => "↙",
            Direction::Left => "←",
            Direction::LeftUp => "↖",
        }
    }
}

/// 修饰:手势按住期间叠加的额外动作
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Modifier {
    None,
    WheelForward,
    WheelBackward,
    LeftButtonDown,
    MiddleButtonDown,
    RightButtonDown,
    X1Down,
    X2Down,
}

impl Modifier {
    pub fn mnemonic(self) -> &'static str {
        match self {
            Modifier::None => "",
            Modifier::WheelForward => "▲",
            Modifier::WheelBackward => "▼",
            Modifier::LeftButtonDown => "◐",
            Modifier::MiddleButtonDown => "●",
            Modifier::RightButtonDown => "◑",
            Modifier::X1Down => "X1",
            Modifier::X2Down => "X2",
        }
    }
}

/// 手势 = 触发键 + 笔画序列 + 修饰(三者共同决定唯一性)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GestureSpec {
    pub trigger: TriggerButton,
    pub strokes: Vec<Direction>,
    #[serde(default = "Modifier::default_none")]
    pub modifier: Modifier,
}

impl Modifier {
    fn default_none() -> Modifier {
        Modifier::None
    }
}

impl GestureSpec {
    pub fn mnemonic(&self) -> String {
        let mut s: String = self.strokes.iter().map(|d| d.mnemonic()).collect();
        let m = self.modifier.mnemonic();
        if !m.is_empty() {
            s.push(' ');
            s.push_str(m);
        }
        s
    }
}

/// 屏幕坐标点(物理像素)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

impl Point {
    pub fn dist_sq(self, other: Point) -> i64 {
        let dx = (self.x - other.x) as i64;
        let dy = (self.y - other.y) as i64;
        dx * dx + dy * dy
    }
}

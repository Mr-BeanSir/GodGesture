//! 方向识别器 —— 移植 WGestures GestureParser 的笔画算法。
//!
//! 语义要点(与 1.8.5 行为对齐,见盘点报告):
//! - 有效点距离(effective_move)达到才计入一次方向判定;相同方向合并;
//! - 8 向模式下,斜向仅允许作为首笔;第二笔转向时,若与首笔斜向夹角小于
//!   约 36°,继续延伸斜向,否则首笔被回写为其 4 向等价方向;
//! - 第三笔起一律 4 向;
//! - 最多 12 笔,超出后不再追加。

use super::types::{Direction, Point};

pub const MAX_STROKES: usize = 12;

/// 8 向判定中,斜向扇区的展宽角度(度)。WGestures: slashRange = 50°
const SLASH_RANGE_DEG: f64 = 50.0;
/// 次笔与首笔斜向的"继续延伸"判定角(度)。WGestures: < 36°
const DIAGONAL_CONTINUE_DEG: f64 = 36.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrokeEvent {
    /// 无新笔画(位移不足或方向未变)
    None,
    /// 追加了一笔(可能伴随首笔回写)
    Grew,
    /// 已达笔画上限,忽略后续
    Saturated,
}

pub struct StrokeParser {
    strokes: Vec<Direction>,
    last_point: Point,
    effective_move_px: f64,
    enable_8_directions: bool,
}

impl StrokeParser {
    pub fn new(start: Point, effective_move_px: f64, enable_8_directions: bool) -> Self {
        Self {
            strokes: Vec::new(),
            last_point: start,
            effective_move_px: effective_move_px.max(1.0),
            enable_8_directions,
        }
    }

    pub fn strokes(&self) -> &[Direction] {
        &self.strokes
    }

    /// 喂入一个新的鼠标位置;返回是否长出了新笔画。
    pub fn feed(&mut self, p: Point) -> StrokeEvent {
        let dx = (p.x - self.last_point.x) as f64;
        // 屏幕坐标 Y 轴向下,翻转为数学向上为正(与 WGestures 一致)
        let dy = (self.last_point.y - p.y) as f64;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < self.effective_move_px {
            return StrokeEvent::None;
        }
        self.last_point = p;

        let dir = self.classify(dx, dy);
        match self.strokes.last() {
            Some(&last) if last == dir => StrokeEvent::None,
            _ => {
                if self.strokes.len() >= MAX_STROKES {
                    return StrokeEvent::Saturated;
                }
                self.push_stroke(dir, dx, dy);
                StrokeEvent::Grew
            }
        }
    }

    fn push_stroke(&mut self, dir: Direction, dx: f64, dy: f64) {
        // 8 向语义:斜向仅首笔;次笔时决定延伸或回写
        if self.strokes.len() == 1 {
            let first = self.strokes[0];
            if first.is_diagonal() && dir != first {
                let angle = angle_between_deg(dx, dy, diagonal_unit(first));
                if angle < DIAGONAL_CONTINUE_DEG {
                    // 仍在首笔斜向的容差内:视为延续,不新增笔画
                    return;
                }
                // 回写首笔为 4 向等价
                self.strokes[0] = first.to_cardinal();
                let cardinal = classify_4dir(dx, dy);
                if self.strokes[0] != cardinal {
                    self.strokes.push(cardinal);
                }
                return;
            }
        }
        self.strokes.push(dir);
    }

    fn classify(&self, dx: f64, dy: f64) -> Direction {
        if self.enable_8_directions && self.strokes.is_empty() {
            classify_8dir(dx, dy)
        } else {
            classify_4dir(dx, dy)
        }
    }
}

/// 4 向:取主导轴
fn classify_4dir(dx: f64, dy: f64) -> Direction {
    if dx.abs() >= dy.abs() {
        if dx >= 0.0 {
            Direction::Right
        } else {
            Direction::Left
        }
    } else if dy >= 0.0 {
        Direction::Up
    } else {
        Direction::Down
    }
}

/// 8 向:按与正上方向的罗盘角分扇区。
/// 斜向扇区宽 SLASH_RANGE_DEG(以 45°/135°/225°/315° 为中心),
/// 基本向占其余角度(每个 90 - SLASH_RANGE_DEG)。
fn classify_8dir(dx: f64, dy: f64) -> Direction {
    // atan2 以 +x 为 0°、逆时针;转成以 +y(上)为 0°、顺时针的罗盘角
    let compass = (90.0 - dy.atan2(dx).to_degrees()).rem_euclid(360.0);
    let h = SLASH_RANGE_DEG / 2.0;
    match compass {
        c if c < 45.0 - h => Direction::Up,
        c if c < 45.0 + h => Direction::RightUp,
        c if c < 135.0 - h => Direction::Right,
        c if c < 135.0 + h => Direction::RightDown,
        c if c < 225.0 - h => Direction::Down,
        c if c < 225.0 + h => Direction::LeftDown,
        c if c < 315.0 - h => Direction::Left,
        c if c < 315.0 + h => Direction::LeftUp,
        _ => Direction::Up,
    }
}

/// 斜向的单位向量(数学坐标,y 向上)
fn diagonal_unit(d: Direction) -> (f64, f64) {
    let s = std::f64::consts::FRAC_1_SQRT_2;
    match d {
        Direction::RightUp => (s, s),
        Direction::RightDown => (s, -s),
        Direction::LeftDown => (-s, -s),
        Direction::LeftUp => (-s, s),
        _ => (0.0, 1.0),
    }
}

/// 向量与给定单位向量的夹角(度)
fn angle_between_deg(dx: f64, dy: f64, unit: (f64, f64)) -> f64 {
    let len = (dx * dx + dy * dy).sqrt();
    if len == 0.0 {
        return 0.0;
    }
    let dot = (dx * unit.0 + dy * unit.1) / len;
    dot.clamp(-1.0, 1.0).acos().to_degrees()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_path(parser: &mut StrokeParser, points: &[(i32, i32)]) {
        for &(x, y) in points {
            parser.feed(Point { x, y });
        }
    }

    #[test]
    fn simple_right_then_down() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 10.0, true);
        feed_path(&mut p, &[(20, 0), (40, 0), (40, 20), (40, 40)]);
        assert_eq!(p.strokes(), &[Direction::Right, Direction::Down]);
    }

    #[test]
    fn diagonal_first_stroke_kept_when_continuing() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 10.0, true);
        // 一路右上(屏幕 y 减小)
        feed_path(&mut p, &[(20, -20), (40, -40), (60, -60)]);
        assert_eq!(p.strokes(), &[Direction::RightUp]);
    }

    #[test]
    fn diagonal_rewritten_to_cardinal_on_turn() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 10.0, true);
        // 先右上,再明确转右:首笔回写为 Up?否 —— 主导轴变化:
        // WGestures 语义:回写为 4 向等价(RightUp→Up),再追加新 4 向
        feed_path(&mut p, &[(20, -20), (40, -40)]);
        assert_eq!(p.strokes(), &[Direction::RightUp]);
        feed_path(&mut p, &[(80, -40), (120, -40)]);
        assert_eq!(p.strokes(), &[Direction::Up, Direction::Right]);
    }

    #[test]
    fn no_diagonals_after_first_stroke() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 10.0, true);
        feed_path(&mut p, &[(0, 30), (0, 60)]); // Down
        assert_eq!(p.strokes(), &[Direction::Down]);
        // 之后画斜线也只识别为 4 向
        feed_path(&mut p, &[(30, 90), (60, 120)]);
        assert!(p.strokes().iter().skip(1).all(|d| !d.is_diagonal()));
    }

    #[test]
    fn four_dir_mode_never_diagonal() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 10.0, false);
        feed_path(&mut p, &[(20, -20), (40, -40)]);
        assert!(p.strokes().iter().all(|d| !d.is_diagonal()));
    }

    #[test]
    fn max_strokes_saturation() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 5.0, false);
        // 反复左右横跳制造大量笔画
        let mut pts = Vec::new();
        let mut x = 0;
        for i in 0..40 {
            x += if i % 2 == 0 { 50 } else { -50 };
            pts.push((x, 0));
        }
        feed_path(&mut p, &pts);
        assert_eq!(p.strokes().len(), MAX_STROKES);
    }

    #[test]
    fn small_jitter_ignored() {
        let mut p = StrokeParser::new(Point { x: 0, y: 0 }, 20.0, true);
        feed_path(&mut p, &[(3, 2), (5, -3), (8, 1)]);
        assert!(p.strokes().is_empty());
    }
}

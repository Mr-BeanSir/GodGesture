//! 普通手势与边角序列共用的活动捕获基础设施。
//!
//! 准入方式可以不同:普通手势需要经过触发键和移动阈值,边角序列需要先命中边/近角区域。
//! 一旦进入活动捕获,输入标准化、有序步骤与独立修饰符仲裁、消费记录和主释放键语义必须一致。

use super::config::{GestureInput, GestureInputButton};
use super::parser::{StrokeEvent, StrokeParser};
use super::tracker::MouseButton;
use super::types::{Direction, Modifier, Point};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReleaseAnchor {
    Button(MouseButton),
    #[default]
    None,
}

impl ReleaseAnchor {
    pub fn button(self) -> Option<MouseButton> {
        match self {
            Self::Button(button) => Some(button),
            Self::None => None,
        }
    }

    pub fn or(self, fallback: Option<MouseButton>) -> Option<MouseButton> {
        self.button().or(fallback)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureReplay {
    Click {
        button: MouseButton,
        pos: super::types::Point,
    },
    Wheel {
        forward: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupplementalDisposition {
    /// 该输入必须继续作为基础有序输入,不能被独立修饰符抢占。
    Ordered,
    /// 该输入命中了独立修饰符,不加入基础有序输入。
    IndependentModifier,
    /// 没有任何候选前缀或独立修饰符命中,按普通未匹配输入处理。
    Unmatched,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseDisposition {
    Anchor,
    ConsumedButton,
    PassThrough,
}

/// 共用的有序候选收敛器。
///
/// 普通手势通常通过 `IntentFinder` 按当前输入即时查询,边角序列则需要在多个
/// `BoundaryIntent` 之间逐步收敛。两种配置提供器都可以复用这段“按位置过滤候选、
/// 递增输入索引、返回完整候选”的逻辑,而不复制一份序列状态机。
#[derive(Debug)]
pub struct OrderedMatcher<C> {
    candidates: Vec<C>,
    fallback: Option<C>,
    next_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderedMatchError {
    NoCandidate,
}

impl<C: Clone> OrderedMatcher<C> {
    pub fn new(candidates: Vec<C>, fallback: Option<C>) -> Self {
        Self {
            candidates,
            fallback,
            next_index: 0,
        }
    }

    pub fn next_index(&self) -> usize {
        self.next_index
    }

    pub fn candidate_count(&self) -> usize {
        self.candidates.len()
    }

    pub fn has_fallback(&self) -> bool {
        self.fallback.is_some()
    }

    pub fn take_fallback(&mut self) -> Option<C> {
        self.fallback.take()
    }

    /// 返回 `Err(OrderedMatchError::NoCandidate)` 表示当前 token 使所有候选失配;
    /// 返回 `Ok(Some(candidate))` 表示某个候选已完整匹配;
    /// 返回 `Ok(None)` 表示仍在等待后续输入。
    pub fn feed<T, F, G>(
        &mut self,
        token: &T,
        matches: F,
        is_complete: G,
    ) -> Result<Option<C>, OrderedMatchError>
    where
        F: Fn(&C, usize, &T) -> bool,
        G: Fn(&C, usize) -> bool,
    {
        let index = self.next_index;
        self.candidates
            .retain(|candidate| matches(candidate, index, token));
        if self.candidates.is_empty() {
            return Err(OrderedMatchError::NoCandidate);
        }
        self.next_index += 1;
        Ok(self
            .candidates
            .iter()
            .find(|candidate| is_complete(candidate, self.next_index))
            .cloned())
    }
}

/// 将物理附加输入归类为有序步骤、独立修饰符或未匹配输入。
///
/// `PathTracker` 报告的是物理事件,它本身不能决定事件的配置语义。普通手势与边角序列都
/// 必须通过这个仲裁顺序:有序前缀优先,然后才查询独立修饰符。
pub fn classify_supplemental_input<F>(
    current: &[GestureInput],
    input: &GestureInput,
    modifier: Modifier,
    has_ordered_prefix: F,
    has_independent_modifier: bool,
) -> SupplementalDisposition
where
    F: FnOnce(&[GestureInput]) -> bool,
{
    let mut prefix = current.to_vec();
    prefix.push(input.clone());
    if has_ordered_prefix(&prefix) {
        SupplementalDisposition::Ordered
    } else if modifier != Modifier::None && has_independent_modifier {
        SupplementalDisposition::IndependentModifier
    } else {
        SupplementalDisposition::Unmatched
    }
}

/// 活动捕获的共享输入账本。
///
/// 普通会话以触发键初始化 `release_anchor`;边角会话在第一个按钮 token 被记录时初始化它。
/// `consumed` 与 `released_buttons` 用于边角失败恢复和等待主按钮释放时吞掉后续按钮抬起。
#[derive(Debug, Default, Clone)]
pub struct CaptureLedger {
    inputs: Vec<GestureInput>,
    release_anchor: ReleaseAnchor,
    waiting_for_release: Option<MouseButton>,
    consumed: Vec<CaptureReplay>,
    released_buttons: Vec<MouseButton>,
}

impl CaptureLedger {
    pub fn with_release_anchor(anchor: Option<MouseButton>) -> Self {
        Self {
            release_anchor: anchor.map_or(ReleaseAnchor::None, ReleaseAnchor::Button),
            waiting_for_release: None,
            ..Self::default()
        }
    }

    pub fn inputs(&self) -> &[GestureInput] {
        &self.inputs
    }

    pub fn inputs_mut(&mut self) -> &mut Vec<GestureInput> {
        &mut self.inputs
    }

    /// Keep ordered stroke inputs aligned with the parser. The parser may
    /// rewrite the first diagonal stroke after a turn, so replacing existing
    /// stroke entries must happen before appending any new ones.
    pub fn sync_strokes(&mut self, strokes: &[Direction]) {
        let stroke_positions = self
            .inputs
            .iter()
            .enumerate()
            .filter_map(|(index, input)| {
                matches!(input, GestureInput::Stroke { .. }).then_some(index)
            })
            .collect::<Vec<_>>();

        for (position, direction) in stroke_positions
            .iter()
            .copied()
            .zip(strokes.iter().copied())
        {
            self.inputs[position] = GestureInput::Stroke { direction };
        }
        if strokes.len() > stroke_positions.len() {
            self.inputs.extend(
                strokes[stroke_positions.len()..]
                    .iter()
                    .copied()
                    .map(|direction| GestureInput::Stroke { direction }),
            );
        }
    }

    pub fn push_ordered(
        &mut self,
        input: GestureInput,
        replay: Option<CaptureReplay>,
        button: Option<MouseButton>,
    ) {
        if self.inputs.is_empty() && self.release_anchor == ReleaseAnchor::None {
            if let Some(button) = button {
                self.release_anchor = ReleaseAnchor::Button(button);
            }
        }
        if let Some(replay) = replay {
            self.consumed.push(replay);
        }
        self.inputs.push(input);
    }

    pub fn release_anchor(&self) -> ReleaseAnchor {
        self.release_anchor
    }

    pub fn arm_release(&mut self, anchor: Option<MouseButton>) -> bool {
        let Some(anchor) = anchor else {
            return false;
        };
        self.waiting_for_release = Some(anchor);
        true
    }

    pub fn waiting_for_release(&self) -> Option<MouseButton> {
        self.waiting_for_release
    }

    pub fn release_button(&mut self, button: MouseButton) -> ReleaseDisposition {
        if self.waiting_for_release == Some(button) {
            self.waiting_for_release = None;
            ReleaseDisposition::Anchor
        } else if self.record_consumed_button_up(button) {
            ReleaseDisposition::ConsumedButton
        } else {
            ReleaseDisposition::PassThrough
        }
    }

    pub fn consumed(&self) -> &[CaptureReplay] {
        &self.consumed
    }

    pub fn take_consumed(&mut self) -> Vec<CaptureReplay> {
        std::mem::take(&mut self.consumed)
    }

    pub fn released_buttons(&self) -> &[MouseButton] {
        &self.released_buttons
    }

    pub fn take_released_buttons(&mut self) -> Vec<MouseButton> {
        std::mem::take(&mut self.released_buttons)
    }

    pub fn has_consumed_button(&self, button: MouseButton) -> bool {
        self.consumed.iter().any(|replay| {
            matches!(replay, CaptureReplay::Click { button: consumed, .. } if *consumed == button)
        })
    }

    pub fn record_consumed_button_up(&mut self, button: MouseButton) -> bool {
        if self.has_consumed_button(button) && !self.released_buttons.contains(&button) {
            self.released_buttons.push(button);
            true
        } else {
            false
        }
    }
}

/// Shared active gesture capture used by ordinary and boundary admissions.
///
/// Admission and candidate lookup stay outside this type. Once an input owner
/// has been selected, both paths use the same stroke parser, ordered input
/// ledger, release anchor and replay bookkeeping.
#[derive(Debug)]
pub struct GestureCapture {
    parser: StrokeParser,
    ledger: CaptureLedger,
}

impl GestureCapture {
    pub fn new(origin: Point, effective_move_px: f64, release_anchor: Option<MouseButton>) -> Self {
        Self {
            parser: StrokeParser::new(origin, effective_move_px),
            ledger: CaptureLedger::with_release_anchor(release_anchor),
        }
    }

    pub fn feed_move(&mut self, point: Point) -> StrokeEvent {
        self.parser.feed(point)
    }

    pub fn strokes(&self) -> &[Direction] {
        self.parser.strokes()
    }

    pub fn sync_strokes(&mut self) {
        self.ledger.sync_strokes(self.parser.strokes());
    }

    pub fn inputs(&self) -> &[GestureInput] {
        self.ledger.inputs()
    }

    pub fn inputs_mut(&mut self) -> &mut Vec<GestureInput> {
        self.ledger.inputs_mut()
    }

    pub fn push_ordered(
        &mut self,
        input: GestureInput,
        replay: Option<CaptureReplay>,
        button: Option<MouseButton>,
    ) {
        self.ledger.push_ordered(input, replay, button);
    }

    pub fn release_anchor(&self) -> ReleaseAnchor {
        self.ledger.release_anchor()
    }

    pub fn arm_release(&mut self, anchor: Option<MouseButton>) -> bool {
        self.ledger.arm_release(anchor)
    }

    pub fn waiting_for_release(&self) -> Option<MouseButton> {
        self.ledger.waiting_for_release()
    }

    pub fn release_button(&mut self, button: MouseButton) -> ReleaseDisposition {
        self.ledger.release_button(button)
    }

    pub fn consumed(&self) -> &[CaptureReplay] {
        self.ledger.consumed()
    }

    pub fn take_consumed(&mut self) -> Vec<CaptureReplay> {
        self.ledger.take_consumed()
    }

    pub fn released_buttons(&self) -> &[MouseButton] {
        self.ledger.released_buttons()
    }

    pub fn take_released_buttons(&mut self) -> Vec<MouseButton> {
        self.ledger.take_released_buttons()
    }

    pub fn has_consumed_button(&self, button: MouseButton) -> bool {
        self.ledger.has_consumed_button(button)
    }
}

pub fn button_input(button: MouseButton) -> GestureInput {
    GestureInput::Button {
        button: match button {
            MouseButton::Left => GestureInputButton::Left,
            MouseButton::Middle => GestureInputButton::Middle,
            MouseButton::Right => GestureInputButton::Right,
            MouseButton::X1 => GestureInputButton::X1,
            MouseButton::X2 => GestureInputButton::X2,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::BoundaryWheelDirection;
    use crate::engine::parser::StrokeEvent;
    use crate::engine::tracker::MouseButton;
    use crate::engine::types::Direction;
    use crate::engine::types::Point;

    fn point(x: i32, y: i32) -> Point {
        Point { x, y }
    }

    fn stroke() -> GestureInput {
        GestureInput::Stroke {
            direction: crate::engine::types::Direction::Down,
        }
    }

    #[test]
    fn ordered_prefix_wins_over_independent_modifier() {
        let current = vec![stroke()];
        let input = GestureInput::Wheel {
            direction: BoundaryWheelDirection::Forward,
        };
        assert_eq!(
            classify_supplemental_input(&current, &input, Modifier::WheelForward, |_| true, true),
            SupplementalDisposition::Ordered
        );
    }

    #[test]
    fn independent_modifier_is_not_an_ordered_input() {
        let input = GestureInput::Wheel {
            direction: BoundaryWheelDirection::Forward,
        };
        assert_eq!(
            classify_supplemental_input(&[], &input, Modifier::WheelForward, |_| false, true),
            SupplementalDisposition::IndependentModifier
        );
    }

    #[test]
    fn ordered_matcher_converges_candidates_in_order() {
        let mut matcher = OrderedMatcher::new(vec![vec!['a', 'b'], vec!['a', 'c']], None);
        assert_eq!(
            matcher.feed(
                &'a',
                |candidate, index, token| candidate[index] == *token,
                |candidate, index| { candidate.len() == index }
            ),
            Ok(None)
        );
        assert_eq!(matcher.candidate_count(), 2);
        assert_eq!(
            matcher.feed(
                &'c',
                |candidate, index, token| candidate[index] == *token,
                |candidate, index| { candidate.len() == index }
            ),
            Ok(Some(vec!['a', 'c']))
        );
        assert_eq!(matcher.candidate_count(), 1);
    }

    #[test]
    fn first_boundary_button_becomes_release_anchor() {
        let mut ledger = CaptureLedger::default();
        ledger.push_ordered(
            button_input(MouseButton::Right),
            Some(CaptureReplay::Click {
                button: MouseButton::Right,
                pos: Point { x: 1, y: 2 },
            }),
            Some(MouseButton::Right),
        );
        assert_eq!(
            ledger.release_anchor(),
            ReleaseAnchor::Button(MouseButton::Right)
        );
        assert!(ledger.record_consumed_button_up(MouseButton::Right));
        assert_eq!(ledger.released_buttons(), &[MouseButton::Right]);
    }

    #[test]
    fn shared_capture_syncs_diagonal_rewrite_without_duplicate_strokes() {
        let mut capture = GestureCapture::new(point(0, 0), 10.0, Some(MouseButton::Right));
        assert_eq!(capture.feed_move(point(20, -20)), StrokeEvent::Grew);
        capture.push_ordered(
            GestureInput::Stroke {
                direction: Direction::RightUp,
            },
            None,
            None,
        );
        capture.feed_move(point(40, -40));
        assert_eq!(capture.feed_move(point(80, -40)), StrokeEvent::Grew);
        capture.sync_strokes();
        assert_eq!(capture.strokes(), &[Direction::Up, Direction::Right]);
        assert_eq!(
            capture.inputs(),
            &[
                GestureInput::Stroke {
                    direction: Direction::Up,
                },
                GestureInput::Stroke {
                    direction: Direction::Right,
                },
            ]
        );
    }
}

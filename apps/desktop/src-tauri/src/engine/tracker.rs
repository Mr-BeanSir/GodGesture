//! 路径追踪器 —— 平台无关状态机,移植 Win32MousePathTracker2 的行为语义:
//!
//! - 触发键按下先"待定"(Pending),位移达到起始阈值才真正开始手势;
//! - 起始超时:按住不动超过阈值 → 放弃捕获,合成按下事件透传为普通拖拽;
//! - 点击透传:按下后无有效位移即抬起 → 合成一次完整点击;
//! - 停留超时:手势中途停留过久 → 取消,等待抬起并吞掉;
//! - 附加输入:手势期间滚轮(100ms 节流)与其它按键按实际顺序成为输入事件;
//! - 手势结束后 300ms 内的滚轮事件吞掉(防止目标程序收到 Ctrl+滚轮之类)。
//!
//! 平台层职责:把钩子事件喂给 `handle`,按返回值决定是否吞事件,并执行 `Action`。

use super::types::{Modifier, Point, TriggerButton};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

impl MouseButton {
    pub fn as_trigger(self) -> Option<TriggerButton> {
        match self {
            MouseButton::Right => Some(TriggerButton::Right),
            MouseButton::Middle => Some(TriggerButton::Middle),
            MouseButton::X1 => Some(TriggerButton::X1),
            MouseButton::X2 => Some(TriggerButton::X2),
            MouseButton::Left => None,
        }
    }

    fn as_modifier(self) -> Modifier {
        match self {
            MouseButton::Left => Modifier::LeftButtonDown,
            MouseButton::Right => Modifier::RightButtonDown,
            MouseButton::Middle => Modifier::MiddleButtonDown,
            MouseButton::X1 => Modifier::X1Down,
            MouseButton::X2 => Modifier::X2Down,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    ButtonDown(MouseButton, Point),
    ButtonUp(MouseButton, Point),
    KeyDown(String),
    KeyUp(String),
    Move(Point),
    /// forward = 滚轮向前(远离使用者)
    Wheel {
        forward: bool,
        pos: Point,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// 手势正式开始(已越过起始阈值)
    PathStart {
        trigger: TriggerButton,
        origin: Point,
    },
    /// 路径生长(渲染与识别都从这里喂)
    PathGrow(Point),
    /// 修饰触发
    ModifierFired { modifier: Modifier, pos: Point },
    /// 键盘输入按下,由运行时追加到有序输入序列
    KeyFired { key: String },
    /// 正常结束:交由引擎按识别结果执行/取消
    PathEnd { pos: Point },
    /// 停留超时取消(轨迹应立即消失,后续抬起会被吞)
    PathTimeout,
    /// 待定期抬起:合成一次完整点击(down+up)
    SynthesizeClick { button: MouseButton, pos: Point },
    /// 起始超时:合成按下,转普通拖拽透传
    SynthesizeDown { button: MouseButton, pos: Point },
}

/// `handle` 的返回:是否吞掉当前这条真实事件 + 待执行动作
#[derive(Debug, Default)]
pub struct Outcome {
    pub swallow: bool,
    pub actions: Vec<Action>,
}

impl Outcome {
    fn pass() -> Self {
        Outcome::default()
    }
    fn swallowed(actions: Vec<Action>) -> Self {
        Outcome {
            swallow: true,
            actions,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TrackerParams {
    pub trigger_buttons: Vec<TriggerButton>,
    pub initial_valid_move_px: u32,
    pub initial_stay_timeout: bool,
    pub initial_stay_timeout_ms: u32,
    pub stay_timeout: bool,
    pub stay_timeout_ms: u32,
}

impl Default for TrackerParams {
    fn default() -> Self {
        Self {
            trigger_buttons: vec![
                TriggerButton::Right,
                TriggerButton::Middle,
                TriggerButton::X1,
                TriggerButton::X2,
            ],
            initial_valid_move_px: 4,
            initial_stay_timeout: false,
            initial_stay_timeout_ms: 200,
            stay_timeout: false,
            stay_timeout_ms: 500,
        }
    }
}

/// 由引擎实现,回答追踪器无法自知的问题
pub trait TrackerHost {
    /// 路径开始前的放行判定(黑名单/总开关/全屏禁用)——必须快
    fn is_gesturing_allowed(&mut self, pos: Point) -> bool;
    /// 是否处于设置页录制模式;录制时触发键按下即开始建立可视捕获。
    fn is_recording(&self) -> bool;
}

const WHEEL_THROTTLE: Duration = Duration::from_millis(100);
const POST_GESTURE_WHEEL_SWALLOW: Duration = Duration::from_millis(300);

#[derive(Debug)]
enum State {
    Idle,
    /// 触发键已按下,尚未越过起始阈值
    Pending {
        button: MouseButton,
        trigger: TriggerButton,
        origin: Point,
        since: Instant,
    },
    /// 手势进行中
    Tracking {
        button: MouseButton,
        modifier_used: bool,
        last_wheel: Option<Instant>,
        last_activity: Instant,
        /// 手势期间按下的其它按键(其抬起也要吞)
        held_modifier_buttons: Vec<MouseButton>,
        /// 手势期间按下的键盘键(避免长按重复记录,其抬起也要吞)
        held_keys: Vec<String>,
    },
    /// 起始超时后转普通拖拽:一切透传,等触发键抬起
    PassthroughDrag {
        button: MouseButton,
    },
    /// 已取消(停留超时),吞掉即将到来的触发键抬起
    CancelledAwaitUp {
        button: MouseButton,
    },
}

pub struct PathTracker {
    params: TrackerParams,
    state: State,
    last_gesture_end: Option<Instant>,
}

impl PathTracker {
    pub fn new(params: TrackerParams) -> Self {
        Self {
            params,
            state: State::Idle,
            last_gesture_end: None,
        }
    }

    pub fn set_params(&mut self, params: TrackerParams) {
        self.params = params;
    }

    /// 是否处于手势捕获中(供上层决定是否转发修饰等)
    pub fn is_capturing(&self) -> bool {
        matches!(self.state, State::Pending { .. } | State::Tracking { .. })
    }

    /// 取消当前捕获。若有触发键按下,转入等待其抬起的吞键状态。
    pub fn cancel_capture(&mut self) -> bool {
        let button = match &self.state {
            State::Pending { button, .. } | State::Tracking { button, .. } => *button,
            _ => return false,
        };
        self.state = State::CancelledAwaitUp { button };
        true
    }

    /// 下一次需要 tick 的期限(无则 None);平台层用它设置等待超时
    pub fn next_deadline(&self) -> Option<Instant> {
        match &self.state {
            State::Pending { since, .. } if self.params.initial_stay_timeout => {
                Some(*since + Duration::from_millis(self.params.initial_stay_timeout_ms as u64))
            }
            State::Tracking { last_activity, .. } if self.params.stay_timeout => {
                Some(*last_activity + Duration::from_millis(self.params.stay_timeout_ms as u64))
            }
            _ => None,
        }
    }

    /// 时间驱动:检查各超时
    pub fn tick(&mut self, now: Instant) -> Vec<Action> {
        match &self.state {
            State::Pending {
                button,
                origin,
                since,
                ..
            } if self.params.initial_stay_timeout
                && now.duration_since(*since)
                    >= Duration::from_millis(self.params.initial_stay_timeout_ms as u64) =>
            {
                let (button, origin) = (*button, *origin);
                self.state = State::PassthroughDrag { button };
                vec![Action::SynthesizeDown {
                    button,
                    pos: origin,
                }]
            }
            State::Tracking {
                button,
                last_activity,
                ..
            } if self.params.stay_timeout
                && now.duration_since(*last_activity)
                    >= Duration::from_millis(self.params.stay_timeout_ms as u64) =>
            {
                let button = *button;
                self.state = State::CancelledAwaitUp { button };
                vec![Action::PathTimeout]
            }
            _ => Vec::new(),
        }
    }

    pub fn handle(&mut self, input: Input, now: Instant, host: &mut dyn TrackerHost) -> Outcome {
        match input {
            Input::ButtonDown(btn, pos) => self.on_button_down(btn, pos, now, host),
            Input::ButtonUp(btn, pos) => self.on_button_up(btn, pos, now, host),
            Input::KeyDown(key) => self.on_key_down(key, now),
            Input::KeyUp(key) => self.on_key_up(key),
            Input::Move(pos) => self.on_move(pos, now),
            Input::Wheel { forward, pos } => self.on_wheel(forward, pos, now),
        }
    }

    fn on_button_down(
        &mut self,
        btn: MouseButton,
        pos: Point,
        now: Instant,
        host: &mut dyn TrackerHost,
    ) -> Outcome {
        match &mut self.state {
            State::Idle => {
                let Some(trigger) = btn.as_trigger() else {
                    return Outcome::pass();
                };
                if !self.params.trigger_buttons.contains(&trigger) {
                    return Outcome::pass();
                }
                if !host.is_gesturing_allowed(pos) {
                    return Outcome::pass();
                }
                if host.is_recording() {
                    self.state = State::Tracking {
                        button: btn,
                        modifier_used: false,
                        last_wheel: None,
                        last_activity: now,
                        held_modifier_buttons: Vec::new(),
                        held_keys: Vec::new(),
                    };
                    return Outcome::swallowed(vec![Action::PathStart {
                        trigger,
                        origin: pos,
                    }]);
                }
                self.state = State::Pending {
                    button: btn,
                    trigger,
                    origin: pos,
                    since: now,
                };
                Outcome::swallowed(Vec::new())
            }
            // 手势期间按下其它键 → 修饰
            State::Tracking {
                modifier_used,
                held_modifier_buttons,
                last_activity,
                button,
                ..
            } => {
                if btn == *button {
                    return Outcome::swallowed(Vec::new());
                }
                *modifier_used = true;
                *last_activity = now;
                held_modifier_buttons.push(btn);
                Outcome::swallowed(vec![Action::ModifierFired {
                    modifier: btn.as_modifier(),
                    pos,
                }])
            }
            // 待定期收到另一鼠标键时,把它作为有序手势输入的第一步。
            // 这允许“右键按住 -> 中键按下 -> 移动”这类手势在尚未移动时就建立捕获。
            State::Pending {
                button,
                trigger,
                origin,
                ..
            } => {
                let (trigger, origin, primary) = (*trigger, *origin, *button);
                self.state = State::Tracking {
                    button: primary,
                    modifier_used: true,
                    last_wheel: None,
                    last_activity: now,
                    held_modifier_buttons: vec![btn],
                    held_keys: Vec::new(),
                };
                Outcome::swallowed(vec![
                    Action::PathStart { trigger, origin },
                    Action::ModifierFired {
                        modifier: btn.as_modifier(),
                        pos,
                    },
                ])
            }
            State::PassthroughDrag { .. } | State::CancelledAwaitUp { .. } => Outcome::pass(),
        }
    }

    fn on_button_up(
        &mut self,
        btn: MouseButton,
        pos: Point,
        now: Instant,
        _host: &mut dyn TrackerHost,
    ) -> Outcome {
        match &mut self.state {
            State::Pending { button, .. } if btn == *button => {
                let button = *button;
                self.state = State::Idle;
                self.last_gesture_end = Some(now);
                Outcome::swallowed(vec![Action::SynthesizeClick { button, pos }])
            }
            State::Tracking {
                button,
                held_modifier_buttons,
                ..
            } => {
                if btn == *button {
                    self.state = State::Idle;
                    self.last_gesture_end = Some(now);
                    // Entering Tracking has already consumed the trigger click. Even when
                    // the movement did not form a stroke, end the gesture so the overlay is
                    // cleared and the original button event is never replayed.
                    Outcome::swallowed(vec![Action::PathEnd { pos }])
                } else if let Some(i) = held_modifier_buttons.iter().position(|b| *b == btn) {
                    held_modifier_buttons.remove(i);
                    Outcome::swallowed(Vec::new())
                } else {
                    Outcome::pass()
                }
            }
            State::PassthroughDrag { button } | State::CancelledAwaitUp { button }
                if btn == *button =>
            {
                let swallow = matches!(self.state, State::CancelledAwaitUp { .. });
                self.state = State::Idle;
                self.last_gesture_end = Some(now);
                Outcome {
                    swallow,
                    actions: Vec::new(),
                }
            }
            _ => Outcome::pass(),
        }
    }

    fn on_move(&mut self, pos: Point, now: Instant) -> Outcome {
        match &mut self.state {
            State::Pending {
                button,
                trigger,
                origin,
                ..
            } => {
                let threshold = self.params.initial_valid_move_px as i64;
                if origin.dist_sq(pos) >= threshold * threshold {
                    let (trigger, origin, button) = (*trigger, *origin, *button);
                    self.state = State::Tracking {
                        button,
                        modifier_used: false,
                        last_wheel: None,
                        last_activity: now,
                        held_modifier_buttons: Vec::new(),
                        held_keys: Vec::new(),
                    };
                    Outcome {
                        swallow: false,
                        actions: vec![Action::PathStart { trigger, origin }, Action::PathGrow(pos)],
                    }
                } else {
                    Outcome::pass()
                }
            }
            State::Tracking { last_activity, .. } => {
                *last_activity = now;
                Outcome {
                    swallow: false,
                    actions: vec![Action::PathGrow(pos)],
                }
            }
            _ => Outcome::pass(),
        }
    }

    fn on_wheel(&mut self, forward: bool, pos: Point, now: Instant) -> Outcome {
        match &mut self.state {
            State::Tracking {
                modifier_used,
                last_wheel,
                last_activity,
                ..
            } => {
                *last_activity = now;
                if last_wheel.is_some_and(|t| now.duration_since(t) < WHEEL_THROTTLE) {
                    return Outcome::swallowed(Vec::new());
                }
                *last_wheel = Some(now);
                *modifier_used = true;
                let m = if forward {
                    Modifier::WheelForward
                } else {
                    Modifier::WheelBackward
                };
                Outcome::swallowed(vec![Action::ModifierFired { modifier: m, pos }])
            }
            State::Pending {
                button,
                trigger,
                origin,
                ..
            } => {
                let (trigger, origin, primary) = (*trigger, *origin, *button);
                self.state = State::Tracking {
                    button: primary,
                    modifier_used: true,
                    last_wheel: Some(now),
                    last_activity: now,
                    held_modifier_buttons: Vec::new(),
                    held_keys: Vec::new(),
                };
                let m = if forward {
                    Modifier::WheelForward
                } else {
                    Modifier::WheelBackward
                };
                Outcome::swallowed(vec![
                    Action::PathStart { trigger, origin },
                    Action::ModifierFired { modifier: m, pos },
                ])
            }
            // 手势刚结束的滚轮吞掉,防止目标程序收到意外的 Ctrl+滚轮等
            State::Idle
                if self
                    .last_gesture_end
                    .is_some_and(|t| now.duration_since(t) < POST_GESTURE_WHEEL_SWALLOW) =>
            {
                Outcome::swallowed(Vec::new())
            }
            _ => Outcome::pass(),
        }
    }

    fn on_key_down(&mut self, key: String, now: Instant) -> Outcome {
        match &mut self.state {
            State::Tracking {
                held_keys,
                last_activity,
                ..
            } => {
                *last_activity = now;
                if held_keys.iter().any(|held| held == &key) {
                    return Outcome::swallowed(Vec::new());
                }
                held_keys.push(key.clone());
                Outcome::swallowed(vec![Action::KeyFired { key }])
            }
            State::Pending {
                button,
                trigger,
                origin,
                ..
            } => {
                let (trigger, origin, primary) = (*trigger, *origin, *button);
                self.state = State::Tracking {
                    button: primary,
                    modifier_used: false,
                    last_wheel: None,
                    last_activity: now,
                    held_modifier_buttons: Vec::new(),
                    held_keys: vec![key.clone()],
                };
                Outcome::swallowed(vec![
                    Action::PathStart { trigger, origin },
                    Action::KeyFired { key },
                ])
            }
            _ => Outcome::pass(),
        }
    }

    fn on_key_up(&mut self, key: String) -> Outcome {
        match &mut self.state {
            State::Tracking { held_keys, .. } => {
                if let Some(index) = held_keys.iter().position(|held| held == &key) {
                    held_keys.remove(index);
                    Outcome::swallowed(Vec::new())
                } else {
                    Outcome::pass()
                }
            }
            _ => Outcome::pass(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Host {
        allowed: bool,
        recording: bool,
    }

    impl TrackerHost for Host {
        fn is_gesturing_allowed(&mut self, _pos: Point) -> bool {
            self.allowed
        }
        fn is_recording(&self) -> bool {
            self.recording
        }
    }

    fn pt(x: i32, y: i32) -> Point {
        Point { x, y }
    }

    fn setup(params: TrackerParams) -> (PathTracker, Host, Instant) {
        (
            PathTracker::new(params),
            Host {
                allowed: true,
                recording: false,
            },
            Instant::now(),
        )
    }

    #[test]
    fn full_gesture_flow() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        let o = t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        assert!(o.swallow && o.actions.is_empty());

        let o = t.handle(Input::Move(pt(30, 0)), t0, &mut h);
        assert_eq!(
            o.actions[0],
            Action::PathStart {
                trigger: TriggerButton::Right,
                origin: pt(0, 0)
            }
        );

        let o = t.handle(Input::ButtonUp(MouseButton::Right, pt(60, 0)), t0, &mut h);
        assert!(o.swallow);
        assert_eq!(o.actions, vec![Action::PathEnd { pos: pt(60, 0) }]);
        assert!(!t.is_capturing());
    }

    #[test]
    fn recording_starts_on_trigger_and_captures_wheel_without_move() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        h.recording = true;

        let down = t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        assert_eq!(
            down.actions,
            vec![Action::PathStart {
                trigger: TriggerButton::Right,
                origin: pt(0, 0)
            }]
        );

        let wheel = t.handle(
            Input::Wheel {
                forward: true,
                pos: pt(0, 0),
            },
            t0 + Duration::from_millis(10),
            &mut h,
        );
        assert_eq!(
            wheel.actions,
            vec![Action::ModifierFired {
                modifier: Modifier::WheelForward,
                pos: pt(0, 0),
            }]
        );

        let up = t.handle(
            Input::ButtonUp(MouseButton::Right, pt(0, 0)),
            t0 + Duration::from_millis(20),
            &mut h,
        );
        assert_eq!(up.actions, vec![Action::PathEnd { pos: pt(0, 0) }]);
    }

    #[test]
    fn pending_accepts_ordered_button_and_wheel_inputs_before_move() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        let down = t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        assert!(down.swallow && down.actions.is_empty());

        let middle = t.handle(
            Input::ButtonDown(MouseButton::Middle, pt(0, 0)),
            t0 + Duration::from_millis(10),
            &mut h,
        );
        assert_eq!(
            middle.actions,
            vec![
                Action::PathStart {
                    trigger: TriggerButton::Right,
                    origin: pt(0, 0),
                },
                Action::ModifierFired {
                    modifier: Modifier::MiddleButtonDown,
                    pos: pt(0, 0),
                },
            ]
        );

        let wheel = t.handle(
            Input::Wheel {
                forward: true,
                pos: pt(0, 0),
            },
            t0 + Duration::from_millis(120),
            &mut h,
        );
        assert_eq!(
            wheel.actions,
            vec![Action::ModifierFired {
                modifier: Modifier::WheelForward,
                pos: pt(0, 0),
            }]
        );
    }

    #[test]
    fn click_passthrough_when_no_movement() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        let o = t.handle(Input::ButtonUp(MouseButton::Right, pt(1, 1)), t0, &mut h);
        assert!(o.swallow);
        assert_eq!(
            o.actions,
            vec![Action::SynthesizeClick {
                button: MouseButton::Right,
                pos: pt(1, 1)
            }]
        );
    }

    #[test]
    fn moved_capture_ends_without_click_when_no_strokes() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        t.handle(Input::Move(pt(30, 0)), t0, &mut h);
        let o = t.handle(Input::ButtonUp(MouseButton::Right, pt(30, 0)), t0, &mut h);
        assert!(o.swallow);
        assert_eq!(o.actions, vec![Action::PathEnd { pos: pt(30, 0) }]);
    }

    #[test]
    fn moved_capture_stays_consumed_after_direction_reversal() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        t.handle(Input::Move(pt(5, 0)), t0, &mut h);
        t.handle(Input::Move(pt(1, 0)), t0, &mut h);
        let o = t.handle(Input::ButtonUp(MouseButton::Right, pt(1, 0)), t0, &mut h);
        assert!(o.swallow);
        assert_eq!(o.actions, vec![Action::PathEnd { pos: pt(1, 0) }]);
    }

    #[test]
    fn not_allowed_passes_through() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        h.allowed = false;
        let o = t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        assert!(!o.swallow);
        assert!(!t.is_capturing());
    }

    #[test]
    fn non_trigger_button_ignored() {
        let params = TrackerParams {
            trigger_buttons: vec![TriggerButton::Right],
            ..Default::default()
        };
        let (mut t, mut h, t0) = setup(params);
        let o = t.handle(Input::ButtonDown(MouseButton::Middle, pt(0, 0)), t0, &mut h);
        assert!(!o.swallow);
    }

    #[test]
    fn initial_stay_timeout_becomes_drag() {
        let params = TrackerParams {
            initial_stay_timeout: true,
            initial_stay_timeout_ms: 200,
            ..Default::default()
        };
        let (mut t, mut h, t0) = setup(params);
        t.handle(Input::ButtonDown(MouseButton::Right, pt(5, 5)), t0, &mut h);
        assert!(t.next_deadline().is_some());
        let actions = t.tick(t0 + Duration::from_millis(201));
        assert_eq!(
            actions,
            vec![Action::SynthesizeDown {
                button: MouseButton::Right,
                pos: pt(5, 5)
            }]
        );
        // 之后一切透传,真实抬起也不吞
        let o = t.handle(
            Input::Move(pt(50, 50)),
            t0 + Duration::from_millis(250),
            &mut h,
        );
        assert!(!o.swallow && o.actions.is_empty());
        let o = t.handle(
            Input::ButtonUp(MouseButton::Right, pt(50, 50)),
            t0 + Duration::from_millis(300),
            &mut h,
        );
        assert!(!o.swallow);
    }

    #[test]
    fn stay_timeout_cancels_and_swallows_up() {
        let params = TrackerParams {
            stay_timeout: true,
            stay_timeout_ms: 500,
            ..Default::default()
        };
        let (mut t, mut h, t0) = setup(params);
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        t.handle(Input::Move(pt(30, 0)), t0, &mut h);
        let actions = t.tick(t0 + Duration::from_millis(501));
        assert_eq!(actions, vec![Action::PathTimeout]);
        let o = t.handle(
            Input::ButtonUp(MouseButton::Right, pt(30, 0)),
            t0 + Duration::from_millis(600),
            &mut h,
        );
        assert!(o.swallow && o.actions.is_empty());
        assert!(!t.is_capturing());
    }

    #[test]
    fn cancel_capture_swallows_trigger_up_from_pending_and_tracking() {
        for move_first in [false, true] {
            let (mut t, mut h, t0) = setup(TrackerParams::default());
            t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
            if move_first {
                t.handle(Input::Move(pt(30, 0)), t0, &mut h);
            }

            assert!(t.cancel_capture());
            assert!(!t.is_capturing());
            let o = t.handle(Input::ButtonUp(MouseButton::Right, pt(30, 0)), t0, &mut h);
            assert!(o.swallow && o.actions.is_empty());
            assert!(!t.cancel_capture());
        }
    }

    #[test]
    fn wheel_modifier_with_throttle() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        t.handle(Input::Move(pt(30, 0)), t0, &mut h);

        let o = t.handle(
            Input::Wheel {
                forward: true,
                pos: pt(30, 0),
            },
            t0,
            &mut h,
        );
        assert_eq!(
            o.actions,
            vec![Action::ModifierFired {
                modifier: Modifier::WheelForward,
                pos: pt(30, 0),
            }]
        );
        // 100ms 内的第二次被节流(但仍吞)
        let o = t.handle(
            Input::Wheel {
                forward: true,
                pos: pt(30, 0),
            },
            t0 + Duration::from_millis(50),
            &mut h,
        );
        assert!(o.swallow && o.actions.is_empty());
        // 100ms 后恢复
        let o = t.handle(
            Input::Wheel {
                forward: false,
                pos: pt(30, 0),
            },
            t0 + Duration::from_millis(200),
            &mut h,
        );
        assert_eq!(
            o.actions,
            vec![Action::ModifierFired {
                modifier: Modifier::WheelBackward,
                pos: pt(30, 0),
            }]
        );
    }

    #[test]
    fn other_button_is_modifier_and_its_up_swallowed() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        t.handle(Input::Move(pt(30, 0)), t0, &mut h);

        let o = t.handle(Input::ButtonDown(MouseButton::Left, pt(30, 0)), t0, &mut h);
        assert_eq!(
            o.actions,
            vec![Action::ModifierFired {
                modifier: Modifier::LeftButtonDown,
                pos: pt(30, 0),
            }]
        );
        let o = t.handle(Input::ButtonUp(MouseButton::Left, pt(30, 0)), t0, &mut h);
        assert!(o.swallow && o.actions.is_empty());

        // 修饰用过后,即使无笔画,抬起也按 PathEnd 处理(引擎决定执行与否)
        let o = t.handle(Input::ButtonUp(MouseButton::Right, pt(30, 0)), t0, &mut h);
        assert_eq!(o.actions, vec![Action::PathEnd { pos: pt(30, 0) }]);
    }

    #[test]
    fn keyboard_input_is_recorded_before_and_after_the_first_stroke() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        h.recording = true;

        let down = t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        assert_eq!(
            down.actions,
            vec![Action::PathStart {
                trigger: TriggerButton::Right,
                origin: pt(0, 0),
            }]
        );

        let key = t.handle(
            Input::KeyDown("KeyQ".into()),
            t0 + Duration::from_millis(10),
            &mut h,
        );
        assert_eq!(key.actions, vec![Action::KeyFired { key: "KeyQ".into() }]);
        assert!(key.swallow);

        let move_outcome = t.handle(
            Input::Move(pt(30, 0)),
            t0 + Duration::from_millis(20),
            &mut h,
        );
        assert_eq!(move_outcome.actions, vec![Action::PathGrow(pt(30, 0))]);

        let key_up = t.handle(
            Input::KeyUp("KeyQ".into()),
            t0 + Duration::from_millis(30),
            &mut h,
        );
        assert!(key_up.swallow && key_up.actions.is_empty());
    }

    #[test]
    fn post_gesture_wheel_swallowed_briefly() {
        let (mut t, mut h, t0) = setup(TrackerParams::default());
        t.handle(Input::ButtonDown(MouseButton::Right, pt(0, 0)), t0, &mut h);
        t.handle(Input::Move(pt(30, 0)), t0, &mut h);
        t.handle(Input::ButtonUp(MouseButton::Right, pt(30, 0)), t0, &mut h);

        let o = t.handle(
            Input::Wheel {
                forward: true,
                pos: pt(30, 0),
            },
            t0 + Duration::from_millis(100),
            &mut h,
        );
        assert!(o.swallow);
        let o = t.handle(
            Input::Wheel {
                forward: true,
                pos: pt(30, 0),
            },
            t0 + Duration::from_millis(400),
            &mut h,
        );
        assert!(!o.swallow);
    }
}

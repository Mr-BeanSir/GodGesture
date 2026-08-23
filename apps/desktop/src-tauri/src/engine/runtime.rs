//! 引擎运行时 —— 把平台钩子事件接到追踪器/识别器/意图查找,并分发产物。
//!
//! 线程模型:
//! - 钩子线程:同步裁决(吞/不吞)+ 轻逻辑(追踪器、识别器、意图查找,均 µs 级);
//! - 定时线程:驱动追踪器的超时(起始超时/停留超时),30ms 粒度仅在捕获期间轮询;
//! - 执行线程(engine worker):命令执行与覆盖层消息等重活,经 channel 接收。
//!
//! 平台层负责保持输入恢复时序。Windows 普通点击在当前低级钩子回调返回后由
//! 钩子消息泵重放;起始超时的 SynthesizeDown 仍同步执行以衔接后续真实抬起。

use super::audio::resolve_feedback_locale;
use super::boundary::{BoundaryMatcher, BoundaryReplay, BoundaryResult};
use super::capture::{classify_supplemental_input, GestureCapture, SupplementalDisposition};
use super::config::{
    BoundaryMouseButton, BoundaryToken, BoundaryWheelDirection, Command, ConfigDocument,
    GestureInput, GestureInputButton, GestureIntent, Locale,
};
use super::corners::{BoundaryGuideFrame, CornerEdgeDetector, CornerEdgeHit, ScreenInfo};
use super::intents::{ForegroundApp, IntentFinder};
use super::parser::StrokeEvent;
use super::tracker::{Action, Input, MouseButton, PathTracker, TrackerHost, TrackerParams};
use super::types::{Direction, Modifier, Point, TriggerButton};
use crossbeam_channel::{unbounded, Receiver, Sender};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 命令执行所需的手势上下文(平台无关;native_window 由平台层在解析前台窗口时填充)。
#[derive(Debug, Clone, Copy, Default)]
pub struct GestureContext {
    /// 手势起点(屏幕物理像素)
    pub origin: Point,
    /// 命令触发点/手势终点(屏幕物理像素)
    pub endpoint: Point,
    /// 目标窗口的不透明原生句柄(Windows = HWND as i64;0 表示无)
    pub native_window: i64,
}

/// 发往执行线程的消息(命令执行 + 视图更新)
#[derive(Debug, Clone)]
pub enum EngineMsg {
    PathStarted {
        trigger: TriggerButton,
        origin: Point,
    },
    PathGrown {
        point: Point,
    },
    /// 边缘准入会话的轨迹覆盖层事件。它与普通手势共用活动捕获核心,仅消息类型不同。
    BoundaryPathStarted {
        origin: Point,
    },
    BoundaryPathGrown {
        point: Point,
    },
    BoundaryPathEnded,
    BoundaryPathCancelled,
    BoundaryGuideChanged(Option<BoundaryGuideFrame>),
    /// 增量识别结果变化(None=无匹配),仅用于更新覆盖层提示。
    RecognitionChanged {
        name: Option<String>,
    },
    PathEnded {
        intent: Option<GestureIntent>,
        trigger: TriggerButton,
        modifier: Modifier,
        context: GestureContext,
    },
    PathCancelled,
    ModifierFired {
        intent: Option<GestureIntent>,
        trigger: TriggerButton,
        modifier: Modifier,
        context: GestureContext,
    },
    /// 录制模式下捕获到一条手势(设置界面的手势录制器消费)
    GestureCaptured {
        trigger: TriggerButton,
        strokes: Vec<Direction>,
        modifier: Modifier,
        inputs: Vec<GestureInput>,
    },
    /// 录制模式中的增量载荷(按下、笔画或修饰变化时推送)
    CaptureUpdated {
        trigger: TriggerButton,
        strokes: Vec<Direction>,
        modifier: Modifier,
        inputs: Vec<GestureInput>,
    },
    /// 触发角 / 摩擦边命中,命令已按配置解析出来
    CornerEdgeFired {
        intent_id: String,
        hit: CornerEdgeHit,
        command: Command,
        /// 命中时的光标位置(命令执行上下文的 origin)
        origin: Point,
    },
    /// 暂停状态由任意入口改变（设置、托盘、快捷键、和弦或命令）。
    PauseChanged(bool),
    /// 配置替换后同步 Node 插件集合。
    ScriptConfigChanged,
}

/// 输入事件来源与目标窗口的 Windows 完整性级别诊断。
///
/// macOS 和不支持该诊断的平台返回 `Unknown`;它不参与手势准入裁决。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputIntegrity {
    Unknown,
    Untrusted,
    Low,
    Medium,
    High,
    System,
    Protected,
}

impl InputIntegrity {
    pub fn is_higher_than(self, other: Self) -> bool {
        self.rank() > other.rank() && self != Self::Unknown && other != Self::Unknown
    }

    fn rank(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Untrusted => 1,
            Self::Low => 2,
            Self::Medium => 3,
            Self::High => 4,
            Self::System => 5,
            Self::Protected => 6,
        }
    }
}

/// 平台服务:运行时需要但因平台而异的操作(由 platform 层注入)
pub trait PlatformServices: Send + Sync {
    fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp;
    fn is_fullscreen(&self) -> bool;
    fn synthesize_click(&self, button: super::tracker::MouseButton, pos: Point);
    fn synthesize_down(&self, button: super::tracker::MouseButton, pos: Point);
    fn synthesize_wheel(&self, forward: bool);
    /// 光标所在显示器的完整边界与 DPI 缩放(触发角/摩擦边判定用)。
    /// 该点不属于任何已知显示器时返回 None。
    fn screen_at(&self, pos: Point) -> Option<ScreenInfo>;
    /// 返回系统 locale。平台实现可在后续边界接入真实系统值。
    fn system_locale(&self) -> Locale {
        Locale::En
    }
    /// Windows 通知区域等系统输入面应优先收到原生鼠标事件。
    /// 其它平台没有该类系统托盘命中判定时保持放行。
    fn is_system_tray_point(&self, _pos: Point) -> bool {
        false
    }
    /// 返回当前引擎进程和手势目标窗口的完整性级别,仅用于 Windows 诊断。
    fn input_integrity(
        &self,
        _pos: Point,
        _prefer_cursor_window: bool,
    ) -> (InputIntegrity, InputIntegrity) {
        (InputIntegrity::Unknown, InputIntegrity::Unknown)
    }
}

/// 手势进行中的会话状态(仅钩子线程与定时线程经锁访问)
struct Session {
    fg: ForegroundApp,
    trigger: TriggerButton,
    /// 手势起点(命令执行上下文用)
    origin: Point,
    /// 手势期间最后一次触发的修饰(用于命令上下文)
    active_modifier: Modifier,
    /// 普通和边角活动会话共用的输入账本、主释放键和消费记录。
    capture: GestureCapture,
    /// 上次增量识别的结果名(去重用)
    last_recognized: Option<String>,
}

/// 左键+中键和弦(暂停/继续)的检测状态
#[derive(Default)]
struct ChordState {
    left_down: bool,
    swallow_next_middle_up: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InputRoute {
    /// 边角准入没有拥有这条输入,继续交给普通手势准入或平台透传。
    Continue,
    /// 边角活动会话已经拥有这条输入,`swallow` 只决定平台是否吞掉它。
    Boundary { swallow: bool },
}

pub struct EngineShared {
    tracker: Mutex<PathTracker>,
    session: Mutex<Option<Session>>,
    finder: Mutex<IntentFinder>,
    paused: AtomicBool,
    /// 录制模式:设置界面录制手势时置位,期间放行一切前台/暂停限制且不执行命令
    recording: AtomicBool,
    platform: Arc<dyn PlatformServices>,
    tx: Sender<EngineMsg>,
    /// 有效点距(识别一笔所需位移):屏宽 * 0.025,由平台层在启动/分辨率变化时更新
    effective_move_px: Mutex<f64>,
    chord: Mutex<ChordState>,
    /// 触发角 / 摩擦边检测状态(仅钩子线程访问)
    corner_edge: Mutex<CornerEdgeDetector>,
    boundary: Mutex<BoundaryMatcher>,
    boundary_swallow_ups: AtomicU8,
    /// 物理按下的鼠标键位掩码 —— 任意键按下即抑制触发角/摩擦边。
    /// 从钩子事件自行累计,避免在钩子线程上做 GetAsyncKeyState 系统调用。
    buttons_down: AtomicU8,
    /// 两个开关的缓存,免得每条鼠标移动都去锁配置
    corners_enabled: AtomicBool,
    edges_enabled: AtomicBool,
    disable_in_fullscreen: AtomicBool,
    show_boundary_guide: AtomicBool,
    boundary_guide_last: Mutex<Option<BoundaryGuideFrame>>,
}

impl EngineShared {
    pub fn new(
        config: ConfigDocument,
        platform: Arc<dyn PlatformServices>,
    ) -> (Arc<Self>, Receiver<EngineMsg>) {
        let (tx, rx) = unbounded();
        let params = tracker_params_from(&config);
        let corners_enabled = config.hot_corners.enabled;
        let edges_enabled = config.rub_edges.enabled;
        let disable_in_fullscreen = config.preferences.path_tracker.disable_in_fullscreen;
        let show_boundary_guide = config.preferences.gesture_view.show_boundary_guide;
        let shared = Arc::new(Self {
            tracker: Mutex::new(PathTracker::new(params)),
            session: Mutex::new(None),
            finder: Mutex::new(IntentFinder::new(config)),
            paused: AtomicBool::new(false),
            recording: AtomicBool::new(false),
            platform,
            tx,
            effective_move_px: Mutex::new(48.0),
            chord: Mutex::new(ChordState::default()),
            corner_edge: Mutex::new(CornerEdgeDetector::new()),
            boundary: Mutex::new(BoundaryMatcher::default()),
            boundary_swallow_ups: AtomicU8::new(0),
            buttons_down: AtomicU8::new(0),
            corners_enabled: AtomicBool::new(corners_enabled),
            edges_enabled: AtomicBool::new(edges_enabled),
            disable_in_fullscreen: AtomicBool::new(disable_in_fullscreen),
            show_boundary_guide: AtomicBool::new(show_boundary_guide),
            boundary_guide_last: Mutex::new(None),
        });
        (shared, rx)
    }

    /// 进入手势录制模式。
    pub fn start_recording(&self) {
        self.clear_boundary_guide();
        self.cancel_boundary_sequence();
        self.recording.store(true, Ordering::SeqCst);
    }

    /// 退出录制并取消正在进行的捕获;下一次触发键抬起仍会被追踪器吞掉。
    pub fn cancel_recording(&self) {
        self.clear_boundary_guide();
        self.recording.store(false, Ordering::SeqCst);
        if self.tracker.lock().cancel_capture() {
            *self.session.lock() = None;
            let _ = self.tx.send(EngineMsg::PathCancelled);
        }
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
    }

    pub fn set_paused(&self, paused: bool) {
        if paused {
            self.clear_boundary_guide();
            self.cancel_boundary_sequence();
        }
        let previous = self.paused.swap(paused, Ordering::SeqCst);
        if previous != paused {
            let _ = self.tx.send(EngineMsg::PauseChanged(paused));
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp {
        self.platform
            .resolve_foreground_app(pos, prefer_cursor_window)
    }

    pub fn toggle_paused(&self) -> bool {
        let now = !self.paused.fetch_xor(true, Ordering::SeqCst);
        if now {
            self.clear_boundary_guide();
            self.cancel_boundary_sequence();
        }
        let _ = self.tx.send(EngineMsg::PauseChanged(now));
        now
    }

    pub fn set_effective_move_px(&self, px: f64) {
        *self.effective_move_px.lock() = px.max(8.0);
    }

    /// 配置变更(设置界面保存/同步拉取后调用)
    pub fn replace_config(&self, config: ConfigDocument) {
        self.cancel_boundary_sequence();
        self.tracker.lock().set_params(tracker_params_from(&config));
        let corners_enabled = config.hot_corners.enabled;
        let edges_enabled = config.rub_edges.enabled;
        let disable_in_fullscreen = config.preferences.path_tracker.disable_in_fullscreen;
        let show_boundary_guide = config.preferences.gesture_view.show_boundary_guide;
        let corners_changed = self
            .corners_enabled
            .swap(corners_enabled, Ordering::Relaxed)
            != corners_enabled;
        let edges_changed =
            self.edges_enabled.swap(edges_enabled, Ordering::Relaxed) != edges_enabled;
        let guide_preference_changed = self
            .show_boundary_guide
            .swap(show_boundary_guide, Ordering::Relaxed)
            != show_boundary_guide;
        self.disable_in_fullscreen
            .store(disable_in_fullscreen, Ordering::Relaxed);
        if corners_changed || edges_changed || guide_preference_changed {
            self.clear_boundary_guide();
        }
        self.finder.lock().replace_config(config);
        let _ = self.tx.send(EngineMsg::ScriptConfigChanged);
    }

    /// 暂停/继续快捷键 (修饰键列表, 主键)
    pub fn pause_hotkey(&self) -> (Vec<String>, String) {
        let finder = self.finder.lock();
        let hk = &finder.config().preferences.pause_hotkey;
        (hk.modifiers.clone(), hk.key.clone())
    }

    pub fn referenced_node_plugin_ids(&self) -> std::collections::HashSet<String> {
        self.finder.lock().config().referenced_node_plugin_ids()
    }

    pub fn command_feedback_preferences(&self) -> (Locale, bool, bool) {
        let finder = self.finder.lock();
        let preferences = &finder.config().preferences;
        (
            resolve_feedback_locale(preferences.locale, self.platform.system_locale()),
            preferences.gesture_view.show_command_name,
            preferences.gesture_view.fade_out,
        )
    }

    /// 触发键对应的轨迹配色与显示开关
    /// 返回 (主色, 未识别色, show_path, show_label, fade_out)
    pub fn trail_style_for(&self, trigger: TriggerButton) -> (u32, u32, bool, bool, bool) {
        let finder = self.finder.lock();
        let v = &finder.config().preferences.gesture_view;
        let main = match trigger {
            TriggerButton::Right => parse_argb(&v.right_button_path_color),
            TriggerButton::Middle => parse_argb(&v.middle_button_path_color),
            TriggerButton::X1 | TriggerButton::X2 => parse_argb(&v.x_button_path_color),
        };
        (
            main,
            parse_argb(&v.unrecognized_path_color),
            v.show_path,
            v.show_command_name,
            v.fade_out,
        )
    }

    fn set_boundary_guide(&self, next: Option<BoundaryGuideFrame>) {
        let mut last = self.boundary_guide_last.lock();
        if *last == next {
            return;
        }
        let _ = self.tx.send(EngineMsg::BoundaryGuideChanged(next));
        *last = next;
    }

    fn clear_boundary_guide(&self) {
        self.set_boundary_guide(None);
    }

    /// 钩子线程入口:裁决是否吞事件
    pub fn on_hook_event(self: &Arc<Self>, input: Input) -> bool {
        let button_event = match &input {
            Input::ButtonDown(button, point) => Some(("down", *button, *point)),
            Input::ButtonUp(button, point) => Some(("up", *button, *point)),
            _ => None,
        };
        let buttons_down_before = self.buttons_down.load(Ordering::Relaxed);
        let boundary_swallow_before = self.boundary_swallow_ups.load(Ordering::Relaxed);
        if let Some((phase, button, point)) = button_event {
            log::debug!(
                target: "gesture.capture",
                "event=engine_button_received phase={} button={:?} x={} y={} buttons_down_before={} boundary_swallow_ups_before={} tracker_capturing={}",
                phase,
                button,
                point.x,
                point.y,
                buttons_down_before,
                boundary_swallow_before,
                self.tracker.lock().is_capturing()
            );
        }
        let key_probe_phase = match &input {
            Input::KeyDown(key) if key == "KeyQ" => Some("down"),
            Input::KeyUp(key) if key == "KeyQ" => Some("up"),
            _ => None,
        };
        if let Some(phase) = key_probe_phase {
            log::debug!(
                target: "gesture.capture",
                "event=engine_input_received key=KeyQ phase={phase} recording={} capturing={}",
                self.is_recording(),
                self.tracker.lock().is_capturing()
            );
        }
        // 先记录物理按键状态:下面的和弦分支会提前 return,放这里才不会漏记
        match &input {
            Input::ButtonDown(b, _) => {
                self.buttons_down
                    .fetch_or(button_bit(*b), Ordering::Relaxed);
            }
            Input::ButtonUp(b, _) => {
                self.buttons_down
                    .fetch_and(!button_bit(*b), Ordering::Relaxed);
            }
            _ => {}
        }
        if self.buttons_down.load(Ordering::Relaxed) != 0 {
            self.clear_boundary_guide();
        }
        if let Input::ButtonUp(button, _) = &input {
            let bit = button_bit(*button);
            let mask_before = self.boundary_swallow_ups.fetch_and(!bit, Ordering::Relaxed);
            if mask_before & bit != 0 {
                log::debug!(
                    target: "gesture.boundary",
                    "event=boundary_up_swallowed button={:?} mask_before={} mask_after={} reason=replayed_click_release",
                    button,
                    mask_before,
                    mask_before & !bit
                );
                return true;
            }
        }

        // System tray icons must receive their native click sequence. Only
        // bypass gesture admission when no existing capture owns the input;
        // an active gesture still has priority for its secondary buttons.
        if let Input::ButtonDown(button, pos) = &input {
            let capture_active =
                self.tracker.lock().is_capturing() || self.boundary.lock().is_active();
            if !capture_active && !self.is_recording() && self.platform.is_system_tray_point(*pos) {
                log::debug!(
                    target: "platform.windows",
                    "event=system_tray_input_passthrough phase=down button={:?} x={} y={}",
                    button,
                    pos.x,
                    pos.y
                );
                return false;
            }
        }

        let now = Instant::now();
        if let InputRoute::Boundary { swallow } = self.route_boundary_input(&input, now) {
            if let Some((phase, button, point)) = button_event {
                log::debug!(
                    target: "gesture.boundary",
                    "event=engine_button_boundary_completed phase={} button={:?} x={} y={} swallowed={} boundary_active_after={}",
                    phase,
                    button,
                    point.x,
                    point.y,
                    swallow,
                    self.boundary.lock().is_active()
                );
            }
            return swallow;
        }
        let move_pos = match &input {
            Input::Move(p) => Some(*p),
            _ => None,
        };
        // 左键+中键和弦 = 暂停/继续(仅在非捕获状态,对齐 WGestures)
        {
            let mut chord = self.chord.lock();
            match &input {
                Input::ButtonDown(MouseButton::Left, _) => chord.left_down = true,
                Input::ButtonUp(MouseButton::Left, _) => chord.left_down = false,
                Input::ButtonDown(MouseButton::Middle, _)
                    if chord.left_down && !self.tracker.lock().is_capturing() =>
                {
                    chord.swallow_next_middle_up = true;
                    let paused = self.toggle_paused();
                    log::info!("和弦: 手势{}", if paused { "已暂停" } else { "已继续" });
                    return true;
                }
                Input::ButtonUp(MouseButton::Middle, _) if chord.swallow_next_middle_up => {
                    chord.swallow_next_middle_up = false;
                    return true;
                }
                _ => {}
            }
        }

        let mut host = HostImpl { shared: self };
        let outcome = self.tracker.lock().handle(input, now, &mut host);
        let path_threshold_crossed = move_pos.is_some()
            && outcome
                .actions
                .iter()
                .any(|action| matches!(action, Action::PathStart { .. }));
        let action_count = outcome.actions.len();
        if let Some(phase) = key_probe_phase {
            log::debug!(
                target: "gesture.capture",
                "event=engine_input_completed key=KeyQ phase={phase} swallowed={} action_count={}",
                outcome.swallow,
                outcome.actions.len()
            );
        }
        self.apply_actions(outcome.actions);

        if let Some((phase, button, point)) = button_event {
            log::debug!(
                target: "gesture.capture",
                "event=engine_button_tracker_completed phase={} button={:?} x={} y={} swallowed={} tracker_capturing_after={}",
                phase,
                button,
                point.x,
                point.y,
                outcome.swallow,
                self.tracker.lock().is_capturing()
            );
        }

        if path_threshold_crossed {
            if let Some(point) = move_pos {
                log::debug!(
                    target: "gesture.capture",
                    "event=path_threshold_crossed x={} y={} action_count={} swallowed={} tracker_capturing_after={}",
                    point.x,
                    point.y,
                    action_count,
                    outcome.swallow,
                    self.tracker.lock().is_capturing()
                );
            }
        }

        // 触发角 / 摩擦边:纯观察,不参与吞事件的裁决
        if let Some(pos) = move_pos {
            self.detect_corner_edge(pos, now);
        }
        outcome.swallow
    }

    fn route_boundary_input(&self, input: &Input, now: Instant) -> InputRoute {
        if !matches!(input, Input::ButtonUp(_, _)) {
            let anchor = self.boundary.lock().release_anchor();
            let held_anchor = anchor.filter(|button| {
                self.buttons_down.load(Ordering::Relaxed) & button_bit(*button) != 0
            });
            let timeout_result = self.boundary.lock().tick_with_held_anchor(now, held_anchor);
            self.apply_boundary_result(timeout_result);
        }
        if self.boundary.lock().is_active() {
            return match input {
                Input::ButtonDown(button, pos) => {
                    let (result, recognized) = {
                        let mut boundary = self.boundary.lock();
                        let was_waiting = boundary.is_waiting_for_button_up();
                        let result = boundary.feed(
                            BoundaryToken::Button {
                                button: boundary_button(*button),
                            },
                            Some(BoundaryReplay::Click {
                                button: *button,
                                pos: *pos,
                            }),
                            now,
                        );
                        let recognized =
                            (!was_waiting).then(|| boundary.recognized_name()).flatten();
                        (result, recognized)
                    };
                    let swallow = matches!(
                        result,
                        BoundaryResult::Pending | BoundaryResult::Complete { .. }
                    );
                    self.apply_boundary_result(result);
                    self.emit_boundary_recognition(recognized);
                    InputRoute::Boundary { swallow }
                }
                Input::Wheel { forward, .. } => {
                    let (result, recognized) = {
                        let mut boundary = self.boundary.lock();
                        let was_waiting = boundary.is_waiting_for_button_up();
                        let result = boundary.feed(
                            BoundaryToken::Wheel {
                                direction: if *forward {
                                    BoundaryWheelDirection::Forward
                                } else {
                                    BoundaryWheelDirection::Backward
                                },
                            },
                            Some(BoundaryReplay::Wheel { forward: *forward }),
                            now,
                        );
                        let recognized =
                            (!was_waiting).then(|| boundary.recognized_name()).flatten();
                        (result, recognized)
                    };
                    let swallow = matches!(
                        result,
                        BoundaryResult::Pending | BoundaryResult::Complete { .. }
                    );
                    self.apply_boundary_result(result);
                    self.emit_boundary_recognition(recognized);
                    InputRoute::Boundary { swallow }
                }
                Input::Move(point) => {
                    let _ = self.tx.send(EngineMsg::BoundaryPathGrown { point: *point });
                    let (result, recognized) = {
                        let mut boundary = self.boundary.lock();
                        let was_waiting = boundary.is_waiting_for_button_up();
                        let result = boundary.feed_move(*point, now);
                        let recognized =
                            (!was_waiting).then(|| boundary.recognized_name()).flatten();
                        (result, recognized)
                    };
                    self.apply_boundary_result(result);
                    self.emit_boundary_recognition(recognized);
                    InputRoute::Boundary { swallow: false }
                }
                Input::ButtonUp(button, _) => {
                    if self.boundary.lock().is_waiting_for_button_up() {
                        let (result, swallow_consumed_up) = {
                            let mut boundary = self.boundary.lock();
                            let result = boundary.release(*button);
                            let swallow = boundary.is_consumed_button_up(*button);
                            (result, swallow)
                        };
                        if matches!(result, BoundaryResult::Complete { .. }) {
                            self.apply_boundary_result(result);
                            return InputRoute::Boundary { swallow: true };
                        }
                        return InputRoute::Boundary {
                            swallow: swallow_consumed_up,
                        };
                    }
                    log::debug!(
                        target: "gesture.boundary",
                        "event=boundary_cancelled reason=button_up_before_sequence_complete button={:?}",
                        button
                    );
                    let has_trail = self.boundary.lock().has_trail();
                    let result = self.boundary.lock().cancel();
                    let swallow = matches!(
                        &result,
                        BoundaryResult::Cancelled { replay }
                            if replay.iter().any(|entry| matches!(
                                entry,
                                BoundaryReplay::Click { button: replay_button, .. }
                                    if replay_button == button
                            ))
                    ) || has_trail;
                    self.apply_boundary_result(result);
                    if swallow {
                        self.boundary_swallow_ups
                            .fetch_and(!button_bit(*button), Ordering::Relaxed);
                    }
                    InputRoute::Boundary { swallow }
                }
                Input::KeyDown(_) | Input::KeyUp(_) => {
                    let result = self.boundary.lock().cancel();
                    self.apply_boundary_result(result);
                    InputRoute::Boundary { swallow: false }
                }
            };
        }
        self.try_activate_boundary_input(input, now)
    }

    /// 边角捕获只在首个按钮/滚轮输入到来时按当前位置进入;无匹配候选时也保留视觉捕获,
    /// 移动本身不再武装它,且不会让 PathTracker 接管。
    fn try_activate_boundary_input(&self, input: &Input, now: Instant) -> InputRoute {
        let (pos, token, replay) = match input {
            Input::ButtonDown(button, pos) => (
                *pos,
                BoundaryToken::Button {
                    button: boundary_button(*button),
                },
                Some(BoundaryReplay::Click {
                    button: *button,
                    pos: *pos,
                }),
            ),
            Input::Wheel { forward, pos } => (
                *pos,
                BoundaryToken::Wheel {
                    direction: if *forward {
                        BoundaryWheelDirection::Forward
                    } else {
                        BoundaryWheelDirection::Backward
                    },
                },
                Some(BoundaryReplay::Wheel { forward: *forward }),
            ),
            _ => return InputRoute::Continue,
        };
        if self.is_paused() || self.is_recording() || self.tracker.lock().is_capturing() {
            return InputRoute::Continue;
        }
        let disable_in_fullscreen = self
            .finder
            .lock()
            .config()
            .preferences
            .path_tracker
            .disable_in_fullscreen;
        if disable_in_fullscreen && self.platform.is_fullscreen() {
            return InputRoute::Continue;
        }
        let Some(hit) = self
            .corner_edge
            .lock()
            .sequence_at(pos, now, || self.platform.screen_at(pos))
        else {
            return InputRoute::Continue;
        };
        let activated = {
            let finder = self.finder.lock();
            let config = finder.config();
            let effective = *self.effective_move_px.lock();
            self.boundary
                .lock()
                .activate_for_input(config, hit, pos, now, effective, &token)
        };
        if !matches!(activated, BoundaryResult::Pending) {
            self.apply_boundary_result(activated);
            return InputRoute::Continue;
        }
        let (result, recognized) = {
            let mut boundary = self.boundary.lock();
            let result = boundary.feed(token, replay, now);
            let recognized = boundary.recognized_name();
            (result, recognized)
        };
        let accepted = matches!(
            &result,
            BoundaryResult::Pending | BoundaryResult::Complete { .. }
        );
        if accepted {
            self.corner_edge.lock().reset_rub();
            self.start_boundary_path(pos);
        }
        self.apply_boundary_result(result);
        self.emit_boundary_recognition(recognized);
        InputRoute::Boundary { swallow: accepted }
    }

    fn emit_boundary_recognition(&self, name: Option<String>) {
        if let Some(name) = name {
            let _ = self
                .tx
                .send(EngineMsg::RecognitionChanged { name: Some(name) });
        }
    }

    fn apply_boundary_result(&self, result: BoundaryResult) {
        match result {
            BoundaryResult::Idle | BoundaryResult::Pending => {}
            BoundaryResult::Complete {
                intent,
                hit,
                origin,
                consumed,
                released_button,
                released_buttons,
            } => {
                for replay in consumed {
                    if let BoundaryReplay::Click { button, .. } = replay {
                        if released_button != Some(button) && !released_buttons.contains(&button) {
                            let bit = button_bit(button);
                            let mask_before =
                                self.boundary_swallow_ups.fetch_or(bit, Ordering::Relaxed);
                            log::debug!(
                                target: "gesture.boundary",
                                "event=boundary_release_mask_set button={:?} mask_before={} mask_after={} reason=completed_consumed_button",
                                button,
                                mask_before,
                                mask_before | bit
                            );
                        }
                    }
                }
                let _ = self.tx.send(EngineMsg::RecognitionChanged {
                    name: Some(intent.name.clone()),
                });
                let _ = self.tx.send(EngineMsg::BoundaryPathEnded);
                let _ = self.tx.send(EngineMsg::CornerEdgeFired {
                    intent_id: intent.id.clone(),
                    hit,
                    command: intent.command.clone(),
                    origin,
                });
            }
            BoundaryResult::Cancelled { replay } => {
                log::debug!(
                    target: "gesture.boundary",
                    "event=boundary_cancelled replay_count={}",
                    replay.len()
                );
                let _ = self.tx.send(EngineMsg::BoundaryPathCancelled);
                for input in replay {
                    match input {
                        BoundaryReplay::Click { button, pos } => {
                            let bit = button_bit(button);
                            let mask_before =
                                self.boundary_swallow_ups.fetch_or(bit, Ordering::Relaxed);
                            log::debug!(
                                target: "gesture.boundary",
                                "event=boundary_replay_click button={:?} x={} y={} swallow_mask_before={} swallow_mask_after={}",
                                button,
                                pos.x,
                                pos.y,
                                mask_before,
                                mask_before | bit
                            );
                            self.platform.synthesize_click(button, pos);
                        }
                        BoundaryReplay::Wheel { forward } => {
                            self.platform.synthesize_wheel(forward);
                        }
                    }
                }
            }
        }
    }

    fn start_boundary_path(&self, pos: Point) {
        self.clear_boundary_guide();
        log::debug!(
            target: "gesture.boundary",
            "event=boundary_path_started x={} y={}",
            pos.x,
            pos.y
        );
        let _ = self.tx.send(EngineMsg::BoundaryPathStarted { origin: pos });
    }

    fn cancel_boundary_sequence(&self) {
        let (was_active, result) = {
            let mut boundary = self.boundary.lock();
            (boundary.is_active(), boundary.cancel())
        };
        self.apply_boundary_result(result);
        if was_active {
            self.clear_boundary_guide();
        }
    }

    /// 触发角 / 摩擦边判定(钩子线程)。命中即把解析好的命令投给执行线程 ——
    /// 命令执行可能很慢(如取选中文本要轮询剪贴板 ~200ms),绝不能在钩子线程里做。
    fn detect_corner_edge(self: &Arc<Self>, pos: Point, now: Instant) {
        let corners = self.corners_enabled.load(Ordering::Relaxed);
        let edges = self.edges_enabled.load(Ordering::Relaxed);
        if !corners && !edges {
            self.clear_boundary_guide();
            return;
        }
        // 暂停 / 录制 / 手势捕获中:整个状态机停摆,不喂数据。
        // 参考实现里 _isPaused 短路整个钩子过程、_captured 挡住触发角判定的调用点,
        // 语义一致;录制期间抑制是本项目有意加的(见 corners.rs 头部说明)。
        if self.is_paused() || self.is_recording() {
            self.clear_boundary_guide();
            return;
        }
        if self.tracker.lock().is_capturing() {
            self.clear_boundary_guide();
            return;
        }
        if self.boundary.lock().is_active() {
            self.clear_boundary_guide();
            return;
        }

        let buttons_held = self.buttons_down.load(Ordering::Relaxed) != 0;
        let disable_in_fullscreen = self.disable_in_fullscreen.load(Ordering::Relaxed);
        let show_boundary_guide = self.show_boundary_guide.load(Ordering::Relaxed);
        let fullscreen_suppressed =
            show_boundary_guide && disable_in_fullscreen && self.platform.is_fullscreen();
        let guide = if show_boundary_guide && !buttons_held && !fullscreen_suppressed {
            self.corner_edge.lock().guide_at(
                pos,
                now,
                || self.platform.screen_at(pos),
                corners,
                edges,
            )
        } else {
            None
        };
        self.set_boundary_guide(guide);

        let Some(hit) = self
            .corner_edge
            .lock()
            .on_move(pos, now, || self.platform.screen_at(pos))
        else {
            return;
        };

        // 鼠标键按下时**照样喂状态机**,只是不执行命令 —— 参考实现的按键判定在分发处
        // (OnHotCorner / OnRubEdge),不在检测处,于是命中会"烧掉"这一次武装。
        // 这个位置差别是用户可见的:按住左键把窗口拖到左上角(Aero Snap)再松手,
        // 若在喂之前就 return,武装被完整保留,松手后随便动一下就会误触发角命令 ——
        // 等于每次贴角吸附窗口都白触发一次。
        if buttons_held {
            return;
        }

        // 全屏抑制与手势共用同一偏好;guide 开启时上面已查询并复用结果。
        if disable_in_fullscreen
            && (fullscreen_suppressed || (!show_boundary_guide && self.platform.is_fullscreen()))
        {
            return;
        }
        let result = {
            let finder = self.finder.lock();
            self.boundary
                .lock()
                .activate_immediate(finder.config(), hit, pos)
        };
        self.apply_boundary_result(result);
    }

    /// 定时线程入口
    fn on_tick(self: &Arc<Self>, now: Instant) {
        let anchor = self.boundary.lock().release_anchor();
        let held_anchor = anchor
            .filter(|button| self.buttons_down.load(Ordering::Relaxed) & button_bit(*button) != 0);
        let boundary = self.boundary.lock().tick_with_held_anchor(now, held_anchor);
        self.apply_boundary_result(boundary);
        let actions = self.tracker.lock().tick(now);
        self.apply_actions(actions);
    }

    fn apply_actions(self: &Arc<Self>, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::PathStart { trigger, origin } => {
                    let prefer_cursor = self
                        .finder
                        .lock()
                        .config()
                        .preferences
                        .path_tracker
                        .prefer_cursor_window;
                    let fg = self.platform.resolve_foreground_app(origin, prefer_cursor);
                    let eff = *self.effective_move_px.lock();
                    *self.session.lock() = Some(Session {
                        fg,
                        trigger,
                        origin,
                        active_modifier: Modifier::None,
                        capture: GestureCapture::new(
                            origin,
                            eff,
                            Some(trigger_mouse_button(trigger)),
                        ),
                        last_recognized: None,
                    });
                    let _ = self.tx.send(EngineMsg::PathStarted { trigger, origin });
                    if self.is_recording() {
                        let _ = self.tx.send(EngineMsg::CaptureUpdated {
                            trigger,
                            strokes: Vec::new(),
                            modifier: Modifier::None,
                            inputs: Vec::new(),
                        });
                    }
                }
                Action::PathGrow(pt) => {
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        let grew = s.capture.feed_move(pt) == StrokeEvent::Grew;
                        if grew {
                            s.capture.sync_strokes();
                        }
                        let _ = self.tx.send(EngineMsg::PathGrown { point: pt });
                        if grew && self.is_recording() {
                            let _ = self.tx.send(EngineMsg::CaptureUpdated {
                                trigger: s.trigger,
                                strokes: s.capture.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.capture.inputs().to_vec(),
                            });
                        }
                        if grew {
                            let recognized = self
                                .finder
                                .lock()
                                .find_inputs(s.trigger, s.capture.inputs(), &s.fg)
                                .map(|intent| intent.name.clone());
                            if recognized != s.last_recognized {
                                s.last_recognized = recognized.clone();
                                let _ = self
                                    .tx
                                    .send(EngineMsg::RecognitionChanged { name: recognized });
                            }
                        }
                    }
                }
                Action::ModifierFired { modifier: m, pos } => {
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        s.active_modifier = m;
                        let input = modifier_to_input(m);
                        let ordered_prefix = input.as_ref().is_some_and(|input| {
                            let mut prefix = s.capture.inputs().to_vec();
                            prefix.push(input.clone());
                            self.finder
                                .lock()
                                .any_inputs_with_prefix(s.trigger, &prefix, &s.fg)
                        });
                        let independent_intent = if !self.is_recording() && !ordered_prefix {
                            self.finder
                                .lock()
                                .find_modifier(s.trigger, s.capture.inputs(), m, &s.fg)
                                .cloned()
                        } else {
                            None
                        };
                        let disposition =
                            input
                                .as_ref()
                                .map_or(SupplementalDisposition::Unmatched, |input| {
                                    if self.is_recording() {
                                        SupplementalDisposition::Ordered
                                    } else {
                                        classify_supplemental_input(
                                            s.capture.inputs(),
                                            input,
                                            m,
                                            |_| ordered_prefix,
                                            independent_intent.is_some(),
                                        )
                                    }
                                });
                        let intent = match (disposition, input) {
                            (SupplementalDisposition::IndependentModifier, _) => {
                                // Independent modifiers do not enter the ordered
                                // input list, so the same event can fire again.
                                independent_intent
                            }
                            (
                                SupplementalDisposition::Ordered
                                | SupplementalDisposition::Unmatched,
                                Some(input),
                            ) => {
                                s.capture.push_ordered(
                                    input.clone(),
                                    None,
                                    gesture_input_button(&input),
                                );
                                None
                            }
                            (_, None) => None,
                        };
                        if !self.is_recording() {
                            let recognized = self
                                .finder
                                .lock()
                                .find_inputs(s.trigger, s.capture.inputs(), &s.fg)
                                .map(|intent| intent.name.clone());
                            if recognized != s.last_recognized {
                                s.last_recognized = recognized.clone();
                                let _ = self
                                    .tx
                                    .send(EngineMsg::RecognitionChanged { name: recognized });
                            }
                        }
                        let context = GestureContext {
                            origin: s.origin,
                            endpoint: pos,
                            native_window: s.fg.native_window,
                        };
                        if self.is_recording() {
                            let _ = self.tx.send(EngineMsg::CaptureUpdated {
                                trigger: s.trigger,
                                strokes: s.capture.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.capture.inputs().to_vec(),
                            });
                        }
                        let _ = self.tx.send(EngineMsg::ModifierFired {
                            intent,
                            trigger: s.trigger,
                            modifier: m,
                            context,
                        });
                    }
                }
                Action::KeyFired { key } => {
                    if key == "KeyQ" {
                        log::debug!(
                            target: "gesture.capture",
                            "event=key_fired key=KeyQ recording={}",
                            self.is_recording()
                        );
                    }
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        s.capture.inputs_mut().push(GestureInput::Key { key });
                        if !self.is_recording() {
                            let recognized = self
                                .finder
                                .lock()
                                .find_inputs(s.trigger, s.capture.inputs(), &s.fg)
                                .map(|intent| intent.name.clone());
                            if recognized != s.last_recognized {
                                s.last_recognized = recognized.clone();
                                let _ = self
                                    .tx
                                    .send(EngineMsg::RecognitionChanged { name: recognized });
                            }
                        } else {
                            let _ = self.tx.send(EngineMsg::CaptureUpdated {
                                trigger: s.trigger,
                                strokes: s.capture.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.capture.inputs().to_vec(),
                            });
                        }
                    }
                }
                Action::PathEnd { pos } => {
                    log::debug!(
                        target: "gesture.capture",
                        "event=path_end_emitted x={} y={}",
                        pos.x,
                        pos.y
                    );
                    let session = self.session.lock().take();
                    if let Some(s) = session {
                        // 录制模式:只上报捕获到的手势,不查找/不执行命令。
                        // 录制持续到前端显式 cancel_recording,期间可反复重画覆盖上一次结果,
                        // 避免录制器开着时误执行命令(例如把设置窗口关掉)。
                        if self.is_recording() {
                            let _ = self.tx.send(EngineMsg::GestureCaptured {
                                trigger: s.trigger,
                                strokes: s.capture.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.capture.inputs().to_vec(),
                            });
                            continue;
                        }
                        let context = GestureContext {
                            origin: s.origin,
                            endpoint: pos,
                            native_window: s.fg.native_window,
                        };
                        let finder = self.finder.lock();
                        let intent = finder
                            .find_inputs(s.trigger, s.capture.inputs(), &s.fg)
                            .or_else(|| {
                                // 带附加输入未命中时回退纯笔画意图。
                                let strokes = s
                                    .capture
                                    .strokes()
                                    .iter()
                                    .copied()
                                    .map(|direction| GestureInput::Stroke { direction })
                                    .collect::<Vec<_>>();
                                finder.find_inputs(s.trigger, &strokes, &s.fg)
                            })
                            .cloned();
                        let _ = self.tx.send(EngineMsg::PathEnded {
                            intent,
                            trigger: s.trigger,
                            modifier: s.active_modifier,
                            context,
                        });
                    }
                }
                Action::PathTimeout => {
                    *self.session.lock() = None;
                    let _ = self.tx.send(EngineMsg::PathCancelled);
                }
                Action::SynthesizeClick { button, pos } => {
                    *self.session.lock() = None;
                    self.platform.synthesize_click(button, pos);
                }
                Action::SynthesizeDown { button, pos } => {
                    *self.session.lock() = None;
                    self.platform.synthesize_down(button, pos);
                }
            }
        }
    }

    /// 启动定时线程(随返回的 handle 存活;进程级单例,不考虑关停)
    pub fn spawn_timer_thread(self: &Arc<Self>) {
        let shared = Arc::clone(self);
        std::thread::Builder::new()
            .name("gg-engine-timer".into())
            .spawn(move || loop {
                let capturing = shared.tracker.lock().is_capturing();
                std::thread::sleep(if capturing {
                    Duration::from_millis(30)
                } else {
                    Duration::from_millis(200)
                });
                shared.on_tick(Instant::now());
            })
            .expect("failed to spawn engine timer thread");
    }
}

struct HostImpl<'a> {
    shared: &'a Arc<EngineShared>,
}

impl TrackerHost for HostImpl<'_> {
    fn is_gesturing_allowed(&mut self, pos: Point) -> bool {
        let shared = self.shared;
        // 录制模式:放行一切(即便暂停/黑名单/全屏),以便在任意界面上录制手势
        if shared.is_recording() {
            return true;
        }
        if shared.is_paused() {
            return false;
        }
        let (prefer_cursor, disable_fullscreen) = {
            let finder = shared.finder.lock();
            let p = &finder.config().preferences.path_tracker;
            (p.prefer_cursor_window, p.disable_in_fullscreen)
        };
        if disable_fullscreen && shared.platform.is_fullscreen() {
            log::debug!(
                target: "gesture.capture",
                "event=tracker_admission_denied reason=fullscreen x={} y={}",
                pos.x,
                pos.y
            );
            return false;
        }
        let fg = shared.platform.resolve_foreground_app(pos, prefer_cursor);
        let (allowed, matched_app) = {
            let finder = shared.finder.lock();
            (
                finder.is_gesturing_enabled_for(&fg),
                finder.match_app(&fg).map(|app| app.id.clone()),
            )
        };
        let (self_integrity, target_integrity) =
            shared.platform.input_integrity(pos, prefer_cursor);
        log::debug!(
            target: "gesture.capture",
            "event=tracker_admission_decision x={} y={} allowed={} matched_app={:?} exe={:?} aumid={:?} prefer_cursor_window={} self_integrity={:?} target_integrity={:?} elevation_boundary={}",
            pos.x,
            pos.y,
            allowed,
            matched_app,
            fg.exe_name,
            fg.aumid,
            prefer_cursor,
            self_integrity,
            target_integrity,
            target_integrity.is_higher_than(self_integrity)
        );
        allowed
    }

    fn is_recording(&self) -> bool {
        self.shared.is_recording()
    }
}

/// 鼠标键在 `buttons_down` 掩码里的位
fn button_bit(button: MouseButton) -> u8 {
    match button {
        MouseButton::Left => 1,
        MouseButton::Middle => 1 << 1,
        MouseButton::Right => 1 << 2,
        MouseButton::X1 => 1 << 3,
        MouseButton::X2 => 1 << 4,
    }
}

fn boundary_button(button: MouseButton) -> BoundaryMouseButton {
    match button {
        MouseButton::Left => BoundaryMouseButton::Left,
        MouseButton::Middle => BoundaryMouseButton::Middle,
        MouseButton::Right => BoundaryMouseButton::Right,
        MouseButton::X1 => BoundaryMouseButton::X1,
        MouseButton::X2 => BoundaryMouseButton::X2,
    }
}

fn modifier_to_input(modifier: Modifier) -> Option<GestureInput> {
    Some(match modifier {
        Modifier::None => return None,
        Modifier::WheelForward => GestureInput::Wheel {
            direction: BoundaryWheelDirection::Forward,
        },
        Modifier::WheelBackward => GestureInput::Wheel {
            direction: BoundaryWheelDirection::Backward,
        },
        Modifier::LeftButtonDown => GestureInput::Button {
            button: GestureInputButton::Left,
        },
        Modifier::MiddleButtonDown => GestureInput::Button {
            button: GestureInputButton::Middle,
        },
        Modifier::RightButtonDown => GestureInput::Button {
            button: GestureInputButton::Right,
        },
        Modifier::X1Down => GestureInput::Button {
            button: GestureInputButton::X1,
        },
        Modifier::X2Down => GestureInput::Button {
            button: GestureInputButton::X2,
        },
    })
}

fn trigger_mouse_button(trigger: TriggerButton) -> MouseButton {
    match trigger {
        TriggerButton::Right => MouseButton::Right,
        TriggerButton::Middle => MouseButton::Middle,
        TriggerButton::X1 => MouseButton::X1,
        TriggerButton::X2 => MouseButton::X2,
    }
}

fn gesture_input_button(input: &GestureInput) -> Option<MouseButton> {
    match input {
        GestureInput::Button { button } => Some(match button {
            GestureInputButton::Left => MouseButton::Left,
            GestureInputButton::Middle => MouseButton::Middle,
            GestureInputButton::Right => MouseButton::Right,
            GestureInputButton::X1 => MouseButton::X1,
            GestureInputButton::X2 => MouseButton::X2,
        }),
        GestureInput::Stroke { .. } | GestureInput::Wheel { .. } | GestureInput::Key { .. } => None,
    }
}

/// "#AARRGGBB" → u32(解析失败返回不透明白,便于肉眼发现配置错误)
fn parse_argb(s: &str) -> u32 {
    s.strip_prefix('#')
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .unwrap_or(0xFFFFFFFF)
}

fn tracker_params_from(config: &ConfigDocument) -> TrackerParams {
    let p = &config.preferences.path_tracker;
    TrackerParams {
        trigger_buttons: p.trigger_buttons.clone(),
        initial_valid_move_px: p.initial_valid_move_px,
        initial_stay_timeout: p.initial_stay_timeout,
        initial_stay_timeout_ms: p.initial_stay_timeout_ms,
        stay_timeout: p.stay_timeout,
        stay_timeout_ms: p.stay_timeout_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::{BoundaryIntent, BoundaryOrigin, GestureIntent, GestureSpecConfig};
    use crate::engine::corners::ScreenEdge;
    use crate::engine::corners::{ScreenCorner, ScreenRect};

    struct StubPlatform;

    impl PlatformServices for StubPlatform {
        fn resolve_foreground_app(
            &self,
            _pos: Point,
            _prefer_cursor_window: bool,
        ) -> ForegroundApp {
            ForegroundApp::default()
        }

        fn is_fullscreen(&self) -> bool {
            false
        }

        fn synthesize_click(&self, _button: MouseButton, _pos: Point) {}

        fn synthesize_down(&self, _button: MouseButton, _pos: Point) {}

        fn synthesize_wheel(&self, _forward: bool) {}

        fn screen_at(&self, _pos: Point) -> Option<ScreenInfo> {
            None
        }
    }

    struct ZhCnPlatform;

    impl PlatformServices for ZhCnPlatform {
        fn resolve_foreground_app(
            &self,
            _pos: Point,
            _prefer_cursor_window: bool,
        ) -> ForegroundApp {
            ForegroundApp::default()
        }

        fn is_fullscreen(&self) -> bool {
            false
        }

        fn synthesize_click(&self, _button: MouseButton, _pos: Point) {}

        fn synthesize_down(&self, _button: MouseButton, _pos: Point) {}

        fn synthesize_wheel(&self, _forward: bool) {}

        fn screen_at(&self, _pos: Point) -> Option<ScreenInfo> {
            None
        }

        fn system_locale(&self) -> Locale {
            Locale::ZhCn
        }
    }

    #[test]
    fn pause_changes_are_atomic_and_published() {
        let (shared, rx) = EngineShared::new(ConfigDocument::default(), Arc::new(StubPlatform));

        assert!(shared.toggle_paused());
        assert!(matches!(rx.recv().unwrap(), EngineMsg::PauseChanged(true)));
        shared.set_paused(false);
        assert!(matches!(rx.recv().unwrap(), EngineMsg::PauseChanged(false)));
    }

    #[test]
    fn command_feedback_preferences_resolve_locale_and_view_flags() {
        let mut config = ConfigDocument::default();
        config.preferences.locale = Locale::Auto;
        config.preferences.gesture_view.show_command_name = false;
        config.preferences.gesture_view.fade_out = false;
        let (shared, _rx) = EngineShared::new(config, Arc::new(ZhCnPlatform));

        assert_eq!(
            shared.command_feedback_preferences(),
            (Locale::ZhCn, false, false)
        );
    }

    #[test]
    fn recording_preserves_button_then_stroke_input_order() {
        let (shared, rx) = EngineShared::new(ConfigDocument::default(), Arc::new(StubPlatform));
        shared.start_recording();

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Middle, Point { x: 0, y: 0 },)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));

        let mut captured = None;
        for message in rx.try_iter() {
            if let EngineMsg::GestureCaptured { inputs, .. } = message {
                captured = Some(inputs);
            }
        }
        assert_eq!(
            captured,
            Some(vec![
                GestureInput::Button {
                    button: GestureInputButton::Middle,
                },
                GestureInput::Stroke {
                    direction: Direction::Right,
                },
            ])
        );
    }

    #[test]
    fn recording_rewrites_diagonal_stroke_in_ordered_inputs() {
        let (shared, rx) = EngineShared::new(ConfigDocument::default(), Arc::new(StubPlatform));
        shared.start_recording();
        shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 }));
        shared.on_hook_event(Input::Move(Point { x: 100, y: -100 }));
        shared.on_hook_event(Input::Move(Point { x: 200, y: -100 }));
        shared.on_hook_event(Input::ButtonUp(
            MouseButton::Right,
            Point { x: 200, y: -100 },
        ));

        let captured = rx.try_iter().find_map(|message| match message {
            EngineMsg::GestureCaptured {
                inputs, strokes, ..
            } => Some((inputs, strokes)),
            _ => None,
        });
        assert_eq!(
            captured,
            Some((
                vec![
                    GestureInput::Stroke {
                        direction: Direction::Up,
                    },
                    GestureInput::Stroke {
                        direction: Direction::Right,
                    },
                ],
                vec![Direction::Up, Direction::Right],
            ))
        );
    }

    #[test]
    fn recording_preserves_keyboard_input_order() {
        let (shared, rx) = EngineShared::new(ConfigDocument::default(), Arc::new(StubPlatform));
        shared.start_recording();

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(shared.on_hook_event(Input::KeyDown("KeyQ".into())));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        assert!(shared.on_hook_event(Input::KeyUp("KeyQ".into())));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));

        let captured = rx.try_iter().find_map(|message| match message {
            EngineMsg::GestureCaptured { inputs, .. } => Some(inputs),
            _ => None,
        });
        assert_eq!(
            captured,
            Some(vec![
                GestureInput::Key { key: "KeyQ".into() },
                GestureInput::Stroke {
                    direction: Direction::Right,
                },
            ])
        );
    }

    #[test]
    fn ordered_button_input_wins_over_an_independent_modifier() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = ConfigDocument::default();
        config.global.intents = vec![
            GestureIntent {
                id: "50000000-0000-4000-8000-000000000010".into(),
                name: "Ordered left click".into(),
                enabled: true,
                gesture: GestureSpecConfig {
                    trigger: TriggerButton::Right,
                    strokes: vec![Direction::Right],
                    modifier: Modifier::None,
                    inputs: vec![
                        GestureInput::Stroke {
                            direction: Direction::Right,
                        },
                        GestureInput::Button {
                            button: GestureInputButton::Left,
                        },
                    ],
                },
                command: Command::DoNothing,
                order: 0,
            },
            GestureIntent {
                id: "50000000-0000-4000-8000-000000000011".into(),
                name: "Independent left click".into(),
                enabled: true,
                gesture: GestureSpecConfig {
                    trigger: TriggerButton::Right,
                    strokes: vec![Direction::Right],
                    modifier: Modifier::LeftButtonDown,
                    inputs: vec![GestureInput::Stroke {
                        direction: Direction::Right,
                    }],
                },
                command: Command::DoNothing,
                order: 1,
            },
        ];
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Left, Point { x: 120, y: 0 },)));
        assert!(!rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::ModifierFired {
                intent: Some(intent),
                modifier: Modifier::LeftButtonDown,
                ..
            } if intent.name == "Independent left click"
        )));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Left, Point { x: 120, y: 0 },)));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));

        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::PathEnded {
                intent: Some(intent),
                ..
            } if intent.name == "Ordered left click"
        )));
    }

    #[test]
    fn moved_capture_ends_without_replaying_unmatched_click() {
        let platform = Arc::new(BoundaryPlatform::default());
        let (shared, rx) = EngineShared::new(ConfigDocument::default(), platform.clone());

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 5, y: 0 })));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 1, y: 0 },)));

        assert!(platform.clicks.lock().is_empty());
        let messages = rx.try_iter().collect::<Vec<_>>();
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::PathStarted { .. })));
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::PathEnded { intent: None, .. })));
    }

    #[test]
    fn task_switcher_without_modifier_is_deferred_until_path_end() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = ConfigDocument::default();
        config.global.intents = vec![GestureIntent {
            id: "50000000-0000-4000-8000-000000000002".into(),
            name: "Deferred task switcher".into(),
            enabled: true,
            gesture: GestureSpecConfig {
                trigger: TriggerButton::Right,
                strokes: vec![Direction::Right],
                modifier: Modifier::None,
                inputs: vec![GestureInput::Stroke {
                    direction: Direction::Right,
                }],
            },
            command: Command::TaskSwitcher,
            order: 0,
        }];
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));

        let before_release = rx.try_iter().collect::<Vec<_>>();
        assert!(before_release.iter().any(|message| matches!(
            message,
            EngineMsg::RecognitionChanged { name: Some(name) }
                if name == "Deferred task switcher"
        )));
        assert!(!before_release
            .iter()
            .any(|message| matches!(message, EngineMsg::PathEnded { .. })));

        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::PathEnded {
                intent: Some(intent),
                modifier: Modifier::None,
                ..
            } if matches!(intent.command, Command::TaskSwitcher)
        )));
    }

    #[test]
    fn task_switcher_with_modifier_fires_immediately_without_path_end_repeat() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = ConfigDocument::default();
        config.global.intents = vec![GestureIntent {
            id: "50000000-0000-4000-8000-000000000003".into(),
            name: "Immediate task switcher".into(),
            enabled: true,
            gesture: GestureSpecConfig {
                trigger: TriggerButton::Right,
                strokes: vec![Direction::Right],
                modifier: Modifier::WheelBackward,
                inputs: vec![GestureInput::Stroke {
                    direction: Direction::Right,
                }],
            },
            command: Command::TaskSwitcher,
            order: 0,
        }];
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        assert!(shared.on_hook_event(Input::Wheel {
            forward: false,
            pos: Point { x: 120, y: 0 },
        }));

        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::ModifierFired {
                intent: Some(intent),
                modifier: Modifier::WheelBackward,
                ..
            } if matches!(intent.command, Command::TaskSwitcher)
        )));

        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::PathEnded { intent: None, .. })));
    }

    #[test]
    fn independent_button_modifier_repeats_without_growing_base_inputs() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = ConfigDocument::default();
        config.global.intents.push(GestureIntent {
            id: "50000000-0000-4000-8000-000000000001".into(),
            name: "Repeat middle".into(),
            enabled: true,
            gesture: GestureSpecConfig {
                trigger: TriggerButton::Right,
                strokes: vec![Direction::Right],
                modifier: Modifier::MiddleButtonDown,
                inputs: vec![GestureInput::Stroke {
                    direction: Direction::Right,
                }],
            },
            command: Command::DoNothing,
            order: 0,
        });
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 },)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        for _ in 0..2 {
            assert!(shared.on_hook_event(Input::ButtonDown(
                MouseButton::Middle,
                Point { x: 120, y: 0 },
            )));
            assert!(
                shared.on_hook_event(Input::ButtonUp(MouseButton::Middle, Point { x: 120, y: 0 },))
            );
        }
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));

        let messages = rx.try_iter().collect::<Vec<_>>();
        assert_eq!(
            messages
                .iter()
                .filter(|message| matches!(
                    message,
                    EngineMsg::ModifierFired { intent: Some(intent), .. }
                        if intent.name == "Repeat middle"
                ))
                .count(),
            2
        );
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::PathEnded { intent: None, .. })));
    }

    #[derive(Default)]
    struct BoundaryPlatform {
        clicks: Mutex<Vec<(MouseButton, Point)>>,
        wheels: Mutex<Vec<bool>>,
        tray_points: Mutex<Vec<Point>>,
        fullscreen: AtomicBool,
    }

    impl BoundaryPlatform {
        fn set_fullscreen(&self, fullscreen: bool) {
            self.fullscreen.store(fullscreen, Ordering::SeqCst);
        }
    }

    impl PlatformServices for BoundaryPlatform {
        fn resolve_foreground_app(
            &self,
            _pos: Point,
            _prefer_cursor_window: bool,
        ) -> ForegroundApp {
            ForegroundApp::default()
        }

        fn is_fullscreen(&self) -> bool {
            self.fullscreen.load(Ordering::SeqCst)
        }

        fn synthesize_click(&self, button: MouseButton, pos: Point) {
            self.clicks.lock().push((button, pos));
        }

        fn synthesize_down(&self, _button: MouseButton, _pos: Point) {}

        fn synthesize_wheel(&self, forward: bool) {
            self.wheels.lock().push(forward);
        }

        fn screen_at(&self, _pos: Point) -> Option<ScreenInfo> {
            Some(ScreenInfo {
                bounds: ScreenRect {
                    left: 0,
                    top: 0,
                    right: 1919,
                    bottom: 1079,
                },
                dpi_scale: 1.0,
            })
        }

        fn is_system_tray_point(&self, pos: Point) -> bool {
            self.tray_points.lock().contains(&pos)
        }
    }

    fn boundary_config(sequence: Vec<BoundaryToken>) -> ConfigDocument {
        let mut config = ConfigDocument::default();
        config.boundary_intents.push(BoundaryIntent {
            id: "20000000-0000-4000-8000-000000000001".into(),
            name: "Boundary test".into(),
            enabled: true,
            origin: BoundaryOrigin::HotCorner {
                corner: "leftTop".into(),
            },
            sequence,
            command: Command::DoNothing,
            order: 0,
        });
        config
    }

    fn guide_config() -> ConfigDocument {
        let mut config = ConfigDocument::default();
        config.preferences.gesture_view.show_boundary_guide = true;
        config
    }

    #[test]
    fn guide_is_emitted_without_boundary_actions_and_deduplicated() {
        let config = guide_config();
        assert!(config.boundary_intents.is_empty());
        let (shared, rx) = EngineShared::new(config, Arc::new(BoundaryPlatform::default()));

        assert!(!shared.on_hook_event(Input::Move(Point { x: 50, y: 50 })));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 50, y: 50 })));

        let messages = rx.try_iter().collect::<Vec<_>>();
        assert_eq!(
            messages
                .iter()
                .filter(|message| matches!(
                    message,
                    EngineMsg::BoundaryGuideChanged(Some(frame))
                        if frame.region == CornerEdgeHit::Corner(ScreenCorner::LeftTop)
                ))
                .count(),
            1
        );
    }

    #[test]
    fn guide_hides_disabled_hot_corners_and_rub_edges() {
        let mut corners_disabled = guide_config();
        corners_disabled.hot_corners.enabled = false;
        let (shared, rx) =
            EngineShared::new(corners_disabled, Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));
        shared.on_hook_event(Input::Move(Point { x: 10, y: 500 }));
        let messages = rx.try_iter().collect::<Vec<_>>();
        assert!(!messages.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryGuideChanged(Some(frame))
                if matches!(frame.region, CornerEdgeHit::Corner(_))
        )));
        assert!(messages.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryGuideChanged(Some(frame))
                if frame.region == CornerEdgeHit::Edge(ScreenEdge::Left)
        )));

        let mut edges_disabled = guide_config();
        edges_disabled.rub_edges.enabled = false;
        let (shared, rx) = EngineShared::new(edges_disabled, Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 10, y: 500 }));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));
        let messages = rx.try_iter().collect::<Vec<_>>();
        assert!(!messages.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryGuideChanged(Some(frame))
                if matches!(frame.region, CornerEdgeHit::Edge(_))
        )));
        assert!(messages.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryGuideChanged(Some(frame))
                if frame.region == CornerEdgeHit::Corner(ScreenCorner::LeftTop)
        )));
    }

    #[test]
    fn guide_clears_when_pointer_leaves() {
        let (shared, rx) = EngineShared::new(guide_config(), Arc::new(BoundaryPlatform::default()));

        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));
        shared.on_hook_event(Input::Move(Point { x: 500, y: 500 }));

        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_when_paused() {
        let (shared, rx) = EngineShared::new(guide_config(), Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        shared.set_paused(true);

        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_when_recording_starts() {
        let (shared, rx) = EngineShared::new(guide_config(), Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        shared.start_recording();

        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_when_a_tracker_capture_becomes_active() {
        let (shared, rx) = EngineShared::new(guide_config(), Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        shared.on_hook_event(Input::ButtonDown(
            MouseButton::Right,
            Point { x: 500, y: 500 },
        ));
        shared.on_hook_event(Input::Move(Point { x: 510, y: 500 }));

        assert!(shared.tracker.lock().is_capturing());
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_when_a_boundary_capture_becomes_active() {
        let mut config = guide_config();
        config.boundary_intents.push(BoundaryIntent {
            id: "20000000-0000-4000-8000-000000000002".into(),
            name: "Boundary guide capture".into(),
            enabled: true,
            origin: BoundaryOrigin::HotCorner {
                corner: "leftTop".into(),
            },
            sequence: vec![
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                },
                BoundaryToken::Stroke {
                    direction: Direction::Right,
                },
            ],
            command: Command::DoNothing,
            order: 0,
        });
        let (shared, rx) = EngineShared::new(config, Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        assert!(shared.on_hook_event(Input::Wheel {
            forward: true,
            pos: Point { x: 50, y: 50 },
        }));

        assert!(shared.boundary.lock().is_active());
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_when_a_mouse_button_is_held() {
        let (shared, rx) = EngineShared::new(guide_config(), Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        shared.on_hook_event(Input::ButtonDown(
            MouseButton::Left,
            Point { x: 500, y: 500 },
        ));

        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_during_fullscreen_suppression() {
        let platform = Arc::new(BoundaryPlatform::default());
        let (shared, rx) = EngineShared::new(guide_config(), platform.clone());
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        platform.set_fullscreen(true);
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn guide_clears_when_preferences_or_global_region_switches_change() {
        let (shared, rx) = EngineShared::new(guide_config(), Arc::new(BoundaryPlatform::default()));
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));

        let mut corners_disabled = guide_config();
        corners_disabled.hot_corners.enabled = false;
        shared.replace_config(corners_disabled);
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));

        shared.on_hook_event(Input::Move(Point { x: 10, y: 500 }));
        let mut guide_disabled = guide_config();
        guide_disabled.preferences.gesture_view.show_boundary_guide = false;
        shared.replace_config(guide_disabled);
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));
    }

    #[test]
    fn replacing_fullscreen_preference_updates_cached_suppression() {
        let platform = Arc::new(BoundaryPlatform::default());
        let (shared, rx) = EngineShared::new(guide_config(), platform.clone());
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));
        platform.set_fullscreen(true);
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryGuideChanged(None))));

        let mut enabled = guide_config();
        enabled.preferences.path_tracker.disable_in_fullscreen = false;
        shared.replace_config(enabled);
        shared.on_hook_event(Input::Move(Point { x: 50, y: 50 }));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryGuideChanged(Some(frame))
                if frame.region == CornerEdgeHit::Corner(ScreenCorner::LeftTop)
        )));
    }

    #[test]
    fn rub_edge_sequence_waits_for_input_after_pointer_enters_the_edge_band() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = boundary_config(vec![BoundaryToken::Wheel {
            direction: BoundaryWheelDirection::Forward,
        }]);
        config.boundary_intents[0].origin = BoundaryOrigin::RubEdge {
            edge: "bottom".into(),
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(!shared.on_hook_event(Input::Move(Point { x: 960, y: 1079 })));
        assert!(!rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathStarted { .. })));
        assert!(shared.on_hook_event(Input::Wheel {
            forward: true,
            pos: Point { x: 960, y: 1079 },
        }));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                hit: CornerEdgeHit::Edge(ScreenEdge::Bottom),
                ..
            }
        )));
    }

    #[test]
    fn rub_edge_wheel_rearms_from_the_current_pointer_position() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = boundary_config(vec![BoundaryToken::Wheel {
            direction: BoundaryWheelDirection::Forward,
        }]);
        config.boundary_intents[0].origin = BoundaryOrigin::RubEdge {
            edge: "bottom".into(),
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(shared.on_hook_event(Input::Wheel {
            forward: true,
            pos: Point { x: 960, y: 1079 },
        }));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                hit: CornerEdgeHit::Edge(ScreenEdge::Bottom),
                ..
            }
        )));
    }

    #[test]
    fn rub_edge_immediate_fallback_does_not_block_wheel_sequence() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = ConfigDocument {
            boundary_intents: vec![
                BoundaryIntent {
                    id: "20000000-0000-4000-8000-000000000010".into(),
                    name: "Bottom edge".into(),
                    enabled: true,
                    origin: BoundaryOrigin::RubEdge {
                        edge: "bottom".into(),
                    },
                    sequence: vec![],
                    command: Command::DoNothing,
                    order: 0,
                },
                BoundaryIntent {
                    id: "20000000-0000-4000-8000-000000000011".into(),
                    name: "Bottom edge wheel".into(),
                    enabled: true,
                    origin: BoundaryOrigin::RubEdge {
                        edge: "bottom".into(),
                    },
                    sequence: vec![BoundaryToken::Wheel {
                        direction: BoundaryWheelDirection::Forward,
                    }],
                    command: Command::DoNothing,
                    order: 1,
                },
            ],
            ..Default::default()
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(!shared.on_hook_event(Input::Move(Point { x: 960, y: 1079 })));
        assert!(shared.on_hook_event(Input::Wheel {
            forward: true,
            pos: Point { x: 960, y: 1079 },
        }));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired { intent_id, .. }
                if intent_id == "20000000-0000-4000-8000-000000000011"
        )));
    }

    #[test]
    fn boundary_button_sequence_fires_and_swallows_the_matching_up() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![BoundaryToken::Button {
            button: BoundaryMouseButton::Right,
        }]);
        let (shared, rx) = EngineShared::new(config, platform);

        let corner = Point { x: 1, y: 1 };
        assert!(!shared.on_hook_event(Input::Move(corner)));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, corner)));
        assert!(!rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                intent_id,
                hit: CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                command: Command::DoNothing,
                ..
            } if intent_id == "20000000-0000-4000-8000-000000000001"
        )));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, corner)));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                intent_id,
                hit: CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                command: Command::DoNothing,
                ..
            } if intent_id == "20000000-0000-4000-8000-000000000001"
        )));
    }

    #[test]
    fn exact_corner_keeps_immediate_action_separate_from_near_corner_sequence() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = ConfigDocument {
            boundary_intents: vec![
                BoundaryIntent {
                    id: "20000000-0000-4000-8000-000000000020".into(),
                    name: "Immediate corner".into(),
                    enabled: true,
                    origin: BoundaryOrigin::HotCorner {
                        corner: "leftTop".into(),
                    },
                    sequence: vec![],
                    command: Command::DoNothing,
                    order: 0,
                },
                BoundaryIntent {
                    id: "20000000-0000-4000-8000-000000000021".into(),
                    name: "Corner button".into(),
                    enabled: true,
                    origin: BoundaryOrigin::HotCorner {
                        corner: "leftTop".into(),
                    },
                    sequence: vec![BoundaryToken::Button {
                        button: BoundaryMouseButton::Right,
                    }],
                    command: Command::DoNothing,
                    order: 1,
                },
            ],
            ..Default::default()
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(!shared.on_hook_event(Input::Move(Point { x: 0, y: 0 })));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired { intent_id, .. }
                if intent_id == "20000000-0000-4000-8000-000000000020"
        )));

        assert!(!shared.on_hook_event(Input::Move(Point { x: 200, y: 200 })));
        let corner = Point { x: 1, y: 1 };
        assert!(!shared.on_hook_event(Input::Move(corner)));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, corner)));
        assert!(!rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::CornerEdgeFired { .. })));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, corner)));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired { intent_id, .. }
                if intent_id == "20000000-0000-4000-8000-000000000021"
        )));
    }

    #[test]
    fn incomplete_boundary_button_sequence_replays_a_click() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Down,
            },
        ]);
        let (shared, _rx) = EngineShared::new(config, platform.clone());

        let corner = Point { x: 1, y: 1 };
        shared.on_hook_event(Input::Move(corner));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, corner)));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, corner)));
        assert_eq!(
            platform.clicks.lock().as_slice(),
            &[(MouseButton::Right, corner)]
        );
    }

    #[test]
    fn system_tray_button_clicks_bypass_gesture_capture() {
        let platform = Arc::new(BoundaryPlatform::default());
        let tray = Point { x: 2199, y: 1072 };
        platform.tray_points.lock().push(tray);
        let (shared, _rx) = EngineShared::new(ConfigDocument::default(), platform);

        for _ in 0..8 {
            assert!(!shared.on_hook_event(Input::ButtonDown(MouseButton::Right, tray)));
            assert!(!shared.on_hook_event(Input::ButtonUp(MouseButton::Right, tray)));
        }
    }

    #[test]
    fn incomplete_boundary_stroke_does_not_replay_trigger_click() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Down,
            },
        ]);
        let (shared, rx) = EngineShared::new(config, platform.clone());

        let origin = Point { x: 1, y: 1 };
        let end = Point { x: 120, y: 1 };
        shared.on_hook_event(Input::Move(origin));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, origin)));
        assert!(!shared.on_hook_event(Input::Move(end)));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, end)));

        assert!(platform.clicks.lock().is_empty());
        assert!(rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathCancelled)));
    }

    #[test]
    fn unmatched_boundary_button_stays_captured_until_release() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Down,
            },
        ]);
        let (shared, _rx) = EngineShared::new(config, platform.clone());

        let origin = Point { x: 1, y: 1 };
        let left_pos = Point { x: 120, y: 1 };
        shared.on_hook_event(Input::Move(origin));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, origin)));

        // An active PathTracker swallows additional buttons even when they do
        // not resolve to a configured modifier. Boundary capture must keep
        // the same ownership until the current button is released.
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Left, left_pos)));
        assert!(platform.clicks.lock().is_empty());
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Left, left_pos)));
        assert_eq!(
            platform.clicks.lock().as_slice(),
            &[(MouseButton::Right, origin), (MouseButton::Left, left_pos),]
        );

        // The replayed primary release must not re-enter the foreground app.
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, left_pos)));
    }

    #[test]
    fn boundary_timeout_does_not_replay_until_the_anchor_is_released() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Down,
            },
        ]);
        let (shared, _rx) = EngineShared::new(config, platform.clone());

        let corner = Point { x: 1, y: 1 };
        shared.on_hook_event(Input::Move(corner));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, corner)));

        shared.on_tick(Instant::now() + Duration::from_secs(2));
        assert!(platform.clicks.lock().is_empty());

        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 1 },)));
        assert_eq!(
            platform.clicks.lock().as_slice(),
            &[(MouseButton::Right, corner)]
        );
    }

    #[test]
    fn boundary_stroke_sequence_uses_its_own_parser() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Right,
            },
        ]);
        let (shared, rx) = EngineShared::new(config, platform);

        let corner = Point { x: 1, y: 1 };
        shared.on_hook_event(Input::Move(corner));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, corner)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        assert!(!rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                command: Command::DoNothing,
                ..
            }
        )));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 120, y: 0 },)));
        assert!(rx.try_iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                command: Command::DoNothing,
                ..
            }
        )));
    }

    #[test]
    fn boundary_waiting_for_anchor_release_swallows_unmatched_buttons() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Down,
            },
        ]);
        let (shared, _rx) = EngineShared::new(config, platform.clone());

        let origin = Point { x: 1, y: 1 };
        let moved = Point { x: 1, y: 120 };
        assert!(!shared.on_hook_event(Input::Move(origin)));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, origin)));
        assert!(!shared.on_hook_event(Input::Move(moved)));

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Left, moved)));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Left, moved)));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, moved)));
        assert!(platform.clicks.lock().is_empty());
    }

    #[test]
    fn right_edge_button_stroke_button_sequence_emits_boundary_trail_events() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = boundary_config(vec![
            BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            },
            BoundaryToken::Stroke {
                direction: Direction::Down,
            },
            BoundaryToken::Button {
                button: BoundaryMouseButton::Left,
            },
        ]);
        config.boundary_intents[0].origin = BoundaryOrigin::RubEdge {
            edge: "right".into(),
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(!shared.on_hook_event(Input::Move(Point { x: 1919, y: 500 })));
        assert!(shared.on_hook_event(Input::ButtonDown(
            MouseButton::Right,
            Point { x: 1919, y: 500 },
        )));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 1919, y: 620 })));
        assert!(shared.on_hook_event(Input::ButtonDown(
            MouseButton::Left,
            Point { x: 1919, y: 620 },
        )));

        let before_release = rx.try_iter().collect::<Vec<_>>();
        assert!(before_release
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathStarted { .. })));
        assert!(before_release.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryPathGrown {
                point: Point { x: 1919, y: 620 }
            }
        )));
        assert!(before_release.iter().any(|message| matches!(
            message,
            EngineMsg::RecognitionChanged {
                name: Some(name)
            } if name == "Boundary test"
        )));
        assert!(!before_release
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathEnded)));
        assert!(!before_release
            .iter()
            .any(|message| matches!(message, EngineMsg::CornerEdgeFired { .. })));

        assert!(shared.on_hook_event(Input::ButtonUp(
            MouseButton::Left,
            Point { x: 1919, y: 620 },
        )));
        let after_secondary_release = rx.try_iter().collect::<Vec<_>>();
        assert!(!after_secondary_release
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathEnded)));
        assert!(!after_secondary_release
            .iter()
            .any(|message| matches!(message, EngineMsg::CornerEdgeFired { .. })));

        assert!(shared.on_hook_event(Input::ButtonUp(
            MouseButton::Right,
            Point { x: 1919, y: 620 },
        )));
        let messages = rx.try_iter().collect::<Vec<_>>();
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathEnded)));
        assert!(messages.iter().any(|message| matches!(
            message,
            EngineMsg::CornerEdgeFired {
                hit: CornerEdgeHit::Edge(ScreenEdge::Right),
                ..
            }
        )));
    }

    #[test]
    fn boundary_sequence_does_not_start_outside_its_edge_region() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = boundary_config(vec![BoundaryToken::Button {
            button: BoundaryMouseButton::Right,
        }]);
        config.boundary_intents[0].origin = BoundaryOrigin::RubEdge {
            edge: "right".into(),
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(shared.on_hook_event(Input::ButtonDown(
            MouseButton::Right,
            Point { x: 960, y: 500 },
        )));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 1080, y: 500 })));
        assert!(shared.on_hook_event(Input::ButtonUp(
            MouseButton::Right,
            Point { x: 1080, y: 500 },
        )));
        assert!(!rx
            .try_iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathStarted { .. })));
    }

    #[test]
    fn edge_region_starts_a_boundary_capture_when_prefix_misses() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = boundary_config(vec![BoundaryToken::Wheel {
            direction: BoundaryWheelDirection::Forward,
        }]);
        config.boundary_intents[0].origin = BoundaryOrigin::RubEdge {
            edge: "bottom".into(),
        };
        let (shared, rx) = EngineShared::new(config, platform);
        let origin = Point { x: 1123, y: 1079 };

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::X2, origin,)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 1123, y: 722 })));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::X2, Point { x: 1123, y: 722 },)));

        let messages = rx.try_iter().collect::<Vec<_>>();
        assert!(!messages
            .iter()
            .any(|message| matches!(message, EngineMsg::PathStarted { .. })));
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathStarted { .. })));
        assert!(messages.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryPathGrown {
                point: Point { x: 1123, y: 722 }
            }
        )));
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathCancelled)));
    }

    #[test]
    fn near_corner_region_starts_a_boundary_capture_when_prefix_misses() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![BoundaryToken::Wheel {
            direction: BoundaryWheelDirection::Forward,
        }]);
        let (shared, rx) = EngineShared::new(config, platform);
        let origin = Point { x: 1, y: 1 };

        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::X2, origin,)));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 1 })));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::X2, Point { x: 120, y: 1 },)));

        let messages = rx.try_iter().collect::<Vec<_>>();
        assert!(!messages
            .iter()
            .any(|message| matches!(message, EngineMsg::PathStarted { .. })));
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathStarted { .. })));
        assert!(messages.iter().any(|message| matches!(
            message,
            EngineMsg::BoundaryPathGrown {
                point: Point { x: 120, y: 1 }
            }
        )));
        assert!(messages
            .iter()
            .any(|message| matches!(message, EngineMsg::BoundaryPathCancelled)));
    }
}

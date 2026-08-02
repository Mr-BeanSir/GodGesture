//! 引擎运行时 —— 把平台钩子事件接到追踪器/识别器/意图查找,并分发产物。
//!
//! 线程模型:
//! - 钩子线程:同步裁决(吞/不吞)+ 轻逻辑(追踪器、识别器、意图查找,均 µs 级);
//! - 定时线程:驱动追踪器的超时(起始超时/停留超时),30ms 粒度仅在捕获期间轮询;
//! - 执行线程(engine worker):命令执行与覆盖层消息等重活,经 channel 接收。
//!
//! 平台层负责保持输入恢复时序。Windows 普通点击在当前低级钩子回调返回后由
//! 钩子消息泵重放;起始超时的 SynthesizeDown 仍同步执行以衔接后续真实抬起。

use super::boundary::{BoundaryMatcher, BoundaryReplay, BoundaryResult};
use super::config::{
    BoundaryMouseButton, BoundaryToken, BoundaryWheelDirection, Command, ConfigDocument,
    GestureInput, GestureInputButton, GestureIntent,
};
use super::corners::{CornerEdgeDetector, CornerEdgeHit, ScreenInfo};
use super::intents::{ForegroundApp, IntentFinder};
use super::parser::{StrokeEvent, StrokeParser};
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
    /// 增量识别结果变化(None=无匹配);TaskSwitcher 需要消费线程在识别期间
    /// 保持 Alt,因此连同命令类型一起传递,不能只按可能重复的意图名判断。
    RecognitionChanged {
        name: Option<String>,
        task_switcher: bool,
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
}

/// 手势进行中的会话状态(仅钩子线程与定时线程经锁访问)
struct Session {
    parser: StrokeParser,
    fg: ForegroundApp,
    trigger: TriggerButton,
    /// 手势起点(命令执行上下文用)
    origin: Point,
    /// 手势期间最后一次触发的修饰(用于 PathEnd 时的意图键)
    active_modifier: Modifier,
    /// 鼠标键/滚轮/笔画的实际发生顺序(不含触发键本身)。
    inputs: Vec<GestureInput>,
    /// 是否已在修饰触发时执行过命令(execute_on_modifier);PathEnd 据此避免二次执行
    executed_on_modifier: bool,
    /// 上次增量识别的结果名(去重用)
    last_recognized: Option<(String, bool)>,
}

/// 左键+中键和弦(暂停/继续)的检测状态
#[derive(Default)]
struct ChordState {
    left_down: bool,
    swallow_next_middle_up: bool,
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
    boundary_parser: Mutex<Option<StrokeParser>>,
    boundary_swallow_ups: AtomicU8,
    /// 物理按下的鼠标键位掩码 —— 任意键按下即抑制触发角/摩擦边。
    /// 从钩子事件自行累计,避免在钩子线程上做 GetAsyncKeyState 系统调用。
    buttons_down: AtomicU8,
    /// 两个开关的缓存,免得每条鼠标移动都去锁配置
    corners_enabled: AtomicBool,
    edges_enabled: AtomicBool,
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
            boundary_parser: Mutex::new(None),
            boundary_swallow_ups: AtomicU8::new(0),
            buttons_down: AtomicU8::new(0),
            corners_enabled: AtomicBool::new(corners_enabled),
            edges_enabled: AtomicBool::new(edges_enabled),
        });
        (shared, rx)
    }

    /// 进入手势录制模式。
    pub fn start_recording(&self) {
        self.cancel_boundary_sequence();
        self.recording.store(true, Ordering::SeqCst);
    }

    /// 退出录制并取消正在进行的捕获;下一次触发键抬起仍会被追踪器吞掉。
    pub fn cancel_recording(&self) {
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
        self.corners_enabled
            .store(config.hot_corners.enabled, Ordering::Relaxed);
        self.edges_enabled
            .store(config.rub_edges.enabled, Ordering::Relaxed);
        self.finder.lock().replace_config(config);
        let _ = self.tx.send(EngineMsg::ScriptConfigChanged);
    }

    /// 暂停/继续快捷键 (修饰键列表, 主键)
    pub fn pause_hotkey(&self) -> (Vec<String>, String) {
        let finder = self.finder.lock();
        let hk = &finder.config().preferences.pause_hotkey;
        (hk.modifiers.clone(), hk.key.clone())
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

    /// 钩子线程入口:裁决是否吞事件
    pub fn on_hook_event(self: &Arc<Self>, input: Input) -> bool {
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
        if let Input::ButtonUp(button, _) = &input {
            let bit = button_bit(*button);
            if self.boundary_swallow_ups.fetch_and(!bit, Ordering::Relaxed) & bit != 0 {
                return true;
            }
        }

        let now = Instant::now();
        if self.handle_boundary_input(&input, now) {
            return true;
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
        self.apply_actions(outcome.actions);

        // 触发角 / 摩擦边:纯观察,不参与吞事件的裁决
        if let Some(pos) = move_pos {
            self.detect_corner_edge(pos, now);
        }
        outcome.swallow
    }

    fn handle_boundary_input(&self, input: &Input, now: Instant) -> bool {
        let timeout_result = self.boundary.lock().tick(now);
        self.apply_boundary_result(timeout_result);
        if !self.boundary.lock().is_active() {
            if let Input::Wheel { pos, .. } = input {
                self.arm_edge_sequence_at(*pos, now);
            }
        }
        if !self.boundary.lock().is_active() {
            return false;
        }
        match input {
            Input::ButtonDown(button, pos) => {
                let result = self.boundary.lock().feed(
                    BoundaryToken::Button {
                        button: boundary_button(*button),
                    },
                    Some(BoundaryReplay::Click {
                        button: *button,
                        pos: *pos,
                    }),
                    now,
                );
                let swallow = matches!(
                    result,
                    BoundaryResult::Pending | BoundaryResult::Complete { .. }
                );
                self.apply_boundary_result(result);
                swallow
            }
            Input::Wheel { forward, .. } => {
                let result = self.boundary.lock().feed(
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
                let swallow = matches!(
                    result,
                    BoundaryResult::Pending | BoundaryResult::Complete { .. }
                );
                self.apply_boundary_result(result);
                swallow
            }
            Input::Move(point) => {
                let direction = {
                    let mut parser = self.boundary_parser.lock();
                    parser.as_mut().and_then(|parser| {
                        if parser.feed(*point) == StrokeEvent::Grew {
                            parser.strokes().last().copied()
                        } else {
                            None
                        }
                    })
                };
                if let Some(direction) = direction {
                    let result =
                        self.boundary
                            .lock()
                            .feed(BoundaryToken::Stroke { direction }, None, now);
                    self.apply_boundary_result(result);
                }
                false
            }
            Input::ButtonUp(button, _) => {
                let result = self.boundary.lock().cancel();
                let swallow = matches!(
                    &result,
                    BoundaryResult::Cancelled { replay }
                        if replay.iter().any(|entry| matches!(
                            entry,
                            BoundaryReplay::Click { button: replay_button, .. }
                                if replay_button == button
                        ))
                );
                self.apply_boundary_result(result);
                if swallow {
                    self.boundary_swallow_ups
                        .fetch_and(!button_bit(*button), Ordering::Relaxed);
                }
                swallow
            }
        }
    }

    /// 滚轮本身不会产生 Move 事件。光标长时间停在边缘导致先前等待超时后,
    /// 在滚轮到达时按当前位置重新武装,保证边缘序列不依赖用户滚动前再抖一下鼠标。
    fn arm_edge_sequence_at(&self, pos: Point, now: Instant) {
        if self.is_paused() || self.is_recording() || self.tracker.lock().is_capturing() {
            return;
        }
        let disable_in_fullscreen = self
            .finder
            .lock()
            .config()
            .preferences
            .path_tracker
            .disable_in_fullscreen;
        if disable_in_fullscreen && self.platform.is_fullscreen() {
            return;
        }
        let Some(edge) = self
            .corner_edge
            .lock()
            .edge_at(pos, now, || self.platform.screen_at(pos))
        else {
            return;
        };
        let result = {
            let finder = self.finder.lock();
            let config = finder.config();
            if !config.rub_edges.enabled
                || !config.boundary_intents.iter().any(|intent| {
                    intent.enabled
                        && !intent.sequence.is_empty()
                        && intent.origin.matches("rubEdge", edge.key())
                })
            {
                return;
            }
            self.boundary
                .lock()
                .activate(config, CornerEdgeHit::Edge(edge), pos, now)
        };
        if matches!(result, BoundaryResult::Pending) {
            let (effective, enable_8) = {
                let finder = self.finder.lock();
                (
                    *self.effective_move_px.lock(),
                    finder.config().preferences.path_tracker.enable_8_directions,
                )
            };
            *self.boundary_parser.lock() = Some(StrokeParser::new(pos, effective, enable_8));
        }
        self.apply_boundary_result(result);
    }

    fn apply_boundary_result(&self, result: BoundaryResult) {
        match result {
            BoundaryResult::Idle | BoundaryResult::Pending => {}
            BoundaryResult::Complete {
                intent,
                hit,
                origin,
                consumed,
            } => {
                *self.boundary_parser.lock() = None;
                for replay in consumed {
                    if let BoundaryReplay::Click { button, .. } = replay {
                        self.boundary_swallow_ups
                            .fetch_or(button_bit(button), Ordering::Relaxed);
                    }
                }
                let _ = self.tx.send(EngineMsg::CornerEdgeFired {
                    intent_id: intent.id.clone(),
                    hit,
                    command: intent.command.clone(),
                    origin,
                });
            }
            BoundaryResult::Cancelled { replay } => {
                *self.boundary_parser.lock() = None;
                for input in replay {
                    match input {
                        BoundaryReplay::Click { button, pos } => {
                            self.boundary_swallow_ups
                                .fetch_or(button_bit(button), Ordering::Relaxed);
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

    fn cancel_boundary_sequence(&self) {
        let result = self.boundary.lock().cancel();
        self.apply_boundary_result(result);
    }

    /// 触发角 / 摩擦边判定(钩子线程)。命中即把解析好的命令投给执行线程 ——
    /// 命令执行可能很慢(如取选中文本要轮询剪贴板 ~200ms),绝不能在钩子线程里做。
    fn detect_corner_edge(self: &Arc<Self>, pos: Point, now: Instant) {
        let corners = self.corners_enabled.load(Ordering::Relaxed);
        let edges = self.edges_enabled.load(Ordering::Relaxed);
        if !corners && !edges {
            return;
        }
        // 暂停 / 录制 / 手势捕获中:整个状态机停摆,不喂数据。
        // 参考实现里 _isPaused 短路整个钩子过程、_captured 挡住触发角判定的调用点,
        // 语义一致;录制期间抑制是本项目有意加的(见 corners.rs 头部说明)。
        if self.is_paused() || self.is_recording() {
            return;
        }
        if self.tracker.lock().is_capturing() {
            return;
        }

        let hit = self
            .corner_edge
            .lock()
            .on_move(pos, now, || self.platform.screen_at(pos));
        let hit = hit.or_else(|| {
            if self.boundary.lock().is_active() {
                return None;
            }
            let edge = self
                .corner_edge
                .lock()
                .edge_at(pos, now, || self.platform.screen_at(pos))?;
            let has_sequence = self
                .finder
                .lock()
                .config()
                .boundary_intents
                .iter()
                .any(|intent| {
                    intent.enabled
                        && !intent.sequence.is_empty()
                        && intent.origin.matches("rubEdge", edge.key())
                });
            has_sequence.then_some(CornerEdgeHit::Edge(edge))
        });
        let Some(hit) = hit else { return };

        // 鼠标键按下时**照样喂状态机**,只是不执行命令 —— 参考实现的按键判定在分发处
        // (OnHotCorner / OnRubEdge),不在检测处,于是命中会"烧掉"这一次武装。
        // 这个位置差别是用户可见的:按住左键把窗口拖到左上角(Aero Snap)再松手,
        // 若在喂之前就 return,武装被完整保留,松手后随便动一下就会误触发角命令 ——
        // 等于每次贴角吸附窗口都白触发一次。
        if self.buttons_down.load(Ordering::Relaxed) != 0 {
            return;
        }

        let disable_in_fullscreen = {
            let finder = self.finder.lock();
            let config = finder.config();
            config.preferences.path_tracker.disable_in_fullscreen
        };
        // 全屏抑制与手势共用同一偏好;放在最后才查,免得每次移动都问系统
        if disable_in_fullscreen && self.platform.is_fullscreen() {
            return;
        }
        self.cancel_boundary_sequence();
        let result = {
            let finder = self.finder.lock();
            self.boundary
                .lock()
                .activate(finder.config(), hit, pos, now)
        };
        if matches!(result, BoundaryResult::Pending) {
            let (effective, enable_8) = {
                let finder = self.finder.lock();
                (
                    *self.effective_move_px.lock(),
                    finder.config().preferences.path_tracker.enable_8_directions,
                )
            };
            *self.boundary_parser.lock() = Some(StrokeParser::new(pos, effective, enable_8));
        }
        self.apply_boundary_result(result);
    }

    /// 定时线程入口
    fn on_tick(self: &Arc<Self>, now: Instant) {
        let boundary = self.boundary.lock().tick(now);
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
                    let enable8 = self
                        .finder
                        .lock()
                        .config()
                        .preferences
                        .path_tracker
                        .enable_8_directions;
                    let eff = *self.effective_move_px.lock();
                    *self.session.lock() = Some(Session {
                        parser: StrokeParser::new(origin, eff, enable8),
                        fg,
                        trigger,
                        origin,
                        active_modifier: Modifier::None,
                        inputs: Vec::new(),
                        executed_on_modifier: false,
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
                        let grew = s.parser.feed(pt) == StrokeEvent::Grew;
                        if grew {
                            sync_stroke_inputs(s);
                        }
                        let _ = self.tx.send(EngineMsg::PathGrown { point: pt });
                        if grew && self.is_recording() {
                            let _ = self.tx.send(EngineMsg::CaptureUpdated {
                                trigger: s.trigger,
                                strokes: s.parser.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.inputs.clone(),
                            });
                        }
                        if grew {
                            let recognized = self
                                .finder
                                .lock()
                                .find_inputs(s.trigger, &s.inputs, &s.fg)
                                .map(|intent| {
                                    (
                                        intent.name.clone(),
                                        matches!(&intent.command, Command::TaskSwitcher),
                                    )
                                });
                            if recognized != s.last_recognized {
                                s.last_recognized = recognized.clone();
                                let (name, task_switcher) = recognized
                                    .map_or((None, false), |(name, task)| (Some(name), task));
                                let _ = self.tx.send(EngineMsg::RecognitionChanged {
                                    name,
                                    task_switcher,
                                });
                            }
                        }
                    }
                }
                Action::ModifierFired { modifier: m, pos } => {
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        s.active_modifier = m;
                        if let Some(input) = modifier_to_input(m) {
                            s.inputs.push(input);
                        }
                        let intent = if self.is_recording() {
                            None
                        } else {
                            self.finder
                                .lock()
                                .find_inputs(s.trigger, &s.inputs, &s.fg)
                                .cloned()
                        };
                        // 立即执行型意图(如滚轮调音量)在此触发;标记以免 PathEnd 二次执行
                        if intent.as_ref().is_some_and(|i| i.execute_on_modifier) {
                            s.executed_on_modifier = true;
                        }
                        let context = GestureContext {
                            origin: s.origin,
                            endpoint: pos,
                            native_window: s.fg.native_window,
                        };
                        if self.is_recording() {
                            let _ = self.tx.send(EngineMsg::CaptureUpdated {
                                trigger: s.trigger,
                                strokes: s.parser.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.inputs.clone(),
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
                Action::PathEnd { pos } => {
                    let session = self.session.lock().take();
                    if let Some(s) = session {
                        // 录制模式:只上报捕获到的手势,不查找/不执行命令。
                        // 录制持续到前端显式 cancel_recording,期间可反复重画覆盖上一次结果,
                        // 避免录制器开着时误执行命令(例如把设置窗口关掉)。
                        if self.is_recording() {
                            let _ = self.tx.send(EngineMsg::GestureCaptured {
                                trigger: s.trigger,
                                strokes: s.parser.strokes().to_vec(),
                                modifier: s.active_modifier,
                                inputs: s.inputs.clone(),
                            });
                            continue;
                        }
                        let context = GestureContext {
                            origin: s.origin,
                            endpoint: pos,
                            native_window: s.fg.native_window,
                        };
                        let intent = if s.executed_on_modifier {
                            // 已在修饰触发时执行,避免二次执行
                            None
                        } else {
                            let finder = self.finder.lock();
                            finder
                                .find_inputs(s.trigger, &s.inputs, &s.fg)
                                .or_else(|| {
                                    // 带附加输入未命中时回退纯笔画意图。
                                    let strokes = s
                                        .parser
                                        .strokes()
                                        .iter()
                                        .copied()
                                        .map(|direction| GestureInput::Stroke { direction })
                                        .collect::<Vec<_>>();
                                    finder.find_inputs(s.trigger, &strokes, &s.fg)
                                })
                                .cloned()
                        };
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
            return false;
        }
        let fg = shared.platform.resolve_foreground_app(pos, prefer_cursor);
        shared.finder.lock().is_gesturing_enabled_for(&fg)
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

/// Keep the stroke portion of the ordered sequence aligned with the parser.
/// The parser can rewrite a diagonal first stroke when the next direction is
/// known, so blindly appending the latest direction would leave stale inputs.
fn sync_stroke_inputs(session: &mut Session) {
    let strokes = session.parser.strokes().to_vec();
    let mut stroke_positions = Vec::new();
    for (index, input) in session.inputs.iter().enumerate() {
        if matches!(input, GestureInput::Stroke { .. }) {
            stroke_positions.push(index);
        }
    }
    for (position, direction) in stroke_positions
        .iter()
        .copied()
        .zip(strokes.iter().copied())
    {
        session.inputs[position] = GestureInput::Stroke { direction };
    }
    if strokes.len() > stroke_positions.len() {
        session.inputs.extend(
            strokes[stroke_positions.len()..]
                .iter()
                .copied()
                .map(|direction| GestureInput::Stroke { direction }),
        );
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
    use crate::engine::config::{BoundaryIntent, BoundaryOrigin};
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

    #[test]
    fn pause_changes_are_atomic_and_published() {
        let (shared, rx) = EngineShared::new(ConfigDocument::default(), Arc::new(StubPlatform));

        assert!(shared.toggle_paused());
        assert!(matches!(rx.recv().unwrap(), EngineMsg::PauseChanged(true)));
        shared.set_paused(false);
        assert!(matches!(rx.recv().unwrap(), EngineMsg::PauseChanged(false)));
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

    #[derive(Default)]
    struct BoundaryPlatform {
        clicks: Mutex<Vec<(MouseButton, Point)>>,
        wheels: Mutex<Vec<bool>>,
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
            false
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
            command: Command::Pause,
            order: 0,
        });
        config
    }

    #[test]
    fn rub_edge_sequence_arms_on_entering_the_edge_band() {
        let platform = Arc::new(BoundaryPlatform::default());
        let mut config = boundary_config(vec![BoundaryToken::Wheel {
            direction: BoundaryWheelDirection::Forward,
        }]);
        config.boundary_intents[0].origin = BoundaryOrigin::RubEdge {
            edge: "bottom".into(),
        };
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(!shared.on_hook_event(Input::Move(Point { x: 960, y: 1079 })));
        assert!(shared.on_hook_event(Input::Wheel {
            forward: true,
            pos: Point { x: 960, y: 1079 },
        }));
        assert!(matches!(
            rx.recv().unwrap(),
            EngineMsg::CornerEdgeFired {
                hit: CornerEdgeHit::Edge(ScreenEdge::Bottom),
                ..
            }
        ));
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
        assert!(matches!(
            rx.recv().unwrap(),
            EngineMsg::CornerEdgeFired {
                hit: CornerEdgeHit::Edge(ScreenEdge::Bottom),
                ..
            }
        ));
    }

    #[test]
    fn boundary_button_sequence_fires_and_swallows_the_matching_up() {
        let platform = Arc::new(BoundaryPlatform::default());
        let config = boundary_config(vec![BoundaryToken::Button {
            button: BoundaryMouseButton::Right,
        }]);
        let (shared, rx) = EngineShared::new(config, platform);

        assert!(!shared.on_hook_event(Input::Move(Point { x: 0, y: 0 })));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 })));
        assert!(matches!(
            rx.recv().unwrap(),
            EngineMsg::CornerEdgeFired {
                intent_id,
                hit: CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                command: Command::Pause,
                ..
            } if intent_id == "20000000-0000-4000-8000-000000000001"
        ));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 0, y: 0 })));
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

        shared.on_hook_event(Input::Move(Point { x: 0, y: 0 }));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 })));
        assert!(shared.on_hook_event(Input::ButtonUp(MouseButton::Right, Point { x: 0, y: 0 })));
        assert_eq!(
            platform.clicks.lock().as_slice(),
            &[(MouseButton::Right, Point { x: 0, y: 0 })]
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

        shared.on_hook_event(Input::Move(Point { x: 0, y: 0 }));
        assert!(shared.on_hook_event(Input::ButtonDown(MouseButton::Right, Point { x: 0, y: 0 })));
        assert!(!shared.on_hook_event(Input::Move(Point { x: 120, y: 0 })));
        assert!(matches!(
            rx.recv().unwrap(),
            EngineMsg::CornerEdgeFired {
                command: Command::Pause,
                ..
            }
        ));
    }
}

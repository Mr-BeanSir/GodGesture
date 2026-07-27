//! 引擎运行时 —— 把平台钩子事件接到追踪器/识别器/意图查找,并分发产物。
//!
//! 线程模型:
//! - 钩子线程:同步裁决(吞/不吞)+ 轻逻辑(追踪器、识别器、意图查找,均 µs 级);
//! - 定时线程:驱动追踪器的超时(起始超时/停留超时),30ms 粒度仅在捕获期间轮询;
//! - 执行线程(engine worker):命令执行与覆盖层消息等重活,经 channel 接收。
//!
//! 输入合成(SynthesizeClick/Down)在钩子线程内直接调用 —— 必须与吞事件的
//! 裁决保持同一时序,否则真实事件与合成事件可能乱序。

use super::config::{Command, ConfigDocument, GestureIntent};
use super::corners::{CornerEdgeDetector, CornerEdgeHit, ScreenInfo};
use super::intents::{hot_corner_command, rub_edge_command, ForegroundApp, IntentFinder};
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
        modifier: Modifier,
        context: GestureContext,
    },
    PathCancelled,
    ModifierFired {
        intent: Option<GestureIntent>,
        modifier: Modifier,
        context: GestureContext,
    },
    /// 录制模式下捕获到一条手势(设置界面的手势录制器消费)
    GestureCaptured {
        trigger: TriggerButton,
        strokes: Vec<Direction>,
    },
    /// 触发角 / 摩擦边命中,命令已按配置解析出来
    CornerEdgeFired {
        hit: CornerEdgeHit,
        command: Command,
        /// 命中时的光标位置(命令执行上下文的 origin)
        origin: Point,
    },
    /// 暂停状态由任意入口改变（设置、托盘、快捷键、和弦或命令）。
    PauseChanged(bool),
}

/// 平台服务:运行时需要但因平台而异的操作(由 platform 层注入)
pub trait PlatformServices: Send + Sync {
    fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp;
    fn is_fullscreen(&self) -> bool;
    fn synthesize_click(&self, button: super::tracker::MouseButton, pos: Point);
    fn synthesize_down(&self, button: super::tracker::MouseButton, pos: Point);
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
            buttons_down: AtomicU8::new(0),
            corners_enabled: AtomicBool::new(corners_enabled),
            edges_enabled: AtomicBool::new(edges_enabled),
        });
        (shared, rx)
    }

    /// 进入手势录制模式。
    pub fn start_recording(&self) {
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
        let previous = self.paused.swap(paused, Ordering::SeqCst);
        if previous != paused {
            let _ = self.tx.send(EngineMsg::PauseChanged(paused));
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn toggle_paused(&self) -> bool {
        let now = !self.paused.fetch_xor(true, Ordering::SeqCst);
        let _ = self.tx.send(EngineMsg::PauseChanged(now));
        now
    }

    pub fn set_effective_move_px(&self, px: f64) {
        *self.effective_move_px.lock() = px.max(8.0);
    }

    /// 配置变更(设置界面保存/同步拉取后调用)
    pub fn replace_config(&self, config: ConfigDocument) {
        self.tracker.lock().set_params(tracker_params_from(&config));
        self.corners_enabled
            .store(config.hot_corners.enabled, Ordering::Relaxed);
        self.edges_enabled
            .store(config.rub_edges.enabled, Ordering::Relaxed);
        self.finder.lock().replace_config(config);
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
                self.buttons_down.fetch_or(button_bit(*b), Ordering::Relaxed);
            }
            Input::ButtonUp(b, _) => {
                self.buttons_down
                    .fetch_and(!button_bit(*b), Ordering::Relaxed);
            }
            _ => {}
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

        let now = Instant::now();
        let mut host = HostImpl { shared: self };
        let outcome = self.tracker.lock().handle(input, now, &mut host);
        self.apply_actions(outcome.actions);

        // 触发角 / 摩擦边:纯观察,不参与吞事件的裁决
        if let Some(pos) = move_pos {
            self.detect_corner_edge(pos, now);
        }
        outcome.swallow
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
        let Some(hit) = hit else {
            return;
        };

        // 鼠标键按下时**照样喂状态机**,只是不执行命令 —— 参考实现的按键判定在分发处
        // (OnHotCorner / OnRubEdge),不在检测处,于是命中会"烧掉"这一次武装。
        // 这个位置差别是用户可见的:按住左键把窗口拖到左上角(Aero Snap)再松手,
        // 若在喂之前就 return,武装被完整保留,松手后随便动一下就会误触发角命令 ——
        // 等于每次贴角吸附窗口都白触发一次。
        if self.buttons_down.load(Ordering::Relaxed) != 0 {
            return;
        }

        // 未配命令就当没这回事(查找函数内部已校验 enabled 开关)
        let (command, disable_in_fullscreen) = {
            let finder = self.finder.lock();
            let config = finder.config();
            let command = match hit {
                CornerEdgeHit::Corner(c) => hot_corner_command(config, c.key()),
                CornerEdgeHit::Edge(e) => rub_edge_command(config, e.key()),
            }
            .cloned();
            (
                command,
                config.preferences.path_tracker.disable_in_fullscreen,
            )
        };
        let Some(command) = command else {
            return;
        };
        // 全屏抑制与手势共用同一偏好;放在最后才查,免得每次移动都问系统
        if disable_in_fullscreen && self.platform.is_fullscreen() {
            return;
        }
        let _ = self.tx.send(EngineMsg::CornerEdgeFired {
            hit,
            command,
            origin: pos,
        });
    }

    /// 定时线程入口
    fn on_tick(self: &Arc<Self>, now: Instant) {
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
                        executed_on_modifier: false,
                        last_recognized: None,
                    });
                    let _ = self.tx.send(EngineMsg::PathStarted { trigger, origin });
                }
                Action::PathGrow(pt) => {
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        let grew = s.parser.feed(pt) == StrokeEvent::Grew;
                        let _ = self.tx.send(EngineMsg::PathGrown { point: pt });
                        if grew {
                            let recognized = self
                                .finder
                                .lock()
                                .find(s.trigger, s.parser.strokes(), Modifier::None, &s.fg)
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
                Action::ModifierFired(m) => {
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        s.active_modifier = m;
                        let intent = if self.is_recording() {
                            None
                        } else {
                            self.finder
                                .lock()
                                .find(s.trigger, s.parser.strokes(), m, &s.fg)
                                .cloned()
                        };
                        // 立即执行型意图(如滚轮调音量)在此触发;标记以免 PathEnd 二次执行
                        if intent.as_ref().is_some_and(|i| i.execute_on_modifier) {
                            s.executed_on_modifier = true;
                        }
                        let context = GestureContext {
                            origin: s.origin,
                            native_window: s.fg.native_window,
                        };
                        let _ = self.tx.send(EngineMsg::ModifierFired {
                            intent,
                            modifier: m,
                            context,
                        });
                    }
                }
                Action::PathEnd { pos: _ } => {
                    let session = self.session.lock().take();
                    if let Some(s) = session {
                        // 录制模式:只上报捕获到的手势,不查找/不执行命令。
                        // 录制持续到前端显式 cancel_recording,期间可反复重画覆盖上一次结果,
                        // 避免录制器开着时误执行命令(例如把设置窗口关掉)。
                        if self.is_recording() {
                            let _ = self.tx.send(EngineMsg::GestureCaptured {
                                trigger: s.trigger,
                                strokes: s.parser.strokes().to_vec(),
                            });
                            continue;
                        }
                        let context = GestureContext {
                            origin: s.origin,
                            native_window: s.fg.native_window,
                        };
                        let intent = if s.executed_on_modifier {
                            // 已在修饰触发时执行,避免二次执行
                            None
                        } else {
                            let finder = self.finder.lock();
                            finder
                                .find(s.trigger, s.parser.strokes(), s.active_modifier, &s.fg)
                                .or_else(|| {
                                    // 带修饰未命中时回退无修饰意图(WGestures 语义:
                                    // 修饰只在有对应意图时才有意义)
                                    finder.find(s.trigger, s.parser.strokes(), Modifier::None, &s.fg)
                                })
                                .cloned()
                        };
                        let _ = self.tx.send(EngineMsg::PathEnded {
                            intent,
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

    fn has_path_content(&self) -> bool {
        self.shared
            .session
            .lock()
            .as_ref()
            .is_some_and(|s| !s.parser.strokes().is_empty())
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
        assert!(matches!(
            rx.recv().unwrap(),
            EngineMsg::PauseChanged(false)
        ));
    }
}

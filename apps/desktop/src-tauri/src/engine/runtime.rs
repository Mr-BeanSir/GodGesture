//! 引擎运行时 —— 把平台钩子事件接到追踪器/识别器/意图查找,并分发产物。
//!
//! 线程模型:
//! - 钩子线程:同步裁决(吞/不吞)+ 轻逻辑(追踪器、识别器、意图查找,均 µs 级);
//! - 定时线程:驱动追踪器的超时(起始超时/停留超时),30ms 粒度仅在捕获期间轮询;
//! - 执行线程(engine worker):命令执行与覆盖层消息等重活,经 channel 接收。
//!
//! 输入合成(SynthesizeClick/Down)在钩子线程内直接调用 —— 必须与吞事件的
//! 裁决保持同一时序,否则真实事件与合成事件可能乱序。

use super::config::{ConfigDocument, GestureIntent};
use super::intents::{ForegroundApp, IntentFinder};
use super::parser::{StrokeEvent, StrokeParser};
use super::tracker::{Action, Input, PathTracker, TrackerHost, TrackerParams};
use super::types::{Modifier, Point, TriggerButton};
use crossbeam_channel::{unbounded, Receiver, Sender};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 发往执行线程的消息(命令执行 + 视图更新;视图消费方在 M1 后段接入)
#[derive(Debug, Clone)]
pub enum EngineMsg {
    PathStarted {
        trigger: TriggerButton,
        origin: Point,
    },
    PathGrown {
        point: Point,
    },
    /// 增量识别结果变化(Some=当前笔画命中的意图名,None=无匹配)
    RecognitionChanged(Option<String>),
    PathEnded {
        intent: Option<GestureIntent>,
        modifier: Modifier,
    },
    PathCancelled,
    ModifierFired {
        intent: Option<GestureIntent>,
        modifier: Modifier,
    },
}

/// 平台服务:运行时需要但因平台而异的操作(由 platform 层注入)
pub trait PlatformServices: Send + Sync {
    fn resolve_foreground_app(&self, pos: Point, prefer_cursor_window: bool) -> ForegroundApp;
    fn is_fullscreen(&self) -> bool;
    fn synthesize_click(&self, button: super::tracker::MouseButton, pos: Point);
    fn synthesize_down(&self, button: super::tracker::MouseButton, pos: Point);
}

/// 手势进行中的会话状态(仅钩子线程与定时线程经锁访问)
struct Session {
    parser: StrokeParser,
    fg: ForegroundApp,
    trigger: TriggerButton,
    /// 手势期间最后一次触发的修饰(用于 PathEnd 时的意图键)
    active_modifier: Modifier,
    /// 上次增量识别的结果名(去重用)
    last_recognized: Option<String>,
}

pub struct EngineShared {
    tracker: Mutex<PathTracker>,
    session: Mutex<Option<Session>>,
    finder: Mutex<IntentFinder>,
    paused: AtomicBool,
    platform: Arc<dyn PlatformServices>,
    tx: Sender<EngineMsg>,
    /// 有效点距(识别一笔所需位移):屏宽 * 0.025,由平台层在启动/分辨率变化时更新
    effective_move_px: Mutex<f64>,
}

impl EngineShared {
    pub fn new(
        config: ConfigDocument,
        platform: Arc<dyn PlatformServices>,
    ) -> (Arc<Self>, Receiver<EngineMsg>) {
        let (tx, rx) = unbounded();
        let params = tracker_params_from(&config);
        let shared = Arc::new(Self {
            tracker: Mutex::new(PathTracker::new(params)),
            session: Mutex::new(None),
            finder: Mutex::new(IntentFinder::new(config)),
            paused: AtomicBool::new(false),
            platform,
            tx,
            effective_move_px: Mutex::new(48.0),
        });
        (shared, rx)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn toggle_paused(&self) -> bool {
        let now = !self.is_paused();
        self.set_paused(now);
        now
    }

    pub fn set_effective_move_px(&self, px: f64) {
        *self.effective_move_px.lock() = px.max(8.0);
    }

    /// 配置变更(设置界面保存/同步拉取后调用)
    pub fn replace_config(&self, config: ConfigDocument) {
        self.tracker.lock().set_params(tracker_params_from(&config));
        self.finder.lock().replace_config(config);
    }

    /// 钩子线程入口:裁决是否吞事件
    pub fn on_hook_event(self: &Arc<Self>, input: Input) -> bool {
        let now = Instant::now();
        let mut host = HostImpl { shared: self };
        let outcome = self.tracker.lock().handle(input, now, &mut host);
        self.apply_actions(outcome.actions);
        outcome.swallow
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
                        active_modifier: Modifier::None,
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
                            let name = self
                                .finder
                                .lock()
                                .find(s.trigger, s.parser.strokes(), Modifier::None, &s.fg)
                                .map(|i| i.name.clone());
                            if name != s.last_recognized {
                                s.last_recognized = name.clone();
                                let _ = self.tx.send(EngineMsg::RecognitionChanged(name));
                            }
                        }
                    }
                }
                Action::ModifierFired(m) => {
                    let mut session_guard = self.session.lock();
                    if let Some(s) = session_guard.as_mut() {
                        s.active_modifier = m;
                        let intent = self
                            .finder
                            .lock()
                            .find(s.trigger, s.parser.strokes(), m, &s.fg)
                            .cloned();
                        let _ = self.tx.send(EngineMsg::ModifierFired {
                            intent,
                            modifier: m,
                        });
                    }
                }
                Action::PathEnd { pos: _ } => {
                    let session = self.session.lock().take();
                    if let Some(s) = session {
                        let intent = {
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

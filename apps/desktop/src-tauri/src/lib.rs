pub mod engine;
mod legacy_import;
pub mod platform;

use engine::config::{ConfigDocument, ConfigStore, MachineLocalSettings};
#[cfg(windows)]
use engine::config::{ConfigFilesSnapshot, PauseHotkey};
use engine::runtime::{EngineMsg, EngineShared};
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg(windows)]
use platform::windows::startup::{
    EarlyMode, MachineRuntimeStatus, StartupError, StartupPolicy, TaskSnapshot,
};

struct ConfigTransaction(parking_lot::Mutex<()>);

#[cfg(windows)]
struct PauseHotkeyRegistration(parking_lot::Mutex<Option<String>>);

#[cfg(windows)]
struct TrayVisibility(parking_lot::Mutex<bool>);

#[cfg(windows)]
struct MachineStatus(parking_lot::Mutex<MachineRuntimeStatus>);

#[cfg(windows)]
struct PauseMenuItem(tauri::menu::MenuItem<tauri::Wry>);

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskSwitcherEvent {
    Recognition(bool),
    Finish,
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskSwitcherEffect {
    None,
    Begin,
    End,
}

#[cfg(windows)]
#[derive(Default)]
struct TaskSwitcherLifecycle {
    active: bool,
}

#[cfg(windows)]
impl TaskSwitcherLifecycle {
    fn reduce(&mut self, event: TaskSwitcherEvent) -> TaskSwitcherEffect {
        match (self.active, event) {
            (false, TaskSwitcherEvent::Recognition(true)) => {
                self.active = true;
                TaskSwitcherEffect::Begin
            }
            (true, TaskSwitcherEvent::Recognition(false) | TaskSwitcherEvent::Finish) => {
                self.active = false;
                TaskSwitcherEffect::End
            }
            _ => TaskSwitcherEffect::None,
        }
    }

    fn finish_path(&mut self, final_is_task_switcher: bool) -> (TaskSwitcherEffect, bool) {
        let already_executed = self.active && final_is_task_switcher;
        (self.reduce(TaskSwitcherEvent::Finish), already_executed)
    }

    fn force_inactive(&mut self) {
        self.active = false;
    }
}

#[cfg(windows)]
#[derive(Default)]
struct TaskSwitcherConsumer {
    lifecycle: TaskSwitcherLifecycle,
}

#[cfg(windows)]
impl TaskSwitcherConsumer {
    fn apply(&mut self, effect: TaskSwitcherEffect) {
        match effect {
            TaskSwitcherEffect::Begin => {
                if !platform::windows::commands::task_switcher_begin() {
                    self.lifecycle.force_inactive();
                }
            }
            TaskSwitcherEffect::End => platform::windows::commands::task_switcher_end(),
            TaskSwitcherEffect::None => {}
        }
    }

    fn recognition_changed(&mut self, task_switcher: bool) {
        let effect = self
            .lifecycle
            .reduce(TaskSwitcherEvent::Recognition(task_switcher));
        self.apply(effect);
    }

    fn finish(&mut self) {
        let effect = self.lifecycle.reduce(TaskSwitcherEvent::Finish);
        self.apply(effect);
    }

    fn finish_path(&mut self, final_is_task_switcher: bool) -> bool {
        let (effect, already_executed) = self.lifecycle.finish_path(final_is_task_switcher);
        self.apply(effect);
        already_executed
    }
}

#[cfg(windows)]
impl Drop for TaskSwitcherConsumer {
    fn drop(&mut self) {
        if self.lifecycle.active {
            // Channel 关闭、consumer 提前返回或 panic unwind 都必须释放 Alt。
            platform::windows::commands::task_switcher_end();
            self.lifecycle.force_inactive();
        }
    }
}

/// 引擎产物消费线程:驱动轨迹覆盖层;命令执行器(M2)也从这里接出去。
#[cfg(windows)]
fn spawn_engine_consumer(
    rx: crossbeam_channel::Receiver<EngineMsg>,
    shared: Arc<EngineShared>,
    overlay: platform::windows::overlay::Overlay,
    app: tauri::AppHandle,
) {
    use platform::windows::overlay::{OverlayCmd, TrailColors};
    std::thread::Builder::new()
        .name("gg-engine-consumer".into())
        .spawn(move || {
            let mut task_switcher = TaskSwitcherConsumer::default();
            for msg in rx {
                match msg {
                    EngineMsg::PathStarted { trigger, origin } => {
                        task_switcher.finish();
                        log::debug!("手势开始: {trigger:?} @ ({}, {})", origin.x, origin.y);
                        let (main, unrecognized, show_path, show_label, fade_out) =
                            shared.trail_style_for(trigger);
                        overlay.send(OverlayCmd::Begin {
                            origin,
                            colors: TrailColors { main, unrecognized },
                            show_path,
                            show_label,
                            fade_out,
                        });
                    }
                    EngineMsg::PathGrown { point } => {
                        overlay.send(OverlayCmd::Grow(point));
                    }
                    EngineMsg::RecognitionChanged {
                        name,
                        task_switcher: recognized_task_switcher,
                    } => {
                        log::debug!("识别变化: {name:?}");
                        overlay.send(OverlayCmd::Recognized(name));
                        task_switcher.recognition_changed(
                            recognized_task_switcher && !shared.is_recording(),
                        );
                    }
                    EngineMsg::ModifierFired {
                        intent,
                        modifier,
                        context,
                    } => {
                        // 修饰会把查找切到另一条意图；先结束增量 TaskSwitcher，
                        // 避免随后执行的命令意外继承仍按住的 Alt。
                        task_switcher.finish();
                        log::info!(
                            "修饰触发: {modifier:?} → {:?}",
                            intent.as_ref().map(|i| &i.name)
                        );
                        if !shared.is_recording() {
                            if let Some(intent) = intent.filter(|i| i.execute_on_modifier) {
                                execute_intent(&intent.command, modifier, &context, &shared);
                            }
                        }
                    }
                    EngineMsg::PathEnded {
                        intent,
                        modifier,
                        context,
                    } => {
                        overlay.send(OverlayCmd::End);
                        let final_is_task_switcher = intent.as_ref().is_some_and(|intent| {
                            matches!(&intent.command, engine::config::Command::TaskSwitcher)
                        });
                        let task_switcher_already_executed =
                            task_switcher.finish_path(final_is_task_switcher);
                        match intent {
                            Some(intent) => {
                                log::info!(
                                    "手势完成: [{}] {} (修饰 {modifier:?}) → 命令 {:?}",
                                    intent.gesture.trigger.mnemonic_dirs(&intent.gesture.strokes),
                                    intent.name,
                                    intent.command
                                );
                                if task_switcher_already_executed {
                                    log::debug!(
                                        "TaskSwitcher 已在增量识别时执行,PathEnd 仅释放 Alt"
                                    );
                                } else {
                                    execute_intent(&intent.command, modifier, &context, &shared);
                                }
                            }
                            None => log::debug!("手势结束: 无匹配意图"),
                        }
                    }
                    EngineMsg::GestureCaptured { trigger, strokes } => {
                        task_switcher.finish();
                        overlay.send(OverlayCmd::End);
                        let payload = CapturedGesture {
                            trigger,
                            mnemonic: trigger.mnemonic_dirs(&strokes),
                            strokes,
                        };
                        if let Err(e) = app.emit("gesture-captured", payload) {
                            log::warn!("手势录制事件发送失败: {e}");
                        }
                    }
                    EngineMsg::CornerEdgeFired {
                        hit,
                        command,
                        origin,
                    } => {
                        log::info!("{hit} 触发 → 命令 {command:?}");
                        // 目标窗口取前台窗口:此刻光标停在屏幕边角,指针下方的窗口
                        // 多半不是用户想操作的那个。
                        let fg = platform::windows::window::resolve_foreground_app(origin, false);
                        let context = engine::runtime::GestureContext {
                            origin,
                            endpoint: origin,
                            native_window: fg.native_window,
                        };
                        execute_intent(
                            &command,
                            engine::types::Modifier::None,
                            &context,
                            &shared,
                        );
                    }
                    EngineMsg::PathCancelled => {
                        task_switcher.finish();
                        log::debug!("手势取消");
                        overlay.send(OverlayCmd::Cancel);
                    }
                    EngineMsg::PauseChanged(paused) => {
                        task_switcher.finish();
                        publish_pause_state(&app, paused);
                    }
                }
            }
        })
        .expect("failed to spawn engine consumer thread");
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CapturedGesture {
    trigger: engine::types::TriggerButton,
    strokes: Vec<engine::types::Direction>,
    mnemonic: String,
}

#[cfg(windows)]
fn execute_intent(
    command: &engine::config::Command,
    modifier: engine::types::Modifier,
    context: &engine::runtime::GestureContext,
    shared: &Arc<EngineShared>,
) {
    if matches!(command, engine::config::Command::Pause) {
        let paused = shared.toggle_paused();
        log::info!("命令: 手势{}", if paused { "已暂停" } else { "已继续" });
    } else {
        platform::windows::commands::execute(command, modifier, context);
    }
}

trait TriggerMnemonic {
    fn mnemonic_dirs(&self, strokes: &[engine::types::Direction]) -> String;
}

impl TriggerMnemonic for engine::types::TriggerButton {
    fn mnemonic_dirs(&self, strokes: &[engine::types::Direction]) -> String {
        let btn = match self {
            engine::types::TriggerButton::Right => "◑",
            engine::types::TriggerButton::Middle => "●",
            engine::types::TriggerButton::X1 => "X1",
            engine::types::TriggerButton::X2 => "X2",
        };
        let dirs: String = strokes.iter().map(|d| d.mnemonic()).collect();
        format!("{btn}{dirs}")
    }
}

#[tauri::command]
fn engine_toggle_pause(state: tauri::State<Arc<EngineShared>>) -> bool {
    state.toggle_paused()
}

#[tauri::command]
fn engine_is_paused(state: tauri::State<Arc<EngineShared>>) -> bool {
    state.is_paused()
}

#[tauri::command]
fn config_get(store: tauri::State<Arc<ConfigStore>>) -> ConfigDocument {
    store.load_config()
}

#[tauri::command]
fn config_set(
    document: ConfigDocument,
    store: tauri::State<Arc<ConfigStore>>,
    engine: tauri::State<Arc<EngineShared>>,
    transaction: tauri::State<ConfigTransaction>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let _transaction = transaction.0.lock();
    #[cfg(not(windows))]
    let _ = &app;
    #[cfg(windows)]
    let previous_hotkey = current_pause_hotkey(&app);
    #[cfg(windows)]
    replace_pause_hotkey(&app, &document.preferences.pause_hotkey)?;

    if let Err(err) = store.save_config(&document) {
        #[cfg(windows)]
        if let Err(rollback_err) = replace_pause_hotkey_value(&app, previous_hotkey) {
            log::error!("配置保存失败后恢复暂停快捷键也失败: {rollback_err}");
        }
        return Err(err.to_string());
    }
    engine.replace_config(document);
    Ok(())
}

#[tauri::command]
fn machine_get(store: tauri::State<Arc<ConfigStore>>) -> MachineLocalSettings {
    store.load_machine()
}

#[cfg(windows)]
#[tauri::command]
async fn machine_set(
    settings: MachineLocalSettings,
    app: tauri::AppHandle,
) -> Result<(), StartupError> {
    tauri::async_runtime::spawn_blocking(move || machine_set_blocking(settings, &app))
        .await
        .map_err(|err| StartupError::new(
            "apply_failed",
            format!("machine settings worker failed: {err}"),
        ))?
}

#[cfg(windows)]
fn machine_set_blocking(
    settings: MachineLocalSettings,
    app: &tauri::AppHandle,
) -> Result<(), StartupError> {
    let store = app.state::<Arc<ConfigStore>>();
    let transaction = app.state::<ConfigTransaction>();
    let _transaction = transaction.0.lock();
    if settings.run_as_admin {
        let (elevated, split_token) = platform::windows::startup::elevation_state()?;
        if !elevated && !split_token {
            return Err(StartupError::new(
                "admin_account_required",
                "run as administrator requires an administrator account with an elevatable token",
            ));
        }
    }

    let mut effects = DesktopMachineEffects {
        store: store.inner(),
        app,
        settings: &settings,
    };
    let result = platform::windows::startup::apply_machine_settings(&mut effects);
    let status = match &result {
        Ok(()) => MachineRuntimeStatus::healthy(),
        Err(error) if error.code == "rollback_incomplete" => MachineRuntimeStatus::failed(error),
        Err(_) => return result,
    };
    *app.state::<MachineStatus>().0.lock() = status;
    result
}

#[cfg(windows)]
struct DesktopMachineSnapshot {
    files: ConfigFilesSnapshot,
    task: TaskSnapshot,
    sid: String,
    tray_visible: bool,
}

#[cfg(windows)]
struct DesktopMachineEffects<'a> {
    store: &'a ConfigStore,
    app: &'a tauri::AppHandle,
    settings: &'a MachineLocalSettings,
}

#[cfg(windows)]
impl platform::windows::startup::MachineEffects for DesktopMachineEffects<'_> {
    type Snapshot = DesktopMachineSnapshot;

    fn snapshot(&mut self) -> Result<Self::Snapshot, StartupError> {
        let files = self.store.snapshot_files().map_err(|err| {
            StartupError::new("apply_failed", format!("snapshot machine file: {err}"))
        })?;
        let sid = platform::windows::startup::current_user_sid()?;
        let task = platform::windows::startup::snapshot(&sid)?;
        Ok(DesktopMachineSnapshot {
            files,
            task,
            sid,
            tray_visible: current_tray_visibility(self.app),
        })
    }

    fn save_machine(&mut self) -> Result<(), StartupError> {
        self.store.save_machine(self.settings).map_err(|err| {
            StartupError::new("apply_failed", format!("save machine settings: {err}"))
        })
    }

    fn reconcile_task(&mut self) -> Result<(), StartupError> {
        platform::windows::startup::reconcile_with_elevation(
            &StartupPolicy::from(self.settings),
            &platform::windows::startup::current_user_sid()?,
        )
    }

    fn apply_tray(&mut self) -> Result<(), StartupError> {
        set_tray_visible(self.app, self.settings.tray_icon_visible).map_err(|err| {
            StartupError::new("apply_failed", format!("set tray visibility: {err}"))
        })
    }

    fn rollback(
        &mut self,
        snapshot: &Self::Snapshot,
        progress: platform::windows::startup::MachineApplyProgress,
    ) -> Vec<String> {
        let mut errors = Vec::new();
        if progress.tray_attempted {
            if let Err(err) = set_tray_visible(self.app, snapshot.tray_visible) {
                errors.push(format!("tray restore failed: {err}"));
            }
        }
        if progress.task_attempted {
            if let Err(err) = platform::windows::startup::restore_with_elevation(
                &snapshot.task,
                &snapshot.sid,
            ) {
                errors.push(format!("startup task restore failed: {}", err.message));
            }
        }
        if progress.file_attempted {
            if let Err(err) = self.store.restore_machine_snapshot(&snapshot.files) {
                errors.push(format!("machine file restore failed: {err}"));
            }
        }
        errors
    }
}

#[cfg(windows)]
#[tauri::command]
async fn machine_status(app: tauri::AppHandle) -> MachineRuntimeStatus {
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let transaction = worker_app.state::<ConfigTransaction>();
        let _transaction = transaction.0.lock();
        worker_app.state::<MachineStatus>().0.lock().clone()
    })
    .await
    .unwrap_or_else(|err| {
        let error = StartupError::new(
            "task_scheduler_failed",
            format!("machine status worker failed: {err}"),
        );
        MachineRuntimeStatus::failed(&error)
    })
}

#[cfg(not(windows))]
#[tauri::command]
fn machine_set(
    settings: MachineLocalSettings,
    store: tauri::State<Arc<ConfigStore>>,
    transaction: tauri::State<ConfigTransaction>,
) -> Result<(), String> {
    let _transaction = transaction.0.lock();
    store.save_machine(&settings).map_err(|err| err.to_string())
}

#[cfg(not(windows))]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NonWindowsMachineRuntimeStatus {
    healthy: bool,
    code: Option<String>,
    message: Option<String>,
}

#[cfg(not(windows))]
#[tauri::command]
fn machine_status() -> NonWindowsMachineRuntimeStatus {
    NonWindowsMachineRuntimeStatus {
        healthy: true,
        code: None,
        message: None,
    }
}

#[cfg(windows)]
struct DesktopLegacyImportSnapshot {
    files: ConfigFilesSnapshot,
    hotkey: Option<String>,
    tray_visible: bool,
    startup: TaskSnapshot,
    sid: String,
}

#[cfg(windows)]
struct DesktopLegacyImportEffects<'a> {
    store: &'a ConfigStore,
    engine: &'a EngineShared,
    app: &'a tauri::AppHandle,
}

#[cfg(windows)]
impl legacy_import::LegacyImportEffects for DesktopLegacyImportEffects<'_> {
    type Snapshot = DesktopLegacyImportSnapshot;

    fn snapshot(&mut self) -> Result<Self::Snapshot, String> {
        let files = self.store.snapshot_files().map_err(|err| err.to_string())?;
        let sid = platform::windows::startup::current_user_sid().map_err(|err| err.message)?;
        let startup = platform::windows::startup::snapshot(&sid).map_err(|err| err.message)?;
        Ok(DesktopLegacyImportSnapshot {
            files,
            hotkey: current_pause_hotkey(self.app),
            tray_visible: current_tray_visibility(self.app),
            startup,
            sid,
        })
    }

    fn apply_hotkey(&mut self, hotkey: &PauseHotkey) -> Result<(), String> {
        replace_pause_hotkey(self.app, hotkey)
    }

    fn apply_tray_visibility(&mut self, visible: bool) -> Result<(), String> {
        set_tray_visible(self.app, visible)
    }

    fn save_config(&mut self, document: &ConfigDocument) -> Result<(), String> {
        self.store
            .save_config(document)
            .map_err(|err| err.to_string())
    }

    fn save_machine(&mut self, machine: &MachineLocalSettings) -> Result<(), String> {
        self.store
            .save_machine(machine)
            .map_err(|err| err.to_string())
    }

    fn apply_startup(&mut self, machine: &MachineLocalSettings) -> Result<(), String> {
        if machine.run_as_admin {
            let (elevated, split) = platform::windows::startup::elevation_state()
                .map_err(|err| err.message)?;
            if !elevated && !split {
                return Err("admin_account_required".into());
            }
        }
        platform::windows::startup::reconcile_with_elevation(
            &StartupPolicy::from(machine),
            &platform::windows::startup::current_user_sid().map_err(|err| err.message)?,
        )
        .map_err(|err| format!("{}: {}", err.code, err.message))
    }

    fn rollback(
        &mut self,
        snapshot: &Self::Snapshot,
        progress: legacy_import::ApplyProgress,
    ) -> Vec<String> {
        let mut errors = Vec::new();
        if progress.tray_attempted {
            if let Err(err) = set_tray_visible(self.app, snapshot.tray_visible) {
                errors.push(format!("tray restore failed: {err}"));
            }
        }
        if progress.startup_attempted {
            if let Err(err) = platform::windows::startup::restore_with_elevation(
                &snapshot.startup,
                &snapshot.sid,
            ) {
                errors.push(format!("startup task restore failed: {}", err.message));
            }
        }
        if progress.machine_attempted {
            if let Err(err) = self.store.restore_machine_snapshot(&snapshot.files) {
                errors.push(format!("machine file restore failed: {err}"));
            }
        }
        if progress.config_attempted {
            if let Err(err) = self.store.restore_config_snapshot(&snapshot.files) {
                errors.push(format!("config file restore failed: {err}"));
            }
        }
        if progress.hotkey_attempted {
            if let Err(err) = replace_pause_hotkey_value(self.app, snapshot.hotkey.clone()) {
                errors.push(format!("hotkey restore failed: {err}"));
            }
        }
        errors
    }

    fn replace_engine_config(&mut self, document: ConfigDocument) {
        self.engine.replace_config(document);
    }
}

#[cfg(windows)]
#[tauri::command]
async fn legacy_import_apply(
    document: ConfigDocument,
    machine: MachineLocalSettings,
    app: tauri::AppHandle,
) -> Result<(), legacy_import::LegacyImportError> {
    tauri::async_runtime::spawn_blocking(move || {
        legacy_import_apply_blocking(document, machine, &app)
    })
    .await
    .map_err(|err| legacy_import::LegacyImportError::apply_failed(format!(
        "legacy import worker failed: {err}"
    )))?
}

#[cfg(windows)]
fn legacy_import_apply_blocking(
    document: ConfigDocument,
    machine: MachineLocalSettings,
    app: &tauri::AppHandle,
) -> Result<(), legacy_import::LegacyImportError> {
    let store = app.state::<Arc<ConfigStore>>();
    let engine = app.state::<Arc<EngineShared>>();
    let transaction = app.state::<ConfigTransaction>();
    let _transaction = transaction.0.lock();
    let mut effects = DesktopLegacyImportEffects {
        store: store.inner(),
        engine: engine.inner(),
        app,
    };
    let result = legacy_import::apply_legacy_import(&mut effects, document, machine);
    match &result {
        Ok(()) => {
            *app.state::<MachineStatus>().0.lock() = MachineRuntimeStatus::healthy();
        }
        Err(err) if err.code == "rollback_incomplete" => {
            let startup_error = StartupError::rollback_incomplete(
                err.message.clone(),
                err.rollback_errors.clone(),
            );
            *app.state::<MachineStatus>().0.lock() =
                MachineRuntimeStatus::failed(&startup_error);
        }
        Err(_) => {}
    }
    if let Err(err) = &result {
        if err.code == "rollback_incomplete" {
            log::error!(
                "WGestures 导入回滚不完整: {}; {}",
                err.message,
                err.rollback_errors.join("; ")
            );
        } else {
            log::warn!("WGestures 导入失败并已回滚: {}", err.message);
        }
    }
    result
}

#[cfg(not(windows))]
#[tauri::command]
fn legacy_import_apply(
    document: ConfigDocument,
    machine: MachineLocalSettings,
    transaction: tauri::State<ConfigTransaction>,
) -> Result<(), legacy_import::LegacyImportError> {
    let _transaction = transaction.0.lock();
    let _ = (document, machine);
    Err(legacy_import::LegacyImportError::unsupported())
}

#[tauri::command]
fn capture_start(engine: tauri::State<Arc<EngineShared>>) {
    engine.start_recording();
}

#[tauri::command]
fn capture_cancel(engine: tauri::State<Arc<EngineShared>>) {
    engine.cancel_recording();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedWindow {
    exe_name: String,
    exe_path: String,
    aumid: Option<String>,
    app_name: String,
}

/// 拾取窗口:轮询前台窗口至多 ~3s,取第一个非本进程的窗口。
/// 轮询是阻塞的,放到 blocking 线程,避免冻结设置窗口。
#[cfg(windows)]
#[tauri::command]
async fn pick_window() -> Option<PickedWindow> {
    tauri::async_runtime::spawn_blocking(pick_window_blocking)
        .await
        .ok()
        .flatten()
}

#[cfg(not(windows))]
#[tauri::command]
async fn pick_window() -> Option<PickedWindow> {
    None
}

#[cfg(windows)]
fn pick_window_blocking() -> Option<PickedWindow> {
    let own_pid = std::process::id();
    for _ in 0..30 {
        if let Some(info) = platform::windows::window::foreground_window_info() {
            if info.pid != own_pid {
                let app_name = if info.title.is_empty() {
                    info.exe_name
                        .strip_suffix(".exe")
                        .unwrap_or(&info.exe_name)
                        .to_string()
                } else {
                    info.title
                };
                return Some(PickedWindow {
                    exe_name: info.exe_name,
                    exe_path: info.exe_path,
                    aumid: info.aumid,
                    app_name,
                });
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    None
}

/// exe 名 → 图标 PNG 的 base64(裸 base64,前端自行拼 data: 前缀);
/// 解析不到路径或取不到图标时返回 null(契约允许)。
/// 解析要枚举窗口/读注册表,和 pick_window 一样丢到 blocking 线程,别卡住设置窗口。
#[cfg(windows)]
#[tauri::command]
async fn app_icon(exe_name: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform::windows::icon::app_icon_base64(&exe_name)
    })
    .await
    .ok()
    .flatten()
}

#[cfg(not(windows))]
#[tauri::command]
async fn app_icon(exe_name: String) -> Option<String> {
    let _ = exe_name;
    None
}

/// 托盘:暂停/继续 · 设置 · 退出(对齐 WGestures 托盘菜单)
#[cfg(windows)]
fn setup_tray(
    app: &tauri::App,
    shared: Arc<EngineShared>,
    visible: bool,
) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::TrayIconBuilder;

    let pause_item = MenuItemBuilder::with_id("pause", "暂停").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "设置").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&pause_item)
        .separator()
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    app.manage(PauseMenuItem(pause_item.clone()));
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("app icon missing"))
        .tooltip(format!("GodGesture {}", env!("CARGO_PKG_VERSION")))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "pause" => {
                let paused = shared.toggle_paused();
                log::info!("手势{}", if paused { "已暂停" } else { "已继续" });
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 双击打开设置
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;
    tray.set_visible(visible)?;
    app.manage(TrayVisibility(parking_lot::Mutex::new(visible)));
    Ok(())
}

#[cfg(windows)]
fn set_tray_visible(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "tray icon is unavailable".to_string())?;
    tray.set_visible(visible).map_err(|err| err.to_string())?;
    *app.state::<TrayVisibility>().0.lock() = visible;
    Ok(())
}

#[cfg(windows)]
fn current_tray_visibility(app: &tauri::AppHandle) -> bool {
    *app.state::<TrayVisibility>().0.lock()
}

#[cfg(windows)]
fn publish_pause_state(app: &tauri::AppHandle, paused: bool) {
    if let Some(item) = app.try_state::<PauseMenuItem>() {
        if let Err(err) = item.0.set_text(if paused { "继续" } else { "暂停" }) {
            log::warn!("托盘暂停菜单更新失败: {err}");
        }
    }
    if let Err(err) = app.emit("pause-changed", paused) {
        log::warn!("暂停状态事件发送失败: {err}");
    }
}

/// 全局暂停/继续快捷键(默认 Ctrl+Shift+Alt+W,配置可改)
#[cfg(windows)]
fn setup_pause_hotkey(app: &tauri::App, shared: Arc<EngineShared>) {
    use tauri_plugin_global_shortcut::ShortcutState;

    app.manage(PauseHotkeyRegistration(parking_lot::Mutex::new(None)));
    let shared_hk = Arc::clone(&shared);
    let result = app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let paused = shared_hk.toggle_paused();
                    log::info!("快捷键: 手势{}", if paused { "已暂停" } else { "已继续" });
                }
            })
            .build(),
    );
    if let Err(err) = result {
        log::warn!("暂停快捷键插件初始化失败: {err}");
        return;
    }
    let hotkey = shared.pause_hotkey();
    if let Err(err) = replace_pause_hotkey_parts(app.handle(), &hotkey.0, &hotkey.1) {
        log::warn!("暂停快捷键注册失败: {err}");
    }
}

#[cfg(windows)]
fn format_pause_hotkey(modifiers: &[String], key: &str) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    // global-hotkey 的字符串语法把跨平台 meta 称为 Super。
    let modifiers = modifiers
        .iter()
        .map(|modifier| if modifier == "meta" { "super" } else { modifier })
        .collect::<Vec<_>>()
        .join("+");
    Some(if modifiers.is_empty() {
        key.to_string()
    } else {
        format!("{modifiers}+{key}")
    })
}

#[cfg(windows)]
fn replace_pause_hotkey(app: &tauri::AppHandle, hotkey: &PauseHotkey) -> Result<(), String> {
    replace_pause_hotkey_parts(app, &hotkey.modifiers, &hotkey.key)
}

#[cfg(windows)]
fn replace_pause_hotkey_parts(
    app: &tauri::AppHandle,
    modifiers: &[String],
    key: &str,
) -> Result<(), String> {
    replace_pause_hotkey_value(app, format_pause_hotkey(modifiers, key))
}

#[cfg(windows)]
fn current_pause_hotkey(app: &tauri::AppHandle) -> Option<String> {
    app.state::<PauseHotkeyRegistration>().0.lock().clone()
}

#[cfg(windows)]
fn replace_pause_hotkey_value(app: &tauri::AppHandle, next: Option<String>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let state = app.state::<PauseHotkeyRegistration>();
    let mut current = state.0.lock();
    if *current == next {
        return Ok(());
    }
    let previous = current.clone();
    if let Some(shortcut) = previous.as_deref() {
        app.global_shortcut()
            .unregister(shortcut)
            .map_err(|err| format!("无法注销旧快捷键 {shortcut}: {err}"))?;
    }
    if let Some(shortcut) = next.as_deref() {
        if let Err(err) = app.global_shortcut().register(shortcut) {
            let rollback = previous.as_deref().map(|old| {
                app.global_shortcut()
                    .register(old)
                    .map_err(|rollback_err| rollback_err.to_string())
            });
            *current = if rollback.as_ref().is_none_or(Result::is_ok) {
                previous
            } else {
                None
            };
            return Err(match rollback {
                Some(Err(rollback_err)) => format!(
                    "无法注册快捷键 {shortcut}: {err}; 恢复旧快捷键也失败: {rollback_err}"
                ),
                _ => format!("无法注册快捷键 {shortcut}: {err}"),
            });
        }
    } else {
        log::info!("暂停快捷键已禁用");
    }
    *current = next;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    #[cfg(windows)]
    let early_mode = match platform::windows::startup::parse_early_mode(std::env::args()) {
        Ok(mode) => mode,
        Err(err) => {
            log::error!("拒绝无效的内部启动参数: {}", err.message);
            return;
        }
    };

    #[cfg(windows)]
    if let EarlyMode::TaskHelper { enabled, highest } = early_mode {
        let result = platform::windows::startup::run_helper(&StartupPolicy { enabled, highest });
        if let Err(err) = &result {
            log::error!("启动任务 helper 失败 [{}]: {}", err.code, err.message);
        }
        std::process::exit(platform::windows::startup::helper_exit_code(&result));
    }

    #[cfg(windows)]
    if early_mode == EarlyMode::Interactive {
        let config_dir = std::env::var_os("APPDATA")
            .map(std::path::PathBuf::from)
            .map(|path| path.join("com.godgesture.app"));
        if let Some(config_dir) = config_dir {
            let machine = ConfigStore::new(config_dir).load_machine();
            if machine.run_as_admin {
                match platform::windows::startup::elevation_state() {
                    Ok((true, _)) => {}
                    Ok((false, true)) => {
                        if let Err(err) = platform::windows::startup::elevate_interactive() {
                            log::error!("管理员启动失败 [{}]: {}", err.code, err.message);
                        }
                        return;
                    }
                    Ok((false, false)) => {
                        log::error!("管理员启动被拒绝: 当前账户没有可提升的 split token");
                        return;
                    }
                    Err(err) => {
                        log::error!("管理员启动校验失败 [{}]: {}", err.code, err.message);
                        return;
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    let setup_mode = early_mode;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let is_autostart = args.iter().any(|arg| arg == "--autostart");
            if !is_autostart {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        }))
        .setup(move |app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("cannot resolve app config dir");
            let store = Arc::new(ConfigStore::new(config_dir));
            let config = store.load_config();
            #[cfg(windows)]
            let machine = store.load_machine();
            app.manage(store);
            app.manage(ConfigTransaction(parking_lot::Mutex::new(())));

            #[cfg(windows)]
            {
                app.manage(MachineStatus(parking_lot::Mutex::new(
                    MachineRuntimeStatus::healthy(),
                )));
                let startup_app = app.handle().clone();
                let startup_failure_app = startup_app.clone();
                let startup_policy = StartupPolicy::from(&machine);
                if let Err(err) = std::thread::Builder::new()
                    .name("gg-startup-reconcile".into())
                    .spawn(move || {
                        let transaction = startup_app.state::<ConfigTransaction>();
                        let _transaction = transaction.0.lock();
                        let result = platform::windows::startup::current_user_sid().and_then(|sid| {
                            platform::windows::startup::reconcile_with_elevation(
                                &startup_policy,
                                &sid,
                            )
                        });
                        let status = match result {
                            Ok(()) => MachineRuntimeStatus::healthy(),
                            Err(err) => {
                                log::warn!("启动任务对账失败 [{}]: {}", err.code, err.message);
                                MachineRuntimeStatus::failed(&err)
                            }
                        };
                        *startup_app.state::<MachineStatus>().0.lock() = status;
                    })
                {
                    let error = StartupError::new(
                        "task_scheduler_failed",
                        format!("cannot start startup reconciliation worker: {err}"),
                    );
                    *startup_failure_app.state::<MachineStatus>().0.lock() =
                        MachineRuntimeStatus::failed(&error);
                }
                let platform = Arc::new(platform::windows::WindowsPlatform);
                let (shared, rx) = EngineShared::new(config, platform);
                let overlay = platform::windows::overlay::Overlay::spawn();
                spawn_engine_consumer(
                    rx,
                    Arc::clone(&shared),
                    overlay,
                    app.handle().clone(),
                );
                app.manage(Arc::clone(&shared));
                setup_tray(app, Arc::clone(&shared), machine.tray_icon_visible)?;
                setup_pause_hotkey(app, Arc::clone(&shared));
                let hook = platform::windows::start(Arc::clone(&shared));
                // 钩子随应用生存期存活
                app.manage(hook);
                if setup_mode == EarlyMode::Interactive {
                    if let Some(win) = app.get_webview_window("main") {
                        win.show()?;
                        win.set_focus()?;
                    }
                }
            }
            #[cfg(not(windows))]
            {
                let _ = config;
                log::warn!("当前平台的手势引擎尚未实现(macOS 引擎在 M4 落地)");
                if let Some(win) = app.get_webview_window("main") {
                    win.show()?;
                    win.set_focus()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config_get,
            config_set,
            machine_get,
            machine_set,
            machine_status,
            legacy_import_apply,
            engine_toggle_pause,
            engine_is_paused,
            capture_start,
            capture_cancel,
            pick_window,
            app_icon,
        ])
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        // Frontend cleanup is asynchronous and may be interrupted by a hide.
                        // Always bound recording in Rust before keeping the settings WebView alive.
                        window.state::<Arc<EngineShared>>().cancel_recording();
                        api.prevent_close();
                        if let Err(err) = window.hide() {
                            log::warn!("设置窗口隐藏失败: {err}");
                        }
                    }
                    tauri::WindowEvent::Destroyed => {
                        window.state::<Arc<EngineShared>>().cancel_recording();
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::types::{Direction, TriggerButton};

    #[test]
    fn captured_gesture_matches_frontend_contract() {
        let trigger = TriggerButton::Right;
        let strokes = vec![Direction::Up, Direction::RightDown];
        let payload = CapturedGesture {
            trigger,
            mnemonic: trigger.mnemonic_dirs(&strokes),
            strokes,
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["trigger"], "right");
        assert_eq!(json["strokes"], serde_json::json!(["up", "rightDown"]));
        assert_eq!(json["mnemonic"], "◑↑↘");
    }

    #[test]
    fn picked_window_matches_frontend_contract() {
        let json = serde_json::to_value(PickedWindow {
            exe_name: "calculatorapp.exe".into(),
            exe_path: "C:\\Program Files\\WindowsApps\\CalculatorApp.exe".into(),
            aumid: Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".into()),
            app_name: "Calculator".into(),
        })
        .unwrap();

        assert_eq!(json["exeName"], "calculatorapp.exe");
        assert_eq!(
            json["aumid"],
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        );
        assert!(json.get("exe_name").is_none());

        let without_aumid = serde_json::to_value(PickedWindow {
            exe_name: "notepad.exe".into(),
            exe_path: "C:\\Windows\\System32\\notepad.exe".into(),
            aumid: None,
            app_name: "Notepad".into(),
        })
        .unwrap();
        assert!(without_aumid["aumid"].is_null());
    }

    #[cfg(windows)]
    #[test]
    fn pause_hotkey_format_uses_global_shortcut_super_name() {
        assert_eq!(
            format_pause_hotkey(&["ctrl".into(), "meta".into()], "w").as_deref(),
            Some("ctrl+super+w")
        );
        assert_eq!(format_pause_hotkey(&[], "f12").as_deref(), Some("f12"));
        assert_eq!(format_pause_hotkey(&["ctrl".into()], ""), None);
    }

    #[cfg(windows)]
    #[test]
    fn task_switcher_lifecycle_begins_once_and_ends_when_recognition_changes() {
        let mut lifecycle = TaskSwitcherLifecycle::default();

        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Recognition(true)),
            TaskSwitcherEffect::Begin
        );
        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Recognition(true)),
            TaskSwitcherEffect::None
        );
        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Recognition(false)),
            TaskSwitcherEffect::End
        );
        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Recognition(false)),
            TaskSwitcherEffect::None
        );
        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Recognition(true)),
            TaskSwitcherEffect::Begin
        );
    }

    #[cfg(windows)]
    #[test]
    fn task_switcher_lifecycle_finish_is_idempotent() {
        let mut lifecycle = TaskSwitcherLifecycle::default();

        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Recognition(true)),
            TaskSwitcherEffect::Begin
        );
        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Finish),
            TaskSwitcherEffect::End
        );
        assert_eq!(
            lifecycle.reduce(TaskSwitcherEvent::Finish),
            TaskSwitcherEffect::None
        );
    }

    #[cfg(windows)]
    #[test]
    fn task_switcher_path_end_skips_only_an_active_matching_command() {
        let mut lifecycle = TaskSwitcherLifecycle::default();

        lifecycle.reduce(TaskSwitcherEvent::Recognition(true));
        assert_eq!(lifecycle.finish_path(true), (TaskSwitcherEffect::End, true));
        assert_eq!(
            lifecycle.finish_path(true),
            (TaskSwitcherEffect::None, false)
        );

        lifecycle.reduce(TaskSwitcherEvent::Recognition(true));
        assert_eq!(
            lifecycle.finish_path(false),
            (TaskSwitcherEffect::End, false)
        );
    }
}

pub mod engine;
pub mod platform;

#[cfg(windows)]
use engine::config::PauseHotkey;
use engine::config::{ConfigDocument, ConfigStore, MachineLocalSettings};
use engine::runtime::{EngineMsg, EngineShared};
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg(windows)]
struct PauseHotkeyRegistration(parking_lot::Mutex<Option<String>>);

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
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(not(windows))]
    let _ = &app;
    #[cfg(windows)]
    let previous_hotkey = engine.pause_hotkey();
    #[cfg(windows)]
    replace_pause_hotkey(&app, &document.preferences.pause_hotkey)?;

    if let Err(err) = store.save_config(&document) {
        #[cfg(windows)]
        if let Err(rollback_err) = replace_pause_hotkey_parts(
            &app,
            &previous_hotkey.0,
            &previous_hotkey.1,
        ) {
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

#[tauri::command]
fn machine_set(
    settings: MachineLocalSettings,
    store: tauri::State<Arc<ConfigStore>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(not(windows))]
    let _ = &app;
    #[cfg(windows)]
    let previous = store.load_machine();
    #[cfg(windows)]
    set_tray_visible(&app, settings.tray_icon_visible)?;
    if let Err(err) = store.save_machine(&settings) {
        #[cfg(windows)]
        if let Err(rollback_err) = set_tray_visible(&app, previous.tray_icon_visible) {
            log::error!("本机设置保存失败后恢复托盘可见性也失败: {rollback_err}");
        }
        return Err(err.to_string());
    }
    Ok(())
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
    Ok(())
}

#[cfg(windows)]
fn set_tray_visible(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "tray icon is unavailable".to_string())?;
    tray.set_visible(visible).map_err(|err| err.to_string())
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
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let next = format_pause_hotkey(modifiers, key);
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动:唤起设置窗口(对齐 WGestures 的单实例行为)
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("cannot resolve app config dir");
            let store = Arc::new(ConfigStore::new(config_dir));
            let config = store.load_config();
            #[cfg(windows)]
            let machine = store.load_machine();
            app.manage(store);

            #[cfg(windows)]
            {
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
            }
            #[cfg(not(windows))]
            {
                let _ = config;
                log::warn!("当前平台的手势引擎尚未实现(macOS 引擎在 M4 落地)");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config_get,
            config_set,
            machine_get,
            machine_set,
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

pub mod engine;
pub mod platform;

use engine::config::{ConfigDocument, ConfigStore, MachineLocalSettings};
use engine::runtime::{EngineMsg, EngineShared};
use std::sync::Arc;
use tauri::Manager;

/// 引擎产物消费线程:驱动轨迹覆盖层;命令执行器(M2)也从这里接出去。
#[cfg(windows)]
fn spawn_engine_consumer(
    rx: crossbeam_channel::Receiver<EngineMsg>,
    shared: Arc<EngineShared>,
    overlay: platform::windows::overlay::Overlay,
    app: tauri::AppHandle,
) {
    use platform::windows::overlay::{OverlayCmd, TrailColors};
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("gg-engine-consumer".into())
        .spawn(move || {
            for msg in rx {
                match msg {
                    EngineMsg::PathStarted { trigger, origin } => {
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
                    EngineMsg::RecognitionChanged(name) => {
                        log::debug!("识别变化: {name:?}");
                        overlay.send(OverlayCmd::Recognized(name));
                    }
                    EngineMsg::ModifierFired {
                        intent,
                        modifier,
                        context,
                    } => {
                        log::info!(
                            "修饰触发: {modifier:?} → {:?}",
                            intent.as_ref().map(|i| &i.name)
                        );
                        if !shared.is_recording() {
                            if let Some(intent) = intent.filter(|i| i.execute_on_modifier) {
                                execute_intent(&intent.command, &context, &shared);
                            }
                        }
                    }
                    EngineMsg::PathEnded {
                        intent,
                        modifier,
                        context,
                    } => {
                        overlay.send(OverlayCmd::End);
                        match intent {
                            Some(intent) => {
                                log::info!(
                                    "手势完成: [{}] {} (修饰 {modifier:?}) → 命令 {:?}",
                                    intent.gesture.trigger.mnemonic_dirs(&intent.gesture.strokes),
                                    intent.name,
                                    intent.command
                                );
                                execute_intent(&intent.command, &context, &shared);
                            }
                            None => log::debug!("手势结束: 无匹配意图"),
                        }
                    }
                    EngineMsg::GestureCaptured { trigger, strokes } => {
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
                    EngineMsg::PathCancelled => {
                        log::debug!("手势取消");
                        overlay.send(OverlayCmd::Cancel);
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
    context: &engine::runtime::GestureContext,
    shared: &Arc<EngineShared>,
) {
    if matches!(command, engine::config::Command::Pause) {
        let paused = shared.toggle_paused();
        log::info!("命令: 手势{}", if paused { "已暂停" } else { "已继续" });
    } else {
        platform::windows::commands::execute(command, context);
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
) -> Result<(), String> {
    store.save_config(&document).map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    store.save_machine(&settings).map_err(|e| e.to_string())
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
                    app_name,
                });
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    None
}

/// 图标提取与 PNG 编码在后续 UI 完善项落地;契约允许失败时返回 null。
#[tauri::command]
fn app_icon(exe_name: String) -> Option<String> {
    let _ = exe_name;
    None
}

/// 托盘:暂停/继续 · 设置 · 退出(对齐 WGestures 托盘菜单)
#[cfg(windows)]
fn setup_tray(app: &tauri::App, shared: Arc<EngineShared>) -> tauri::Result<()> {
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

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("app icon missing"))
        .tooltip(format!("GodGesture {}", env!("CARGO_PKG_VERSION")))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "pause" => {
                let paused = shared.toggle_paused();
                let _ = pause_item.set_text(if paused { "继续" } else { "暂停" });
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
    Ok(())
}

/// 全局暂停/继续快捷键(默认 Ctrl+Shift+Alt+W,配置可改)
#[cfg(windows)]
fn setup_pause_hotkey(app: &tauri::App, shared: Arc<EngineShared>) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let hk = {
        let cfg = &shared_config_pause_hotkey(&shared);
        let mods = cfg.0.join("+");
        if mods.is_empty() {
            cfg.1.clone()
        } else {
            format!("{}+{}", mods, cfg.1)
        }
    };
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
    if result.is_ok() {
        if let Err(e) = app.handle().global_shortcut().register(hk.as_str()) {
            log::warn!("暂停快捷键注册失败({hk}): {e}");
        }
    }
}

#[cfg(windows)]
fn shared_config_pause_hotkey(shared: &Arc<EngineShared>) -> (Vec<String>, String) {
    let hk = shared.pause_hotkey();
    (hk.0, hk.1)
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
                let hook = platform::windows::start(Arc::clone(&shared));
                setup_tray(app, Arc::clone(&shared))?;
                setup_pause_hotkey(app, Arc::clone(&shared));
                // 钩子随应用生存期存活
                app.manage(shared);
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
}

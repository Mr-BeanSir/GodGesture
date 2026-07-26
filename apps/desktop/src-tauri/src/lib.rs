pub mod engine;
pub mod platform;

use engine::config::ConfigStore;
use engine::runtime::{EngineMsg, EngineShared};
use std::sync::Arc;
use tauri::Manager;

/// 引擎产物消费线程:驱动轨迹覆盖层;命令执行器(M2)也从这里接出去。
#[cfg(windows)]
fn spawn_engine_consumer(
    rx: crossbeam_channel::Receiver<EngineMsg>,
    shared: Arc<EngineShared>,
    overlay: platform::windows::overlay::Overlay,
) {
    use platform::windows::overlay::{OverlayCmd, TrailColors};
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
                    EngineMsg::ModifierFired { intent, modifier } => {
                        log::info!(
                            "修饰触发: {modifier:?} → {:?}",
                            intent.as_ref().map(|i| &i.name)
                        );
                        // TODO(M2): execute_on_modifier 意图立即执行
                    }
                    EngineMsg::PathEnded { intent, modifier } => {
                        overlay.send(OverlayCmd::End);
                        match intent {
                            Some(intent) => {
                                log::info!(
                                    "手势完成: [{}] {} (修饰 {modifier:?}) → 命令 {:?}",
                                    intent.gesture.trigger.mnemonic_dirs(&intent.gesture.strokes),
                                    intent.name,
                                    intent.command
                                );
                                // TODO(M2): 命令执行器
                            }
                            None => log::debug!("手势结束: 无匹配意图"),
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
            let store = ConfigStore::new(config_dir);
            let config = store.load_config();

            #[cfg(windows)]
            {
                let platform = Arc::new(platform::windows::WindowsPlatform);
                let (shared, rx) = EngineShared::new(config, platform);
                let overlay = platform::windows::overlay::Overlay::spawn();
                spawn_engine_consumer(rx, Arc::clone(&shared), overlay);
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
        .invoke_handler(tauri::generate_handler![engine_toggle_pause, engine_is_paused])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

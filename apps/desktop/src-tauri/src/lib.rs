mod account;
mod app_acquisition;
pub mod engine;
mod legacy_import;
pub mod platform;
mod template_download;
mod updater;

#[cfg(windows)]
use engine::config::ConfigFilesSnapshot;
#[cfg(any(windows, target_os = "macos"))]
use engine::config::PauseHotkey;
use engine::config::{ConfigDocument, ConfigStore, MachineLocalSettings};
#[cfg(any(windows, target_os = "macos"))]
use engine::node_service::{NodeInvocationOutcome, NodeScriptService, OutcomeSink};
use engine::runtime::{EngineMsg, EngineShared};
#[cfg(any(windows, target_os = "macos"))]
use engine::script_host::{ScriptInvocation, ScriptSlot};
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use platform::macos::startup::{MachineRuntimeStatus, StartupError};
#[cfg(windows)]
use platform::windows::startup::{
    EarlyMode, MachineRuntimeStatus, StartupError, StartupPolicy, TaskSnapshot,
};
#[cfg(not(any(windows, target_os = "macos")))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MachineRuntimeStatus {
    healthy: bool,
    code: Option<String>,
    message: Option<String>,
}
#[cfg(not(any(windows, target_os = "macos")))]
impl MachineRuntimeStatus {
    fn healthy() -> Self {
        Self {
            healthy: true,
            code: None,
            message: None,
        }
    }
}

struct ConfigTransaction(parking_lot::Mutex<()>);

#[cfg(any(windows, target_os = "macos"))]
struct PauseHotkeyRegistration(parking_lot::Mutex<Option<String>>);

#[cfg(any(windows, target_os = "macos"))]
struct TrayVisibility(parking_lot::Mutex<bool>);

#[cfg(any(windows, target_os = "macos"))]
struct MachineStatus(parking_lot::Mutex<MachineRuntimeStatus>);

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PlatformRuntimeStatus {
    platform: &'static str,
    gesture_engine_running: bool,
    accessibility: bool,
    input_monitoring: bool,
    event_posting: bool,
    code: Option<String>,
    message: Option<String>,
}

#[cfg(any(windows, target_os = "macos"))]
struct PauseMenuItem(tauri::menu::MenuItem<tauri::Wry>);

#[cfg(any(windows, target_os = "macos"))]
#[cfg(any(windows, target_os = "macos"))]
struct ActiveNodeScript {
    key: String,
    plugin_id: String,
    invocation: ScriptInvocation,
}

#[cfg(any(windows, target_os = "macos"))]
enum IncomingLifecycleScript {
    Node { key: String, plugin_id: String },
}

#[cfg(any(windows, target_os = "macos"))]
impl IncomingLifecycleScript {
    fn key(&self) -> &str {
        match self {
            Self::Node { key, .. } => key,
        }
    }
}

#[cfg(any(windows, target_os = "macos"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModifierScriptTransition {
    NoChange,
    Start,
    Continue,
    Replace,
    Finish,
}

#[cfg(any(windows, target_os = "macos"))]
fn modifier_script_transition(
    active_key: Option<&str>,
    incoming_key: Option<&str>,
    has_immediate_intent: bool,
) -> ModifierScriptTransition {
    match (active_key, incoming_key, has_immediate_intent) {
        (None, Some(_), _) => ModifierScriptTransition::Start,
        (Some(active), Some(incoming), _) if active == incoming => {
            ModifierScriptTransition::Continue
        }
        (Some(_), Some(_), _) => ModifierScriptTransition::Replace,
        (Some(_), None, true) => ModifierScriptTransition::Finish,
        _ => ModifierScriptTransition::NoChange,
    }
}

#[cfg(any(windows, target_os = "macos"))]
#[cfg(any(windows, target_os = "macos"))]
fn run_node_slot(
    service: Option<&NodeScriptService>,
    plugin_id: &str,
    handler: &str,
    slot: ScriptSlot,
    invocation: ScriptInvocation,
) -> bool {
    let Some(service) = service else {
        log::error!("Node plugin runtime is unavailable; '{plugin_id}:{handler}' was skipped");
        return false;
    };
    service.invoke(plugin_id, handler, true, slot, invocation)
}

#[cfg(any(windows, target_os = "macos"))]
fn end_active_node_script(
    active_node: &mut Option<ActiveNodeScript>,
    service: Option<&NodeScriptService>,
    invocation: Option<ScriptInvocation>,
) {
    let Some(mut active) = active_node.take() else {
        return;
    };
    if let Some(invocation) = invocation {
        active.invocation = invocation;
    }
    run_node_slot(
        service,
        &active.plugin_id,
        "gestureEnded",
        ScriptSlot::GestureEnded,
        active.invocation,
    );
}

#[cfg(any(windows, target_os = "macos"))]
fn end_active_lifecycle(
    active_node: &mut Option<ActiveNodeScript>,
    node_service: Option<&NodeScriptService>,
    invocation: Option<ScriptInvocation>,
) {
    end_active_node_script(active_node, node_service, invocation);
}

#[cfg(any(windows, target_os = "macos"))]
fn start_incoming_lifecycle(
    incoming: IncomingLifecycleScript,
    active_node: &mut Option<ActiveNodeScript>,
    node_service: Option<&NodeScriptService>,
    invocation: ScriptInvocation,
) {
    match incoming {
        IncomingLifecycleScript::Node { key, plugin_id } => {
            if run_node_slot(
                node_service,
                &plugin_id,
                "gestureRecognized",
                ScriptSlot::GestureRecognized,
                invocation,
            ) {
                run_node_slot(
                    node_service,
                    &plugin_id,
                    "modifierTriggered",
                    ScriptSlot::ModifierTriggered,
                    invocation,
                );
                *active_node = Some(ActiveNodeScript {
                    key,
                    plugin_id,
                    invocation,
                });
            }
        }
    }
}

#[cfg(any(windows, target_os = "macos"))]
/// 引擎产物消费线程:驱动轨迹覆盖层;命令执行器(M2)也从这里接出去。
#[cfg(any(windows, target_os = "macos"))]
fn spawn_engine_consumer(
    rx: crossbeam_channel::Receiver<EngineMsg>,
    shared: Arc<EngineShared>,
    overlay: platform::current::overlay::Overlay,
    app: tauri::AppHandle,
) {
    use platform::current::overlay::{OverlayCmd, TrailColors};
    std::thread::Builder::new()
        .name("gg-engine-consumer".into())
        .spawn(move || {
            let script_host = platform::current::script::create_host(&app);
            let outcome_overlay = overlay.clone();
            let outcome_sink: OutcomeSink =
                Arc::new(move |outcome: NodeInvocationOutcome| match outcome.result {
                    Ok(_) => {
                        if let Some(status) = outcome.status {
                            if outcome.invocation.trigger.is_some() {
                                outcome_overlay.send(OverlayCmd::Recognized(Some(status)));
                            } else {
                                log::info!(
                                    "Node plugin '{}:{}' status: {status}",
                                    outcome.plugin_id,
                                    outcome.handler
                                );
                            }
                        }
                    }
                    Err(error) => log::error!(
                        "Node plugin '{}:{}' failed: {error}",
                        outcome.plugin_id,
                        outcome.handler
                    ),
                });
            let initial_plugins = app.state::<Arc<ConfigStore>>().load_config().node_plugins;
            let node_service = app
                .path()
                .app_local_data_dir()
                .map_err(|error| format!("resolve Node plugin data directory: {error}"))
                .and_then(|data_dir| {
                    resolve_node_toolchain(&app).and_then(|toolchain| {
                        NodeScriptService::start(
                            toolchain.node,
                            toolchain.pnpm,
                            toolchain.supervisor,
                            data_dir.join("node-plugins").join("runtime"),
                            script_host,
                            outcome_sink,
                            initial_plugins,
                        )
                    })
                });
            let node_service = match node_service {
                Ok(service) => Some(service),
                Err(error) => {
                    log::error!("{error}");
                    None
                }
            };
            let mut active_node_script: Option<ActiveNodeScript> = None;
            for msg in rx {
                match msg {
                    EngineMsg::PathStarted { trigger, origin } => {
                        active_node_script = None;
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
                    EngineMsg::RecognitionChanged { name } => {
                        log::debug!("识别变化: {name:?}");
                        overlay.send(OverlayCmd::Recognized(name));
                    }
                    EngineMsg::ModifierFired {
                        intent,
                        trigger,
                        modifier,
                        context,
                    } => {
                        log::info!(
                            "修饰触发: {modifier:?} → {:?}",
                            intent.as_ref().map(|i| &i.name)
                        );
                        if !shared.is_recording() {
                            let invocation = ScriptInvocation {
                                gesture: context,
                                trigger: Some(trigger),
                                modifier,
                            };
                            let immediate_intent = intent.as_ref().filter(|intent| {
                                intent.gesture.modifier != engine::types::Modifier::None
                            });
                            let lifecycle_script =
                                immediate_intent.and_then(|intent| match &intent.command {
                                    engine::config::Command::NodePlugin { plugin_id, .. } => {
                                        Some(IncomingLifecycleScript::Node {
                                            key: format!("node:{}:{plugin_id}", intent.id),
                                            plugin_id: plugin_id.clone(),
                                        })
                                    }
                                    _ => None,
                                });
                            let active_lifecycle_key = active_node_script
                                .as_ref()
                                .map(|active| active.key.as_str());
                            let transition = modifier_script_transition(
                                active_lifecycle_key,
                                lifecycle_script.as_ref().map(IncomingLifecycleScript::key),
                                immediate_intent.is_some(),
                            );
                            let has_lifecycle_script = lifecycle_script.is_some();

                            match transition {
                                ModifierScriptTransition::Continue => {
                                    if let Some(active) = active_node_script.as_mut() {
                                        active.invocation = invocation;
                                        run_node_slot(
                                            node_service.as_ref(),
                                            &active.plugin_id,
                                            "modifierTriggered",
                                            ScriptSlot::ModifierTriggered,
                                            invocation,
                                        );
                                    }
                                }
                                ModifierScriptTransition::Start => {
                                    let incoming = lifecycle_script
                                        .expect("start requires an incoming lifecycle script");
                                    start_incoming_lifecycle(
                                        incoming,
                                        &mut active_node_script,
                                        node_service.as_ref(),
                                        invocation,
                                    );
                                }
                                ModifierScriptTransition::Replace => {
                                    end_active_lifecycle(
                                        &mut active_node_script,
                                        node_service.as_ref(),
                                        Some(invocation),
                                    );
                                    let incoming = lifecycle_script
                                        .expect("replace requires an incoming lifecycle script");
                                    start_incoming_lifecycle(
                                        incoming,
                                        &mut active_node_script,
                                        node_service.as_ref(),
                                        invocation,
                                    );
                                }
                                ModifierScriptTransition::Finish => {
                                    end_active_lifecycle(
                                        &mut active_node_script,
                                        node_service.as_ref(),
                                        Some(invocation),
                                    );
                                }
                                ModifierScriptTransition::NoChange => {}
                            }

                            if !has_lifecycle_script {
                                if let Some(intent) = immediate_intent {
                                    execute_intent(
                                        &intent.command,
                                        invocation,
                                        &shared,
                                        node_service.as_ref(),
                                    );
                                }
                            }
                        }
                    }
                    EngineMsg::PathEnded {
                        intent,
                        trigger,
                        modifier,
                        context,
                    } => {
                        end_active_lifecycle(
                            &mut active_node_script,
                            node_service.as_ref(),
                            Some(ScriptInvocation {
                                gesture: context,
                                trigger: Some(trigger),
                                modifier,
                            }),
                        );
                        let mut deferred_intent = None;
                        match intent {
                            Some(intent) => {
                                log::info!(
                                    "手势完成: [{}] {} (修饰 {modifier:?}) → 命令 {:?}",
                                    intent
                                        .gesture
                                        .trigger
                                        .mnemonic_dirs(&intent.gesture.strokes),
                                    intent.name,
                                    intent.command
                                );
                                if matches!(
                                    &intent.command,
                                    engine::config::Command::NodePlugin { .. }
                                ) {
                                    execute_intent(
                                        &intent.command,
                                        ScriptInvocation {
                                            gesture: context,
                                            trigger: Some(trigger),
                                            modifier,
                                        },
                                        &shared,
                                        node_service.as_ref(),
                                    );
                                } else {
                                    deferred_intent = Some(intent);
                                }
                            }
                            None => log::debug!("手势结束: 无匹配意图"),
                        }
                        overlay.send(OverlayCmd::End);
                        if let Some(intent) = deferred_intent {
                            execute_intent(
                                &intent.command,
                                ScriptInvocation {
                                    gesture: context,
                                    trigger: Some(trigger),
                                    modifier,
                                },
                                &shared,
                                node_service.as_ref(),
                            );
                        }
                    }
                    EngineMsg::CaptureUpdated {
                        trigger,
                        strokes,
                        modifier,
                        inputs,
                    } => {
                        let payload = CapturedGesture {
                            trigger,
                            mnemonic: captured_mnemonic(trigger, &inputs, &strokes, modifier),
                            strokes,
                            modifier,
                            inputs,
                        };
                        if let Err(e) = app.emit("gesture-captured", payload) {
                            log::warn!("手势录制增量事件发送失败: {e}");
                        }
                    }
                    EngineMsg::GestureCaptured {
                        trigger,
                        strokes,
                        modifier,
                        inputs,
                    } => {
                        overlay.send(OverlayCmd::End);
                        let payload = CapturedGesture {
                            trigger,
                            mnemonic: captured_mnemonic(trigger, &inputs, &strokes, modifier),
                            strokes,
                            modifier,
                            inputs,
                        };
                        if let Err(e) = app.emit("gesture-captured", payload) {
                            log::warn!("手势录制事件发送失败: {e}");
                        }
                    }
                    EngineMsg::CornerEdgeFired {
                        intent_id: _,
                        hit,
                        command,
                        origin,
                    } => {
                        log::info!("{hit} 触发 → 命令 {command:?}");
                        // 目标窗口取前台窗口:此刻光标停在屏幕边角,指针下方的窗口
                        // 多半不是用户想操作的那个。
                        let fg = shared.resolve_foreground_app(origin, false);
                        let context = engine::runtime::GestureContext {
                            origin,
                            endpoint: origin,
                            native_window: fg.native_window,
                        };
                        execute_intent(
                            &command,
                            ScriptInvocation {
                                gesture: context,
                                trigger: None,
                                modifier: engine::types::Modifier::None,
                            },
                            &shared,
                            node_service.as_ref(),
                        );
                    }
                    EngineMsg::PathCancelled => {
                        active_node_script = None;
                        log::debug!("手势取消");
                        overlay.send(OverlayCmd::Cancel);
                    }
                    EngineMsg::PauseChanged(paused) => {
                        publish_pause_state(&app, paused);
                    }
                    EngineMsg::ScriptConfigChanged => {
                        if let Some(service) = node_service.as_ref() {
                            service.sync_plugins(
                                app.state::<Arc<ConfigStore>>().load_config().node_plugins,
                            );
                        }
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
    modifier: engine::types::Modifier,
    inputs: Vec<engine::config::GestureInput>,
}

#[cfg(any(windows, target_os = "macos"))]
fn execute_intent(
    command: &engine::config::Command,
    invocation: ScriptInvocation,
    _shared: &Arc<EngineShared>,
    node_service: Option<&NodeScriptService>,
) {
    if let engine::config::Command::NodePlugin {
        plugin_id,
        export_name,
    } = command
    {
        let Some(service) = node_service else {
            log::error!(
                "Node plugin runtime is unavailable; '{plugin_id}:{export_name}' was skipped"
            );
            return;
        };
        service.invoke(
            plugin_id.clone(),
            export_name.clone(),
            false,
            ScriptSlot::Execute,
            invocation,
        );
    } else {
        platform::current::commands::execute(command, invocation.modifier, &invocation.gesture);
    }
}

trait TriggerMnemonic {
    fn mnemonic_dirs(&self, strokes: &[engine::types::Direction]) -> String;
}

fn captured_mnemonic(
    trigger: engine::types::TriggerButton,
    inputs: &[engine::config::GestureInput],
    strokes: &[engine::types::Direction],
    modifier: engine::types::Modifier,
) -> String {
    if inputs.is_empty() {
        let mut mnemonic = trigger.mnemonic_dirs(strokes);
        let modifier_symbol = modifier.mnemonic();
        if !modifier_symbol.is_empty() {
            mnemonic.push_str(" +");
            mnemonic.push_str(modifier_symbol);
        }
        return mnemonic;
    }
    let mut mnemonic = trigger.mnemonic_dirs(&[]);
    for input in inputs {
        match input {
            engine::config::GestureInput::Stroke { direction } => {
                mnemonic.push_str(direction.mnemonic());
            }
            engine::config::GestureInput::Button { button } => {
                mnemonic.push_str(match button {
                    engine::config::GestureInputButton::Left => "◐",
                    engine::config::GestureInputButton::Middle => "●",
                    engine::config::GestureInputButton::Right => "◑",
                    engine::config::GestureInputButton::X1 => "X1",
                    engine::config::GestureInputButton::X2 => "X2",
                });
            }
            engine::config::GestureInput::Wheel { direction } => {
                mnemonic.push_str(match direction {
                    engine::config::BoundaryWheelDirection::Forward => "▲",
                    engine::config::BoundaryWheelDirection::Backward => "▼",
                });
            }
        }
    }
    mnemonic
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
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = &app;
    #[cfg(any(windows, target_os = "macos"))]
    let previous_hotkey = current_pause_hotkey(&app);
    #[cfg(any(windows, target_os = "macos"))]
    replace_pause_hotkey(&app, &document.preferences.pause_hotkey)?;

    if let Err(err) = store.save_config(&document) {
        #[cfg(any(windows, target_os = "macos"))]
        if let Err(rollback_err) = replace_pause_hotkey_value(&app, previous_hotkey) {
            log::error!("配置保存失败后恢复暂停快捷键也失败: {rollback_err}");
        }
        return Err(err.to_string());
    }
    engine.replace_config(document);
    Ok(())
}

fn resolve_node_toolchain(
    app: &tauri::AppHandle,
) -> Result<engine::node_toolchain::NodeToolchain, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resolve Node plugin resource directory: {error}"))?;
    engine::node_toolchain::from_resource_root(&resource_dir).or_else(|error| {
        #[cfg(debug_assertions)]
        {
            log::debug!("{error}; using PATH Node for debug development");
            Ok(engine::node_toolchain::NodeToolchain {
                node: std::path::PathBuf::from("node"),
                pnpm: std::path::PathBuf::from("pnpm"),
                supervisor: engine::node_host::default_supervisor_path(),
                typescript: std::path::PathBuf::from("typescript/lib/tsc.js"),
            })
        }
        #[cfg(not(debug_assertions))]
        {
            Err(error)
        }
    })
}

#[tauri::command]
async fn node_plugin_install(
    plugin: engine::config::NodePlugin,
    app: tauri::AppHandle,
) -> Result<engine::node_packages::NodePackageResult, String> {
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve Node plugin data directory: {error}"))?
        .join("node-plugins")
        .join("runtime");
    let toolchain = resolve_node_toolchain(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = engine::node_packages::install_plugin(&workspace, &toolchain, &plugin)?;
        let mut prepared_plugin = plugin;
        prepared_plugin.lockfile = result.lockfile.clone();
        engine::node_service::ensure_plugin_cache(
            &workspace,
            &toolchain.node,
            &toolchain.pnpm,
            &prepared_plugin,
        )?;
        Ok(result)
    })
    .await
    .map_err(|error| format!("Node package worker failed: {error}"))?
}

#[tauri::command]
async fn node_plugin_package_search(
    query: String,
) -> Result<Vec<engine::node_registry::NodePackageSearchResult>, String> {
    engine::node_registry::search_node_packages(query).await
}

#[tauri::command]
async fn node_plugin_package_latest(name: String) -> Result<String, String> {
    engine::node_registry::latest_node_package_version(name).await
}

#[tauri::command]
async fn node_plugin_test(
    plugin: engine::config::NodePlugin,
    handler: String,
    app: tauri::AppHandle,
) -> Result<engine::node_packages::NodeTestResult, String> {
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve Node plugin data directory: {error}"))?
        .join("node-plugins")
        .join("runtime");
    let toolchain = resolve_node_toolchain(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine::node_packages::test_plugin(&workspace, &toolchain, &plugin, &handler)
    })
    .await
    .map_err(|error| format!("Node test worker failed: {error}"))?
}

#[tauri::command]
async fn node_plugin_typecheck(
    plugin: engine::config::NodePlugin,
    app: tauri::AppHandle,
) -> Result<engine::node_packages::NodeTypecheckResult, String> {
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve Node plugin data directory: {error}"))?
        .join("node-plugins")
        .join("runtime");
    let toolchain = resolve_node_toolchain(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine::node_packages::typecheck_plugin(&workspace, &toolchain, &plugin)
    })
    .await
    .map_err(|error| format!("Node typecheck worker failed: {error}"))?
}

#[tauri::command]
async fn node_plugin_cache_status(
    plugin: engine::config::NodePlugin,
    app: tauri::AppHandle,
) -> Result<engine::node_service::NodePluginCacheStatus, String> {
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve Node plugin data directory: {error}"))?
        .join("node-plugins")
        .join("runtime");
    tauri::async_runtime::spawn_blocking(move || {
        engine::node_service::plugin_cache_status(&workspace, &plugin)
    })
    .await
    .map_err(|error| format!("Node cache status worker failed: {error}"))?
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
        .map_err(|err| {
            StartupError::new(
                "apply_failed",
                format!("machine settings worker failed: {err}"),
            )
        })?
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
        set_tray_visible(self.app, self.settings.tray_icon_visible)
            .map_err(|err| StartupError::new("apply_failed", format!("set tray visibility: {err}")))
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
            if let Err(err) =
                platform::windows::startup::restore_with_elevation(&snapshot.task, &snapshot.sid)
            {
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

#[cfg(target_os = "macos")]
#[tauri::command]
async fn machine_set(
    settings: MachineLocalSettings,
    app: tauri::AppHandle,
) -> Result<(), StartupError> {
    tauri::async_runtime::spawn_blocking(move || machine_set_blocking(settings, &app))
        .await
        .map_err(|error| {
            StartupError::new(
                "apply_failed",
                format!("machine settings worker failed: {error}"),
            )
        })?
}

#[cfg(target_os = "macos")]
fn machine_set_blocking(
    settings: MachineLocalSettings,
    app: &tauri::AppHandle,
) -> Result<(), StartupError> {
    if settings.run_as_admin {
        return Err(StartupError::new(
            "unsupported_machine_setting",
            "run as administrator is unsupported on macOS",
        ));
    }

    let store = app.state::<Arc<ConfigStore>>();
    let transaction = app.state::<ConfigTransaction>();
    let _transaction = transaction.0.lock();
    let previous = store.load_machine();
    let files = store.snapshot_files().map_err(|error| {
        StartupError::new("apply_failed", format!("snapshot machine file: {error}"))
    })?;
    let login_item = if previous.auto_start || settings.auto_start {
        Some(platform::macos::startup::status()?)
    } else {
        None
    };
    let tray_visible = current_tray_visibility(app);

    let result = (|| {
        store.save_machine(&settings).map_err(|error| {
            StartupError::new("apply_failed", format!("save machine settings: {error}"))
        })?;
        if previous.auto_start || settings.auto_start {
            platform::macos::startup::reconcile(settings.auto_start)?;
        }
        set_tray_visible(app, settings.tray_icon_visible).map_err(|error| {
            StartupError::new("apply_failed", format!("set tray visibility: {error}"))
        })
    })();

    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        if let Err(rollback) = set_tray_visible(app, tray_visible) {
            rollback_errors.push(format!("tray restore failed: {rollback}"));
        }
        if let Some(login_item) = login_item {
            if let Err(rollback) = platform::macos::startup::restore(login_item) {
                rollback_errors.push(format!("login item restore failed: {}", rollback.message));
            }
        }
        if let Err(rollback) = store.restore_machine_snapshot(&files) {
            rollback_errors.push(format!("machine file restore failed: {rollback}"));
        }
        let error = if rollback_errors.is_empty() {
            error
        } else {
            StartupError::rollback_incomplete(error.message, rollback_errors)
        };
        if error.code == "rollback_incomplete" {
            *app.state::<MachineStatus>().0.lock() = MachineRuntimeStatus::failed(&error);
        }
        return Err(error);
    }

    let status = platform::macos::startup::runtime_status(settings.auto_start);
    *app.state::<MachineStatus>().0.lock() = status;
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn machine_status(app: tauri::AppHandle) -> MachineRuntimeStatus {
    app.state::<MachineStatus>().0.lock().clone()
}

#[cfg(not(any(windows, target_os = "macos")))]
#[tauri::command]
fn machine_set(
    settings: MachineLocalSettings,
    store: tauri::State<Arc<ConfigStore>>,
    transaction: tauri::State<ConfigTransaction>,
) -> Result<(), String> {
    let _transaction = transaction.0.lock();
    store
        .save_machine(&settings)
        .map_err(|error| error.to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
#[tauri::command]
fn machine_status() -> MachineRuntimeStatus {
    MachineRuntimeStatus::healthy()
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
            let (elevated, split) =
                platform::windows::startup::elevation_state().map_err(|err| err.message)?;
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
            if let Err(err) =
                platform::windows::startup::restore_with_elevation(&snapshot.startup, &snapshot.sid)
            {
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
    .map_err(|err| {
        legacy_import::LegacyImportError::apply_failed(format!(
            "legacy import worker failed: {err}"
        ))
    })?
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
            let startup_error =
                StartupError::rollback_incomplete(err.message.clone(), err.rollback_errors.clone());
            *app.state::<MachineStatus>().0.lock() = MachineRuntimeStatus::failed(&startup_error);
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

#[cfg(windows)]
#[tauri::command]
fn hotkey_capture_start(capture: tauri::State<Arc<platform::windows::hook::KeyboardCapture>>) {
    capture.start();
}

#[cfg(not(windows))]
#[tauri::command]
fn hotkey_capture_start() {}

#[cfg(windows)]
#[tauri::command]
fn hotkey_capture_cancel(capture: tauri::State<Arc<platform::windows::hook::KeyboardCapture>>) {
    capture.stop();
}

#[cfg(not(windows))]
#[tauri::command]
fn hotkey_capture_cancel() {}

#[tauri::command]
async fn pick_window() -> Option<app_acquisition::PickedWindow> {
    tauri::async_runtime::spawn_blocking(app_acquisition::pick_window)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn resolve_app_file(
    path: String,
) -> Result<app_acquisition::PickedWindow, app_acquisition::AppAcquisitionError> {
    tauri::async_runtime::spawn_blocking(move || {
        app_acquisition::resolve_app_file(std::path::Path::new(&path))
    })
    .await
    .map_err(|error| app_acquisition::AppAcquisitionError {
        code: "app_file_unavailable",
        message: format!("application file worker failed: {error}"),
    })?
}

#[cfg(target_os = "macos")]
fn current_platform_status(app: &tauri::AppHandle) -> PlatformRuntimeStatus {
    let permissions = platform::macos::permissions::status();
    let (running, engine_error) = app.state::<platform::macos::EngineState>().status();
    let (code, message) = if !permissions.granted() {
        (
            Some("permission_required".to_string()),
            Some(
                "Accessibility, Input Monitoring, and event-posting access are required"
                    .to_string(),
            ),
        )
    } else if !running {
        (
            Some("gesture_engine_unavailable".to_string()),
            Some(engine_error.unwrap_or_else(|| "the macOS gesture engine is not running".into())),
        )
    } else {
        (None, None)
    };
    PlatformRuntimeStatus {
        platform: "macos",
        gesture_engine_running: running,
        accessibility: permissions.accessibility,
        input_monitoring: permissions.input_monitoring,
        event_posting: permissions.event_posting,
        code,
        message,
    }
}

#[cfg(windows)]
fn current_platform_status(_app: &tauri::AppHandle) -> PlatformRuntimeStatus {
    PlatformRuntimeStatus {
        platform: "windows",
        gesture_engine_running: true,
        accessibility: true,
        input_monitoring: true,
        event_posting: true,
        code: None,
        message: None,
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn current_platform_status(_app: &tauri::AppHandle) -> PlatformRuntimeStatus {
    PlatformRuntimeStatus {
        platform: "unsupported",
        gesture_engine_running: false,
        accessibility: false,
        input_monitoring: false,
        event_posting: false,
        code: Some("unsupported_platform".into()),
        message: Some("the gesture engine is unsupported on this platform".into()),
    }
}

#[tauri::command]
fn platform_status(app: tauri::AppHandle) -> PlatformRuntimeStatus {
    current_platform_status(&app)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn platform_request_permissions(app: tauri::AppHandle) -> PlatformRuntimeStatus {
    let _ = platform::macos::permissions::request_trust();
    if platform::macos::permissions::is_trusted() {
        let shared = app.state::<Arc<EngineShared>>().inner().clone();
        if app
            .state::<platform::macos::EngineState>()
            .try_start(shared)
        {
            log::info!("macOS CGEventTap installed after permission request");
        }
    }
    current_platform_status(&app)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn platform_request_permissions(app: tauri::AppHandle) -> PlatformRuntimeStatus {
    current_platform_status(&app)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn platform_open_permission_settings() -> Result<(), String> {
    platform::macos::permissions::open_settings()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn platform_open_permission_settings() -> Result<(), String> {
    Err("permission settings are only available on macOS".into())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppIconRequest {
    windows_exe_name: Option<String>,
    mac_bundle_id: Option<String>,
}

/// Returns a bare base64 PNG for platform-local application identity, or null on lookup failure.
#[cfg(windows)]
#[tauri::command]
async fn app_icon(request: AppIconRequest) -> Option<String> {
    let AppIconRequest {
        windows_exe_name,
        mac_bundle_id: _mac_bundle_id,
    } = request;
    let exe_name = windows_exe_name?;
    tauri::async_runtime::spawn_blocking(move || {
        platform::windows::icon::app_icon_base64(&exe_name)
    })
    .await
    .ok()
    .flatten()
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn app_icon(request: AppIconRequest) -> Option<String> {
    let AppIconRequest {
        windows_exe_name: _windows_exe_name,
        mac_bundle_id,
    } = request;
    let bundle_id = mac_bundle_id?;
    tauri::async_runtime::spawn_blocking(move || platform::macos::icon::app_icon_base64(&bundle_id))
        .await
        .ok()
        .flatten()
}

#[cfg(not(any(windows, target_os = "macos")))]
#[tauri::command]
async fn app_icon(request: AppIconRequest) -> Option<String> {
    let _ = request;
    None
}

/// 托盘:暂停/继续 · 设置 · 退出(对齐 WGestures 托盘菜单)
#[cfg(any(windows, target_os = "macos"))]
fn setup_tray(app: &tauri::App, shared: Arc<EngineShared>, visible: bool) -> tauri::Result<()> {
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
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("app icon missing"),
        )
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

#[cfg(any(windows, target_os = "macos"))]
fn set_tray_visible(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "tray icon is unavailable".to_string())?;
    tray.set_visible(visible).map_err(|err| err.to_string())?;
    *app.state::<TrayVisibility>().0.lock() = visible;
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
fn current_tray_visibility(app: &tauri::AppHandle) -> bool {
    *app.state::<TrayVisibility>().0.lock()
}

#[cfg(any(windows, target_os = "macos"))]
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
#[cfg(any(windows, target_os = "macos"))]
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

#[cfg(any(windows, target_os = "macos"))]
fn format_pause_hotkey(modifiers: &[String], key: &str) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    // global-hotkey 的字符串语法把跨平台 meta 称为 Super。
    let modifiers = modifiers
        .iter()
        .map(|modifier| {
            if modifier == "meta" {
                "super"
            } else {
                modifier
            }
        })
        .collect::<Vec<_>>()
        .join("+");
    Some(if modifiers.is_empty() {
        key.to_string()
    } else {
        format!("{modifiers}+{key}")
    })
}

#[cfg(any(windows, target_os = "macos"))]
fn replace_pause_hotkey(app: &tauri::AppHandle, hotkey: &PauseHotkey) -> Result<(), String> {
    replace_pause_hotkey_parts(app, &hotkey.modifiers, &hotkey.key)
}

#[cfg(any(windows, target_os = "macos"))]
fn replace_pause_hotkey_parts(
    app: &tauri::AppHandle,
    modifiers: &[String],
    key: &str,
) -> Result<(), String> {
    replace_pause_hotkey_value(app, format_pause_hotkey(modifiers, key))
}

#[cfg(any(windows, target_os = "macos"))]
fn current_pause_hotkey(app: &tauri::AppHandle) -> Option<String> {
    app.state::<PauseHotkeyRegistration>().0.lock().clone()
}

#[cfg(any(windows, target_os = "macos"))]
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
                Some(Err(rollback_err)) => {
                    format!("无法注册快捷键 {shortcut}: {err}; 恢复旧快捷键也失败: {rollback_err}")
                }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let is_autostart = args.iter().any(|arg| arg == "--autostart");
            if is_autostart {
                log::info!("忽略重复的开机启动实例");
                return;
            }
            log::info!("检测到重复启动,正在唤起现有实例");
            if let Some(win) = app.get_webview_window("main") {
                if let Err(error) = win.show() {
                    log::warn!("重复启动时无法显示设置窗口: {error}");
                }
                if let Err(error) = win.set_focus() {
                    log::warn!("重复启动时无法聚焦设置窗口: {error}");
                }
            }
            if let Err(error) = app.emit("single-instance-attempted", ()) {
                log::warn!("无法发送重复启动提示事件: {error}");
            }
        }))
        .setup(move |app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            let config_dir = app
                .path()
                .app_config_dir()
                .expect("cannot resolve app config dir");
            let store = Arc::new(ConfigStore::new(config_dir));
            let config = store.load_config();
            #[cfg(windows)]
            let machine = store.load_machine();
            #[cfg(target_os = "macos")]
            let mut machine = store.load_machine();
            #[cfg(target_os = "macos")]
            if machine.run_as_admin {
                machine.run_as_admin = false;
                if let Err(error) = store.save_machine(&machine) {
                    log::warn!("cannot clear unsupported macOS runAsAdmin setting: {error}");
                }
            }
            app.manage(store);
            app.manage(ConfigTransaction(parking_lot::Mutex::new(())));
            app.manage(account::OAuthLoopbackState::default());
            app.manage(updater::DesktopUpdaterState::default());

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
                        let result =
                            platform::windows::startup::current_user_sid().and_then(|sid| {
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
            }

            #[cfg(target_os = "macos")]
            {
                let result = if machine.auto_start {
                    platform::macos::startup::reconcile(true)
                } else {
                    Ok(())
                };
                let status = match result {
                    Ok(()) => platform::macos::startup::runtime_status(machine.auto_start),
                    Err(error) => {
                        log::warn!(
                            "macOS login item reconciliation failed [{}]: {}",
                            error.code,
                            error.message
                        );
                        MachineRuntimeStatus::failed(&error)
                    }
                };
                app.manage(MachineStatus(parking_lot::Mutex::new(status)));
            }

            #[cfg(any(windows, target_os = "macos"))]
            {
                #[cfg(windows)]
                let platform = Arc::new(platform::windows::WindowsPlatform::default());
                #[cfg(target_os = "macos")]
                let platform = Arc::new(platform::macos::MacPlatform);
                let (shared, rx) = EngineShared::new(config, platform.clone());
                let overlay = platform::current::overlay::Overlay::spawn(app.handle());
                spawn_engine_consumer(rx, Arc::clone(&shared), overlay, app.handle().clone());
                app.manage(Arc::clone(&shared));
                setup_tray(app, Arc::clone(&shared), machine.tray_icon_visible)?;
                setup_pause_hotkey(app, Arc::clone(&shared));

                #[cfg(windows)]
                {
                    let keyboard_capture = platform.keyboard_capture();
                    app.manage(keyboard_capture);
                    if let Some(events) = platform.take_keyboard_events() {
                        let event_app = app.handle().clone();
                        if let Err(error) = std::thread::Builder::new()
                            .name("gg-hotkey-capture-events".into())
                            .spawn(move || {
                                while let Ok(event) = events.recv() {
                                    if let Err(error) = event_app.emit("hotkey-capture", event) {
                                        log::warn!("快捷键录制事件发送失败: {error}");
                                        break;
                                    }
                                }
                            })
                        {
                            log::warn!("无法启动快捷键录制事件转发线程: {error}");
                        }
                    }
                    let hook = platform::windows::start(Arc::clone(&shared), platform);
                    app.manage(hook);
                    if setup_mode == EarlyMode::Interactive {
                        if let Some(win) = app.get_webview_window("main") {
                            win.show()?;
                            win.set_focus()?;
                        }
                    }
                }

                #[cfg(target_os = "macos")]
                {
                    shared.spawn_timer_thread();
                    let engine_state = platform::macos::EngineState::default();
                    if engine_state.try_start(Arc::clone(&shared)) {
                        log::info!("macOS CGEventTap installed");
                    } else {
                        let (_, error) = engine_state.status();
                        log::warn!(
                            "macOS gesture engine unavailable: {}",
                            error.unwrap_or_else(|| "unknown error".into())
                        );
                    }
                    app.manage(engine_state);
                    if let Some(win) = app.get_webview_window("main") {
                        win.show()?;
                        win.set_focus()?;
                    }
                }
            }

            #[cfg(not(any(windows, target_os = "macos")))]
            {
                let _ = config;
                log::warn!("gesture engine is unsupported on this platform");
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
            node_plugin_install,
            node_plugin_package_search,
            node_plugin_package_latest,
            node_plugin_test,
            node_plugin_typecheck,
            node_plugin_cache_status,
            machine_get,
            machine_set,
            machine_status,
            legacy_import_apply,
            engine_toggle_pause,
            engine_is_paused,
            capture_start,
            capture_cancel,
            hotkey_capture_start,
            hotkey_capture_cancel,
            pick_window,
            resolve_app_file,
            app_icon,
            platform_status,
            platform_request_permissions,
            platform_open_permission_settings,
            template_download::download_template_text,
            account::account_credential_get,
            account::account_credential_set,
            account::account_credential_delete,
            account::account_device_info,
            account::sync_metadata_get,
            account::sync_metadata_set,
            account::oauth_loopback_start,
            account::oauth_loopback_finish,
            account::oauth_loopback_cancel,
            updater::update_check,
            updater::update_cancel,
            updater::update_install,
        ])
        .on_window_event(|window, event| {
            #[cfg(any(windows, target_os = "macos"))]
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
            modifier: engine::types::Modifier::None,
            inputs: vec![
                engine::config::GestureInput::Stroke {
                    direction: Direction::Up,
                },
                engine::config::GestureInput::Stroke {
                    direction: Direction::RightDown,
                },
            ],
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["trigger"], "right");
        assert_eq!(json["strokes"], serde_json::json!(["up", "rightDown"]));
        assert_eq!(json["mnemonic"], "◑↑↘");
        assert_eq!(json["modifier"], "none");
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
    fn modifier_script_transition_covers_start_continue_replace_finish_and_no_change() {
        assert_eq!(
            modifier_script_transition(None, Some("a"), true),
            ModifierScriptTransition::Start
        );
        assert_eq!(
            modifier_script_transition(Some("a"), Some("a"), true),
            ModifierScriptTransition::Continue
        );
        assert_eq!(
            modifier_script_transition(Some("a"), Some("b"), true),
            ModifierScriptTransition::Replace
        );
        assert_eq!(
            modifier_script_transition(Some("a"), None, true),
            ModifierScriptTransition::Finish
        );
        assert_eq!(
            modifier_script_transition(Some("a"), None, false),
            ModifierScriptTransition::NoChange
        );
        assert_eq!(
            modifier_script_transition(None, None, true),
            ModifierScriptTransition::NoChange
        );
    }
}

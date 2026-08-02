//! 配置文档 —— 与 packages/shared/src/config/*.ts 的 JSON 形状严格一致。
//! 本机专属设置(MachineLocalSettings)单独存放,不进同步载荷(ADR-0010)。

use super::types::{Direction, Modifier, TriggerButton};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};

pub const CONFIG_FORMAT_VERSION: u32 = 4;

// ---------------------------------------------------------------------------
// 命令(执行器在 M2 落地,类型先行以支撑意图查找与配置往返)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    DoNothing,
    #[serde(rename_all = "camelCase")]
    HotKey {
        modifiers: Vec<String>,
        keys: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    WebSearch {
        engine_name: String,
        engine_url: String,
        #[serde(default)]
        browser: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    WindowControl {
        operation: WindowOperation,
    },
    TaskSwitcher,
    #[serde(rename_all = "camelCase")]
    OpenFile {
        path: String,
    },
    #[serde(rename_all = "camelCase")]
    SendText {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    GotoUrl {
        url: String,
    },
    #[serde(rename_all = "camelCase")]
    Cmd {
        code: String,
        #[serde(default = "default_true")]
        show_window: bool,
        #[serde(default = "default_true")]
        auto_set_working_dir: bool,
    },
    #[serde(rename_all = "camelCase")]
    NodePlugin {
        plugin_id: String,
        #[serde(default = "default_node_export")]
        export_name: String,
    },
    Pause,
    #[serde(rename_all = "camelCase")]
    AudioVolume {
        #[serde(default = "default_delta")]
        delta: i32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GestureInputButton {
    Left,
    Middle,
    Right,
    X1,
    X2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum GestureInput {
    Stroke { direction: Direction },
    Button { button: GestureInputButton },
    Wheel { direction: BoundaryWheelDirection },
}

fn default_true() -> bool {
    true
}
fn default_delta() -> i32 {
    1
}
fn default_node_export() -> String {
    "execute".into()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WindowOperation {
    MaximizeRestore,
    Minimize,
    Close,
    ToggleTopmost,
    DockLeft,
    DockRight,
}

// ---------------------------------------------------------------------------
// 手势意图与应用
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GestureSpecConfig {
    pub trigger: TriggerButton,
    pub strokes: Vec<Direction>,
    #[serde(default = "default_modifier")]
    pub modifier: Modifier,
    #[serde(default)]
    pub inputs: Vec<GestureInput>,
}

impl GestureSpecConfig {
    pub fn legacy_inputs(&self) -> Vec<GestureInput> {
        let mut inputs = self
            .strokes
            .iter()
            .copied()
            .map(|direction| GestureInput::Stroke { direction })
            .collect::<Vec<_>>();
        let modifier = match self.modifier {
            Modifier::None => None,
            Modifier::WheelForward => Some(GestureInput::Wheel {
                direction: BoundaryWheelDirection::Forward,
            }),
            Modifier::WheelBackward => Some(GestureInput::Wheel {
                direction: BoundaryWheelDirection::Backward,
            }),
            Modifier::LeftButtonDown => Some(GestureInput::Button {
                button: GestureInputButton::Left,
            }),
            Modifier::MiddleButtonDown => Some(GestureInput::Button {
                button: GestureInputButton::Middle,
            }),
            Modifier::RightButtonDown => Some(GestureInput::Button {
                button: GestureInputButton::Right,
            }),
            Modifier::X1Down => Some(GestureInput::Button {
                button: GestureInputButton::X1,
            }),
            Modifier::X2Down => Some(GestureInput::Button {
                button: GestureInputButton::X2,
            }),
        };
        if let Some(modifier) = modifier {
            inputs.push(modifier);
        }
        inputs
    }

    /// Return the ordered input sequence, normalizing pre-v4 configs that only
    /// carried `strokes` plus a legacy modifier.
    pub fn effective_inputs(&self) -> Vec<GestureInput> {
        if self.inputs.is_empty() {
            self.legacy_inputs()
        } else {
            self.inputs.clone()
        }
    }
}

fn default_modifier() -> Modifier {
    Modifier::None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GestureIntent {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub gesture: GestureSpecConfig,
    pub command: Command,
    #[serde(default)]
    pub execute_on_modifier: bool,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsBinding {
    pub exe_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aumid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exact_path: Option<String>,
    #[serde(default)]
    pub match_by_exact_path: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MacBinding {
    pub bundle_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub windows: Option<WindowsBinding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac: Option<MacBinding>,
    #[serde(default = "default_true")]
    pub gesturing_enabled: bool,
    #[serde(default = "default_true")]
    pub inherit_global_gestures: bool,
    #[serde(default)]
    pub intents: Vec<GestureIntent>,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalApp {
    #[serde(default = "default_true")]
    pub gesturing_enabled: bool,
    #[serde(default)]
    pub intents: Vec<GestureIntent>,
}

impl Default for GlobalApp {
    fn default() -> Self {
        Self {
            gesturing_enabled: true,
            intents: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// 触发角 & 摩擦边
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotCornersConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub commands: std::collections::HashMap<String, Command>,
}

impl Default for HotCornersConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            commands: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubEdgesConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub commands: std::collections::HashMap<String, Command>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BoundaryOrigin {
    HotCorner { corner: String },
    RubEdge { edge: String },
}

impl BoundaryOrigin {
    pub fn matches(&self, kind: &str, key: &str) -> bool {
        match self {
            Self::HotCorner { corner } => kind == "hotCorner" && corner == key,
            Self::RubEdge { edge } => kind == "rubEdge" && edge == key,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BoundaryWheelDirection {
    Forward,
    Backward,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BoundaryMouseButton {
    Left,
    Middle,
    Right,
    X1,
    X2,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BoundaryToken {
    Wheel { direction: BoundaryWheelDirection },
    Button { button: BoundaryMouseButton },
    Stroke { direction: Direction },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryIntent {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub origin: BoundaryOrigin,
    #[serde(default)]
    pub sequence: Vec<BoundaryToken>,
    pub command: Command,
    #[serde(default)]
    pub order: i32,
}

impl Default for RubEdgesConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            commands: Default::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// 偏好设置
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PathTrackerPreferences {
    pub trigger_buttons: Vec<TriggerButton>,
    pub enable_8_directions: bool,
    pub enable_windows_key_gesturing: bool,
    pub prefer_cursor_window: bool,
    pub disable_in_fullscreen: bool,
    pub initial_valid_move_px: u32,
    pub initial_stay_timeout: bool,
    pub initial_stay_timeout_ms: u32,
    pub stay_timeout: bool,
    pub stay_timeout_ms: u32,
}

impl Default for PathTrackerPreferences {
    fn default() -> Self {
        Self {
            trigger_buttons: vec![
                TriggerButton::Right,
                TriggerButton::Middle,
                TriggerButton::X1,
                TriggerButton::X2,
            ],
            enable_8_directions: true,
            enable_windows_key_gesturing: false,
            prefer_cursor_window: true,
            disable_in_fullscreen: false,
            initial_valid_move_px: 4,
            initial_stay_timeout: false,
            initial_stay_timeout_ms: 200,
            stay_timeout: false,
            stay_timeout_ms: 500,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GestureViewPreferences {
    pub show_path: bool,
    pub show_command_name: bool,
    pub fade_out: bool,
    pub right_button_path_color: String,
    pub middle_button_path_color: String,
    pub x_button_path_color: String,
    pub unrecognized_path_color: String,
}

impl Default for GestureViewPreferences {
    fn default() -> Self {
        Self {
            show_path: true,
            show_command_name: true,
            fade_out: true,
            right_button_path_color: "#FF27E518".into(),
            middle_button_path_color: "#FF2DE0FF".into(),
            x_button_path_color: "#FF667EE9".into(),
            unrecognized_path_color: "#FFFF8040".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PauseHotkey {
    pub modifiers: Vec<String>,
    pub key: String,
}

impl Default for PauseHotkey {
    fn default() -> Self {
        Self {
            modifiers: vec!["ctrl".into(), "shift".into(), "alt".into()],
            key: "w".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncedPreferences {
    pub path_tracker: PathTrackerPreferences,
    pub gesture_view: GestureViewPreferences,
    pub pause_hotkey: PauseHotkey,
    pub locale: Locale,
    pub auto_check_for_update: bool,
}

impl Default for SyncedPreferences {
    fn default() -> Self {
        Self {
            path_tracker: PathTrackerPreferences::default(),
            gesture_view: GestureViewPreferences::default(),
            pause_hotkey: PauseHotkey::default(),
            locale: Locale::default(),
            auto_check_for_update: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum Locale {
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}

// ---------------------------------------------------------------------------
// 顶层文档与本机专属设置
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodePlugin {
    pub id: String,
    pub name: String,
    #[serde(default = "default_node_entry")]
    pub entry: String,
    #[serde(default = "default_node_files")]
    pub files: std::collections::HashMap<String, String>,
    #[serde(default = "default_node_manifest")]
    pub package_json: String,
    #[serde(default)]
    pub lockfile: Option<String>,
    #[serde(default)]
    pub allow_lifecycle_scripts: bool,
}

fn default_node_entry() -> String {
    "index.mjs".into()
}

fn default_node_files() -> std::collections::HashMap<String, String> {
    [(
        "index.mjs".into(),
        concat!(
            "export async function execute(context) {\n",
            "  await context.input.sendText(\"Hello from GodGesture\");\n",
            "}\n"
        )
        .into(),
    )]
    .into_iter()
    .collect()
}

fn default_node_manifest() -> String {
    "{\n  \"private\": true,\n  \"type\": \"module\"\n}".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigDocument {
    pub format_version: u32,
    pub global: GlobalApp,
    pub apps: Vec<AppEntry>,
    pub hot_corners: HotCornersConfig,
    pub rub_edges: RubEdgesConfig,
    pub boundary_intents: Vec<BoundaryIntent>,
    pub node_plugins: Vec<NodePlugin>,
    pub preferences: SyncedPreferences,
}

impl Default for ConfigDocument {
    fn default() -> Self {
        Self {
            format_version: CONFIG_FORMAT_VERSION,
            global: GlobalApp::default(),
            apps: Vec::new(),
            hot_corners: HotCornersConfig::default(),
            rub_edges: RubEdgesConfig::default(),
            boundary_intents: Vec::new(),
            node_plugins: Vec::new(),
            preferences: SyncedPreferences::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineLocalSettings {
    pub auto_start: bool,
    pub run_as_admin: bool,
    pub tray_icon_visible: bool,
}

impl Default for MachineLocalSettings {
    fn default() -> Self {
        Self {
            auto_start: false,
            run_as_admin: false,
            tray_icon_visible: true,
        }
    }
}

/// Non-secret restart baseline for whole-document cloud synchronization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncMetadata {
    pub account_id: String,
    pub server_version: u64,
    pub last_synced_document: ConfigDocument,
    pub last_sync_at: String,
}

// ---------------------------------------------------------------------------
// 持久化:%APPDATA%/GodGesture/{config.json, machine.json}
// ---------------------------------------------------------------------------

/// 首次启动的默认手势库(对齐 WGestures 出厂常用项;命令执行 M2 生效)
pub fn default_seed() -> ConfigDocument {
    use super::types::{Direction as D, TriggerButton as T};
    let intent = |name: &str,
                  trigger: T,
                  strokes: Vec<super::types::Direction>,
                  command: Command| GestureIntent {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        enabled: true,
        gesture: GestureSpecConfig {
            trigger,
            strokes,
            modifier: super::types::Modifier::None,
            inputs: Vec::new(),
        },
        command,
        execute_on_modifier: false,
        order: 0,
    };
    let hotkey = |mods: &[&str], keys: &[&str]| Command::HotKey {
        modifiers: mods.iter().map(|s| s.to_string()).collect(),
        keys: keys.iter().map(|s| s.to_string()).collect(),
    };

    let mut doc = ConfigDocument::default();
    doc.global.intents = vec![
        intent(
            "关闭窗口",
            T::Right,
            vec![D::Down, D::Right],
            Command::WindowControl {
                operation: WindowOperation::Close,
            },
        ),
        intent(
            "最大化/还原",
            T::Right,
            vec![D::Up],
            Command::WindowControl {
                operation: WindowOperation::MaximizeRestore,
            },
        ),
        intent(
            "最小化",
            T::Right,
            vec![D::Down],
            Command::WindowControl {
                operation: WindowOperation::Minimize,
            },
        ),
        intent("后退", T::Right, vec![D::Left], hotkey(&["alt"], &["left"])),
        intent(
            "前进",
            T::Right,
            vec![D::Right],
            hotkey(&["alt"], &["right"]),
        ),
        intent(
            "复制",
            T::Right,
            vec![D::RightDown],
            hotkey(&["ctrl"], &["c"]),
        ),
        intent(
            "粘贴",
            T::Right,
            vec![D::RightUp],
            hotkey(&["ctrl"], &["v"]),
        ),
        intent(
            "任务切换",
            T::Right,
            vec![D::Down, D::Up],
            Command::TaskSwitcher,
        ),
        intent("刷新", T::Right, vec![D::Up, D::Down], hotkey(&[], &["f5"])),
    ];
    doc
}

pub struct ConfigStore {
    dir: PathBuf,
}

pub(crate) struct ConfigFilesSnapshot {
    #[cfg_attr(not(windows), allow(dead_code))]
    config: FileSnapshot,
    machine: FileSnapshot,
}

enum FileSnapshot {
    Missing,
    Present(Vec<u8>),
}

impl ConfigStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn config_path(&self) -> PathBuf {
        self.dir.join("config.json")
    }
    fn machine_path(&self) -> PathBuf {
        self.dir.join("machine.json")
    }
    fn sync_state_path(&self) -> PathBuf {
        self.dir.join("sync-state.json")
    }

    /// 加载配置;文件不存在时写入默认手势库种子
    pub fn load_config(&self) -> ConfigDocument {
        let path = self.config_path();
        if !path.exists() {
            let seed = default_seed();
            if let Err(e) = self.save_config(&seed) {
                log::warn!("默认配置种子写入失败: {e}");
            }
            return seed;
        }
        match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<ConfigDocument>(&text) {
                Ok(mut document) => {
                    document.migrate_legacy_boundaries();
                    document
                }
                Err(error) => {
                    // Node-only 不再执行旧 script；中和这些已删除命令，避免一条旧命令
                    // 让整份用户配置回退为默认值。其他字段仍按当前 schema 严格校验。
                    let mut value = match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(value) => value,
                        Err(_) => {
                            log::warn!("配置文件损坏,使用默认值: {path:?}: {error}");
                            return ConfigDocument::default();
                        }
                    };
                    let removed = neutralize_removed_script_commands(&mut value);
                    if removed == 0 {
                        log::warn!("配置文件损坏,使用默认值: {path:?}: {error}");
                        return ConfigDocument::default();
                    }
                    match serde_json::from_value::<ConfigDocument>(value) {
                        Ok(mut document) => {
                            document.migrate_legacy_boundaries();
                            log::warn!(
                                "配置包含 {removed} 个已删除的 script 命令,已降级为 doNothing: {path:?}"
                            );
                            if let Err(save_error) = self.save_config(&document) {
                                log::warn!("修复后的配置写回失败: {path:?}: {save_error}");
                            }
                            document
                        }
                        Err(repair_error) => {
                            log::warn!("配置文件损坏,修复后仍无法加载: {path:?}: {repair_error}");
                            ConfigDocument::default()
                        }
                    }
                }
            },
            Err(_) => ConfigDocument::default(),
        }
    }

    pub fn load_machine(&self) -> MachineLocalSettings {
        Self::load_or_default(&self.machine_path())
    }

    pub fn save_config(&self, doc: &ConfigDocument) -> std::io::Result<()> {
        let mut document = doc.clone();
        document.migrate_legacy_boundaries();
        self.save(&self.config_path(), &document)
    }

    pub fn save_machine(&self, m: &MachineLocalSettings) -> std::io::Result<()> {
        self.save(&self.machine_path(), m)
    }

    pub fn load_sync_metadata(&self) -> Option<SyncMetadata> {
        let path = self.sync_state_path();
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return None,
            Err(err) => {
                log::warn!("同步元数据读取失败: {path:?}: {err}");
                return None;
            }
        };
        serde_json::from_str::<SyncMetadata>(&text)
            .map(|mut metadata| {
                metadata.last_synced_document.migrate_legacy_boundaries();
                Some(metadata)
            })
            .unwrap_or_else(|err| {
                log::warn!("同步元数据损坏,忽略本地基线: {path:?}: {err}");
                None
            })
    }

    pub fn save_sync_metadata(&self, metadata: &SyncMetadata) -> std::io::Result<()> {
        self.save(&self.sync_state_path(), metadata)
    }

    pub(crate) fn snapshot_files(&self) -> io::Result<ConfigFilesSnapshot> {
        Ok(ConfigFilesSnapshot {
            config: Self::snapshot_file(&self.config_path())?,
            machine: Self::snapshot_file(&self.machine_path())?,
        })
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    pub(crate) fn restore_config_snapshot(&self, snapshot: &ConfigFilesSnapshot) -> io::Result<()> {
        self.restore_file(&self.config_path(), &snapshot.config)
    }

    pub(crate) fn restore_machine_snapshot(
        &self,
        snapshot: &ConfigFilesSnapshot,
    ) -> io::Result<()> {
        self.restore_file(&self.machine_path(), &snapshot.machine)
    }

    fn load_or_default<T: Default + for<'de> Deserialize<'de>>(path: &PathBuf) -> T {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                log::warn!("配置文件损坏,使用默认值: {path:?}: {e}");
                T::default()
            }),
            Err(_) => T::default(),
        }
    }

    fn snapshot_file(path: &Path) -> io::Result<FileSnapshot> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(FileSnapshot::Present(bytes)),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(FileSnapshot::Missing),
            Err(err) => Err(err),
        }
    }

    fn restore_file(&self, path: &Path, snapshot: &FileSnapshot) -> io::Result<()> {
        match snapshot {
            FileSnapshot::Present(bytes) => self.atomic_write(path, bytes),
            FileSnapshot::Missing => match std::fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(err) => Err(err),
            },
        }
    }

    /// 原子写:先写同目录临时文件再替换,避免崩溃留下半个文件。
    fn save<T: Serialize>(&self, path: &Path, value: &T) -> std::io::Result<()> {
        let bytes = serde_json::to_vec_pretty(value)?;
        self.atomic_write(path, &bytes)
    }

    fn atomic_write(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, bytes)?;
        replace_file(&tmp, path)
    }
}

/// 将已从 Node-only 协议删除的旧命令中和为安全的空操作,不保留或执行源码。
fn neutralize_removed_script_commands(value: &mut serde_json::Value) -> usize {
    let is_removed_script = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|kind| kind == "script");
    if is_removed_script {
        *value = serde_json::json!({ "type": "doNothing" });
        return 1;
    }
    match value {
        serde_json::Value::Array(items) => items
            .iter_mut()
            .map(neutralize_removed_script_commands)
            .sum(),
        serde_json::Value::Object(fields) => fields
            .values_mut()
            .map(neutralize_removed_script_commands)
            .sum(),
        _ => 0,
    }
}

impl ConfigDocument {
    pub fn migrate_legacy_boundaries(&mut self) {
        for intent in &mut self.global.intents {
            if intent.gesture.inputs.is_empty() {
                intent.gesture.inputs = intent.gesture.legacy_inputs();
            }
        }
        for app in &mut self.apps {
            for intent in &mut app.intents {
                if intent.gesture.inputs.is_empty() {
                    intent.gesture.inputs = intent.gesture.legacy_inputs();
                }
            }
        }
        const CORNERS: [(&str, &str, &str); 4] = [
            (
                "leftTop",
                "10000000-0000-4000-8000-000000000001",
                "Left top corner",
            ),
            (
                "rightTop",
                "10000000-0000-4000-8000-000000000002",
                "Right top corner",
            ),
            (
                "leftBottom",
                "10000000-0000-4000-8000-000000000003",
                "Left bottom corner",
            ),
            (
                "rightBottom",
                "10000000-0000-4000-8000-000000000004",
                "Right bottom corner",
            ),
        ];
        const EDGES: [(&str, &str, &str); 4] = [
            (
                "top",
                "10000000-0000-4000-8000-000000000005",
                "Top rub edge",
            ),
            (
                "right",
                "10000000-0000-4000-8000-000000000006",
                "Right rub edge",
            ),
            (
                "bottom",
                "10000000-0000-4000-8000-000000000007",
                "Bottom rub edge",
            ),
            (
                "left",
                "10000000-0000-4000-8000-000000000008",
                "Left rub edge",
            ),
        ];

        let mut next_order = self.boundary_intents.len() as i32;
        for (corner, id, name) in CORNERS {
            let Some(command) = self.hot_corners.commands.remove(corner) else {
                continue;
            };
            if self.boundary_intents.iter().any(|intent| intent.id == id) {
                continue;
            }
            self.boundary_intents.push(BoundaryIntent {
                id: id.into(),
                name: name.into(),
                enabled: true,
                origin: BoundaryOrigin::HotCorner {
                    corner: corner.into(),
                },
                sequence: Vec::new(),
                command,
                order: next_order,
            });
            next_order += 1;
        }
        for (edge, id, name) in EDGES {
            let Some(command) = self.rub_edges.commands.remove(edge) else {
                continue;
            };
            if self.boundary_intents.iter().any(|intent| intent.id == id) {
                continue;
            }
            self.boundary_intents.push(BoundaryIntent {
                id: id.into(),
                name: name.into(),
                enabled: true,
                origin: BoundaryOrigin::RubEdge { edge: edge.into() },
                sequence: Vec::new(),
                command,
                order: next_order,
            });
            next_order += 1;
        }
        self.format_version = CONFIG_FORMAT_VERSION;
    }
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|_| io::Error::last_os_error())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    std::fs::rename(source, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("godgesture-config-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn config_document_roundtrip_defaults() {
        let doc = ConfigDocument::default();
        let json = serde_json::to_string(&doc).unwrap();
        let back: ConfigDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(doc, back);
    }

    #[test]
    fn load_config_neutralizes_removed_scripts_without_resetting_other_settings() {
        let dir = TestDir::new();
        let store = ConfigStore::new(dir.0.clone());
        std::fs::write(
            store.config_path(),
            serde_json::json!({
                "formatVersion": 3,
                "global": {
                    "intents": [{
                        "id": "30000000-0000-4000-8000-000000000001",
                        "name": "Legacy script",
                        "gesture": { "trigger": "right", "strokes": ["down"] },
                        "command": { "type": "script", "language": "js", "script": "return 1" }
                    }]
                },
                "preferences": { "autoCheckForUpdate": false }
            })
            .to_string(),
        )
        .unwrap();

        let document = store.load_config();
        assert_eq!(document.format_version, CONFIG_FORMAT_VERSION);
        assert_eq!(document.global.intents.len(), 1);
        assert_eq!(document.global.intents[0].command, Command::DoNothing);
        assert!(!document.preferences.auto_check_for_update);
        let saved = std::fs::read_to_string(store.config_path()).unwrap();
        assert!(!saved.contains("\"script\""));
    }

    #[test]
    fn command_json_shape_matches_shared_schema() {
        // 与 shared zod 的 discriminatedUnion("type") 形状一致
        let cmd = Command::HotKey {
            modifiers: vec!["ctrl".into()],
            keys: vec!["w".into()],
        };
        let v = serde_json::to_value(&cmd).unwrap();
        assert_eq!(v["type"], "hotKey");
        assert_eq!(v["modifiers"][0], "ctrl");

        let parsed: Command =
            serde_json::from_value(serde_json::json!({"type": "doNothing"})).unwrap();
        assert_eq!(parsed, Command::DoNothing);

        let node: Command = serde_json::from_value(serde_json::json!({
            "type": "nodePlugin",
            "pluginId": "30000000-0000-4000-8000-000000000001"
        }))
        .unwrap();
        assert_eq!(
            node,
            Command::NodePlugin {
                plugin_id: "30000000-0000-4000-8000-000000000001".into(),
                export_name: "execute".into(),
            }
        );

        let removed = serde_json::from_value::<Command>(serde_json::json!({
            "type": "script",
            "language": "js",
            "script": "return 1"
        }));
        assert!(removed.is_err());

        let plugin: NodePlugin = serde_json::from_value(serde_json::json!({
            "id": "30000000-0000-4000-8000-000000000001",
            "name": "Example"
        }))
        .unwrap();
        assert_eq!(plugin.entry, "index.mjs");
        assert!(plugin.files.contains_key("index.mjs"));
        assert!(plugin.package_json.contains("\"type\": \"module\""));
    }

    #[test]
    fn gesture_spec_json_uses_camel_case_directions() {
        let g = GestureSpecConfig {
            trigger: TriggerButton::Right,
            strokes: vec![Direction::RightUp, Direction::Down],
            modifier: Modifier::WheelForward,
            inputs: Vec::new(),
        };
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["trigger"], "right");
        assert_eq!(v["strokes"][0], "rightUp");
        assert_eq!(v["modifier"], "wheelForward");
    }

    #[test]
    fn legacy_boundary_commands_migrate_deterministically() {
        let mut document: ConfigDocument = serde_json::from_value(serde_json::json!({
            "formatVersion": 1,
            "hotCorners": {
                "enabled": false,
                "commands": { "leftTop": { "type": "pause" } }
            },
            "rubEdges": {
                "commands": {
                    "bottom": { "type": "hotKey", "modifiers": ["meta"], "keys": ["d"] }
                }
            }
        }))
        .unwrap();

        document.migrate_legacy_boundaries();
        assert_eq!(document.format_version, 4);
        assert!(!document.hot_corners.enabled);
        assert!(document.hot_corners.commands.is_empty());
        assert!(document.rub_edges.commands.is_empty());
        assert_eq!(document.boundary_intents.len(), 2);
        assert_eq!(
            document.boundary_intents[0].id,
            "10000000-0000-4000-8000-000000000001"
        );
        assert_eq!(
            document.boundary_intents[1].origin,
            BoundaryOrigin::RubEdge {
                edge: "bottom".into()
            }
        );

        let once = document.clone();
        document.migrate_legacy_boundaries();
        assert_eq!(document, once);
    }

    #[test]
    fn saving_same_config_path_twice_replaces_existing_file() {
        let dir = TestDir::new();
        let store = ConfigStore::new(dir.0.clone());
        let first = ConfigDocument::default();
        let mut second = first.clone();
        second.preferences.auto_check_for_update = false;

        store.save_config(&first).unwrap();
        store.save_config(&second).unwrap();

        assert_eq!(store.load_config(), second);
    }

    #[test]
    fn file_snapshots_restore_contents_and_absence() {
        let dir = TestDir::new();
        let store = ConfigStore::new(dir.0.clone());
        let original = ConfigDocument::default();
        store.save_config(&original).unwrap();
        let snapshot = store.snapshot_files().unwrap();

        let mut changed = original.clone();
        changed.preferences.auto_check_for_update = false;
        store.save_config(&changed).unwrap();
        store
            .save_machine(&MachineLocalSettings {
                auto_start: true,
                ..MachineLocalSettings::default()
            })
            .unwrap();

        store.restore_config_snapshot(&snapshot).unwrap();
        store.restore_machine_snapshot(&snapshot).unwrap();

        assert_eq!(store.load_config(), original);
        assert!(!store.machine_path().exists());
    }

    #[test]
    fn sync_metadata_roundtrips_and_replaces_atomically() {
        let dir = TestDir::new();
        let store = ConfigStore::new(dir.0.clone());
        let first = SyncMetadata {
            account_id: "20000000-0000-4000-8000-000000000001".into(),
            server_version: 3,
            last_synced_document: ConfigDocument::default(),
            last_sync_at: "2026-07-28T10:00:00.000Z".into(),
        };
        let mut second = first.clone();
        second.server_version = 4;
        second
            .last_synced_document
            .preferences
            .auto_check_for_update = false;

        store.save_sync_metadata(&first).unwrap();
        store.save_sync_metadata(&second).unwrap();

        assert_eq!(store.load_sync_metadata(), Some(second));
        assert!(!store.sync_state_path().with_extension("json.tmp").exists());
    }

    #[test]
    fn invalid_sync_metadata_is_ignored_without_touching_config() {
        let dir = TestDir::new();
        let store = ConfigStore::new(dir.0.clone());
        let config = ConfigDocument::default();
        store.save_config(&config).unwrap();
        std::fs::write(store.sync_state_path(), b"not-json").unwrap();

        assert_eq!(store.load_sync_metadata(), None);
        assert_eq!(store.load_config(), config);
    }
}

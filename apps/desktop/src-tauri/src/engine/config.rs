//! 配置文档 —— 与 packages/shared/src/config/*.ts 的 JSON 形状严格一致。
//! 本机专属设置(MachineLocalSettings)单独存放,不进同步载荷(ADR-0010)。

use super::types::{Direction, Modifier, TriggerButton};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const CONFIG_FORMAT_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// 命令(12 类;执行器在 M2 落地,类型先行以支撑意图查找与配置往返)
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
    WindowControl { operation: WindowOperation },
    TaskSwitcher,
    #[serde(rename_all = "camelCase")]
    OpenFile { path: String },
    #[serde(rename_all = "camelCase")]
    SendText { text: String },
    #[serde(rename_all = "camelCase")]
    GotoUrl { url: String },
    #[serde(rename_all = "camelCase")]
    Cmd {
        code: String,
        #[serde(default = "default_true")]
        show_window: bool,
        #[serde(default = "default_true")]
        auto_set_working_dir: bool,
    },
    #[serde(rename_all = "camelCase")]
    Script {
        #[serde(default = "default_js")]
        language: String,
        #[serde(default)]
        init_script: String,
        #[serde(default)]
        script: String,
        #[serde(default)]
        handle_modifiers: bool,
        #[serde(default)]
        gesture_recognized_script: String,
        #[serde(default)]
        modifier_triggered_script: String,
        #[serde(default)]
        gesture_ended_script: String,
    },
    Pause,
    #[serde(rename_all = "camelCase")]
    AudioVolume {
        #[serde(default = "default_delta")]
        delta: i32,
    },
}

fn default_true() -> bool {
    true
}
fn default_js() -> String {
    "js".into()
}
fn default_delta() -> i32 {
    1
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
}

fn default_modifier() -> Modifier {
    Modifier::None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GestureIntent {
    pub id: String,
    pub name: String,
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
#[serde(rename_all = "camelCase", default)]
pub struct ConfigDocument {
    pub format_version: u32,
    pub global: GlobalApp,
    pub apps: Vec<AppEntry>,
    pub hot_corners: HotCornersConfig,
    pub rub_edges: RubEdgesConfig,
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

// ---------------------------------------------------------------------------
// 持久化:%APPDATA%/GodGesture/{config.json, machine.json}
// ---------------------------------------------------------------------------

/// 首次启动的默认手势库(对齐 WGestures 出厂常用项;命令执行 M2 生效)
pub fn default_seed() -> ConfigDocument {
    use super::types::{Direction as D, TriggerButton as T};
    let intent = |name: &str, trigger: T, strokes: Vec<super::types::Direction>, command: Command| {
        GestureIntent {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            gesture: GestureSpecConfig {
                trigger,
                strokes,
                modifier: super::types::Modifier::None,
            },
            command,
            execute_on_modifier: false,
            order: 0,
        }
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
        intent("前进", T::Right, vec![D::Right], hotkey(&["alt"], &["right"])),
        intent("复制", T::Right, vec![D::RightDown], hotkey(&["ctrl"], &["c"])),
        intent("粘贴", T::Right, vec![D::RightUp], hotkey(&["ctrl"], &["v"])),
        intent("任务切换", T::Right, vec![D::Down, D::Up], Command::TaskSwitcher),
        intent(
            "刷新",
            T::Right,
            vec![D::Up, D::Down],
            hotkey(&[], &["f5"]),
        ),
    ];
    doc
}

pub struct ConfigStore {
    dir: PathBuf,
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
        Self::load_or_default(&path)
    }

    pub fn load_machine(&self) -> MachineLocalSettings {
        Self::load_or_default(&self.machine_path())
    }

    pub fn save_config(&self, doc: &ConfigDocument) -> std::io::Result<()> {
        self.save(&self.config_path(), doc)
    }

    pub fn save_machine(&self, m: &MachineLocalSettings) -> std::io::Result<()> {
        self.save(&self.machine_path(), m)
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

    /// 原子写:先写临时文件再改名,避免崩溃留下半个文件
    fn save<T: Serialize>(&self, path: &PathBuf, value: &T) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(value)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_document_roundtrip_defaults() {
        let doc = ConfigDocument::default();
        let json = serde_json::to_string(&doc).unwrap();
        let back: ConfigDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(doc, back);
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
    }

    #[test]
    fn gesture_spec_json_uses_camel_case_directions() {
        let g = GestureSpecConfig {
            trigger: TriggerButton::Right,
            strokes: vec![Direction::RightUp, Direction::Down],
            modifier: Modifier::WheelForward,
        };
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["trigger"], "right");
        assert_eq!(v["strokes"][0], "rightUp");
        assert_eq!(v["modifier"], "wheelForward");
    }
}

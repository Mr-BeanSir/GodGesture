//! 意图查找 —— 应用匹配与继承/黑名单语义(与 WGestures 对齐):
//! - 命中应用条目且其含该手势 → 用之;
//! - 未含且 inherit_global_gestures → 回退全局;
//! - 全局开关是总开关，关闭后所有应用都禁止手势;
//! - 应用黑名单(gesturing_enabled=false)在路径开始前进一步拦截。

use super::config::{AppEntry, Command, ConfigDocument, GestureInput, GestureIntent};
use super::types::{Direction, Modifier, TriggerButton};

/// 前台程序的平台标识(由平台层解析)
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ForegroundApp {
    /// Windows: exe 文件名(小写,如 "chrome.exe")
    pub exe_name: Option<String>,
    /// Windows: AppUserModelID(商店应用)
    pub aumid: Option<String>,
    /// Windows: exe 完整路径(仅精确匹配开启时参与匹配)
    pub exe_path: Option<String>,
    /// macOS: Bundle ID
    pub bundle_id: Option<String>,
    /// 不透明原生窗口句柄(Windows = HWND as i64;macOS 暂 0)。
    /// 仅供命令执行定位目标窗口,**不参与应用匹配**。
    pub native_window: i64,
}

pub struct IntentFinder {
    config: ConfigDocument,
}

impl IntentFinder {
    pub fn new(config: ConfigDocument) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &ConfigDocument {
        &self.config
    }

    pub fn replace_config(&mut self, config: ConfigDocument) {
        self.config = config;
    }

    /// 匹配应用条目。优先级:AUMID 精确 → 精确路径(若启用)→ exe 文件名 → Bundle ID
    pub fn match_app(&self, fg: &ForegroundApp) -> Option<&AppEntry> {
        if let Some(aumid) = &fg.aumid {
            if let Some(app) = self.config.apps.iter().find(|a| {
                a.windows
                    .as_ref()
                    .is_some_and(|w| w.aumid.as_deref() == Some(aumid.as_str()))
            }) {
                return Some(app);
            }
        }
        if let Some(path) = &fg.exe_path {
            let path_lower = path.to_lowercase();
            if let Some(app) = self.config.apps.iter().find(|a| {
                a.windows.as_ref().is_some_and(|w| {
                    w.match_by_exact_path
                        && w.exact_path
                            .as_deref()
                            .is_some_and(|p| p.to_lowercase() == path_lower)
                })
            }) {
                return Some(app);
            }
        }
        if let Some(exe) = &fg.exe_name {
            let exe_lower = exe.to_lowercase();
            if let Some(app) = self.config.apps.iter().find(|a| {
                a.windows
                    .as_ref()
                    .is_some_and(|w| w.exe_name.to_lowercase() == exe_lower)
            }) {
                return Some(app);
            }
        }
        if let Some(bundle) = &fg.bundle_id {
            if let Some(app) = self
                .config
                .apps
                .iter()
                .find(|a| a.mac.as_ref().is_some_and(|m| &m.bundle_id == bundle))
            {
                return Some(app);
            }
        }
        None
    }

    /// 路径开始前的放行判定(黑名单/总开关)
    pub fn is_gesturing_enabled_for(&self, fg: &ForegroundApp) -> bool {
        if !self.config.global.gesturing_enabled {
            return false;
        }
        match self.match_app(fg) {
            Some(app) => app.gesturing_enabled,
            None => true,
        }
    }

    /// 查找无独立修饰符的普通完成意图。
    pub fn find_inputs(
        &self,
        trigger: TriggerButton,
        inputs: &[GestureInput],
        fg: &ForegroundApp,
    ) -> Option<&GestureIntent> {
        let matches = |i: &&GestureIntent| {
            i.enabled
                && i.gesture.trigger == trigger
                && i.gesture.modifier == Modifier::None
                && i.gesture.effective_inputs().as_slice() == inputs
        };
        if let Some(app) = self.match_app(fg) {
            if let Some(intent) = app.intents.iter().find(matches) {
                return Some(intent);
            }
            if !app.inherit_global_gestures {
                return None;
            }
        }
        self.config.global.intents.iter().find(matches)
    }

    /// 按触发键、基础输入和独立修饰符精确查找可重复执行意图。
    pub fn find_modifier(
        &self,
        trigger: TriggerButton,
        inputs: &[GestureInput],
        modifier: Modifier,
        fg: &ForegroundApp,
    ) -> Option<&GestureIntent> {
        if modifier == Modifier::None {
            return None;
        }
        let matches = |i: &&GestureIntent| {
            i.enabled
                && i.gesture.trigger == trigger
                && i.gesture.modifier == modifier
                && i.gesture.effective_inputs().as_slice() == inputs
        };
        if let Some(app) = self.match_app(fg) {
            if let Some(intent) = app.intents.iter().find(matches) {
                return Some(intent);
            }
            if !app.inherit_global_gestures {
                return None;
            }
        }
        self.config.global.intents.iter().find(matches)
    }

    /// 兼容旧调用方的 (触发键, 笔画, 修饰) 查找接口。
    pub fn find(
        &self,
        trigger: TriggerButton,
        strokes: &[Direction],
        modifier: Modifier,
        fg: &ForegroundApp,
    ) -> Option<&GestureIntent> {
        let inputs = strokes
            .iter()
            .copied()
            .map(|direction| GestureInput::Stroke { direction })
            .collect::<Vec<_>>();
        if modifier == Modifier::None {
            self.find_inputs(trigger, &inputs, fg)
        } else {
            self.find_modifier(trigger, &inputs, modifier, fg)
        }
    }

    /// 该 (触发键, 前缀笔画) 下是否存在任何以此为前缀的意图 —— 供增量识别提示
    pub fn any_with_prefix(
        &self,
        trigger: TriggerButton,
        prefix: &[Direction],
        fg: &ForegroundApp,
    ) -> bool {
        let expected_prefix = prefix
            .iter()
            .copied()
            .map(|direction| GestureInput::Stroke { direction })
            .collect::<Vec<_>>();
        let starts = |i: &GestureIntent| {
            i.enabled
                && i.gesture.trigger == trigger
                && i.gesture.effective_inputs().starts_with(&expected_prefix)
        };
        let in_global = || self.config.global.intents.iter().any(starts);
        match self.match_app(fg) {
            Some(app) => {
                app.intents.iter().any(starts) || (app.inherit_global_gestures && in_global())
            }
            None => in_global(),
        }
    }
}

/// 触发角/摩擦边命令查找(键: leftTop/rightTop/... 与 left/top/right/bottom)
pub fn hot_corner_command<'c>(config: &'c ConfigDocument, corner: &str) -> Option<&'c Command> {
    if !config.hot_corners.enabled {
        return None;
    }
    config
        .boundary_intents
        .iter()
        .find(|intent| {
            intent.enabled
                && intent.sequence.is_empty()
                && intent.origin.matches("hotCorner", corner)
        })
        .map(|intent| &intent.command)
        .or_else(|| config.hot_corners.commands.get(corner))
}

pub fn rub_edge_command<'c>(config: &'c ConfigDocument, edge: &str) -> Option<&'c Command> {
    if !config.rub_edges.enabled {
        return None;
    }
    config
        .boundary_intents
        .iter()
        .find(|intent| {
            intent.enabled && intent.sequence.is_empty() && intent.origin.matches("rubEdge", edge)
        })
        .map(|intent| &intent.command)
        .or_else(|| config.rub_edges.commands.get(edge))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::{
        GestureInput, GestureInputButton, GestureSpecConfig, WindowsBinding,
    };

    fn intent(name: &str, trigger: TriggerButton, strokes: Vec<Direction>) -> GestureIntent {
        GestureIntent {
            id: name.to_string(),
            name: name.to_string(),
            enabled: true,
            gesture: GestureSpecConfig {
                trigger,
                strokes,
                modifier: Modifier::None,
                inputs: Vec::new(),
            },
            command: Command::DoNothing,
            order: 0,
        }
    }

    fn chrome_fg() -> ForegroundApp {
        ForegroundApp {
            exe_name: Some("chrome.exe".into()),
            ..Default::default()
        }
    }

    fn config_with_chrome(inherit: bool, enabled: bool) -> ConfigDocument {
        let mut doc = ConfigDocument::default();
        doc.global.intents = vec![intent(
            "g-down",
            TriggerButton::Right,
            vec![Direction::Down],
        )];
        doc.apps.push(AppEntry {
            id: "chrome".into(),
            name: "Chrome".into(),
            windows: Some(WindowsBinding {
                exe_name: "Chrome.EXE".into(),
                aumid: None,
                exact_path: None,
                match_by_exact_path: false,
            }),
            mac: None,
            gesturing_enabled: enabled,
            inherit_global_gestures: inherit,
            intents: vec![intent("c-up", TriggerButton::Right, vec![Direction::Up])],
            order: 0,
        });
        doc
    }

    #[test]
    fn ordered_inputs_distinguish_button_before_stroke() {
        let mut doc = ConfigDocument::default();
        let mut i = intent("middle-right", TriggerButton::Right, vec![Direction::Right]);
        i.gesture.inputs = vec![
            GestureInput::Button {
                button: GestureInputButton::Middle,
            },
            GestureInput::Stroke {
                direction: Direction::Right,
            },
        ];
        doc.global.intents.push(i);
        let finder = IntentFinder::new(doc);
        let fg = ForegroundApp::default();
        assert!(finder
            .find_inputs(
                TriggerButton::Right,
                &[
                    GestureInput::Button {
                        button: GestureInputButton::Middle,
                    },
                    GestureInput::Stroke {
                        direction: Direction::Right,
                    },
                ],
                &fg,
            )
            .is_some());
        assert!(finder
            .find_inputs(
                TriggerButton::Right,
                &[GestureInput::Stroke {
                    direction: Direction::Right,
                }],
                &fg,
            )
            .is_none());
    }

    #[test]
    fn independent_modifier_matches_separately_from_path_end() {
        let mut doc = ConfigDocument::default();
        let mut repeated = intent("repeat", TriggerButton::Right, vec![Direction::Right]);
        repeated.gesture.modifier = Modifier::WheelBackward;
        doc.global.intents.push(repeated);
        let finder = IntentFinder::new(doc);
        let fg = ForegroundApp::default();
        let inputs = [GestureInput::Stroke {
            direction: Direction::Right,
        }];

        assert!(finder
            .find_inputs(TriggerButton::Right, &inputs, &fg)
            .is_none());
        assert_eq!(
            finder
                .find_modifier(TriggerButton::Right, &inputs, Modifier::WheelBackward, &fg,)
                .map(|intent| intent.name.as_str()),
            Some("repeat")
        );
        assert!(finder
            .find_modifier(TriggerButton::Right, &inputs, Modifier::WheelForward, &fg,)
            .is_none());
    }

    #[test]
    fn app_intent_shadows_and_inherits_global() {
        let f = IntentFinder::new(config_with_chrome(true, true));
        let fg = chrome_fg();
        assert_eq!(
            f.find(TriggerButton::Right, &[Direction::Up], Modifier::None, &fg)
                .unwrap()
                .name,
            "c-up"
        );
        // 应用没有 Down,继承回退全局
        assert_eq!(
            f.find(
                TriggerButton::Right,
                &[Direction::Down],
                Modifier::None,
                &fg
            )
            .unwrap()
            .name,
            "g-down"
        );
    }

    #[test]
    fn no_inherit_blocks_global_fallback() {
        let f = IntentFinder::new(config_with_chrome(false, true));
        assert!(f
            .find(
                TriggerButton::Right,
                &[Direction::Down],
                Modifier::None,
                &chrome_fg()
            )
            .is_none());
    }

    #[test]
    fn blacklist_disables_gesturing() {
        let f = IntentFinder::new(config_with_chrome(true, false));
        assert!(!f.is_gesturing_enabled_for(&chrome_fg()));
        // 其他程序仍受全局开关控制
        let other = ForegroundApp {
            exe_name: Some("notepad.exe".into()),
            ..Default::default()
        };
        assert!(f.is_gesturing_enabled_for(&other));
    }

    #[test]
    fn global_switch_disables_gestures_for_all_apps() {
        let mut doc = config_with_chrome(true, true);
        doc.global.gesturing_enabled = false;
        let f = IntentFinder::new(doc);

        assert!(!f.is_gesturing_enabled_for(&chrome_fg()));
        let other = ForegroundApp {
            exe_name: Some("notepad.exe".into()),
            ..Default::default()
        };
        assert!(!f.is_gesturing_enabled_for(&other));
    }

    #[test]
    fn exe_name_match_is_case_insensitive() {
        let f = IntentFinder::new(config_with_chrome(true, true));
        let fg = ForegroundApp {
            exe_name: Some("CHROME.exe".into()),
            ..Default::default()
        };
        assert!(f.match_app(&fg).is_some());
    }

    #[test]
    fn aumid_match_takes_priority_over_exact_path_and_exe_name() {
        let mut doc = ConfigDocument::default();
        doc.apps.push(AppEntry {
            id: "path".into(),
            name: "Path".into(),
            windows: Some(WindowsBinding {
                exe_name: "app.exe".into(),
                aumid: None,
                exact_path: Some("C:\\Apps\\app.exe".into()),
                match_by_exact_path: true,
            }),
            mac: None,
            gesturing_enabled: true,
            inherit_global_gestures: true,
            intents: vec![],
            order: 0,
        });
        doc.apps.push(AppEntry {
            id: "aumid".into(),
            name: "Packaged".into(),
            windows: Some(WindowsBinding {
                exe_name: "app.exe".into(),
                aumid: Some("Contoso.App_123!Main".into()),
                exact_path: None,
                match_by_exact_path: false,
            }),
            mac: None,
            gesturing_enabled: true,
            inherit_global_gestures: true,
            intents: vec![],
            order: 1,
        });

        let fg = ForegroundApp {
            exe_name: Some("app.exe".into()),
            aumid: Some("Contoso.App_123!Main".into()),
            exe_path: Some("C:\\Apps\\app.exe".into()),
            ..Default::default()
        };
        assert_eq!(IntentFinder::new(doc).match_app(&fg).unwrap().id, "aumid");
    }

    #[test]
    fn prefix_probe_sees_app_and_global() {
        let f = IntentFinder::new(config_with_chrome(true, true));
        let fg = chrome_fg();
        assert!(f.any_with_prefix(TriggerButton::Right, &[Direction::Up], &fg));
        assert!(f.any_with_prefix(TriggerButton::Right, &[Direction::Down], &fg));
        assert!(!f.any_with_prefix(TriggerButton::Right, &[Direction::Left], &fg));
    }

    #[test]
    fn disabled_intents_do_not_match_or_keep_prefixes_alive() {
        let mut doc = ConfigDocument::default();
        let mut disabled = intent("disabled", TriggerButton::Right, vec![Direction::Down]);
        disabled.enabled = false;
        doc.global.intents.push(disabled);
        let finder = IntentFinder::new(doc);
        let fg = ForegroundApp::default();

        assert!(finder
            .find(
                TriggerButton::Right,
                &[Direction::Down],
                Modifier::None,
                &fg
            )
            .is_none());
        assert!(!finder.any_with_prefix(TriggerButton::Right, &[Direction::Down], &fg));
    }
}

use crate::engine::config::{ConfigDocument, MachineLocalSettings, PauseHotkey};

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyImportError {
    pub code: &'static str,
    pub message: String,
    pub rollback_errors: Vec<String>,
}

impl LegacyImportError {
    fn apply_failed(message: String) -> Self {
        Self {
            code: "apply_failed",
            message,
            rollback_errors: Vec::new(),
        }
    }

    #[cfg(not(windows))]
    pub(crate) fn unsupported() -> Self {
        Self::apply_failed("legacy import is currently supported on Windows only".into())
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ApplyProgress {
    pub hotkey_attempted: bool,
    pub tray_attempted: bool,
    pub config_attempted: bool,
    pub machine_attempted: bool,
}

pub(crate) trait LegacyImportEffects {
    type Snapshot;

    fn snapshot(&mut self) -> Result<Self::Snapshot, String>;
    fn apply_hotkey(&mut self, hotkey: &PauseHotkey) -> Result<(), String>;
    fn apply_tray_visibility(&mut self, visible: bool) -> Result<(), String>;
    fn save_config(&mut self, document: &ConfigDocument) -> Result<(), String>;
    fn save_machine(&mut self, machine: &MachineLocalSettings) -> Result<(), String>;
    fn rollback(&mut self, snapshot: &Self::Snapshot, progress: ApplyProgress) -> Vec<String>;
    fn replace_engine_config(&mut self, document: ConfigDocument);
}

pub(crate) fn apply_legacy_import<E: LegacyImportEffects>(
    effects: &mut E,
    document: ConfigDocument,
    machine: MachineLocalSettings,
) -> Result<(), LegacyImportError> {
    let snapshot = effects
        .snapshot()
        .map_err(|err| LegacyImportError::apply_failed(format!("snapshot failed: {err}")))?;
    let mut progress = ApplyProgress {
        hotkey_attempted: true,
        ..ApplyProgress::default()
    };
    if let Err(err) = effects.apply_hotkey(&document.preferences.pause_hotkey) {
        return rollback_failure(
            effects,
            &snapshot,
            progress,
            format!("hotkey failed: {err}"),
        );
    }

    progress.tray_attempted = true;
    if let Err(err) = effects.apply_tray_visibility(machine.tray_icon_visible) {
        return rollback_failure(effects, &snapshot, progress, format!("tray failed: {err}"));
    }

    progress.config_attempted = true;
    if let Err(err) = effects.save_config(&document) {
        return rollback_failure(
            effects,
            &snapshot,
            progress,
            format!("config save failed: {err}"),
        );
    }

    progress.machine_attempted = true;
    if let Err(err) = effects.save_machine(&machine) {
        return rollback_failure(
            effects,
            &snapshot,
            progress,
            format!("machine save failed: {err}"),
        );
    }

    effects.replace_engine_config(document);
    Ok(())
}

fn rollback_failure<E: LegacyImportEffects>(
    effects: &mut E,
    snapshot: &E::Snapshot,
    progress: ApplyProgress,
    message: String,
) -> Result<(), LegacyImportError> {
    let rollback_errors = effects.rollback(snapshot, progress);
    let code = if rollback_errors.is_empty() {
        "apply_failed"
    } else {
        "rollback_incomplete"
    };
    Err(LegacyImportError {
        code,
        message,
        rollback_errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MockEffects {
        events: Vec<&'static str>,
        fail_at: Option<&'static str>,
        rollback_errors: Vec<String>,
        rollback_progress: Option<ApplyProgress>,
    }

    impl MockEffects {
        fn step(&mut self, event: &'static str) -> Result<(), String> {
            self.events.push(event);
            if self.fail_at == Some(event) {
                Err(format!("{event} error"))
            } else {
                Ok(())
            }
        }
    }

    impl LegacyImportEffects for MockEffects {
        type Snapshot = ();

        fn snapshot(&mut self) -> Result<Self::Snapshot, String> {
            self.step("snapshot")
        }

        fn apply_hotkey(&mut self, _hotkey: &PauseHotkey) -> Result<(), String> {
            self.step("hotkey")
        }

        fn apply_tray_visibility(&mut self, _visible: bool) -> Result<(), String> {
            self.step("tray")
        }

        fn save_config(&mut self, _document: &ConfigDocument) -> Result<(), String> {
            self.step("config")
        }

        fn save_machine(&mut self, _machine: &MachineLocalSettings) -> Result<(), String> {
            self.step("machine")
        }

        fn rollback(&mut self, _snapshot: &Self::Snapshot, progress: ApplyProgress) -> Vec<String> {
            self.events.push("rollback");
            self.rollback_progress = Some(progress);
            std::mem::take(&mut self.rollback_errors)
        }

        fn replace_engine_config(&mut self, _document: ConfigDocument) {
            self.events.push("engine");
        }
    }

    fn run(effects: &mut MockEffects) -> Result<(), LegacyImportError> {
        apply_legacy_import(
            effects,
            ConfigDocument::default(),
            MachineLocalSettings::default(),
        )
    }

    #[test]
    fn successful_apply_updates_engine_last() {
        let mut effects = MockEffects::default();

        assert_eq!(run(&mut effects), Ok(()));
        assert_eq!(
            effects.events,
            ["snapshot", "hotkey", "tray", "config", "machine", "engine"]
        );
        assert_eq!(effects.rollback_progress, None);
    }

    #[test]
    fn hotkey_or_tray_failure_does_not_write_files() {
        for (failure, expected_events, expected_progress) in [
            (
                "hotkey",
                vec!["snapshot", "hotkey", "rollback"],
                ApplyProgress {
                    hotkey_attempted: true,
                    ..ApplyProgress::default()
                },
            ),
            (
                "tray",
                vec!["snapshot", "hotkey", "tray", "rollback"],
                ApplyProgress {
                    hotkey_attempted: true,
                    tray_attempted: true,
                    ..ApplyProgress::default()
                },
            ),
        ] {
            let mut effects = MockEffects {
                fail_at: Some(failure),
                ..MockEffects::default()
            };

            let error = run(&mut effects).unwrap_err();

            assert_eq!(error.code, "apply_failed");
            assert_eq!(effects.events, expected_events);
            assert_eq!(effects.rollback_progress, Some(expected_progress));
        }
    }

    #[test]
    fn file_failure_rolls_back_before_engine_update() {
        for failure in ["config", "machine"] {
            let mut effects = MockEffects {
                fail_at: Some(failure),
                ..MockEffects::default()
            };

            let error = run(&mut effects).unwrap_err();

            assert_eq!(error.code, "apply_failed");
            assert_eq!(effects.events.last(), Some(&"rollback"));
            assert!(!effects.events.contains(&"engine"));
            let progress = effects.rollback_progress.unwrap();
            assert!(progress.config_attempted);
            assert_eq!(progress.machine_attempted, failure == "machine");
        }
    }

    #[test]
    fn rollback_failure_has_distinct_code_and_keeps_primary_error() {
        let mut effects = MockEffects {
            fail_at: Some("machine"),
            rollback_errors: vec!["config restore error".into()],
            ..MockEffects::default()
        };

        let error = run(&mut effects).unwrap_err();

        assert_eq!(error.code, "rollback_incomplete");
        assert!(error.message.contains("machine save failed"));
        assert_eq!(error.rollback_errors, ["config restore error"]);
    }

    #[test]
    fn snapshot_failure_has_no_side_effects() {
        let mut effects = MockEffects {
            fail_at: Some("snapshot"),
            ..MockEffects::default()
        };

        let error = run(&mut effects).unwrap_err();

        assert_eq!(error.code, "apply_failed");
        assert_eq!(effects.events, ["snapshot"]);
        assert_eq!(effects.rollback_progress, None);
    }

    #[cfg(not(windows))]
    #[test]
    fn unsupported_error_uses_stable_code() {
        assert_eq!(LegacyImportError::unsupported().code, "apply_failed");
    }
}

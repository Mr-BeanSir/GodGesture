//! User-owned filesystem workspace for Node plugins.

use super::config::{NodePlugin, NodePluginAction};
use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const API_VERSION: u32 = 1;
const MAX_PLUGINS: usize = 32;
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_SOURCE_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_LOCKFILE_BYTES: u64 = 512 * 1024;
const IGNORED_DIRECTORIES: &[&str] = &["node_modules", ".git", ".godgesture", "target"];

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginActionSummary {
    pub id: String,
    pub name: String,
    pub export_name: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginProjectSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub path: String,
    pub entry: String,
    pub api_version: u32,
    pub actions: Vec<PluginActionSummary>,
    pub status: &'static str,
    pub error: Option<String>,
    pub last_reload_at: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginWorkspaceSnapshot {
    pub root: String,
    pub plugins: Vec<PluginProjectSummary>,
}

#[derive(Default)]
struct WorkspaceState {
    plugins: Vec<NodePlugin>,
    snapshot: Option<PluginWorkspaceSnapshot>,
}

pub struct PluginWorkspace {
    root: PathBuf,
    state: Mutex<WorkspaceState>,
}

impl PluginWorkspace {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root)
            .map_err(|error| format!("create plugin workspace '{}': {error}", root.display()))?;
        seed_demo_if_empty(&root)?;
        let workspace = Self {
            root,
            state: Mutex::new(WorkspaceState::default()),
        };
        workspace.rescan();
        Ok(workspace)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn plugins(&self) -> Vec<NodePlugin> {
        self.state.lock().plugins.clone()
    }

    pub fn snapshot(&self) -> PluginWorkspaceSnapshot {
        self.state
            .lock()
            .snapshot
            .clone()
            .unwrap_or_else(|| PluginWorkspaceSnapshot {
                root: self.root.to_string_lossy().into_owned(),
                plugins: Vec::new(),
            })
    }

    pub fn export_embedded_plugins(
        &self,
        plugins: &[NodePlugin],
        referenced_actions: &HashMap<String, Vec<String>>,
    ) -> Result<bool, String> {
        if plugins.is_empty() {
            return Ok(false);
        }
        let installed_ids = self
            .plugins()
            .into_iter()
            .map(|plugin| plugin.id)
            .collect::<std::collections::HashSet<_>>();
        let mut wrote_project = false;
        for plugin in plugins {
            if installed_ids.contains(&plugin.id) {
                continue;
            }
            let folder_name = safe_folder_name(&plugin.name, &plugin.id);
            let root = self.root.join(folder_name);
            fs::create_dir_all(&root)
                .map_err(|error| format!("create exported plugin directory: {error}"))?;
            let mut manifest = serde_json::from_str::<serde_json::Value>(&plugin.package_json)
                .map_err(|error| format!("parse embedded plugin package.json: {error}"))?;
            let object = manifest
                .as_object_mut()
                .ok_or_else(|| "embedded plugin package.json must be an object".to_string())?;
            object.insert(
                "name".into(),
                serde_json::Value::String(safe_package_name(&plugin.name)),
            );
            object.insert("version".into(), serde_json::Value::String("0.1.0".into()));
            let actions = if plugin.actions.is_empty() {
                referenced_actions
                    .get(&plugin.id)
                    .cloned()
                    .filter(|actions| !actions.is_empty())
                    .unwrap_or_else(|| vec!["onExecute".into()])
                    .into_iter()
                    .map(|action| {
                        serde_json::json!({
                            "id": action,
                            "name": action,
                            "export": action,
                        })
                    })
                    .collect::<Vec<_>>()
            } else {
                plugin
                    .actions
                    .iter()
                    .map(|action| {
                        serde_json::json!({
                            "id": action.id,
                            "name": action.name,
                            "export": action.export_name,
                        })
                    })
                    .collect::<Vec<_>>()
            };
            object.insert(
                "godgesture".into(),
                serde_json::json!({
                    "id": plugin.id,
                    "apiVersion": API_VERSION,
                    "entry": plugin.entry,
                    "actions": actions,
                    "allowLifecycleScripts": plugin.allow_lifecycle_scripts,
                }),
            );
            fs::write(
                root.join("package.json"),
                serde_json::to_vec_pretty(&manifest).expect("JSON values serialize"),
            )
            .map_err(|error| format!("write exported plugin package.json: {error}"))?;
            for (relative, source) in &plugin.files {
                let target = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!("create exported plugin source directory: {error}")
                    })?;
                }
                fs::write(&target, source).map_err(|error| {
                    format!("write exported plugin source '{relative}': {error}")
                })?;
            }
            if let Some(lockfile) = &plugin.lockfile {
                fs::write(root.join("pnpm-lock.yaml"), lockfile)
                    .map_err(|error| format!("write exported plugin lockfile: {error}"))?;
            }
            wrote_project = true;
        }
        if wrote_project {
            self.rescan();
        }
        Ok(true)
    }

    /// Returns true when the public snapshot or a runnable plugin changed.
    pub fn rescan(&self) -> bool {
        let previous = self.state.lock();
        let previous_plugins = previous
            .plugins
            .iter()
            .map(|plugin| (plugin.id.clone(), plugin.clone()))
            .collect::<HashMap<_, _>>();
        let previous_summaries = previous
            .snapshot
            .as_ref()
            .map(|snapshot| {
                snapshot
                    .plugins
                    .iter()
                    .map(|plugin| (plugin.path.clone(), plugin.clone()))
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();
        drop(previous);

        let mut runnable = Vec::new();
        let mut summaries = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) => {
                log::error!("read plugin workspace '{}': {error}", self.root.display());
                return false;
            }
        };
        let mut project_dirs = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                entry
                    .file_type()
                    .ok()
                    .filter(|kind| kind.is_dir())
                    .map(|_| entry.path())
            })
            .collect::<Vec<_>>();
        project_dirs.sort();

        for (index, project_root) in project_dirs.into_iter().enumerate() {
            let path = project_root.to_string_lossy().into_owned();
            if index >= MAX_PLUGINS {
                let folder = project_root
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("extra-plugin");
                summaries.push(PluginProjectSummary {
                    id: format!("invalid:{folder}"),
                    name: folder.to_string(),
                    version: String::new(),
                    path,
                    entry: String::new(),
                    api_version: 0,
                    actions: Vec::new(),
                    status: "error",
                    error: Some(format!(
                        "plugin workspace supports at most {MAX_PLUGINS} projects"
                    )),
                    last_reload_at: None,
                });
                continue;
            }
            match read_project(&project_root) {
                Ok((plugin, mut summary)) => {
                    if !seen_ids.insert(plugin.id.clone()) {
                        summary.status = "error";
                        summary.error = Some(format!("duplicate plugin id '{}'", plugin.id));
                        summaries.push(summary);
                        continue;
                    }
                    let unchanged = previous_plugins.get(&plugin.id) == Some(&plugin);
                    summary.last_reload_at = if unchanged {
                        previous_summaries
                            .get(&path)
                            .and_then(|previous| previous.last_reload_at)
                    } else {
                        Some(now_millis())
                    };
                    runnable.push(plugin);
                    summaries.push(summary);
                }
                Err(error) => {
                    let folder = project_root
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("invalid-plugin");
                    if let Some(previous) = previous_summaries
                        .get(&path)
                        .and_then(|summary| previous_plugins.get(&summary.id))
                    {
                        runnable.push(previous.clone());
                    }
                    summaries.push(PluginProjectSummary {
                        id: format!("invalid:{folder}"),
                        name: folder.to_string(),
                        version: String::new(),
                        path,
                        entry: String::new(),
                        api_version: 0,
                        actions: Vec::new(),
                        status: "error",
                        error: Some(error),
                        last_reload_at: None,
                    });
                }
            }
        }

        let snapshot = PluginWorkspaceSnapshot {
            root: self.root.to_string_lossy().into_owned(),
            plugins: summaries,
        };
        let mut state = self.state.lock();
        let changed = state.plugins != runnable || state.snapshot.as_ref() != Some(&snapshot);
        state.plugins = runnable;
        state.snapshot = Some(snapshot);
        changed
    }
}

fn safe_folder_name(name: &str, id: &str) -> String {
    let normalized = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let fallback = id.split('-').next().unwrap_or("plugin");
    if normalized.is_empty() {
        fallback.into()
    } else {
        normalized
    }
}

fn safe_package_name(name: &str) -> String {
    let value = safe_folder_name(name, "plugin");
    if value.is_empty() {
        "godgesture-plugin".into()
    } else {
        value
    }
}

fn seed_demo_if_empty(root: &Path) -> Result<(), String> {
    let is_empty = fs::read_dir(root)
        .map_err(|error| format!("read plugin workspace '{}': {error}", root.display()))?
        .next()
        .is_none();
    if !is_empty {
        return Ok(());
    }
    let demo = root.join("gesture-demo");
    fs::create_dir_all(&demo).map_err(|error| format!("create gesture demo directory: {error}"))?;
    fs::write(
        demo.join("package.json"),
        include_str!("../../../../../plugins/gesture-demo/package.json"),
    )
    .map_err(|error| format!("write gesture demo package.json: {error}"))?;
    fs::write(
        demo.join("index.mjs"),
        include_str!("../../../../../plugins/gesture-demo/index.mjs"),
    )
    .map_err(|error| format!("write gesture demo entry: {error}"))?;
    fs::write(
        demo.join("README.md"),
        include_str!("../../../../../plugins/gesture-demo/README.md"),
    )
    .map_err(|error| format!("write gesture demo README: {error}"))
}

#[derive(Deserialize)]
struct PackageManifest {
    name: String,
    #[serde(default)]
    version: String,
    #[serde(rename = "type")]
    module_type: String,
    godgesture: GodGestureManifest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GodGestureManifest {
    id: String,
    api_version: u32,
    entry: String,
    #[serde(default)]
    actions: Vec<PluginActionManifest>,
    #[serde(default)]
    allow_lifecycle_scripts: bool,
}

#[derive(Deserialize)]
struct PluginActionManifest {
    id: String,
    name: String,
    #[serde(rename = "export")]
    export_name: String,
}

fn read_project(root: &Path) -> Result<(NodePlugin, PluginProjectSummary), String> {
    let manifest_path = root.join("package.json");
    let manifest_bytes = fs::metadata(&manifest_path)
        .map_err(|error| format!("read package.json metadata: {error}"))?
        .len();
    if manifest_bytes > MAX_MANIFEST_BYTES {
        return Err(format!("package.json exceeds {MAX_MANIFEST_BYTES} bytes"));
    }
    let package_json = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("read package.json: {error}"))?;
    let manifest: PackageManifest = serde_json::from_str(&package_json)
        .map_err(|error| format!("invalid package.json: {error}"))?;
    if manifest.module_type != "module" {
        return Err("package.json must set type to module".into());
    }
    uuid::Uuid::parse_str(&manifest.godgesture.id)
        .map_err(|_| "package.json godgesture.id must be a UUID".to_string())?;
    if manifest.godgesture.api_version != API_VERSION {
        return Err(format!(
            "unsupported GodGesture plugin API version {} (expected {API_VERSION})",
            manifest.godgesture.api_version
        ));
    }
    validate_relative_path(&manifest.godgesture.entry)?;
    if manifest.godgesture.actions.is_empty() {
        return Err("package.json godgesture.actions must not be empty".into());
    }
    let mut action_ids = std::collections::HashSet::new();
    for action in &manifest.godgesture.actions {
        if !is_action_id(&action.id)
            || action.name.is_empty()
            || !is_identifier(&action.export_name)
        {
            return Err("plugin action id, name, or export is invalid".into());
        }
        if !action_ids.insert(action.id.as_str()) {
            return Err(format!("duplicate plugin action id '{}'", action.id));
        }
    }

    let mut files = HashMap::new();
    collect_files(root, root, &mut files)?;
    if !files.contains_key(&manifest.godgesture.entry) {
        return Err(format!(
            "plugin entry '{}' does not exist",
            manifest.godgesture.entry
        ));
    }
    let lockfile_path = root.join("pnpm-lock.yaml");
    let lockfile = match fs::metadata(&lockfile_path) {
        Ok(metadata) if metadata.len() > MAX_LOCKFILE_BYTES => {
            return Err(format!("pnpm-lock.yaml exceeds {MAX_LOCKFILE_BYTES} bytes"));
        }
        Ok(_) => Some(
            fs::read_to_string(&lockfile_path)
                .map_err(|error| format!("read pnpm-lock.yaml: {error}"))?,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("read pnpm-lock.yaml metadata: {error}")),
    };
    let actions = manifest
        .godgesture
        .actions
        .iter()
        .map(|action| PluginActionSummary {
            id: action.id.clone(),
            name: action.name.clone(),
            export_name: action.export_name.clone(),
        })
        .collect::<Vec<_>>();
    let plugin = NodePlugin {
        id: manifest.godgesture.id.clone(),
        name: manifest.name.clone(),
        entry: manifest.godgesture.entry.clone(),
        files,
        package_json,
        lockfile,
        allow_lifecycle_scripts: manifest.godgesture.allow_lifecycle_scripts,
        actions: manifest
            .godgesture
            .actions
            .iter()
            .map(|action| NodePluginAction {
                id: action.id.clone(),
                name: action.name.clone(),
                export_name: action.export_name.clone(),
            })
            .collect(),
    };
    let summary = PluginProjectSummary {
        id: manifest.godgesture.id,
        name: manifest.name,
        version: manifest.version,
        path: root.to_string_lossy().into_owned(),
        entry: manifest.godgesture.entry,
        api_version: manifest.godgesture.api_version,
        actions,
        status: "ready",
        error: None,
        last_reload_at: None,
    };
    Ok((plugin, summary))
}

fn collect_files(
    root: &Path,
    directory: &Path,
    files: &mut HashMap<String, String>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("read plugin directory '{}': {error}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read plugin entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("read plugin file type: {error}"))?;
        if file_type.is_symlink() {
            return Err(format!(
                "symbolic links are not allowed: {}",
                entry.path().display()
            ));
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if file_type.is_dir() {
            if IGNORED_DIRECTORIES.contains(&name.to_ascii_lowercase().as_str()) {
                continue;
            }
            collect_files(root, &entry.path(), files)?;
            continue;
        }
        if !file_type.is_file() || matches!(name.as_ref(), "package.json" | "pnpm-lock.yaml") {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| "plugin file escaped its project root".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        validate_relative_path(&relative)?;
        let file_bytes = entry
            .metadata()
            .map_err(|error| format!("read plugin source metadata '{relative}': {error}"))?
            .len();
        if file_bytes > MAX_FILE_BYTES {
            return Err(format!(
                "plugin source '{relative}' exceeds {MAX_FILE_BYTES} bytes"
            ));
        }
        if files.len() >= MAX_FILES {
            return Err(format!(
                "plugin project contains more than {MAX_FILES} source files"
            ));
        }
        let source = fs::read_to_string(entry.path())
            .map_err(|error| format!("read plugin source '{relative}': {error}"))?;
        files.insert(relative, source);
        if files.values().map(String::len).sum::<usize>() > MAX_SOURCE_BYTES {
            return Err(format!(
                "plugin source exceeds {MAX_SOURCE_BYTES} bytes in total"
            ));
        }
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 256
        || path.starts_with('/')
        || path.contains('\\')
        || path.split('/').any(|segment| {
            let lower = segment.to_ascii_lowercase();
            let stem = lower.split('.').next().unwrap_or_default();
            segment.is_empty()
                || matches!(segment, "." | "..")
                || segment.ends_with('.')
                || segment.ends_with(' ')
                || segment
                    .chars()
                    .any(|character| character.is_control() || "<>:\"|?*".contains(character))
                || matches!(stem, "con" | "prn" | "aux" | "nul")
                || stem
                    .strip_prefix("com")
                    .or_else(|| stem.strip_prefix("lpt"))
                    .is_some_and(|number| {
                        number.len() == 1 && matches!(number.as_bytes()[0], b'1'..=b'9')
                    })
        })
    {
        return Err(format!(
            "plugin path '{path}' is not a portable relative path"
        ));
    }
    Ok(())
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic() || matches!(character, '_' | '$'))
        && chars
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '$'))
}

fn is_action_id(value: &str) -> bool {
    value.len() <= 64
        && value.chars().next().is_some_and(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '$')
        })
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '$' | '.' | '-')
        })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "godgesture-plugin-workspace-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_project(root: &Path, source: &str) {
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"name":"demo","version":"0.1.0","type":"module","godgesture":{"id":"30000000-0000-4000-8000-000000000001","apiVersion":1,"entry":"src/index.mjs","actions":[{"id":"default","name":"Execute","export":"onExecute"}]}}"#,
        )
        .unwrap();
        fs::write(root.join("src/index.mjs"), source).unwrap();
    }

    #[test]
    fn scans_package_metadata_and_source() {
        let dir = TestDir::new();
        write_project(&dir.0.join("demo"), "export function onExecute() {}");
        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let snapshot = workspace.snapshot();
        assert_eq!(snapshot.plugins.len(), 1);
        assert_eq!(snapshot.plugins[0].actions[0].export_name, "onExecute");
        assert!(workspace.plugins()[0].files.contains_key("src/index.mjs"));
    }

    #[test]
    fn reports_broken_projects_without_hiding_valid_ones() {
        let dir = TestDir::new();
        write_project(&dir.0.join("demo"), "export function onExecute() {}");
        fs::create_dir_all(dir.0.join("broken")).unwrap();
        fs::write(dir.0.join("broken/package.json"), "{}").unwrap();
        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let snapshot = workspace.snapshot();
        assert_eq!(workspace.plugins().len(), 1);
        assert_eq!(snapshot.plugins.len(), 2);
        assert!(snapshot
            .plugins
            .iter()
            .any(|plugin| plugin.status == "error"));
    }

    #[test]
    fn broken_reload_keeps_the_last_runnable_project() {
        let dir = TestDir::new();
        let project = dir.0.join("demo");
        write_project(&project, "export function onExecute() {}");
        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let previous = workspace.plugins();

        fs::write(project.join("package.json"), "{").unwrap();
        assert!(workspace.rescan());

        assert_eq!(workspace.plugins(), previous);
        assert_eq!(workspace.snapshot().plugins[0].status, "error");
    }

    #[test]
    fn exports_legacy_handlers_as_stable_actions() {
        let dir = TestDir::new();
        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let legacy = NodePlugin {
            id: "50000000-0000-4000-8000-000000000010".into(),
            name: "Legacy custom".into(),
            entry: "index.mjs".into(),
            files: HashMap::from([(
                "index.mjs".into(),
                "export function customHandler() {}".into(),
            )]),
            package_json: r#"{"private":true,"type":"module"}"#.into(),
            lockfile: None,
            allow_lifecycle_scripts: false,
            actions: Vec::new(),
        };
        let references = HashMap::from([(legacy.id.clone(), vec!["customHandler".into()])]);

        assert!(workspace
            .export_embedded_plugins(&[legacy], &references)
            .unwrap());
        let exported = workspace
            .snapshot()
            .plugins
            .into_iter()
            .find(|plugin| plugin.id == "50000000-0000-4000-8000-000000000010")
            .unwrap();
        assert_eq!(exported.actions[0].id, "customHandler");
        assert_eq!(exported.actions[0].export_name, "customHandler");
    }
}

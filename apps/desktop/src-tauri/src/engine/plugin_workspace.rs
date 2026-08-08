//! User-owned filesystem workspace for Node plugins.

use super::config::{NodePlugin, NodePluginAction};
use parking_lot::{Mutex, MutexGuard};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
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
const IGNORED_PROJECT_DIRECTORIES: &[&str] =
    &[".operations", "windows-x64", "macos-x64", "macos-arm64"];

// The first-run example belongs to the Desktop experience. Keep it
// embedded here so the native build does not depend on the public distribution
// submodule being checked out.
const DEMO_PACKAGE_JSON: &str = r###"{
  "name": "gesture-demo",
  "version": "0.1.0",
  "author": "GodGesture",
  "private": true,
  "description": "GodGesture Node.js 插件生命周期示例",
  "type": "module",
  "exports": "./index.mjs",
  "godgesture": {
    "id": "30000000-0000-4000-8000-000000000001",
    "apiVersion": 1,
    "entry": "index.mjs",
    "catalog": {
      "title": { "zh-CN": "生命周期示例插件", "en": "Lifecycle demo plugin" },
      "summary": { "zh-CN": "演示 GodGesture Node.js 插件的完整生命周期。", "en": "Demonstrates the complete GodGesture Node.js plugin lifecycle." }
    },
    "lifecycles": ["onInit", "onExecute", "onGestureRecognized", "onModifierTriggered", "onEnd"]
  },
  "devDependencies": { "@godgesture/sdk": "0.1.0" }
}"###;

const DEMO_INDEX_MJS: &str = r###"import { defineHandler } from "@godgesture/sdk";

export const onInit = defineHandler(async (context) => {
  await context.status.report("gesture-demo 已加载");
});

export const onExecute = defineHandler(async (context) => {
  const trigger = context.triggerButton ?? "无";
  await context.status.report(
    `执行完成：触发键=${trigger}，终点=(${context.endpoint.x}, ${context.endpoint.y})`,
  );
});

export const onGestureRecognized = defineHandler(async (context) => {
  await context.status.report(`手势已识别：${context.phase}`);
});

export const onModifierTriggered = defineHandler(async (context) => {
  await context.status.report(`修饰符已触发：${context.modifier}`);
});

export const onEnd = defineHandler(async (context) => {
  await context.status.report(`手势已结束：${context.phase}`);
});
"###;

const DEMO_README: &str = r###"# gesture-demo

这是 GodGesture Node.js 插件的最小生命周期示例，展示 `onInit`、`onExecute`、
`onGestureRecognized`、`onModifierTriggered` 和 `onEnd` 五个现役生命周期。
"###;

/// The online installer keeps a small, durable intent record in each operation
/// directory.  The journal is intentionally separate from the transient
/// checkout/cache directories used by `node_packages`.
pub(crate) const OPERATION_JOURNAL_FILE: &str = "journal.json";
pub(crate) const OPERATION_COMMITTED_FILE: &str = "committed";
pub(crate) const OPERATION_JOURNAL_VERSION: u8 = 1;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginProjectSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub path: String,
    pub entry: String,
    pub api_version: u32,
    pub lifecycles: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginOperationJournal {
    pub(crate) version: u8,
    pub(crate) plugin_id: String,
    /// A portable path relative to the plugin workspace root.
    pub(crate) target: String,
}

/// A guard held for the complete duration of a filesystem installation
/// transaction.  Keeping the guard private prevents callers from faking the
/// "already locked" precondition for `rescan_during_installation`.
pub(crate) struct PluginInstallationGuard<'a> {
    _guard: MutexGuard<'a, ()>,
}

pub struct PluginWorkspace {
    root: PathBuf,
    state: Mutex<WorkspaceState>,
    installation: Mutex<()>,
}

impl PluginWorkspace {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root)
            .map_err(|error| format!("create plugin workspace '{}': {error}", root.display()))?;
        let workspace = Self {
            root,
            state: Mutex::new(WorkspaceState::default()),
            installation: Mutex::new(()),
        };
        workspace.rescan();
        // Recovery runs before seeding the bundled example.  A stale
        // `.operations` directory must never make the workspace look empty and
        // cause an unrelated demo project to be created over the recovery
        // state.
        seed_demo_if_empty(&workspace.root)?;
        workspace.rescan();
        Ok(workspace)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Serializes online installation transactions without blocking workspace reads.
    pub(crate) fn lock_installation(&self) -> PluginInstallationGuard<'_> {
        PluginInstallationGuard {
            _guard: self.installation.lock(),
        }
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

    /// Returns true when the public snapshot or a runnable plugin changed.
    pub fn rescan(&self) -> bool {
        let installation = self.lock_installation();
        self.rescan_during_installation(&installation, None)
    }

    /// Rescans while the caller already owns the installation guard.  The
    /// active operation is excluded from recovery because its journal is
    /// intentionally still uncommitted until validation completes.
    pub(crate) fn rescan_during_installation(
        &self,
        _installation: &PluginInstallationGuard<'_>,
        active_operation: Option<&Path>,
    ) -> bool {
        if !self.recover_interrupted_operations(active_operation) {
            // Keep the last published state while recovery is blocked.  This
            // is what prevents a watcher tick from publishing the temporary
            // target-missing state after a crashed swap.
            return false;
        }
        self.rescan_projects()
    }

    fn rescan_projects(&self) -> bool {
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
                    .filter(|_| {
                        let folder = entry.file_name();
                        let folder = folder.to_string_lossy();
                        !IGNORED_PROJECT_DIRECTORIES
                            .iter()
                            .any(|ignored| folder.eq_ignore_ascii_case(ignored))
                    })
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
                    lifecycles: Vec::new(),
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
                        lifecycles: Vec::new(),
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

    /// Replays or cleans every durable online-install operation except the
    /// operation currently being executed by the caller.  The filesystem
    /// layout is the source of truth; the journal only records the target and
    /// whether the transaction reached its commit point.
    fn recover_interrupted_operations(&self, active_operation: Option<&Path>) -> bool {
        let operations_root = self.root.join(".operations");
        let entries = match fs::read_dir(&operations_root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(error) => {
                log::warn!(
                    "read plugin operation directory '{}': {error}",
                    operations_root.display()
                );
                return false;
            }
        };

        let mut clear = true;
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    log::warn!(
                        "defer plugin operation recovery under '{}': {error}",
                        operations_root.display()
                    );
                    clear = false;
                    continue;
                }
            };
            let operation = entry.path();
            if active_operation.is_some_and(|active| active == operation.as_path()) {
                continue;
            }
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) => {
                    log::warn!(
                        "defer plugin operation recovery '{}': inspect operation: {error}",
                        operation.display()
                    );
                    clear = false;
                    continue;
                }
            };
            if !kind.is_dir() {
                continue;
            }
            let journal_path = operation.join(OPERATION_JOURNAL_FILE);
            match fs::symlink_metadata(&journal_path) {
                Ok(metadata) if metadata.is_file() => {}
                Ok(_) => {
                    log::warn!(
                        "defer plugin operation recovery '{}': journal is not a regular file",
                        operation.display()
                    );
                    clear = false;
                    continue;
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    // Other short-lived operation directories (for example
                    // the Node package cache) deliberately have no journal.
                    continue;
                }
                Err(error) => {
                    log::warn!(
                        "defer plugin operation recovery '{}': inspect journal: {error}",
                        operation.display()
                    );
                    clear = false;
                    continue;
                }
            }
            let journal = match read_operation_journal(&journal_path) {
                Ok(journal) => journal,
                Err(error) => {
                    log::warn!(
                        "defer plugin operation recovery '{}': {error}",
                        operation.display()
                    );
                    clear = false;
                    continue;
                }
            };
            if let Err(error) = validate_operation_journal(&journal) {
                log::warn!(
                    "defer plugin operation recovery '{}': {error}",
                    operation.display()
                );
                clear = false;
                continue;
            }
            let committed = operation.join(OPERATION_COMMITTED_FILE).is_file();
            match recover_operation(&self.root, &operation, &journal, committed) {
                Ok(()) => {
                    if let Err(error) = fs::remove_dir_all(&operation) {
                        log::warn!(
                            "defer cleanup of recovered plugin operation '{}': {error}",
                            operation.display()
                        );
                        clear = false;
                    }
                }
                Err(error) => {
                    log::warn!(
                        "defer plugin operation recovery '{}': {error}",
                        operation.display()
                    );
                    clear = false;
                }
            }
        }
        clear
    }
}

fn read_operation_journal(path: &Path) -> Result<PluginOperationJournal, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("read journal metadata: {error}"))?;
    if metadata.len() > 8 * 1024 {
        return Err("journal exceeds 8192 bytes".into());
    }
    let contents = fs::read_to_string(path).map_err(|error| format!("read journal: {error}"))?;
    serde_json::from_str(&contents).map_err(|error| format!("parse journal: {error}"))
}

fn validate_operation_journal(journal: &PluginOperationJournal) -> Result<(), String> {
    if journal.version != OPERATION_JOURNAL_VERSION {
        return Err(format!("unsupported journal version {}", journal.version));
    }
    uuid::Uuid::parse_str(&journal.plugin_id)
        .map_err(|_| "journal plugin id is not a UUID".to_string())?;
    let path = Path::new(&journal.target);
    if path.is_absolute()
        || path.components().count() != 1
        || !matches!(
            path.components().next(),
            Some(std::path::Component::Normal(_))
        )
    {
        return Err("journal target must name one direct workspace directory".into());
    }
    Ok(())
}

fn recover_operation(
    workspace_root: &Path,
    operation: &Path,
    journal: &PluginOperationJournal,
    committed: bool,
) -> Result<(), String> {
    let target = workspace_root.join(&journal.target);
    let backup = operation.join("previous");
    let staged = operation.join("project");
    let checkout = operation.join("checkout");
    let quarantine = operation.join("activated");

    if committed {
        // The new project was validated before the commit marker was made
        // durable.  Keep it active and only discard swap leftovers.
        remove_path_if_exists(&backup)?;
        remove_path_if_exists(&staged)?;
        remove_path_if_exists(&checkout)?;
        remove_path_if_exists(&quarantine)?;
        return Ok(());
    }

    if backup.exists() {
        // A previous project is authoritative until commit.  If activation
        // already occupied the target, move it aside before restoring the old
        // directory.  Moving (rather than deleting) preserves an unexpected
        // target if a user changed files while the app was stopped.
        if target.exists() {
            if quarantine.exists() {
                return Err(
                    "target is occupied while an earlier recovery quarantine remains".into(),
                );
            }
            fs::rename(&target, &quarantine)
                .map_err(|error| format!("quarantine activated plugin: {error}"))?;
        }
        if !target.exists() {
            fs::rename(&backup, &target)
                .map_err(|error| format!("restore previous plugin: {error}"))?;
        }
        // If a quarantine directory is present, restoration has completed;
        // its contents are uncommitted and can be discarded after the old
        // target is visible again.
        remove_path_if_exists(&quarantine)?;
    } else if quarantine.exists() {
        // Previous recovery may have restored the old target and crashed while
        // deleting the quarantined activation.  Never treat the restored
        // target as a new activation.
        remove_path_if_exists(&quarantine)?;
    } else if staged.exists() {
        // The target was never displaced.  Leave any existing user project
        // untouched and discard only the staged download.
    } else if target.exists() {
        // No previous project existed and activation reached the target.  Move
        // it to the operation directory before cleanup so a failed cleanup
        // cannot destroy an unrelated path.
        fs::rename(&target, &quarantine)
            .map_err(|error| format!("quarantine uncommitted plugin: {error}"))?;
        remove_path_if_exists(&quarantine)?;
    }

    remove_path_if_exists(&staged)?;
    remove_path_if_exists(&checkout)?;
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(path)
                .map_err(|error| format!("remove '{}': {error}", path.display()))
        }
        Ok(_) => {
            fs::remove_file(path).map_err(|error| format!("remove '{}': {error}", path.display()))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("inspect '{}': {error}", path.display())),
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
    fs::write(demo.join("package.json"), DEMO_PACKAGE_JSON)
        .map_err(|error| format!("write gesture demo package.json: {error}"))?;
    fs::write(demo.join("index.mjs"), DEMO_INDEX_MJS)
        .map_err(|error| format!("write gesture demo entry: {error}"))?;
    fs::write(demo.join("README.md"), DEMO_README)
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
    lifecycles: Vec<String>,
    #[serde(default)]
    allow_lifecycle_scripts: bool,
}

#[derive(Clone, Deserialize)]
struct PluginActionManifest {
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
    let declared_lifecycles = if !manifest.godgesture.lifecycles.is_empty() {
        manifest.godgesture.lifecycles.clone()
    } else {
        manifest
            .godgesture
            .actions
            .iter()
            .map(|action| action.export_name.clone())
            .collect::<Vec<_>>()
    };
    if declared_lifecycles.is_empty() {
        return Err("package.json godgesture.lifecycles must not be empty".into());
    }
    let mut lifecycle_names = std::collections::HashSet::new();
    for lifecycle in &declared_lifecycles {
        if !is_lifecycle(lifecycle) {
            return Err(format!("unsupported plugin lifecycle '{lifecycle}'"));
        }
        if !lifecycle_names.insert(lifecycle.as_str()) {
            return Err(format!("duplicate plugin lifecycle '{lifecycle}'"));
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
    let lockfile = read_lockfile(root, "pnpm-lock.yaml")?;
    // Preserve the established pnpm contract when both files are present. npm
    // installations otherwise provide package-lock.json for the runtime cache.
    let npm_lockfile = if lockfile.is_none() {
        read_lockfile(root, "package-lock.json")?
    } else {
        None
    };
    let plugin = NodePlugin {
        id: manifest.godgesture.id.clone(),
        name: manifest.name.clone(),
        entry: manifest.godgesture.entry.clone(),
        files,
        package_json,
        lockfile,
        npm_lockfile,
        allow_lifecycle_scripts: manifest.godgesture.allow_lifecycle_scripts,
        actions: declared_lifecycles
            .iter()
            .map(|lifecycle| NodePluginAction {
                id: lifecycle.clone(),
                name: lifecycle.clone(),
                export_name: lifecycle.clone(),
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
        lifecycles: declared_lifecycles,
        status: "ready",
        error: None,
        last_reload_at: None,
    };
    Ok((plugin, summary))
}

fn read_lockfile(root: &Path, filename: &str) -> Result<Option<String>, String> {
    let path = root.join(filename);
    match fs::metadata(&path) {
        Ok(metadata) if metadata.len() > MAX_LOCKFILE_BYTES => {
            Err(format!("{filename} exceeds {MAX_LOCKFILE_BYTES} bytes"))
        }
        Ok(_) => fs::read_to_string(&path)
            .map(Some)
            .map_err(|error| format!("read {filename}: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read {filename} metadata: {error}")),
    }
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
        if !file_type.is_file()
            || matches!(
                name.as_ref(),
                "package.json" | "pnpm-lock.yaml" | "package-lock.json"
            )
        {
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

fn is_lifecycle(value: &str) -> bool {
    matches!(
        value,
        "onInit" | "onExecute" | "onGestureRecognized" | "onModifierTriggered" | "onEnd"
    )
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
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;

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
            r#"{"name":"demo","version":"0.1.0","type":"module","godgesture":{"id":"30000000-0000-4000-8000-000000000001","apiVersion":1,"entry":"src/index.mjs","lifecycles":["onExecute"]}}"#,
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
        assert_eq!(snapshot.plugins[0].lifecycles, vec!["onExecute"]);
        assert!(workspace.plugins()[0].files.contains_key("src/index.mjs"));
    }

    #[test]
    fn reads_npm_package_lock_when_no_pnpm_lock_exists() {
        let dir = TestDir::new();
        let project = dir.0.join("demo");
        write_project(&project, "export function onExecute() {}");
        fs::write(
            &project.join("package-lock.json"),
            r#"{"lockfileVersion":3}"#,
        )
        .unwrap();

        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let plugin = &workspace.plugins()[0];
        assert_eq!(plugin.lockfile, None);
        assert_eq!(
            plugin.npm_lockfile.as_deref(),
            Some(r#"{"lockfileVersion":3}"#)
        );
    }

    #[test]
    fn prefers_pnpm_lock_when_both_lockfile_formats_exist() {
        let dir = TestDir::new();
        let project = dir.0.join("demo");
        write_project(&project, "export function onExecute() {}");
        fs::write(&project.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();
        fs::write(
            &project.join("package-lock.json"),
            r#"{"lockfileVersion":3}"#,
        )
        .unwrap();

        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let plugin = &workspace.plugins()[0];
        assert_eq!(plugin.lockfile.as_deref(), Some("lockfileVersion: '9.0'\n"));
        assert_eq!(plugin.npm_lockfile, None);
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

    fn write_journal(operation: &Path, target: &str) {
        fs::write(
            operation.join(OPERATION_JOURNAL_FILE),
            serde_json::to_vec(&PluginOperationJournal {
                version: OPERATION_JOURNAL_VERSION,
                plugin_id: "30000000-0000-4000-8000-000000000001".into(),
                target: target.into(),
            })
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn startup_recovers_previous_project_after_interrupted_activation() {
        let dir = TestDir::new();
        let target = dir.0.join("demo");
        write_project(&target, "export function onExecute() { return 'old'; }");

        let operation = dir.0.join(".operations").join("interrupted");
        fs::create_dir_all(&operation).unwrap();
        fs::rename(&target, operation.join("previous")).unwrap();
        write_project(
            &operation.join("project"),
            "export function onExecute() { return 'new'; }",
        );
        fs::rename(operation.join("project"), &target).unwrap();
        write_journal(&operation, "demo");

        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();

        assert_eq!(
            fs::read_to_string(target.join("src/index.mjs")).unwrap(),
            "export function onExecute() { return 'old'; }"
        );
        assert!(!operation.exists());
        assert_eq!(workspace.plugins().len(), 1);
    }

    #[test]
    fn startup_keeps_new_project_after_durable_commit_marker() {
        let dir = TestDir::new();
        let target = dir.0.join("demo");
        write_project(&target, "export function onExecute() { return 'new'; }");

        let operation = dir.0.join(".operations").join("committed");
        fs::create_dir_all(&operation).unwrap();
        write_project(
            &operation.join("previous"),
            "export function onExecute() { return 'old'; }",
        );
        write_journal(&operation, "demo");
        fs::write(operation.join(OPERATION_COMMITTED_FILE), b"committed\n").unwrap();

        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();

        assert_eq!(
            fs::read_to_string(target.join("src/index.mjs")).unwrap(),
            "export function onExecute() { return 'new'; }"
        );
        assert!(!operation.exists());
        assert_eq!(workspace.plugins().len(), 1);
    }

    #[test]
    fn rescan_keeps_last_state_when_operation_recovery_is_blocked() {
        let dir = TestDir::new();
        let target = dir.0.join("demo");
        write_project(&target, "export function onExecute() {} ");
        let workspace = PluginWorkspace::new(dir.0.clone()).unwrap();
        let previous = workspace.plugins();

        let operation = dir.0.join(".operations").join("malformed");
        fs::create_dir_all(&operation).unwrap();
        fs::write(operation.join(OPERATION_JOURNAL_FILE), b"{not-json").unwrap();
        fs::rename(&target, operation.join("previous")).unwrap();

        assert!(!workspace.rescan());
        assert_eq!(workspace.plugins(), previous);
        assert!(operation.exists());
    }

    #[test]
    fn watcher_rescan_waits_through_the_target_swap_gap() {
        let dir = TestDir::new();
        let target = dir.0.join("demo");
        write_project(&target, "export function onExecute() {} ");
        let workspace = Arc::new(PluginWorkspace::new(dir.0.clone()).unwrap());
        let operation = dir.0.join(".operations").join("active");
        fs::create_dir_all(&operation).unwrap();
        write_journal(&operation, "demo");

        let installation = workspace.lock_installation();
        fs::rename(&target, operation.join("previous")).unwrap();
        let (done_tx, done_rx) = mpsc::channel();
        let watcher_workspace = Arc::clone(&workspace);
        thread::spawn(move || {
            done_tx.send(watcher_workspace.rescan()).unwrap();
        });

        assert!(done_rx.recv_timeout(Duration::from_millis(100)).is_err());
        drop(installation);
        assert!(done_rx.recv_timeout(Duration::from_secs(2)).is_ok());
        assert!(target.join("package.json").is_file());
        assert!(!operation.exists());
    }

    #[test]
    fn installation_lock_serializes_workspace_transactions() {
        let workspace = Arc::new(PluginWorkspace {
            root: PathBuf::from("workspace"),
            state: Mutex::new(WorkspaceState::default()),
            installation: Mutex::new(()),
        });
        let first = workspace.lock_installation();
        let (attempted_tx, attempted_rx) = mpsc::channel();
        let (acquired_tx, acquired_rx) = mpsc::channel();
        let waiting_workspace = Arc::clone(&workspace);
        let waiting = thread::spawn(move || {
            attempted_tx.send(()).unwrap();
            let _second = waiting_workspace.lock_installation();
            acquired_tx.send(()).unwrap();
        });

        attempted_rx.recv().unwrap();
        assert!(acquired_rx.try_recv().is_err());
        drop(first);
        acquired_rx.recv().unwrap();
        waiting.join().unwrap();
    }
}

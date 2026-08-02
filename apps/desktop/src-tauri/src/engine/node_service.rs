//! Non-blocking production service for Node plugins.

use super::config::NodePlugin;
use super::node_host::{default_supervisor_path, InvocationResult, NodeHost};
use super::node_packages::write_builtin_sdk;
use super::script_host::{ScriptHost, ScriptInvocation, ScriptSlot};
use crossbeam_channel::{bounded, Sender, TrySendError};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const SERVICE_QUEUE_CAPACITY: usize = 256;
const HOST_RESPONSE_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_PLUGINS: usize = 32;
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_SOURCE_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_LOCKFILE_BYTES: usize = 512 * 1024;
const PACKAGE_INSTALL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone)]
pub struct NodeInvocationOutcome {
    pub plugin_id: String,
    pub handler: String,
    pub invocation: ScriptInvocation,
    pub result: Result<Value, String>,
    pub status: Option<String>,
}

pub type OutcomeSink = Arc<dyn Fn(NodeInvocationOutcome) + Send + Sync>;

#[derive(Clone)]
pub struct NodeScriptService {
    sender: Sender<ServiceMessage>,
}

enum ServiceMessage {
    Sync(Vec<NodePlugin>),
    Invoke {
        plugin_id: String,
        handler: String,
        optional: bool,
        slot: ScriptSlot,
        invocation: ScriptInvocation,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreparedPlugin {
    entry_path: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePluginCacheStatus {
    pub state: String,
    pub revision: String,
}

struct ServiceState {
    node: PathBuf,
    pnpm: PathBuf,
    supervisor: PathBuf,
    workspace: PathBuf,
    script_host: Arc<dyn ScriptHost>,
    outcome_sink: OutcomeSink,
    plugins: HashMap<String, PreparedPlugin>,
    load_errors: HashMap<String, String>,
    node_host: Option<NodeHost>,
}

impl NodeScriptService {
    pub fn start(
        node: PathBuf,
        pnpm: PathBuf,
        supervisor: PathBuf,
        workspace: PathBuf,
        script_host: Arc<dyn ScriptHost>,
        outcome_sink: OutcomeSink,
        initial_plugins: Vec<NodePlugin>,
    ) -> Result<Self, String> {
        let (sender, receiver) = bounded(SERVICE_QUEUE_CAPACITY);
        let service = Self { sender };
        std::thread::Builder::new()
            .name("godgesture-node-service".into())
            .spawn(move || {
                let mut state = ServiceState {
                    node,
                    pnpm,
                    supervisor,
                    workspace,
                    script_host,
                    outcome_sink,
                    plugins: HashMap::new(),
                    load_errors: HashMap::new(),
                    node_host: None,
                };
                state.sync_plugins(initial_plugins);
                while let Ok(message) = receiver.recv() {
                    match message {
                        ServiceMessage::Sync(plugins) => state.sync_plugins(plugins),
                        ServiceMessage::Invoke {
                            plugin_id,
                            handler,
                            optional,
                            slot,
                            invocation,
                        } => state.invoke(plugin_id, handler, optional, slot, invocation),
                    }
                }
            })
            .map_err(|error| format!("start Node plugin service: {error}"))?;
        Ok(service)
    }

    pub fn start_development(
        workspace: PathBuf,
        script_host: Arc<dyn ScriptHost>,
        outcome_sink: OutcomeSink,
        initial_plugins: Vec<NodePlugin>,
    ) -> Result<Self, String> {
        Self::start(
            PathBuf::from("node"),
            PathBuf::from("pnpm"),
            default_supervisor_path(),
            workspace,
            script_host,
            outcome_sink,
            initial_plugins,
        )
    }

    pub fn sync_plugins(&self, plugins: Vec<NodePlugin>) -> bool {
        self.try_send(ServiceMessage::Sync(plugins))
    }

    pub fn invoke(
        &self,
        plugin_id: impl Into<String>,
        handler: impl Into<String>,
        optional: bool,
        slot: ScriptSlot,
        invocation: ScriptInvocation,
    ) -> bool {
        self.try_send(ServiceMessage::Invoke {
            plugin_id: plugin_id.into(),
            handler: handler.into(),
            optional,
            slot,
            invocation,
        })
    }

    fn try_send(&self, message: ServiceMessage) -> bool {
        match self.sender.try_send(message) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => {
                log::error!("Node plugin service queue is full; invocation was dropped");
                false
            }
            Err(TrySendError::Disconnected(_)) => {
                log::error!("Node plugin service is unavailable; invocation was dropped");
                false
            }
        }
    }
}

impl ServiceState {
    fn sync_plugins(&mut self, plugins: Vec<NodePlugin>) {
        if plugins.len() > MAX_PLUGINS {
            log::error!("Node plugin config exceeds the {MAX_PLUGINS}-plugin limit");
            return;
        }
        let mut next_plugins = HashMap::new();
        let mut next_errors = HashMap::new();
        for plugin in plugins {
            let id = plugin.id.clone();
            match prepare_plugin_cache(&self.workspace, &self.node, &self.pnpm, &plugin) {
                Ok(prepared) => {
                    next_plugins.insert(id, prepared);
                }
                Err(error) => {
                    log::error!("Node plugin '{id}' could not be prepared: {error}");
                    next_errors.insert(id, error);
                }
            }
        }
        if next_plugins == self.plugins && next_errors == self.load_errors {
            return;
        }
        self.node_host = None;
        self.plugins = next_plugins;
        self.load_errors = next_errors;
        if let Err(error) = self.start_host() {
            log::error!("Node plugin host could not start: {error}");
        }
    }

    fn start_host(&mut self) -> Result<(), String> {
        if self.plugins.is_empty() {
            self.node_host = None;
            return Ok(());
        }
        let mut host = NodeHost::start_with_supervisor(
            &self.node,
            &self.supervisor,
            HOST_RESPONSE_TIMEOUT,
            Arc::clone(&self.script_host),
        )?;
        let mut ids = self.plugins.keys().cloned().collect::<Vec<_>>();
        ids.sort();
        for id in ids {
            let plugin = &self.plugins[&id];
            let result = host.load_plugin(&id, &plugin.entry_path).and_then(|_| {
                host.invoke(&id, "init", true, ScriptSlot::Init, empty_invocation())
                    .map(|_| ())
            });
            if let Err(error) = result {
                log::error!("Node plugin '{id}' could not load: {error}");
                self.load_errors.insert(id, error);
            }
        }
        self.node_host = Some(host);
        Ok(())
    }

    fn invoke(
        &mut self,
        plugin_id: String,
        handler: String,
        optional: bool,
        slot: ScriptSlot,
        invocation: ScriptInvocation,
    ) {
        let (result, status) =
            match self.invoke_inner(&plugin_id, &handler, optional, slot, invocation) {
                Ok(InvocationResult { value, status, .. }) => (Ok(value), status),
                Err(error) => (Err(error), None),
            };
        (self.outcome_sink)(NodeInvocationOutcome {
            plugin_id,
            handler,
            invocation,
            result,
            status,
        });
    }

    fn invoke_inner(
        &mut self,
        plugin_id: &str,
        handler: &str,
        optional: bool,
        slot: ScriptSlot,
        invocation: ScriptInvocation,
    ) -> Result<InvocationResult, String> {
        if !self.plugins.contains_key(plugin_id) {
            return Err(format!("Node plugin '{plugin_id}' is not configured"));
        }
        if let Some(error) = self.load_errors.get(plugin_id) {
            return Err(format!("Node plugin '{plugin_id}' is unavailable: {error}"));
        }
        if self.node_host.is_none() {
            self.start_host()?;
        }
        let result = self
            .node_host
            .as_mut()
            .expect("host is present after start")
            .invoke(plugin_id, handler, optional, slot, invocation);
        let host_stopped = self
            .node_host
            .as_mut()
            .is_some_and(|host| !host.is_running());
        if host_stopped
            || result
                .as_ref()
                .is_err_and(|error| error.contains("Node host response timeout"))
        {
            self.node_host = None;
        }
        result
    }
}

fn empty_invocation() -> ScriptInvocation {
    ScriptInvocation {
        gesture: Default::default(),
        trigger: None,
        modifier: super::types::Modifier::None,
    }
}

fn prepare_plugin_cache(
    workspace: &Path,
    node: &Path,
    pnpm: &Path,
    plugin: &NodePlugin,
) -> Result<PreparedPlugin, String> {
    validate_plugin(plugin)?;
    let manifest: Value = serde_json::from_str(&plugin.package_json)
        .map_err(|error| format!("invalid package.json: {error}"))?;
    let revision = plugin_fingerprint(plugin);
    let plugin_root = super::node_toolchain::platform_cache_root(workspace)
        .join(&plugin.id)
        .join(format!("{revision:016x}"));
    let ready = plugin_root.join(".ready");
    let sdk_entry = plugin_root
        .join("node_modules")
        .join("@godgesture")
        .join("sdk")
        .join("index.mjs");
    if !ready.is_file() || !sdk_entry.is_file() {
        if plugin_root.exists() {
            fs::remove_dir_all(&plugin_root)
                .map_err(|error| format!("clear incomplete plugin project: {error}"))?;
        }
        fs::create_dir_all(&plugin_root)
            .map_err(|error| format!("create plugin project: {error}"))?;
        fs::write(plugin_root.join("package.json"), &plugin.package_json)
            .map_err(|error| format!("write package.json: {error}"))?;
        if let Some(lockfile) = &plugin.lockfile {
            fs::write(plugin_root.join("pnpm-lock.yaml"), lockfile)
                .map_err(|error| format!("write pnpm-lock.yaml: {error}"))?;
        }
        for (path, source) in &plugin.files {
            let target = plugin_root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("create source directory '{path}': {error}"))?;
            }
            fs::write(&target, source)
                .map_err(|error| format!("write plugin source '{path}': {error}"))?;
        }
        install_dependencies(workspace, &plugin_root, node, pnpm, plugin, &manifest)?;
        write_builtin_sdk(&plugin_root)?;
        fs::write(&ready, revision.to_string())
            .map_err(|error| format!("mark plugin project ready: {error}"))?;
    }
    Ok(PreparedPlugin {
        entry_path: plugin_root.join(plugin.entry.replace('/', std::path::MAIN_SEPARATOR_STR)),
    })
}

pub(crate) fn ensure_plugin_cache(
    workspace: &Path,
    node: &Path,
    pnpm: &Path,
    plugin: &NodePlugin,
) -> Result<(), String> {
    prepare_plugin_cache(workspace, node, pnpm, plugin).map(|_| ())
}

pub fn plugin_cache_status(
    workspace: &Path,
    plugin: &NodePlugin,
) -> Result<NodePluginCacheStatus, String> {
    validate_plugin(plugin)?;
    let manifest: Value = serde_json::from_str(&plugin.package_json)
        .map_err(|error| format!("invalid package.json: {error}"))?;
    let has_dependencies = ["dependencies", "optionalDependencies"].iter().any(|key| {
        manifest
            .get(key)
            .and_then(Value::as_object)
            .is_some_and(|deps| !deps.is_empty())
    });
    let revision = plugin_fingerprint(plugin);
    let revision_hex = format!("{revision:016x}");
    if !has_dependencies {
        return Ok(NodePluginCacheStatus {
            state: "notRequired".into(),
            revision: revision_hex,
        });
    }
    if plugin.lockfile.is_none() {
        return Ok(NodePluginCacheStatus {
            state: "lockfileMissing".into(),
            revision: revision_hex,
        });
    }
    let plugin_root = super::node_toolchain::platform_cache_root(workspace)
        .join(&plugin.id)
        .join(&revision_hex);
    let marker = fs::read_to_string(plugin_root.join(".ready")).ok();
    let sdk_entry = plugin_root
        .join("node_modules")
        .join("@godgesture")
        .join("sdk")
        .join("index.mjs");
    let ready = marker.as_deref() == Some(&revision.to_string()) && sdk_entry.is_file();
    Ok(NodePluginCacheStatus {
        state: if ready { "ready" } else { "missing" }.into(),
        revision: revision_hex,
    })
}

fn install_dependencies(
    workspace: &Path,
    plugin_root: &Path,
    node: &Path,
    pnpm: &Path,
    plugin: &NodePlugin,
    manifest: &Value,
) -> Result<(), String> {
    let has_dependencies = ["dependencies", "optionalDependencies"].iter().any(|key| {
        manifest
            .get(key)
            .and_then(Value::as_object)
            .is_some_and(|deps| !deps.is_empty())
    });
    if !has_dependencies {
        return Ok(());
    }
    if plugin.lockfile.is_none() {
        return Err("plugin dependencies require an exact pnpm lockfile".into());
    }
    let store = super::node_toolchain::platform_cache_root(workspace).join(".pnpm-store");
    fs::create_dir_all(&store).map_err(|error| format!("create pnpm store: {error}"))?;
    let mut command = super::node_toolchain::pnpm_command(node, pnpm);
    command
        .arg("install")
        .arg("--offline")
        .arg("--frozen-lockfile")
        .arg("--prod")
        .arg("--store-dir")
        .arg(&store)
        .current_dir(plugin_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("CI", "1");
    if !plugin.allow_lifecycle_scripts {
        command.arg("--ignore-scripts");
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("start bundled pnpm: {error}"))?;
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("wait for pnpm: {error}"))?
        {
            if status.success() {
                return Ok(());
            }
            return Err(format!("pnpm install failed ({status})"));
        }
        if started.elapsed() >= PACKAGE_INSTALL_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "pnpm install exceeded {} seconds",
                PACKAGE_INSTALL_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn validate_plugin(plugin: &NodePlugin) -> Result<(), String> {
    uuid::Uuid::parse_str(&plugin.id).map_err(|_| "plugin id must be a UUID".to_string())?;
    if plugin.files.len() > MAX_FILES {
        return Err(format!("plugin contains more than {MAX_FILES} files"));
    }
    if !plugin.files.contains_key(&plugin.entry) {
        return Err("plugin entry is missing from source files".into());
    }
    let mut source_bytes = 0;
    for (path, source) in &plugin.files {
        validate_source_path(path)?;
        if source.len() > MAX_FILE_BYTES {
            return Err(format!(
                "plugin file '{path}' exceeds {MAX_FILE_BYTES} bytes"
            ));
        }
        source_bytes += source.len();
    }
    if source_bytes > MAX_SOURCE_BYTES {
        return Err(format!("plugin source exceeds {MAX_SOURCE_BYTES} bytes"));
    }
    if plugin.package_json.len() > MAX_MANIFEST_BYTES {
        return Err(format!("package.json exceeds {MAX_MANIFEST_BYTES} bytes"));
    }
    if plugin
        .lockfile
        .as_ref()
        .is_some_and(|lockfile| lockfile.len() > MAX_LOCKFILE_BYTES)
    {
        return Err(format!("lockfile exceeds {MAX_LOCKFILE_BYTES} bytes"));
    }
    let manifest: Value = serde_json::from_str(&plugin.package_json)
        .map_err(|error| format!("invalid package.json: {error}"))?;
    if manifest.get("type").and_then(Value::as_str) != Some("module") {
        return Err("package.json must set type to module".into());
    }
    Ok(())
}

fn validate_source_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 256 || path.starts_with('/') || path.contains('\\') {
        return Err(format!("plugin source path '{path}' is not portable"));
    }
    let lower = path.to_ascii_lowercase();
    if lower == "package.json"
        || lower == "pnpm-lock.yaml"
        || lower.split('/').next() == Some("node_modules")
    {
        return Err(format!("plugin source path '{path}' is reserved"));
    }
    for segment in path.split('/') {
        let lower = segment.to_ascii_lowercase();
        let stem = lower.split('.').next().unwrap_or_default();
        let reserved = matches!(stem, "con" | "prn" | "aux" | "nul")
            || (stem.len() == 4
                && (stem.starts_with("com") || stem.starts_with("lpt"))
                && stem.as_bytes()[3].is_ascii_digit()
                && stem.as_bytes()[3] != b'0');
        if segment.is_empty()
            || matches!(segment, "." | "..")
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || segment
                .chars()
                .any(|character| character <= '\u{1f}' || "<>:\"|?*".contains(character))
            || reserved
        {
            return Err(format!("plugin source path '{path}' is not portable"));
        }
    }
    Ok(())
}

fn plugin_fingerprint(plugin: &NodePlugin) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    hash_bytes(&mut hash, plugin.entry.as_bytes());
    hash_bytes(&mut hash, plugin.package_json.as_bytes());
    hash_bytes(
        &mut hash,
        if plugin.allow_lifecycle_scripts {
            b"lifecycle-scripts-enabled"
        } else {
            b"lifecycle-scripts-disabled"
        },
    );
    if let Some(lockfile) = &plugin.lockfile {
        hash_bytes(&mut hash, lockfile.as_bytes());
    }
    let mut files = plugin.files.iter().collect::<Vec<_>>();
    files.sort_by_key(|(path, _)| *path);
    for (path, source) in files {
        hash_bytes(&mut hash, path.as_bytes());
        hash_bytes(&mut hash, source.as_bytes());
    }
    hash
}

fn hash_bytes(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x100000001b3);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(0x100000001b3);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::WindowOperation;
    use crate::engine::runtime::GestureContext;
    use crate::engine::script_host::ScriptMouseButton;
    use std::sync::mpsc;

    #[derive(Default)]
    struct FakeHost;

    impl ScriptHost for FakeHost {
        fn key_combo(&self, _: Vec<String>, _: Vec<String>) -> Result<(), String> {
            Ok(())
        }
        fn send_text(&self, _: String) -> Result<(), String> {
            Ok(())
        }
        fn mouse_click(&self, _: ScriptMouseButton) -> Result<(), String> {
            Ok(())
        }
        fn mouse_button(&self, _: ScriptMouseButton, _: bool) -> Result<(), String> {
            Ok(())
        }
        fn move_pointer(&self, _: i32, _: i32) -> Result<(), String> {
            Ok(())
        }
        fn wheel(&self, _: i32) -> Result<(), String> {
            Ok(())
        }
        fn activate_target(&self, _: GestureContext) -> Result<(), String> {
            Ok(())
        }
        fn window_operation(&self, _: WindowOperation, _: GestureContext) -> Result<(), String> {
            Ok(())
        }
        fn clipboard_read_text(&self) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn clipboard_write_text(&self, _: String) -> Result<(), String> {
            Ok(())
        }
        fn clipboard_selected_text(&self) -> Result<Option<String>, String> {
            Ok(None)
        }
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "godgesture-node-service-test-{}",
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

    fn plugin(source: &str) -> NodePlugin {
        NodePlugin {
            id: "30000000-0000-4000-8000-000000000001".into(),
            name: "Test".into(),
            entry: "index.mjs".into(),
            files: [("index.mjs".into(), source.into())].into_iter().collect(),
            package_json: r#"{"private":true,"type":"module"}"#.into(),
            lockfile: None,
            allow_lifecycle_scripts: false,
        }
    }

    #[test]
    fn materialization_is_revisioned_and_rejects_unsafe_paths() {
        let dir = TestDir::new();
        let first = prepare_plugin_cache(
            &dir.0,
            Path::new("node"),
            Path::new("pnpm"),
            &plugin("export function execute() {}"),
        )
        .unwrap();
        assert!(first.entry_path.is_file());
        let second = prepare_plugin_cache(
            &dir.0,
            Path::new("node"),
            Path::new("pnpm"),
            &plugin("export function execute() { return 2 }"),
        )
        .unwrap();
        assert_ne!(first.entry_path, second.entry_path);

        let mut unsafe_plugin = plugin("");
        unsafe_plugin.entry = "../escape.mjs".into();
        unsafe_plugin.files = [("../escape.mjs".into(), "".into())].into_iter().collect();
        assert!(
            prepare_plugin_cache(&dir.0, Path::new("node"), Path::new("pnpm"), &unsafe_plugin)
                .unwrap_err()
                .contains("not portable")
        );
    }

    #[test]
    fn cache_status_distinguishes_dependency_readiness() {
        let dir = TestDir::new();
        let no_dependencies = plugin("export function execute() {}");
        assert_eq!(
            plugin_cache_status(&dir.0, &no_dependencies).unwrap().state,
            "notRequired"
        );

        let mut dependency_plugin = no_dependencies.clone();
        dependency_plugin.package_json =
            r#"{"private":true,"type":"module","dependencies":{"zod":"4.4.3"}}"#.into();
        assert_eq!(
            plugin_cache_status(&dir.0, &dependency_plugin)
                .unwrap()
                .state,
            "lockfileMissing"
        );
        dependency_plugin.lockfile = Some("lockfileVersion: '9.0'".into());
        assert_eq!(
            plugin_cache_status(&dir.0, &dependency_plugin)
                .unwrap()
                .state,
            "missing"
        );
    }

    #[test]
    fn cache_revision_includes_lifecycle_script_policy() {
        let plugin = plugin("export function execute() {}");
        let mut approved = plugin.clone();
        approved.allow_lifecycle_scripts = true;
        assert_ne!(plugin_fingerprint(&plugin), plugin_fingerprint(&approved));
    }

    #[test]
    fn service_queues_lifecycle_handlers_in_order() {
        let dir = TestDir::new();
        let source = r#"
const events = [];
async function record(context) {
  events.push(context.phase);
  await context.status.report(events.join(","));
}
export const init = record;
export const gestureRecognized = record;
export const modifierTriggered = record;
export const gestureEnded = record;
export const execute = record;
"#;
        let (sender, receiver) = mpsc::channel();
        let sink: OutcomeSink = Arc::new(move |outcome| sender.send(outcome).unwrap());
        let service = NodeScriptService::start_development(
            dir.0.clone(),
            Arc::new(FakeHost),
            sink,
            vec![plugin(source)],
        )
        .unwrap();
        for (handler, slot) in [
            ("gestureRecognized", ScriptSlot::GestureRecognized),
            ("modifierTriggered", ScriptSlot::ModifierTriggered),
            ("execute", ScriptSlot::Execute),
            ("gestureEnded", ScriptSlot::GestureEnded),
        ] {
            assert!(service.invoke(
                "30000000-0000-4000-8000-000000000001",
                handler,
                false,
                slot,
                empty_invocation(),
            ));
        }
        let statuses = (0..4)
            .map(|_| {
                let outcome = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
                outcome.result.unwrap();
                outcome.status.unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            statuses,
            [
                "init,gestureRecognized",
                "init,gestureRecognized,modifierTriggered",
                "init,gestureRecognized,modifierTriggered,execute",
                "init,gestureRecognized,modifierTriggered,execute,gestureEnded",
            ]
        );
    }
}

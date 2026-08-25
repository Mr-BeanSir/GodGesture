//! Download and install a Node plugin from a user-approved GitHub repository.

use super::node_toolchain::NodeToolchain;
use super::plugin_workspace::{
    PluginOperationJournal, PluginWorkspace, OPERATION_COMMITTED_FILE, OPERATION_JOURNAL_FILE,
    OPERATION_JOURNAL_VERSION,
};
use crate::http::LoggedHttpClient;
use futures_util::StreamExt;
use reqwest::{header, redirect::Policy, Client};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::io::{BufReader, Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;
use zip::ZipArchive;

const OPERATION_TIMEOUT: Duration = Duration::from_secs(300);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_PLUGIN_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PLUGINS: usize = 32;
const MAX_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 512;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 8 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_REPOSITORY_URL_BYTES: usize = 4096;
const MAX_GIT_REF_BYTES: usize = 128;
const MAX_SUBDIRECTORY_BYTES: usize = 256;
const OFFICIAL_PLUGIN_REPOSITORY_URL: &str = "https://github.com/Mr-BeanSir/GodGesture-Plugins";
const OFFICIAL_PLUGIN_REF: &str = "main";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlinePluginSource {
    pub plugin_id: String,
    pub repository_url: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub subdirectory: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallError {
    pub code: &'static str,
    pub message: String,
}

impl PluginInstallError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct PackageManifest {
    godgesture: GodGestureManifest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GodGestureManifest {
    id: String,
}

pub fn install_online_plugin(
    workspace: &PluginWorkspace,
    toolchain: &NodeToolchain,
    source: OnlinePluginSource,
) -> Result<super::plugin_workspace::PluginWorkspaceSnapshot, PluginInstallError> {
    validate_source(&source)?;
    let source_plugin_id = uuid::Uuid::parse_str(&source.plugin_id)
        .expect("validate_source accepts only UUID plugin IDs")
        .to_string();
    let installation = workspace.lock_installation();
    let root = workspace.root().to_path_buf();
    let operations = root
        .join(".operations")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&operations).map_err(|error| {
        PluginInstallError::new(
            "plugin_workspace",
            format!("create install workspace: {error}"),
        )
    })?;

    let result = install_inner(
        workspace,
        toolchain,
        &source,
        &source_plugin_id,
        &operations,
        &installation,
    );
    let rollback_incomplete = result
        .as_ref()
        .err()
        .is_some_and(|error| error.code == "rollback_incomplete");
    if !rollback_incomplete {
        let _ = fs::remove_dir_all(&operations);
    }
    result
}

fn install_inner(
    workspace: &PluginWorkspace,
    toolchain: &NodeToolchain,
    source: &OnlinePluginSource,
    source_plugin_id: &str,
    operations: &Path,
    installation: &super::plugin_workspace::PluginInstallationGuard<'_>,
) -> Result<super::plugin_workspace::PluginWorkspaceSnapshot, PluginInstallError> {
    let checkout = operations.join("checkout");
    let archive = download_github_archive(source)?;
    extract_github_archive(&archive, &checkout)?;

    let project_root = if source.subdirectory.is_empty() {
        checkout.clone()
    } else {
        checkout.join(
            source
                .subdirectory
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        )
    };
    if !project_root.is_dir() {
        return Err(PluginInstallError::new(
            "plugin_source_missing",
            "the selected plugin subdirectory does not exist",
        ));
    }
    validate_manifest(&project_root, source_plugin_id)?;
    let npm = npm_command(toolchain);
    let installed = run_command(
        npm,
        &[
            "install".into(),
            "--no-audit".into(),
            "--no-fund".into(),
            "--ignore-scripts".into(),
            "--omit=dev".into(),
        ],
        &project_root,
    )
    .map_err(|error| PluginInstallError::new("plugin_install", error))?;
    if !installed.status.success() {
        return Err(PluginInstallError::new(
            "plugin_install",
            format!("npm install failed:\n{}", output_text(&installed)),
        ));
    }

    let snapshot = workspace.snapshot();
    let existing_path = snapshot
        .plugins
        .iter()
        .find(|plugin| same_plugin_id(&plugin.id, source_plugin_id) && plugin.status == "ready")
        .map(|plugin| PathBuf::from(&plugin.path));
    let target = existing_path
        .clone()
        .unwrap_or_else(|| workspace.root().join(source_plugin_id));
    if !target.starts_with(workspace.root()) {
        return Err(PluginInstallError::new(
            "plugin_workspace",
            "existing plugin path is outside the plugin workspace",
        ));
    }
    if existing_path.is_none()
        && snapshot
            .plugins
            .iter()
            .filter(|plugin| plugin.status == "ready")
            .count()
            >= MAX_PLUGINS
    {
        return Err(PluginInstallError::new(
            "plugin_limit",
            format!("plugin workspace supports at most {MAX_PLUGINS} projects"),
        ));
    }

    let staged = operations.join("project");
    fs::rename(&project_root, &staged).map_err(|error| {
        PluginInstallError::new("plugin_workspace", format!("stage plugin project: {error}"))
    })?;
    let backup = operations.join("previous");
    let had_target = target.exists();
    let target_relative = target
        .strip_prefix(workspace.root())
        .map_err(|_| {
            PluginInstallError::new(
                "plugin_workspace",
                "existing plugin path is outside the plugin workspace",
            )
        })?
        .to_string_lossy()
        .replace('\\', "/");
    write_operation_journal(
        operations,
        &PluginOperationJournal {
            version: OPERATION_JOURNAL_VERSION,
            plugin_id: source_plugin_id.to_string(),
            target: target_relative,
        },
    )?;
    if had_target {
        fs::rename(&target, &backup).map_err(|error| {
            PluginInstallError::new(
                "plugin_workspace",
                format!("backup existing plugin: {error}"),
            )
        })?;
    }
    if let Err(error) = fs::rename(&staged, &target) {
        if had_target {
            if let Err(rollback) = restore_previous_project(&target, &backup, false) {
                return Err(PluginInstallError::new(
                    "rollback_incomplete",
                    format!(
                        "activate plugin project: {error}; previous plugin backup was retained for recovery: {rollback}"
                    ),
                ));
            }
        }
        return Err(PluginInstallError::new(
            "plugin_workspace",
            format!("activate plugin project: {error}"),
        ));
    }

    workspace.rescan_during_installation(installation, Some(operations));
    let ready = workspace.snapshot().plugins.iter().any(|plugin| {
        same_plugin_id(&plugin.id, source_plugin_id)
            && plugin.status == "ready"
            && Path::new(&plugin.path) == target.as_path()
    });
    if !ready {
        let rollback = if had_target {
            restore_previous_project(&target, &backup, true)
        } else {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("remove invalid plugin project: {error}"))
        };
        if let Err(rollback) = rollback {
            return Err(PluginInstallError::new(
                "rollback_incomplete",
                format!(
                    "downloaded project does not match the GodGesture plugin manifest; recovery data was retained: {rollback}"
                ),
            ));
        }
        workspace.rescan_during_installation(installation, Some(operations));
        return Err(PluginInstallError::new(
            "plugin_invalid",
            "downloaded project does not match the GodGesture plugin manifest",
        ));
    }

    let plugin = workspace
        .plugins()
        .into_iter()
        .find(|plugin| same_plugin_id(&plugin.id, source_plugin_id))
        .ok_or_else(|| {
            PluginInstallError::new(
                "plugin_invalid",
                "downloaded project could not be prepared for the Node runtime",
            )
        })?;
    if let Err(error) = super::node_service::preflight_plugin_runtime(
        &operations.join("runtime-preflight"),
        toolchain,
        &plugin,
    ) {
        let rollback = if had_target {
            restore_previous_project(&target, &backup, true)
        } else {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("remove runtime-invalid plugin project: {error}"))
        };
        if let Err(rollback) = rollback {
            return Err(PluginInstallError::new(
                "rollback_incomplete",
                format!(
                    "Node runtime validation failed: {error}; recovery data was retained: {rollback}"
                ),
            ));
        }
        workspace.rescan_during_installation(installation, Some(operations));
        return Err(PluginInstallError::new(
            "plugin_invalid",
            format!("Node runtime validation failed: {error}"),
        ));
    }
    write_commit_marker(operations).map_err(|error| {
        let rollback = if had_target {
            restore_previous_project(&target, &backup, true)
        } else {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("remove invalid plugin project: {error}"))
        };
        if let Err(rollback) = rollback {
            PluginInstallError::new(
                "rollback_incomplete",
                format!(
                    "commit plugin installation: {error}; recovery data was retained: {rollback}"
                ),
            )
        } else {
            PluginInstallError::new(
                "plugin_workspace",
                format!("commit plugin installation: {error}"),
            )
        }
    })?;
    let _ = fs::remove_dir_all(&backup);
    Ok(workspace.snapshot())
}

/// Writes the transaction intent before the first destructive rename.  The
/// file is created exactly once and synced before `target -> previous`, so a
/// process crash cannot leave an untracked displaced project.
fn write_operation_journal(
    operations: &Path,
    journal: &PluginOperationJournal,
) -> Result<(), PluginInstallError> {
    let path = operations.join(OPERATION_JOURNAL_FILE);
    let bytes = serde_json::to_vec(journal).map_err(|error| {
        PluginInstallError::new(
            "plugin_workspace",
            format!("serialize install journal: {error}"),
        )
    })?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            PluginInstallError::new(
                "plugin_workspace",
                format!("create install journal: {error}"),
            )
        })?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&path);
        return Err(PluginInstallError::new(
            "plugin_workspace",
            format!("persist install journal: {error}"),
        ));
    }
    Ok(())
}

/// The commit marker is the transaction's durable point of no return.  Before
/// it exists, startup recovery always prefers the previous project.
fn write_commit_marker(operations: &Path) -> Result<(), String> {
    let path = operations.join(OPERATION_COMMITTED_FILE);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("create commit marker: {error}"))?;
    file.write_all(b"committed\n")
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("sync commit marker: {error}"))
}

/// Restores the previous project without risking deletion of an unknown target.
/// A failed restore leaves `backup` in the operation directory for recovery.
fn restore_previous_project(
    target: &Path,
    backup: &Path,
    remove_activated_target: bool,
) -> Result<(), String> {
    if remove_activated_target {
        fs::remove_dir_all(target)
            .map_err(|error| format!("remove newly activated plugin: {error}"))?;
    } else if target.exists() {
        return Err(
            "plugin target became occupied before the previous project could be restored".into(),
        );
    }
    fs::rename(backup, target).map_err(|error| format!("restore existing plugin: {error}"))
}

fn download_github_archive(source: &OnlinePluginSource) -> Result<Vec<u8>, PluginInstallError> {
    let archive_url = github_archive_url(source)?;
    tauri::async_runtime::block_on(async move {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = Client::builder()
            .redirect(Policy::none())
            .user_agent(concat!("GodGesture/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| {
                PluginInstallError::new("plugin_download", format!("create HTTP client: {error}"))
            })?;
        tokio::time::timeout(
            DOWNLOAD_TIMEOUT,
            download_github_archive_with_client(
                LoggedHttpClient::new(client, "http.reqwest"),
                archive_url,
            ),
        )
        .await
        .map_err(|_| PluginInstallError::new("plugin_download", "plugin download timed out"))?
    })
}

fn github_archive_url(source: &OnlinePluginSource) -> Result<Url, PluginInstallError> {
    let repository = Url::parse(&source.repository_url).map_err(|_| {
        PluginInstallError::new("plugin_source_invalid", "plugin repository URL is invalid")
    })?;
    let segments = repository
        .path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let owner = segments.first().ok_or_else(|| {
        PluginInstallError::new(
            "plugin_source_invalid",
            "plugin repository owner is missing",
        )
    })?;
    let repository_name = segments
        .get(1)
        .map(|value| repository_name_without_git_suffix(value))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            PluginInstallError::new("plugin_source_invalid", "plugin repository name is missing")
        })?;
    let mut endpoint = Url::parse("https://api.github.com/").expect("valid GitHub API URL");
    endpoint
        .path_segments_mut()
        .expect("GitHub API URL supports path segments")
        .extend(["repos", owner, repository_name, "zipball", &source.git_ref]);
    Ok(endpoint)
}

fn repository_name_without_git_suffix(value: &str) -> &str {
    let suffix_start = value.len().saturating_sub(4);
    let Some(suffix) = value.get(suffix_start..) else {
        return value;
    };
    if suffix.eq_ignore_ascii_case(".git") {
        &value[..suffix_start]
    } else {
        value
    }
}

async fn download_github_archive_with_client(
    client: LoggedHttpClient,
    mut url: Url,
) -> Result<Vec<u8>, PluginInstallError> {
    for redirect_count in 0..=MAX_REDIRECTS {
        let response = client
            .get(url.clone())
            .header(header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| {
                PluginInstallError::new(
                    "plugin_download",
                    format!("request plugin archive: {error}"),
                )
            })?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(PluginInstallError::new(
                    "plugin_download",
                    "plugin archive exceeded the redirect limit",
                ));
            }
            let location = response.headers().get(header::LOCATION).ok_or_else(|| {
                PluginInstallError::new("plugin_download", "plugin archive redirect is missing")
            })?;
            let location = location.to_str().map_err(|_| {
                PluginInstallError::new("plugin_download", "plugin archive redirect is invalid")
            })?;
            let next = url.join(location).map_err(|_| {
                PluginInstallError::new("plugin_download", "plugin archive redirect URL is invalid")
            })?;
            validate_archive_redirect(&next)?;
            url = next;
            continue;
        }
        if !response.status().is_success() {
            return Err(PluginInstallError::new(
                "plugin_download",
                format!(
                    "plugin archive request failed with status {}",
                    response.status()
                ),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_ARCHIVE_BYTES as u64)
        {
            return Err(PluginInstallError::new(
                "plugin_download",
                "plugin archive exceeds the download size limit",
            ));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                PluginInstallError::new("plugin_download", format!("read plugin archive: {error}"))
            })?;
            if bytes.len().saturating_add(chunk.len()) > MAX_ARCHIVE_BYTES {
                return Err(PluginInstallError::new(
                    "plugin_download",
                    "plugin archive exceeds the download size limit",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(bytes);
    }
    unreachable!("redirect loop exits at the configured limit")
}

fn validate_archive_redirect(url: &Url) -> Result<(), PluginInstallError> {
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("github.com" | "www.github.com" | "api.github.com" | "codeload.github.com")
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(PluginInstallError::new(
            "plugin_download",
            "plugin archive redirected outside GitHub HTTPS",
        ));
    }
    Ok(())
}

fn extract_github_archive(bytes: &[u8], destination: &Path) -> Result<(), PluginInstallError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|error| {
        PluginInstallError::new("plugin_download", format!("read plugin archive: {error}"))
    })?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(PluginInstallError::new(
            "plugin_download",
            "plugin archive contains too many entries",
        ));
    }
    fs::create_dir_all(destination).map_err(|error| {
        PluginInstallError::new(
            "plugin_workspace",
            format!("create archive destination: {error}"),
        )
    })?;
    let mut roots = HashSet::new();
    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            PluginInstallError::new("plugin_download", format!("read archive entry: {error}"))
        })?;
        if entry.is_symlink() {
            return Err(PluginInstallError::new(
                "plugin_download",
                "plugin archive contains a symbolic link",
            ));
        }
        let path = entry.enclosed_name().ok_or_else(|| {
            PluginInstallError::new("plugin_download", "plugin archive contains an unsafe path")
        })?;
        let mut components = path.components();
        let Component::Normal(root) = components.next().ok_or_else(|| {
            PluginInstallError::new(
                "plugin_download",
                "plugin archive entry has no root directory",
            )
        })?
        else {
            return Err(PluginInstallError::new(
                "plugin_download",
                "plugin archive entry has an unsafe root directory",
            ));
        };
        roots.insert(root.to_os_string());
        let relative = components.as_path();
        if relative.as_os_str().is_empty() {
            if entry.is_dir() {
                continue;
            }
            return Err(PluginInstallError::new(
                "plugin_download",
                "plugin archive contains a root file",
            ));
        }
        let target = destination.join(relative);
        if !target.starts_with(destination) {
            return Err(PluginInstallError::new(
                "plugin_download",
                "plugin archive entry escaped its destination",
            ));
        }
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| {
                PluginInstallError::new(
                    "plugin_workspace",
                    format!("create archive directory: {error}"),
                )
            })?;
            continue;
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            return Err(PluginInstallError::new(
                "plugin_download",
                "plugin archive expands beyond the source size limit",
            ));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                PluginInstallError::new(
                    "plugin_workspace",
                    format!("create archive directory: {error}"),
                )
            })?;
        }
        let mut file = fs::File::create(&target).map_err(|error| {
            PluginInstallError::new("plugin_workspace", format!("write archive entry: {error}"))
        })?;
        std::io::copy(&mut entry, &mut file).map_err(|error| {
            PluginInstallError::new(
                "plugin_workspace",
                format!("extract archive entry: {error}"),
            )
        })?;
    }
    if roots.len() != 1 {
        return Err(PluginInstallError::new(
            "plugin_download",
            "plugin archive must contain exactly one root directory",
        ));
    }
    Ok(())
}

fn validate_source(source: &OnlinePluginSource) -> Result<(), PluginInstallError> {
    uuid::Uuid::parse_str(&source.plugin_id)
        .map_err(|_| PluginInstallError::new("plugin_source_invalid", "plugin id is invalid"))?;
    let url = Url::parse(&source.repository_url).map_err(|_| {
        PluginInstallError::new("plugin_source_invalid", "plugin repository URL is invalid")
    })?;
    if source.repository_url != OFFICIAL_PLUGIN_REPOSITORY_URL
        || source.repository_url.len() > MAX_REPOSITORY_URL_BYTES
        || url.scheme() != "https"
        || !matches!(url.host_str(), Some("github.com" | "www.github.com"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path_segments().is_none_or(|segments| {
            let values = segments
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>();
            values.len() != 2 || repository_name_without_git_suffix(values[1]).is_empty()
        })
    {
        return Err(PluginInstallError::new(
            "plugin_source_invalid",
            "plugin repository URL must be the official GodGesture plugin repository",
        ));
    }
    if source.git_ref != OFFICIAL_PLUGIN_REF
        || source.git_ref.len() > MAX_GIT_REF_BYTES
        || source.git_ref.is_empty()
        || source.git_ref.starts_with('-')
        || source.git_ref.contains("..")
        || source.git_ref.contains("@{")
        || source
            .git_ref
            .chars()
            .any(|character| character.is_control() || " ~^:?*[\\".contains(character))
    {
        return Err(PluginInstallError::new(
            "plugin_source_invalid",
            "plugin Git ref must be main",
        ));
    }
    validate_subdirectory(&source.subdirectory)
}

fn validate_subdirectory(value: &str) -> Result<(), PluginInstallError> {
    if value.is_empty() {
        return Ok(());
    }
    if value.len() <= MAX_SUBDIRECTORY_BYTES
        && !value.starts_with('/')
        && !value.contains('\\')
        && value.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && !segment
                    .chars()
                    .any(|character| character.is_control() || "<>:\"|?*".contains(character))
                && !segment.ends_with('.')
                && !segment.ends_with(' ')
                && !is_windows_reserved_name(segment)
        })
    {
        return Ok(());
    }
    Err(PluginInstallError::new(
        "plugin_source_invalid",
        "plugin subdirectory is not a portable relative path",
    ))
}

fn is_windows_reserved_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or_default();
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "CLOCK$"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn validate_manifest(root: &Path, plugin_id: &str) -> Result<(), PluginInstallError> {
    let path = root.join("package.json");
    let metadata = fs::metadata(&path).map_err(|error| {
        PluginInstallError::new(
            "plugin_source_missing",
            format!("read package.json: {error}"),
        )
    })?;
    if metadata.len() > MAX_PLUGIN_MANIFEST_BYTES {
        return Err(PluginInstallError::new(
            "plugin_invalid",
            "package.json is too large",
        ));
    }
    let text = fs::read_to_string(&path).map_err(|error| {
        PluginInstallError::new("plugin_invalid", format!("read package.json: {error}"))
    })?;
    let manifest: PackageManifest = serde_json::from_str(&text).map_err(|error| {
        PluginInstallError::new("plugin_invalid", format!("invalid package.json: {error}"))
    })?;
    let manifest_id = uuid::Uuid::parse_str(&manifest.godgesture.id).map_err(|_| {
        PluginInstallError::new(
            "plugin_invalid",
            "package.json godgesture.id must be a UUID",
        )
    })?;
    let expected_id = uuid::Uuid::parse_str(plugin_id)
        .map_err(|_| PluginInstallError::new("plugin_source_invalid", "plugin id is invalid"))?;
    if manifest_id != expected_id {
        return Err(PluginInstallError::new(
            "plugin_identity_mismatch",
            "package.json godgesture.id does not match the catalog entry",
        ));
    }
    Ok(())
}

fn same_plugin_id(left: &str, right: &str) -> bool {
    uuid::Uuid::parse_str(left).ok() == uuid::Uuid::parse_str(right).ok()
}

fn npm_command(toolchain: &NodeToolchain) -> Command {
    super::node_toolchain::npm_command(&toolchain.node, &toolchain.npm)
}

fn run_command(
    mut command: Command,
    args: &[std::ffi::OsString],
    current_dir: &Path,
) -> Result<Output, String> {
    let mut child = command
        .args(args)
        .current_dir(current_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CI", "1")
        .spawn()
        .map_err(|error| format!("start plugin command: {error}"))?;
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout_reader = thread::spawn(move || read_bounded_output(BufReader::new(stdout)));
    let stderr_reader = thread::spawn(move || read_bounded_output(BufReader::new(stderr)));
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("wait for plugin command: {error}"))?
        {
            return Ok(Output {
                status,
                stdout: stdout_reader.join().unwrap_or_default(),
                stderr: stderr_reader.join().unwrap_or_default(),
            });
        }
        if started.elapsed() >= OPERATION_TIMEOUT {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| format!("wait for timed out plugin command: {error}"))?;
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!(
                "plugin command exceeded {} seconds (status {status})",
                OPERATION_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn read_bounded_output(mut reader: impl Read) -> Vec<u8> {
    let mut retained = Vec::new();
    let mut buffer = [0_u8; 8192];
    while let Ok(read) = reader.read(&mut buffer) {
        if read == 0 {
            break;
        }
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(retained.len());
        if remaining > 0 {
            retained.extend_from_slice(&buffer[..read.min(remaining)]);
        }
    }
    retained
}

fn output_text(output: &Output) -> String {
    let mut bytes = Vec::with_capacity(output.stdout.len() + output.stderr.len());
    bytes.extend_from_slice(&output.stdout);
    bytes.extend_from_slice(&output.stderr);
    let text = String::from_utf8_lossy(&bytes);
    let mut end = text.len().min(MAX_OUTPUT_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::io::Cursor;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "godgesture-plugin-download-{}",
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

    fn source(url: &str) -> OnlinePluginSource {
        OnlinePluginSource {
            plugin_id: "30000000-0000-4000-8000-000000000001".into(),
            repository_url: url.into(),
            git_ref: "main".into(),
            subdirectory: "plugins/demo".into(),
        }
    }

    #[test]
    fn validates_only_the_official_repository_and_main_ref() {
        assert!(
            validate_source(&source("https://github.com/Mr-BeanSir/GodGesture-Plugins")).is_ok()
        );
        for url in [
            "https://github.com/owner/repo",
            "http://github.com/owner/repo",
            "https://example.com/owner/repo",
            "https://github.com/owner/repo/tree/main",
            "https://github.com/owner/repo?token=secret",
        ] {
            assert_eq!(
                validate_source(&source(url)).unwrap_err().code,
                "plugin_source_invalid"
            );
        }
        let mut custom_ref = source("https://github.com/Mr-BeanSir/GodGesture-Plugins");
        custom_ref.git_ref = "develop".into();
        assert_eq!(
            validate_source(&custom_ref).unwrap_err().code,
            "plugin_source_invalid"
        );
    }

    #[test]
    fn builds_the_official_archive_url() {
        let value = source("https://github.com/Mr-BeanSir/GodGesture-Plugins");
        assert!(validate_source(&value).is_ok());
        assert_eq!(
            github_archive_url(&value).unwrap().as_str(),
            "https://api.github.com/repos/Mr-BeanSir/GodGesture-Plugins/zipball/main"
        );
    }

    #[test]
    fn rejects_traversal_subdirectories_and_refs() {
        let mut value = source("https://github.com/Mr-BeanSir/GodGesture-Plugins");
        value.subdirectory = "../outside".into();
        assert!(validate_source(&value).is_err());
        value.subdirectory = "plugins/demo".into();
        value.git_ref = "feature..bad".into();
        assert!(validate_source(&value).is_err());
    }

    #[test]
    fn online_install_runs_the_bundled_npm_cli_with_the_bundled_node_binary() {
        let toolchain = NodeToolchain {
            node: PathBuf::from("bundled-node"),
            npm: PathBuf::from("bundled/npm/bin/npm-cli.js"),
            pnpm: PathBuf::from("unused-pnpm"),
            supervisor: PathBuf::from("unused-supervisor"),
            typescript: PathBuf::from("unused-typescript"),
        };

        let command = npm_command(&toolchain);

        assert_eq!(command.get_program(), OsStr::new("bundled-node"));
        assert_eq!(
            command.get_args().next(),
            Some(OsStr::new("bundled/npm/bin/npm-cli.js"))
        );
    }

    #[test]
    fn process_output_reader_keeps_only_a_bounded_prefix() {
        let source = vec![b'x'; MAX_OUTPUT_BYTES + 8192];
        let retained = read_bounded_output(Cursor::new(source));
        assert_eq!(retained.len(), MAX_OUTPUT_BYTES);
    }

    #[test]
    fn restores_the_previous_project_after_rejecting_an_activated_project() {
        let root = TestDir::new();
        let target = root.0.join("plugin");
        let backup = root.0.join("previous");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("index.mjs"), "old").unwrap();
        fs::rename(&target, &backup).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("index.mjs"), "new").unwrap();

        restore_previous_project(&target, &backup, true).unwrap();

        assert_eq!(fs::read_to_string(target.join("index.mjs")).unwrap(), "old");
        assert!(!backup.exists());
    }

    #[test]
    fn retains_the_backup_when_the_activated_target_cannot_be_removed() {
        let root = TestDir::new();
        let target = root.0.join("plugin");
        let backup = root.0.join("previous");
        fs::write(&target, "unexpected file").unwrap();
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("index.mjs"), "old").unwrap();

        assert!(restore_previous_project(&target, &backup, true).is_err());

        assert!(target.is_file());
        assert_eq!(fs::read_to_string(backup.join("index.mjs")).unwrap(), "old");
    }
}

//! User-initiated Node plugin dependency preparation.

use super::config::NodePlugin;
use super::node_toolchain::NodeToolchain;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const OPERATION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_OUTPUT_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePackageResult {
    pub lockfile: Option<String>,
    pub output: String,
    pub ready: bool,
}

pub fn install_plugin(
    workspace: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
) -> Result<NodePackageResult, String> {
    validate_plugin(plugin)?;
    let operation_root = workspace
        .join(".operations")
        .join(uuid::Uuid::new_v4().to_string());
    let store = workspace.join(".pnpm-store");
    fs::create_dir_all(&operation_root)
        .map_err(|error| format!("create package workspace: {error}"))?;
    fs::create_dir_all(&store).map_err(|error| format!("create package store: {error}"))?;

    let result = install_inner(&operation_root, &store, toolchain, plugin);
    let _ = fs::remove_dir_all(&operation_root);
    result
}

fn install_inner(
    root: &Path,
    store: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
) -> Result<NodePackageResult, String> {
    fs::write(root.join("package.json"), &plugin.package_json)
        .map_err(|error| format!("write package.json: {error}"))?;
    if let Some(lockfile) = &plugin.lockfile {
        fs::write(root.join("pnpm-lock.yaml"), lockfile)
            .map_err(|error| format!("write pnpm-lock.yaml: {error}"))?;
    }
    for (path, source) in &plugin.files {
        let destination = root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create source directory '{path}': {error}"))?;
        }
        fs::write(destination, source)
            .map_err(|error| format!("write source file '{path}': {error}"))?;
    }

    let mut output = String::new();
    let mut resolve_args = vec![
        "install".into(),
        "--lockfile-only".into(),
        "--store-dir".into(),
        store.as_os_str().to_owned(),
        "--reporter=append-only".into(),
    ];
    if !plugin.allow_lifecycle_scripts {
        resolve_args.push("--ignore-scripts".into());
    }
    let resolved = run_command(
        super::node_toolchain::pnpm_command(&toolchain.node, &toolchain.pnpm),
        &resolve_args,
        root,
    )?;
    append_output(&mut output, &resolved);
    if !resolved.status.success() {
        return Err(format!("pnpm lockfile resolution failed:\n{output}"));
    }

    let mut install_args = vec![
        "install".into(),
        "--offline".into(),
        "--frozen-lockfile".into(),
        "--prod".into(),
        "--store-dir".into(),
        store.as_os_str().to_owned(),
        "--reporter=append-only".into(),
    ];
    if !plugin.allow_lifecycle_scripts {
        install_args.push("--ignore-scripts".into());
    }
    let installed = run_command(
        super::node_toolchain::pnpm_command(&toolchain.node, &toolchain.pnpm),
        &install_args,
        root,
    )?;
    append_output(&mut output, &installed);
    if !installed.status.success() {
        return Err(format!("offline package install failed:\n{output}"));
    }

    write_builtin_sdk(root)?;
    let entry = root.join(plugin.entry.replace('/', std::path::MAIN_SEPARATOR_STR));
    let smoke_args: Vec<std::ffi::OsString> = vec![
        "--input-type=module".into(),
        "--eval".into(),
        "const { pathToFileURL } = await import('node:url'); await import(pathToFileURL(process.argv[1]).href);".into(),
        entry.as_os_str().to_owned(),
    ];
    let smoke = run_command(Command::new(&toolchain.node), &smoke_args, root)?;
    append_output(&mut output, &smoke);
    if !smoke.status.success() {
        return Err(format!("plugin import check failed:\n{output}"));
    }

    let lockfile = fs::read_to_string(root.join("pnpm-lock.yaml"))
        .map_err(|error| format!("read generated lockfile: {error}"))?;
    Ok(NodePackageResult {
        lockfile: Some(lockfile),
        output,
        ready: true,
    })
}

pub fn write_builtin_sdk(project_root: &Path) -> Result<(), String> {
    let sdk_root = project_root
        .join("node_modules")
        .join("@godgesture")
        .join("sdk");
    fs::create_dir_all(&sdk_root).map_err(|error| format!("create built-in SDK: {error}"))?;
    fs::write(
        sdk_root.join("package.json"),
        r#"{"name":"@godgesture/sdk","type":"module","exports":"./index.mjs"}"#,
    )
    .map_err(|error| format!("write built-in SDK manifest: {error}"))?;
    fs::write(
        sdk_root.join("index.mjs"),
        include_str!("../../../node-host/sdk.mjs"),
    )
    .map_err(|error| format!("write built-in SDK runtime: {error}"))
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
        .map_err(|error| format!("start bundled Node command: {error}"))?;
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::BufReader::new(stdout).read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::BufReader::new(stderr).read_to_end(&mut bytes);
        bytes
    });
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("wait for bundled Node command: {error}"))?
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
                .map_err(|error| format!("wait for timed out Node command: {error}"))?;
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!(
                "bundled Node command exceeded {} seconds (status {status})",
                OPERATION_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn append_output(output: &mut String, command: &Output) {
    if output.len() >= MAX_OUTPUT_BYTES {
        return;
    }
    let remaining = MAX_OUTPUT_BYTES - output.len();
    let mut bytes = Vec::with_capacity(command.stdout.len() + command.stderr.len());
    bytes.extend_from_slice(&command.stdout);
    bytes.extend_from_slice(&command.stderr);
    let text = String::from_utf8_lossy(&bytes);
    let mut end = text.len().min(remaining);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    output.push_str(&text[..end]);
}

fn validate_plugin(plugin: &NodePlugin) -> Result<(), String> {
    uuid::Uuid::parse_str(&plugin.id).map_err(|_| "plugin id must be a UUID".to_string())?;
    if plugin.files.len() > 64 || !plugin.files.contains_key(&plugin.entry) {
        return Err("plugin files or entry are invalid".into());
    }
    if plugin.files.values().map(String::len).sum::<usize>() > 1024 * 1024 {
        return Err("plugin source exceeds 1 MiB".into());
    }
    let manifest: serde_json::Value = serde_json::from_str(&plugin.package_json)
        .map_err(|error| format!("invalid package.json: {error}"))?;
    if manifest.get("type").and_then(serde_json::Value::as_str) != Some("module") {
        return Err("package.json must set type to module".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn output_is_bounded() {
        let mut output = String::new();
        append_output(
            &mut output,
            &Output {
                status: std::process::ExitStatus::default(),
                stdout: vec![b'x'; MAX_OUTPUT_BYTES + 100],
                stderr: Vec::new(),
            },
        );
        assert_eq!(output.len(), MAX_OUTPUT_BYTES);
    }

    #[test]
    fn rejects_invalid_manifest() {
        let plugin = NodePlugin {
            id: "30000000-0000-4000-8000-000000000001".into(),
            name: "test".into(),
            entry: "index.mjs".into(),
            files: HashMap::from([(String::from("index.mjs"), String::new())]),
            package_json: "{}".into(),
            lockfile: None,
            allow_lifecycle_scripts: false,
        };
        assert!(validate_plugin(&plugin).is_err());
    }
}

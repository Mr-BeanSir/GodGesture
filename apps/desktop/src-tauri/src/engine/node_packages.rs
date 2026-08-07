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

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTestResult {
    pub output: String,
    pub ready: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTypecheckDiagnostic {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTypecheckResult {
    pub output: String,
    pub ready: bool,
    pub diagnostics: Vec<NodeTypecheckDiagnostic>,
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
    let store = super::node_toolchain::platform_cache_root(workspace).join(".pnpm-store");
    fs::create_dir_all(&operation_root)
        .map_err(|error| format!("create package workspace: {error}"))?;
    fs::create_dir_all(&store).map_err(|error| format!("create package store: {error}"))?;

    let result = install_inner(&operation_root, &store, toolchain, plugin, true);
    let _ = fs::remove_dir_all(&operation_root);
    result
}

pub fn test_plugin(
    workspace: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
    handler: &str,
) -> Result<NodeTestResult, String> {
    let mut characters = handler.chars();
    let valid_handler = characters
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic() || matches!(character, '_' | '$'))
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '$'));
    if !valid_handler {
        return Err("handler export name is invalid".into());
    }
    validate_plugin(plugin)?;
    let operation_root = workspace
        .join(".operations")
        .join(uuid::Uuid::new_v4().to_string());
    let store = super::node_toolchain::platform_cache_root(workspace).join(".pnpm-store");
    fs::create_dir_all(&operation_root)
        .map_err(|error| format!("create test workspace: {error}"))?;
    fs::create_dir_all(&store).map_err(|error| format!("create test package store: {error}"))?;
    let result = test_inner(&operation_root, &store, toolchain, plugin, handler);
    let _ = fs::remove_dir_all(&operation_root);
    result
}

pub fn typecheck_plugin(
    workspace: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
) -> Result<NodeTypecheckResult, String> {
    validate_plugin(plugin)?;
    let operation_root = workspace
        .join(".operations")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&operation_root)
        .map_err(|error| format!("create typecheck workspace: {error}"))?;
    let result = typecheck_inner(&operation_root, toolchain, plugin);
    let _ = fs::remove_dir_all(&operation_root);
    result
}

fn typecheck_inner(
    root: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
) -> Result<NodeTypecheckResult, String> {
    write_plugin_project(root, plugin)?;
    write_builtin_sdk(root)?;
    write_builtin_sdk_types(root)?;
    copy_toolchain_types(root, toolchain)?;
    let config = serde_json::json!({
        "compilerOptions": {
            "target": "ES2022",
            "module": "NodeNext",
            "moduleResolution": "NodeNext",
            "allowJs": true,
            "checkJs": true,
            "noEmit": true,
            "strict": true,
            "skipLibCheck": true,
            "resolveJsonModule": true,
            "types": ["node"]
        },
        "include": ["**/*.mjs", "**/*.js", "**/*.ts"]
    });
    fs::write(
        root.join("tsconfig.json"),
        serde_json::to_vec_pretty(&config).unwrap(),
    )
    .map_err(|error| format!("write typecheck config: {error}"))?;
    let args: Vec<std::ffi::OsString> = vec![
        toolchain.typescript.as_os_str().to_owned(),
        "--project".into(),
        root.join("tsconfig.json").as_os_str().to_owned(),
        "--pretty".into(),
        "false".into(),
    ];
    let output = run_command(Command::new(&toolchain.node), &args, root)?;
    let mut text = String::new();
    append_output(&mut text, &output);
    let diagnostics = parse_typecheck_diagnostics(&text);
    Ok(NodeTypecheckResult {
        output: text,
        ready: output.status.success() && diagnostics.iter().all(|item| item.severity != "error"),
        diagnostics,
    })
}

fn write_builtin_sdk_types(project_root: &Path) -> Result<(), String> {
    let sdk_root = project_root
        .join("node_modules")
        .join("@godgesture")
        .join("sdk");
    fs::write(
        sdk_root.join("index.d.ts"),
        include_str!("../../../script-api/godgesture-sdk.d.ts"),
    )
    .map_err(|error| format!("write built-in SDK types: {error}"))
}

fn copy_toolchain_types(project_root: &Path, toolchain: &NodeToolchain) -> Result<(), String> {
    let target_root = toolchain
        .typescript
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| "resolve bundled TypeScript root".to_string())?;
    let source = target_root.join("node_modules");
    if !source.is_dir() {
        return Ok(());
    }
    copy_directory(&source, &project_root.join("node_modules"))
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| format!("create type directory: {error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("read type directory: {error}"))? {
        let entry = entry.map_err(|error| format!("read type entry: {error}"))?;
        let path = entry.path();
        let target = destination.join(entry.file_name());
        if path.is_dir() {
            copy_directory(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|error| format!("copy type file: {error}"))?;
        }
    }
    Ok(())
}

fn parse_typecheck_diagnostics(output: &str) -> Vec<NodeTypecheckDiagnostic> {
    output
        .lines()
        .filter_map(|line| {
            let (location, rest) = line
                .split_once(": error TS")
                .or_else(|| line.split_once(": warning TS"))?;
            let severity = if line.contains(": warning TS") {
                "warning"
            } else {
                "error"
            };
            let (file, coordinates) = location.rsplit_once('(')?;
            let coordinates = coordinates.strip_suffix(')')?;
            let mut parts = coordinates.split(',');
            let line_number = parts.next()?.parse().ok()?;
            let column = parts.next()?.parse().ok()?;
            let message = rest
                .split_once(": ")
                .map(|(_, value)| value)
                .unwrap_or(rest)
                .to_string();
            Some(NodeTypecheckDiagnostic {
                file: file.replace('\\', "/"),
                line: line_number,
                column,
                severity: severity.into(),
                message,
            })
        })
        .collect()
}

fn test_inner(
    root: &Path,
    store: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
    handler: &str,
) -> Result<NodeTestResult, String> {
    let has_dependencies = serde_json::from_str::<serde_json::Value>(&plugin.package_json)
        .ok()
        .is_some_and(|manifest| {
            ["dependencies", "optionalDependencies"].iter().any(|key| {
                manifest
                    .get(key)
                    .and_then(serde_json::Value::as_object)
                    .is_some_and(|items| !items.is_empty())
            })
        });
    let prepared = if plugin.lockfile.is_some() {
        install_inner(root, store, toolchain, plugin, false)?
    } else if has_dependencies {
        return Err(
            "plugin dependencies have no lockfile; generate the lockfile before testing".into(),
        );
    } else {
        write_plugin_project(root, plugin)?;
        write_builtin_sdk(root)?;
        NodePackageResult {
            lockfile: None,
            output: String::new(),
            ready: true,
        }
    };
    let runner = root.join(".godgesture-test-runner.mjs");
    fs::write(&runner, include_str!("../../../node-host/test-runner.mjs"))
        .map_err(|error| format!("write Node test runner: {error}"))?;
    let entry = root.join(plugin.entry.replace('/', std::path::MAIN_SEPARATOR_STR));
    let args: Vec<std::ffi::OsString> = vec![
        runner.as_os_str().to_owned(),
        entry.as_os_str().to_owned(),
        handler.into(),
    ];
    let output = run_command(Command::new(&toolchain.node), &args, root)?;
    let mut text = String::new();
    append_output(&mut text, &output);
    if !output.status.success() {
        return Err(format!("plugin test failed:\n{text}"));
    }
    Ok(NodeTestResult {
        output: format!("lockfile ready: {}\n{text}", prepared.lockfile.is_some()),
        ready: true,
    })
}

fn install_inner(
    root: &Path,
    store: &Path,
    toolchain: &NodeToolchain,
    plugin: &NodePlugin,
    resolve_lockfile: bool,
) -> Result<NodePackageResult, String> {
    write_plugin_project(root, plugin)?;
    if let Some(lockfile) = &plugin.lockfile {
        fs::write(root.join("pnpm-lock.yaml"), lockfile)
            .map_err(|error| format!("write pnpm-lock.yaml: {error}"))?;
    }
    let mut output = String::new();
    if resolve_lockfile {
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
    } else if !root.join("pnpm-lock.yaml").is_file() {
        return Err("plugin lockfile is missing".into());
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

fn write_plugin_project(root: &Path, plugin: &NodePlugin) -> Result<(), String> {
    fs::write(root.join("package.json"), &plugin.package_json)
        .map_err(|error| format!("write package.json: {error}"))?;
    for (path, source) in &plugin.files {
        let destination = root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create source directory '{path}': {error}"))?;
        }
        fs::write(destination, source)
            .map_err(|error| format!("write source file '{path}': {error}"))?;
    }
    Ok(())
}

pub fn write_builtin_sdk(project_root: &Path) -> Result<(), String> {
    let sdk_root = project_root
        .join("node_modules")
        .join("@godgesture")
        .join("sdk");
    fs::create_dir_all(&sdk_root).map_err(|error| format!("create built-in SDK: {error}"))?;
    fs::write(
        sdk_root.join("package.json"),
        r#"{"name":"@godgesture/sdk","type":"module","types":"./index.d.ts","exports":{"types":"./index.d.ts","import":"./index.mjs"}}"#,
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
    let stdout_reader = thread::spawn(move || read_bounded_output(std::io::BufReader::new(stdout)));
    let stderr_reader = thread::spawn(move || read_bounded_output(std::io::BufReader::new(stderr)));
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
    use std::io::Cursor;
    use std::path::PathBuf;

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
    fn process_output_reader_keeps_only_a_bounded_prefix() {
        let source = vec![b'x'; MAX_OUTPUT_BYTES + 8192];
        let retained = read_bounded_output(Cursor::new(source));
        assert_eq!(retained.len(), MAX_OUTPUT_BYTES);
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
            npm_lockfile: None,
            allow_lifecycle_scripts: false,
            actions: Vec::new(),
        };
        assert!(validate_plugin(&plugin).is_err());
    }

    #[test]
    fn dry_run_executes_a_real_node_handler() {
        let workspace =
            std::env::temp_dir().join(format!("godgesture-node-test-{}", uuid::Uuid::new_v4()));
        let plugin = NodePlugin {
            id: "30000000-0000-4000-8000-000000000001".into(),
            name: "test".into(),
            entry: "index.mjs".into(),
            files: HashMap::from([(
                String::from("index.mjs"),
                "export async function onExecute(context) { await context.input.sendText(context.phase); }"
                    .into(),
            )]),
            package_json: r#"{"private":true,"type":"module"}"#.into(),
            lockfile: None,
            npm_lockfile: None,
            allow_lifecycle_scripts: false,
            actions: Vec::new(),
        };
        let toolchain = NodeToolchain {
            node: PathBuf::from("node"),
            npm: PathBuf::from("npm"),
            pnpm: PathBuf::from("pnpm"),
            supervisor: PathBuf::from("unused"),
            typescript: PathBuf::from("typescript/lib/tsc.js"),
        };
        let result = test_plugin(&workspace, &toolchain, &plugin, "onExecute");
        let _ = fs::remove_dir_all(&workspace);
        let result = result.expect("Node dry-run should execute with the development toolchain");
        assert!(result.ready);
        assert!(result.output.contains("input.sendText"));
        assert!(result.output.contains("onExecute"));
    }

    #[test]
    fn dry_run_requires_a_lockfile_for_external_dependencies() {
        let workspace =
            std::env::temp_dir().join(format!("godgesture-node-test-{}", uuid::Uuid::new_v4()));
        let plugin = NodePlugin {
            id: "30000000-0000-4000-8000-000000000001".into(),
            name: "test".into(),
            entry: "index.mjs".into(),
            files: HashMap::from([(
                String::from("index.mjs"),
                "export async function onExecute() {}".into(),
            )]),
            package_json: r#"{"private":true,"type":"module","dependencies":{"zod":"4.4.3"}}"#
                .into(),
            lockfile: None,
            npm_lockfile: None,
            allow_lifecycle_scripts: false,
            actions: Vec::new(),
        };
        let toolchain = NodeToolchain {
            node: PathBuf::from("unused-node"),
            npm: PathBuf::from("unused-npm"),
            pnpm: PathBuf::from("unused-pnpm"),
            supervisor: PathBuf::from("unused"),
            typescript: PathBuf::from("typescript/lib/tsc.js"),
        };
        let result = test_plugin(&workspace, &toolchain, &plugin, "onExecute");
        let _ = fs::remove_dir_all(&workspace);
        assert_eq!(
            result.unwrap_err(),
            "plugin dependencies have no lockfile; generate the lockfile before testing"
        );
    }

    #[test]
    fn parses_tsc_diagnostics_with_stable_locations() {
        let diagnostics = parse_typecheck_diagnostics(
            "src/index.mjs(4,7): error TS2304: Cannot find name 'missing'.\nsrc/index.mjs(5,1): warning TS6133: unused.",
        );
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].file, "src/index.mjs");
        assert_eq!(diagnostics[0].line, 4);
        assert_eq!(diagnostics[0].column, 7);
        assert_eq!(diagnostics[1].severity, "warning");
    }
}

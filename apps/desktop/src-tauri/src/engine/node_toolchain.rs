//! Resolve the Node.js, npm, and pnpm binaries shipped with the desktop bundle.

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeToolchain {
    pub node: PathBuf,
    pub npm: PathBuf,
    pub pnpm: PathBuf,
    pub supervisor: PathBuf,
    pub typescript: PathBuf,
}

/// Keep native package artifacts isolated when a synced profile is used by
/// different operating systems or CPU architectures.
pub fn platform_cache_root(workspace: &Path) -> PathBuf {
    workspace.join(format!(
        "{}-{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ))
}

pub fn target_name() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("windows-x64"),
        ("macos", "x86_64") => Ok("macos-x64"),
        ("macos", "aarch64") => Ok("macos-arm64"),
        (os, arch) => Err(format!("unsupported Node toolchain platform {os}/{arch}")),
    }
}

pub fn from_resource_root(resource_root: &Path) -> Result<NodeToolchain, String> {
    let target = target_name()?;
    let root = resource_root.join("node-toolchain").join(target);
    let node = root.join(if target.starts_with("windows") {
        "node.exe"
    } else {
        "node"
    });
    let npm = root.join("npm").join("bin").join("npm-cli.js");
    let pnpm = root.join("pnpm").join("bin").join("pnpm.cjs");
    let supervisor = root.join("supervisor.mjs");
    let typescript = root.join("typescript").join("lib").join("tsc.js");
    for (name, path) in [
        ("Node.js", &node),
        ("npm", &npm),
        ("pnpm", &pnpm),
        ("Node supervisor", &supervisor),
        ("TypeScript compiler", &typescript),
    ] {
        if !path.is_file() {
            return Err(format!("bundled {name} is missing: {}", path.display()));
        }
    }
    Ok(NodeToolchain {
        node,
        npm,
        pnpm,
        supervisor,
        typescript,
    })
}

pub fn npm_command(node: &Path, npm: &Path) -> Command {
    command_for_javascript(node, npm)
}

pub fn pnpm_command(node: &Path, pnpm: &Path) -> Command {
    command_for_javascript(node, pnpm)
}

fn command_for_javascript(node: &Path, script: &Path) -> Command {
    let is_script = script
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "cjs" | "mjs" | "js"
            )
        });
    if is_script {
        let mut command = Command::new(node);
        command.arg(script);
        command
    } else {
        Command::new(script)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::fs;

    #[test]
    fn target_name_is_supported_on_this_build_platform() {
        assert!(target_name().is_ok());
    }

    #[test]
    fn resource_resolution_requires_all_runtime_files() {
        let root =
            std::env::temp_dir().join(format!("godgesture-toolchain-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let runtime = root.join("node-toolchain").join(target_name().unwrap());
        let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
        for path in [
            node,
            runtime.join("pnpm").join("bin").join("pnpm.cjs"),
            runtime.join("supervisor.mjs"),
            runtime.join("typescript").join("lib").join("tsc.js"),
        ] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        let error = from_resource_root(&root).unwrap_err();
        assert!(error.contains("bundled npm is missing"));
        let npm = runtime.join("npm").join("bin").join("npm-cli.js");
        fs::create_dir_all(npm.parent().unwrap()).unwrap();
        fs::write(&npm, "").unwrap();
        let toolchain = from_resource_root(&root).unwrap();
        assert_eq!(toolchain.npm, npm);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bundled_npm_runs_through_the_bundled_node_binary() {
        let command = npm_command(Path::new("bundled-node"), Path::new("npm/bin/npm-cli.js"));
        assert_eq!(command.get_program(), OsStr::new("bundled-node"));
        assert_eq!(
            command.get_args().next(),
            Some(OsStr::new("npm/bin/npm-cli.js"))
        );
    }

    #[test]
    fn cache_root_includes_build_platform_and_architecture() {
        let root = Path::new("workspace");
        assert_eq!(
            platform_cache_root(root),
            root.join(format!(
                "{}-{}",
                std::env::consts::OS,
                std::env::consts::ARCH
            ))
        );
    }
}

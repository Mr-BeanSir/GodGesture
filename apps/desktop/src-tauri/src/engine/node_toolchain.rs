//! Resolve the Node.js and pnpm binaries shipped with the desktop bundle.

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeToolchain {
    pub node: PathBuf,
    pub pnpm: PathBuf,
    pub supervisor: PathBuf,
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
    let pnpm = root.join("pnpm").join("bin").join("pnpm.cjs");
    let supervisor = root.join("supervisor.mjs");
    for (name, path) in [
        ("Node.js", &node),
        ("pnpm", &pnpm),
        ("Node supervisor", &supervisor),
    ] {
        if !path.is_file() {
            return Err(format!("bundled {name} is missing: {}", path.display()));
        }
    }
    Ok(NodeToolchain {
        node,
        pnpm,
        supervisor,
    })
}

pub fn pnpm_command(node: &Path, pnpm: &Path) -> Command {
    let is_script = pnpm
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
        command.arg(pnpm);
        command
    } else {
        Command::new(pnpm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let error = from_resource_root(&root).unwrap_err();
        assert!(error.contains("bundled"));
        fs::remove_dir_all(root).unwrap();
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

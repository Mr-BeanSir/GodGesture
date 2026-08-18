import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import semver from "semver";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RELEASE_INCREMENT_SELECTORS = new Set(["patch", "minor", "major"]);
const RELEASE_IT_OPTION_ALIASES = new Map([
  ["c", "config"],
  ["i", "increment"],
]);
const RELEASE_IT_VALUE_OPTIONS = new Set([
  "config",
  "configDir",
  "extends",
  "increment",
  "preRelease",
  "snapshot",
  "preReleaseBase",
  "preReleaseId",
  "git.changelog",
  "git.commitsPath",
  "git.commitMessage",
  "git.pushRepo",
  "git.tagAnnotation",
  "git.tagExclude",
  "git.tagMatch",
  "git.tagName",
  "git.commitArgs",
  "git.requireBranch",
  "git.pushArgs",
  "git.tagArgs",
  "npm.otp",
  "npm.publishPackageManager",
  "npm.publishPath",
  "npm.tag",
  "npm.timeout",
  "npm.publishArgs",
  "npm.versionArgs",
  "github.comments.issue",
  "github.comments.pr",
  "github.host",
  "github.proxy",
  "github.releaseName",
  "github.releaseNotes",
  "github.releaseNotes.commit",
  "github.discussionCategoryName",
  "github.makeLatest",
  "github.timeout",
  "github.tokenRef",
  "github.assets",
  "github.releaseNotes.excludeMatches",
  "gitlab.certificateAuthorityFile",
  "gitlab.certificateAuthorityFileRef",
  "gitlab.genericPackageRepositoryName",
  "gitlab.origin",
  "gitlab.releaseName",
  "gitlab.releaseNotes",
  "gitlab.repoId",
  "gitlab.tokenHeader",
  "gitlab.tokenRef",
  "gitlab.assets",
  "gitlab.milestones",
]);
const PROTECTED_PUBLICATION_OPTIONS = new Set([
  "npm",
  "npm.publish",
  "github",
  "github.release",
]);

export function parseReleaseArguments(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("Release arguments must be an array of strings");
  }

  const positional = [];
  let optionTerminated = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionTerminated) {
      positional.push({ arg, index });
      continue;
    }
    if (arg === "--") {
      optionTerminated = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      positional.push({ arg, index });
      continue;
    }

    const option = parseOptionToken(arg);
    if (option && PROTECTED_PUBLICATION_OPTIONS.has(option.name)) {
      throw new Error(
        `Release CLI option "${arg}" is forbidden: npm and GitHub publication settings are fixed by repository configuration`,
      );
    }

    if (
      option &&
      !option.inlineValue &&
      RELEASE_IT_VALUE_OPTIONS.has(option.name) &&
      args[index + 1] !== undefined &&
      !args[index + 1].startsWith("-")
    ) {
      index += 1;
    }
  }

  if (positional.length === 0) {
    throw new Error(
      "A version selector is required: patch, minor, major, or a full SemVer",
    );
  }
  if (positional.length !== 1) {
    throw new Error("Provide exactly one version selector");
  }

  const [{ arg: selector, index }] = positional;
  if (!isReleaseSelector(selector)) {
    throw new Error(
      `Invalid release selector "${selector}"; use patch, minor, major, or a full SemVer`,
    );
  }

  return {
    selector,
    releaseItArgs: args.filter((_, argIndex) => argIndex !== index),
  };
}

function parseOptionToken(arg) {
  if (!arg.startsWith("-")) return null;
  const token = arg.replace(/^-+/, "");
  const separatorIndex = token.indexOf("=");
  const rawName = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
  const aliasedName = RELEASE_IT_OPTION_ALIASES.get(rawName) ?? rawName;
  const name = aliasedName.startsWith("no-")
    ? aliasedName.slice(3)
    : aliasedName;
  return { name, inlineValue: separatorIndex !== -1 };
}

export function resolveReleaseVersion(currentVersion, requested) {
  const current = semver.valid(currentVersion);
  if (!current) {
    throw new Error(`Current version is not valid SemVer: ${currentVersion}`);
  }
  if (!isReleaseSelector(requested)) {
    throw new Error(
      `Requested version must be a valid release selector (patch, minor, major, or full SemVer): ${requested}`,
    );
  }

  const target = RELEASE_INCREMENT_SELECTORS.has(requested)
    ? semver.inc(current, requested)
    : semver.valid(requested);
  if (!target) {
    throw new Error(`Requested version is not valid SemVer: ${requested}`);
  }
  if (!semver.gt(target, current)) {
    throw new Error(
      `Requested release version ${target} must be greater than current version ${current}`,
    );
  }
  return target;
}

export async function readReleaseState(root, { runGit = defaultRunGit, targetVersion } = {}) {
  const repositoryRoot = resolve(root);
  const [rootVersion, desktopVersion, tauriVersion, cargoVersion] =
    await Promise.all([
      readJsonVersion(join(repositoryRoot, "package.json"), "root package"),
      readJsonVersion(
        join(repositoryRoot, "apps", "desktop", "package.json"),
        "Desktop package",
      ),
      readJsonVersion(
        join(repositoryRoot, "apps", "desktop", "src-tauri", "tauri.conf.json"),
        "Tauri configuration",
      ),
      readCargoVersion(
        join(repositoryRoot, "apps", "desktop", "src-tauri", "Cargo.toml"),
      ),
    ]);

  const versions = { rootVersion, desktopVersion, tauriVersion, cargoVersion };
  if (new Set(Object.values(versions)).size !== 1) {
    throw new Error(
      `Desktop release version mismatch: ${Object.entries(versions)
        .map(([field, version]) => `${field}=${version}`)
        .join(", ")}`,
    );
  }

  const status = await runGit(["status", "--porcelain=v1"], repositoryRoot);
  return {
    ...versions,
    targetTag: `v${targetVersion ?? rootVersion}`,
    worktreeClean: String(status).length === 0,
  };
}

export async function assertReleasePreconditions(
  root,
  state,
  targetVersion,
  { runGit = defaultRunGit } = {},
) {
  if (!state.worktreeClean) {
    throw new Error("Release requires a clean top-level worktree");
  }

  const repositoryRoot = resolve(root);
  const targetTag = `v${targetVersion}`;
  const matchingTags = await runGit(["tag", "--list", targetTag], repositoryRoot);
  if (String(matchingTags).trim().length > 0) {
    throw new Error(`Release tag ${targetTag} already exists`);
  }
  return targetTag;
}

export function pnpmInvocation(
  args,
  { platform = process.platform, systemRoot = process.env.SystemRoot ?? process.env.windir } = {},
) {
  if (platform !== "win32") {
    return { command: "pnpm", args };
  }

  const script = [
    "$LASTEXITCODE = $null;",
    "& 'pnpm'",
    ...args.map(quotePowerShellLiteral),
    "; $commandSucceeded = $?;",
    "$exitCode = $LASTEXITCODE;",
    "if (-not $commandSucceeded -and $null -eq $exitCode) { exit 1 };",
    "if ($null -eq $exitCode) { exit 0 };",
    "exit $exitCode",
  ].join(" ");

  return {
    command: powerShellPath(systemRoot),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
  };
}

export async function runRelease(
  args = process.argv.slice(2),
  {
    root = REPOSITORY_ROOT,
    runGit = defaultRunGit,
    spawnProcess = spawn,
    platform = process.platform,
    systemRoot = process.env.SystemRoot ?? process.env.windir,
  } = {},
) {
  const { selector, releaseItArgs } = parseReleaseArguments(args);
  const state = await readReleaseState(root, { runGit });
  const targetVersion = resolveReleaseVersion(state.rootVersion, selector);
  const targetTag = await assertReleasePreconditions(root, state, targetVersion, {
    runGit,
  });

  console.log(`Release target: ${targetVersion} (${targetTag})`);
  const releaseItFlags = shouldUseNonInteractiveDryRun(releaseItArgs)
    ? [...releaseItArgs, "--ci"]
    : releaseItArgs;
  const invocation = pnpmInvocation([
    "exec",
    "release-it",
    targetVersion,
    ...releaseItFlags,
  ], { platform, systemRoot });
  return spawnReleaseIt(root, invocation, spawnProcess);
}

async function readJsonVersion(path, label) {
  const contents = await readFile(path, "utf8");
  const value = JSON.parse(contents).version;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} does not contain a version string`);
  }
  return value;
}

async function readCargoVersion(path) {
  const contents = await readFile(path, "utf8");
  const packageSection = contents.match(
    /(?:^|\r?\n)\s*\[package\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[[^\]]+\]|\s*$)/,
  );
  const version = packageSection?.[1].match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) {
    throw new Error(`${path} does not contain a [package] version string`);
  }
  return version;
}

async function defaultRunGit(args, cwd) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return stdout;
}

function spawnReleaseIt(root, invocation, spawnProcess) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      cwd: resolve(root),
      env: { ...process.env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `release-it failed${signal ? ` (${signal})` : ` (code ${code ?? 1})`}`,
        ),
      );
    });
  });
}

function isReleaseSelector(value) {
  return (
    typeof value === "string" &&
    (RELEASE_INCREMENT_SELECTORS.has(value) || semver.valid(value) !== null)
  );
}

function shouldUseNonInteractiveDryRun(args) {
  const isDryRun = args.some(
    (arg) => arg === "--dry-run" || arg === "-d" || arg === "--dry-run=true",
  );
  const hasExplicitCiChoice = args.some(
    (arg) => arg === "--ci" || arg === "--no-ci",
  );
  return isDryRun && !hasExplicitCiChoice;
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function powerShellPath(systemRoot = process.env.SystemRoot ?? process.env.windir) {
  if (!systemRoot) return "powershell.exe";
  return win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (import.meta.url === invokedPath) {
  runRelease().catch((error) => {
    console.error(`[GodGesture] ${error.message}`);
    process.exitCode = 1;
  });
}

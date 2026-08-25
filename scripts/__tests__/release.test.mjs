import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import {
  assertReleasePreconditions,
  parseReleaseArguments,
  readReleaseState,
  resolveReleaseVersion,
  runRelease,
} from "../release.mjs";

test("resolves patch, minor, major, and explicit versions", () => {
  assert.equal(resolveReleaseVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(resolveReleaseVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(resolveReleaseVersion("0.1.0", "major"), "1.0.0");
  assert.equal(resolveReleaseVersion("0.1.0", "0.2.0"), "0.2.0");
});

test("requires exactly one selector", () => {
  assert.throws(() => parseReleaseArguments([]), /version selector/i);
  assert.throws(
    () => parseReleaseArguments(["patch", "minor"]),
    /one version selector/i,
  );
  assert.deepEqual(parseReleaseArguments(["patch", "--dry-run"]), {
    selector: "patch",
    releaseItArgs: ["--dry-run"],
  });
  assert.throws(() => parseReleaseArguments(["--dry-run"]), /version selector/i);
});

test("rejects npm publication overrides before reading release state", async () => {
  for (const args of [
    ["--npm", "patch"],
    ["patch", "--npm.publish"],
    ["--no-npm", "patch"],
    ["patch", "--npm.publish=true"],
  ]) {
    await assert.rejects(
      runRelease(args, {
        root: join(tmpdir(), "release-argument-test-does-not-exist"),
        runGit: async () => {
          throw new Error("git must not run for a rejected publication option");
        },
        spawnProcess: () => {
          throw new Error("release-it must not run for a rejected publication option");
        },
      }),
      /publication|npm/i,
    );
  }
});

test("rejects GitHub publication overrides before reading release state", async () => {
  for (const args of [
    ["--github", "patch"],
    ["patch", "--github.release"],
    ["--github.release=true", "patch"],
    ["patch", "--no-github"],
    ["patch", "--no-github.release"],
  ]) {
    await assert.rejects(
      runRelease(args, {
        root: join(tmpdir(), "release-argument-test-does-not-exist"),
        runGit: async () => {
          throw new Error("git must not run for a rejected publication option");
        },
        spawnProcess: () => {
          throw new Error("release-it must not run for a rejected publication option");
        },
      }),
      /publication|GitHub|github/i,
    );
  }
});

test("keeps independent option values out of version selector parsing", () => {
  assert.deepEqual(
    parseReleaseArguments(["--config", "release.config.js", "patch"]),
    {
      selector: "patch",
      releaseItArgs: ["--config", "release.config.js"],
    },
  );
  assert.deepEqual(
    parseReleaseArguments(["minor", "--preRelease", "rc", "--dry-run"]),
    {
      selector: "minor",
      releaseItArgs: ["--preRelease", "rc", "--dry-run"],
    },
  );
  assert.deepEqual(
    parseReleaseArguments(["--config=release.config.js", "--preRelease=rc", "major"]),
    {
      selector: "major",
      releaseItArgs: ["--config=release.config.js", "--preRelease=rc"],
    },
  );
});

test("rejects invalid, non-forward, and unsupported selectors", () => {
  assert.throws(
    () => resolveReleaseVersion("0.1.0", "wat"),
    /valid release selector/i,
  );
  assert.throws(
    () => resolveReleaseVersion("0.1.0", "0.1.0"),
    /greater than/i,
  );
  assert.throws(
    () => resolveReleaseVersion("0.1.0", "0.0.9"),
    /greater than/i,
  );
  assert.throws(
    () => resolveReleaseVersion("0.1.0", "01.2.3"),
    /SemVer/i,
  );
});

test("reads four Desktop manifests and ignores independent package versions", async () => {
  const root = await createFixture({
    rootVersion: "0.2.0",
    desktopVersion: "0.2.0",
    tauriVersion: "0.2.0",
    cargoVersion: "0.2.0",
    serverVersion: "9.9.9",
    sharedVersion: "8.8.8",
    uiVersion: "7.7.7",
    sdkVersion: "6.6.6",
  });
  try {
    const state = await readReleaseState(root, {
      runGit: async (args) => {
        assert.deepEqual(args, ["status", "--porcelain=v1"]);
        return "";
      },
    });

    assert.deepEqual(state, {
      rootVersion: "0.2.0",
      desktopVersion: "0.2.0",
      tauriVersion: "0.2.0",
      cargoVersion: "0.2.0",
      targetTag: "v0.2.0",
      worktreeClean: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a Desktop version mismatch before release", async () => {
  const root = await createFixture({
    rootVersion: "0.2.0",
    desktopVersion: "0.2.0",
    tauriVersion: "0.2.0",
    cargoVersion: "0.1.1",
  });
  try {
    await assert.rejects(
      readReleaseState(root, { runGit: async () => "" }),
      (error) => {
        for (const field of [
          "rootVersion",
          "desktopVersion",
          "tauriVersion",
          "cargoVersion",
        ]) {
          assert.match(error.message, new RegExp(field));
        }
        return /version mismatch/i.test(error.message);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a dirty worktree and an existing target tag", async () => {
  const root = await createFixture();
  try {
    const dirtyState = await readReleaseState(root, {
      runGit: async (args) => {
        assert.deepEqual(args, ["status", "--porcelain=v1"]);
        return " M apps/server";
      },
    });
    assert.equal(dirtyState.worktreeClean, false);
    await assert.rejects(
      assertReleasePreconditions(root, dirtyState, "0.1.1", {
        runGit: async () => "",
      }),
      /worktree/i,
    );

    const cleanState = await readReleaseState(root, {
      runGit: async () => "",
    });
    await assert.rejects(
      assertReleasePreconditions(root, cleanState, "0.1.1", {
        runGit: async (args) => {
          assert.deepEqual(args, ["tag", "--list", "v0.1.1"]);
          return "v0.1.1\n";
        },
      }),
      /already exists/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invokes local release-it with the resolved version and passthrough flags", async () => {
  const root = await createFixture();
  try {
    const gitCalls = [];
    let invocation;
    await runRelease(["patch", "--dry-run"], {
      root,
      runGit: async (args, cwd) => {
        gitCalls.push({ args, cwd });
        if (args[0] === "status") return "";
        return "";
      },
      spawnProcess: (command, args, options) => {
        invocation = { command, args, options };
        return {
          once(event, callback) {
            if (event === "exit") callback(0, null);
            return this;
          },
        };
      },
      platform: "linux",
    });

    assert.deepEqual(invocation.args, [
      "exec",
      "release-it",
      "0.1.1",
      "--dry-run",
      "--ci",
      "--no-npm",
      "--no-github.release",
    ]);
    assert.equal(invocation.command, "pnpm");
    assert.equal(invocation.options.cwd, root);
    assert.deepEqual(gitCalls.map(({ args }) => args), [
      ["status", "--porcelain=v1"],
      ["tag", "--list", "v0.1.1"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps custom config passthrough while forcing publication disabled", async () => {
  const root = await createFixture();
  const customConfigPath = join(root, "release-it-malicious.json");
  await writeJson(customConfigPath, {
    npm: { publish: true },
    github: { release: true },
  });

  try {
    let invocation;
    await runRelease(["--config", customConfigPath, "patch"], {
      root,
      runGit: async (args) => {
        if (args[0] === "status") return "";
        return "";
      },
      spawnProcess: (command, args, options) => {
        invocation = { command, args, options };
        return {
          once(event, callback) {
            if (event === "exit") callback(0, null);
            return this;
          },
        };
      },
      platform: "linux",
    });

    assert.equal(invocation.command, "pnpm");
    assert.deepEqual(invocation.args, [
      "exec",
      "release-it",
      "0.1.1",
      "--config",
      customConfigPath,
      "--no-npm",
      "--no-github.release",
    ]);
    assert.equal(invocation.options.cwd, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configures release-it for version files and Cargo lock synchronization", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../.release-it.json", import.meta.url), "utf8"),
  );
  const tauriConfig = JSON.parse(
    await readFile(
      new URL("../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(config.npm, false);
  assert.equal(config.github.release, false);
  assert.equal(config.git.requireCleanWorkingDir, true);
  assert.equal(config.git.requireUpstream, false);
  assert.equal(config.git.commitMessage, "chore: release v${version}");
  assert.equal(config.git.tagName, "v${version}");
  assert.equal(config.git.push, true);
  assert.equal(
    config.hooks["after:bump"],
    "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib",
  );
  assert.equal(tauriConfig.app.windows[0].devtools, true);
  assert.deepEqual(config.plugins["@release-it/bumper"].out, [
    "package.json",
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    {
      file: "apps/desktop/src-tauri/Cargo.toml",
      path: "package.version",
    },
  ]);
});

test("configures a fixed GitHub release body without a second release path", async () => {
  const expected = {
    "type: feat": "✨ Features | 新功能",
    "type: fix": "🐛 Bug Fixes | Bug 修复",
    "type: chore": "🎫 Chores | 其他更新",
    "type: docs": "📝 Documentation | 文档",
    "type: style": "💄 Styles | 风格",
    "type: refactor": "♻ Code Refactoring | 代码重构",
    "type: perf": "⚡ Performance Improvements | 性能优化",
    "type: test": "✅ Tests | 测试",
    "type: revert": "⏪ Reverts | 回退",
    "type: build": "👷 Build System | 构建",
    "type: ci": "🔧 Continuous Integration | CI 配置",
    "type: config": "🔨 CONFIG | 配置",
  };
  const releaseConfig = parseYaml(
    await readFile(new URL("../../.github/release.yml", import.meta.url), "utf8"),
  );
  const categories = releaseConfig.changelog?.categories ?? [];
  assert.equal(categories.length, 12);
  const labels = categories.flatMap(({ labels }) => {
    assert.ok(Array.isArray(labels));
    assert.equal(labels.length, 1);
    return labels;
  });
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(
    Object.fromEntries(categories.map(({ labels, title }) => [labels[0], title])),
    expected,
  );
  assert.equal(releaseConfig.categories, undefined);

  const workflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/desktop-release.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.on?.push?.tags, ["v*"]);
  const releaseJob = workflow.jobs.release;
  assert.equal(releaseJob.needs, "assemble");
  assert.equal(releaseJob.if, "startsWith(github.ref, 'refs/tags/v')");
  assert.equal(releaseJob.permissions?.contents, "write");
  assert.equal(releaseJob.permissions?.["pull-requests"], "read");
  const releaseCheckoutIndex = releaseJob.steps.findIndex(
    (step) => step.uses === "actions/checkout@v7",
  );
  const releaseArtifactDownloadIndex = releaseJob.steps.findIndex(
    (step) => step.uses === "actions/download-artifact@v8",
  );
  assert.ok(releaseCheckoutIndex >= 0);
  assert.ok(releaseArtifactDownloadIndex >= 0);
  assert.ok(releaseCheckoutIndex < releaseArtifactDownloadIndex);
  const releaseAction = releaseJob.steps.find(
    (step) => step.uses === "softprops/action-gh-release@v3",
  );
  assert.ok(releaseAction);
  assert.equal(releaseAction.with.generate_release_notes, false);
  const releaseCheckout = releaseJob.steps.find(
    (step) => step.uses === "actions/checkout@v7",
  );
  assert.ok(releaseCheckout);
  assert.equal(releaseCheckout.with.token, "${{ github.token }}");
  assert.equal(releaseCheckout.with.submodules, false);
  const releaseNotesStep = releaseJob.steps.find(
    (step) => step.name === "Generate release notes",
  );
  assert.ok(releaseNotesStep);
  assert.ok(
    releaseArtifactDownloadIndex <
      releaseJob.steps.findIndex((step) => step.name === "Generate release notes"),
  );
  assert.equal(releaseNotesStep.id, "release-notes");
  assert.equal(
    releaseNotesStep.run,
    'node scripts/generate-release-notes.mjs --output "$GITHUB_OUTPUT"',
  );
  assert.equal(releaseNotesStep.env.GITHUB_TOKEN, "${{ github.token }}");
  assert.equal(releaseNotesStep.env.GITHUB_REPOSITORY, "${{ github.repository }}");
  assert.equal(releaseNotesStep.env.GITHUB_REF_NAME, "${{ github.ref_name }}");
  assert.match(releaseAction.with.body, /Authenticode signed/);
  assert.match(releaseAction.with.body, /ad-hoc signed/);
  assert.match(releaseAction.with.body, /Accessibility and Input Monitoring/);
  assert.match(releaseAction.with.body, /SHA-256 checksum/);
  assert.match(releaseAction.with.body, /Installation and first-use instructions/);
  assert.match(releaseAction.with.body, /docs\/USER_GUIDE\.md/);
  assert.match(releaseAction.with.body, /steps\.release-notes\.outputs\.body/);
  assert.doesNotMatch(JSON.stringify(releaseJob), /Resolve previous release tag/);

  const releaseItConfig = JSON.parse(
    await readFile(new URL("../../.release-it.json", import.meta.url), "utf8"),
  );
  assert.equal(releaseItConfig.github.release, false);
});

test("runs Windows Rust tests in the release profile before packaging", async () => {
  const workflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/desktop-release.yml", import.meta.url),
      "utf8",
    ),
  );
  const windowsJob = workflow.jobs.windows;
  assert.equal(windowsJob["timeout-minutes"], 30);
  const rustTestStep = windowsJob.steps.find(
    (step) => step.name === "Test Rust library",
  );
  assert.ok(rustTestStep);
  assert.equal(
    rustTestStep.run,
    "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --release --locked",
  );
});

test("locks every Cargo path in macOS CI and desktop release builds", async () => {
  const releaseWorkflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/desktop-release.yml", import.meta.url),
      "utf8",
    ),
  );
  const macosWorkflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/macos-ci.yml", import.meta.url),
      "utf8",
    ),
  );

  const releaseBuildRuns = [
    releaseWorkflow.jobs.windows.steps.find(
      (step) => step.name === "Build x64 NSIS installer and updater signature",
    )?.run,
    releaseWorkflow.jobs.macos.steps.find(
      (step) => step.name === "Build ad-hoc universal app, DMG, and updater archive",
    )?.run,
  ];
  assert.deepEqual(releaseBuildRuns, [
    "pnpm --filter @godgesture/desktop tauri build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked",
    "pnpm --filter @godgesture/desktop tauri build --ci --target universal-apple-darwin --bundles app,dmg -- --locked",
  ]);

  const nativeRustRun = macosWorkflow.jobs.validate.steps.find(
    (step) => step.name === "Test native Rust target",
  )?.run;
  assert.equal(
    normalizeShellBlock(nativeRustRun),
    "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --locked -- -D warnings",
  );

  const performanceRun = macosWorkflow.jobs.validate.steps.find(
    (step) => step.name === "Gate Node plugin host performance",
  )?.run;
  assert.match(
    normalizeShellBlock(performanceRun),
    /cargo test --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml --release --locked engine::node_host::tests::node_host_performance_gate/,
  );

  const architectureRun = macosWorkflow.jobs.validate.steps.find(
    (step) => step.name === "Check both macOS architectures",
  )?.run;
  assert.equal(
    normalizeShellBlock(architectureRun),
    "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --target aarch64-apple-darwin --locked cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-apple-darwin --locked",
  );
});

test("release notes generator is included in the release validation suite", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.match(packageJson.scripts["validate:release"], /release-notes\.test\.mjs/);
});

async function createFixture({
  rootVersion = "0.1.0",
  desktopVersion = rootVersion,
  tauriVersion = rootVersion,
  cargoVersion = rootVersion,
  serverVersion = "9.9.9",
  sharedVersion = "8.8.8",
  uiVersion = "7.7.7",
  sdkVersion = "6.6.6",
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "godgesture-release-test-"));
  await mkdir(join(root, "apps", "desktop", "src-tauri"), {
    recursive: true,
  });
  await mkdir(join(root, "apps", "server"), { recursive: true });
  await mkdir(join(root, "packages", "shared"), { recursive: true });
  await mkdir(join(root, "packages", "ui"), { recursive: true });
  await mkdir(join(root, "packages", "sdk"), { recursive: true });
  await writeJson(join(root, "package.json"), { version: rootVersion });
  await writeJson(join(root, "apps", "desktop", "package.json"), {
    version: desktopVersion,
  });
  await writeJson(
    join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"),
    { version: tauriVersion },
  );
  await writeFile(
    join(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
    `[package]\nname = "godgesture"\nversion = "${cargoVersion}"\n\n[dependencies]\n`,
  );
  await writeJson(join(root, "apps", "server", "package.json"), {
    version: serverVersion,
  });
  await writeJson(join(root, "packages", "shared", "package.json"), {
    version: sharedVersion,
  });
  await writeJson(join(root, "packages", "ui", "package.json"), {
    version: uiVersion,
  });
  await writeJson(join(root, "packages", "sdk", "package.json"), {
    version: sdkVersion,
  });
  return root;
}

function normalizeShellBlock(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

test("configures release-it for four version files without npm or GitHub publication", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../.release-it.json", import.meta.url), "utf8"),
  );

  assert.equal(config.npm, false);
  assert.equal(config.github.release, false);
  assert.equal(config.git.requireCleanWorkingDir, true);
  assert.equal(config.git.requireUpstream, false);
  assert.equal(config.git.commitMessage, "chore: release v${version}");
  assert.equal(config.git.tagName, "v${version}");
  assert.equal(config.git.push, true);
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

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

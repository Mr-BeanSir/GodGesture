import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  NODE_ARTIFACTS,
  NODE_VERSION,
  PNPM_SHA512,
  PNPM_VERSION,
  extractArchive,
  targetNames,
} from "../fetch-node-toolchain.mjs";

const execFileAsync = promisify(execFile);

test("pins a current Node LTS and pnpm release", () => {
  assert.equal(NODE_VERSION, "24.18.1");
  assert.equal(PNPM_VERSION, "10.34.5");
  assert.match(PNPM_SHA512, /^[A-Za-z0-9+/]+={0,2}$/);
});

test("ships the fixed TypeScript editor/runtime declarations with every target", async () => {
  const source = await readFile(new URL("../fetch-node-toolchain.mjs", import.meta.url), "utf8");
  assert.match(source, /copyTypeScript/);
  assert.match(source, /join\(sourceRoot, "@types", "node"\)/);
  assert.match(source, /undici-types/);
});

test("maps supported release targets to exact Node archives", () => {
  assert.deepEqual(targetNames("windows-x64"), ["windows-x64"]);
  assert.deepEqual(targetNames("universal-apple-darwin"), ["macos-x64", "macos-arm64"]);
  for (const artifact of Object.values(NODE_ARTIFACTS)) {
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.match(artifact.archive, new RegExp(`^node-v${NODE_VERSION}-`));
  }
});

test("rejects unsupported targets before any download", () => {
  assert.throws(() => targetNames("linux-x64"), /Unsupported Node toolchain target/);
});

test(
  "extracts Windows archives through PowerShell without positional args",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "godgesture-toolchain-test-"));
    const archive = join(root, "archive.zip");
    const destination = join(root, "output");
    const source = join(root, "payload.txt");
    try {
      await writeFile(source, "toolchain smoke");
      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Compress-Archive -LiteralPath $env:GODGESTURE_TOOLCHAIN_SOURCE -DestinationPath $env:GODGESTURE_TOOLCHAIN_ARCHIVE",
        ],
        {
          env: {
            ...process.env,
            GODGESTURE_TOOLCHAIN_SOURCE: source,
            GODGESTURE_TOOLCHAIN_ARCHIVE: archive,
          },
        },
      );
      await extractArchive(archive, "zip", destination);
      assert.equal(await readFile(join(destination, "payload.txt"), "utf8"), "toolchain smoke");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

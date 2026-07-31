import test from "node:test";
import assert from "node:assert/strict";
import {
  NODE_ARTIFACTS,
  NODE_VERSION,
  PNPM_SHA512,
  PNPM_VERSION,
  targetNames,
} from "../fetch-node-toolchain.mjs";

test("pins a current Node LTS and pnpm release", () => {
  assert.equal(NODE_VERSION, "24.18.1");
  assert.equal(PNPM_VERSION, "10.34.5");
  assert.match(PNPM_SHA512, /^[A-Za-z0-9+/]+={0,2}$/);
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

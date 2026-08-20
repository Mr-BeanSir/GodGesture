import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const tauriConfigPath = resolve(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "tauri.conf.json",
);
const installerHooksPath = resolve(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "installer-hooks.nsh",
);

test("Windows NSIS uses the per-machine install mode and hook", async () => {
  const config = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  const nsis = config.bundle?.windows?.nsis;

  assert.equal(nsis?.installMode, "perMachine");
  assert.equal(nsis?.installerHooks, "installer-hooks.nsh");
});

test("Windows uninstall clears only per-machine location metadata outside updates", async () => {
  const hooks = await readFile(installerHooksPath, "utf8");

  assert.match(hooks, /!macro\s+NSIS_HOOK_POSTUNINSTALL/);
  assert.match(hooks, /\$\{If\}\s+\$UpdateMode\s+<>\s+1/);
  assert.match(hooks, /DeleteRegKey\s+HKLM\s+"\$\{MANUPRODUCTKEY\}"/);
  assert.doesNotMatch(hooks, /HKCU/);
  assert.doesNotMatch(hooks, /RmDir\s+\/r/i);
});

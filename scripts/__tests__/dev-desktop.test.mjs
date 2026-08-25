import assert from "node:assert/strict";
import test from "node:test";
import {
  findAvailablePortPair,
  isWindowsProcessElevated,
  tauriDevArgs,
} from "../dev-desktop.mjs";

function availability(occupied) {
  return async (port) => !occupied.has(port);
}

test("uses the preferred Desktop development port pair", async () => {
  assert.deepEqual(
    await findAvailablePortPair({ isAvailable: availability(new Set()) }),
    { devPort: 14200, hmrPort: 14201 },
  );
});

test("skips a pair when either port is occupied", async () => {
  assert.deepEqual(
    await findAvailablePortPair({
      isAvailable: availability(new Set([14201, 14204])),
    }),
    { devPort: 14202, hmrPort: 14203 },
  );
});

test("reports exhaustion without terminating an occupying process", async () => {
  await assert.rejects(
    findAvailablePortPair({
      firstPort: 14200,
      lastPort: 14204,
      isAvailable: availability(
        new Set([14200, 14201, 14202, 14203, 14204, 14205]),
      ),
    }),
    /No free Desktop development port pair in 14200-14205/,
  );
});

test("passes the selected devUrl to Tauri without dropping forwarded args", () => {
  const args = tauriDevArgs(
    { devPort: 14202, hmrPort: 14203 },
    ["--verbose"],
  );
  assert.match(args[0], /apps[\\/]desktop[\\/]node_modules[\\/]@tauri-apps[\\/]cli[\\/]tauri\.js$/);
  assert.equal(args[1], "dev");
  assert.equal(args[2], "--config");
  assert.deepEqual(JSON.parse(args[3]), {
    build: { devUrl: "http://127.0.0.1:14202" },
  });
  assert.deepEqual(args.slice(4), ["--verbose"]);
});

test("does not require elevation on non-Windows development hosts", () => {
  assert.equal(isWindowsProcessElevated({ platform: "darwin" }), true);
});

test("checks the current Windows token through PowerShell", () => {
  let invocation;
  const elevated = isWindowsProcessElevated({
    platform: "win32",
    execFileSyncImpl(...args) {
      invocation = args;
      return Buffer.from("");
    },
  });

  assert.equal(elevated, true);
  assert.equal(invocation[0], "powershell.exe");
  assert.deepEqual(invocation[1].slice(0, 3), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
  ]);
  assert.equal(invocation[1][3], "-Command");
  assert.match(invocation[1][4], /WindowsBuiltInRole\]::Administrator/);
  assert.deepEqual(invocation[2], { stdio: "ignore" });
});

test("rejects a Windows development host when the token is not elevated", () => {
  assert.equal(
    isWindowsProcessElevated({
      platform: "win32",
      execFileSyncImpl() {
        throw new Error("PowerShell role check returned exit code 1");
      },
    }),
    false,
  );
});

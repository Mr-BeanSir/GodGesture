import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { pnpmInvocation } from "../dev-server.mjs";

const source = await readFile(join(import.meta.dirname, "..", "dev-server.mjs"), "utf8");

test("allows enough time for a cold Nest watch compilation", () => {
  const match = source.match(
    /const DEFAULT_BACKEND_HEALTH_TIMEOUT_MS = ([\d_]+);/,
  );

  assert.ok(match, "dev-server must declare its default backend health timeout");
  assert.ok(
    Number(match[1].replaceAll("_", "")) >= 60_000,
    "cold Windows watch startup needs at least a 60 second health window",
  );
  assert.match(
    source,
    /waitForHealth\(\s*backendUrl,\s*backend,\s*DEFAULT_BACKEND_HEALTH_TIMEOUT_MS,?\s*\)/,
  );
});

test("resolves pnpm through PowerShell on Windows without shell interpolation", () => {
  const invocation = pnpmInvocation(
    ["--filter", "@godgesture/server", "run", "value with spaces", "a'quote"],
    { platform: "win32", systemRoot: "C:\\Windows" },
  );

  assert.equal(
    invocation.command,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.deepEqual(invocation.args.slice(0, 6), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
  ]);

  const script = Buffer.from(invocation.args[6], "base64").toString("utf16le");
  assert.equal(
    script,
    "$LASTEXITCODE = $null; & 'pnpm' '--filter' '@godgesture/server' 'run' 'value with spaces' 'a''quote' ; $commandSucceeded = $?; $exitCode = $LASTEXITCODE; if (-not $commandSucceeded -and $null -eq $exitCode) { exit 1 }; if ($null -eq $exitCode) { exit 0 }; exit $exitCode",
  );
});

test("invokes pnpm directly outside Windows", () => {
  assert.deepEqual(
    pnpmInvocation(["--version"], { platform: "darwin" }),
    { command: "pnpm", args: ["--version"] },
  );
});

test(
  "propagates a pnpm failure through the Windows PowerShell wrapper",
  { skip: process.platform !== "win32" },
  async () => {
    const invocation = pnpmInvocation(["--this-option-does-not-exist"]);
    const child = spawn(invocation.command, invocation.args, {
      stdio: "ignore",
    });
    const [code, signal] = await once(child, "close");

    assert.equal(signal, null);
    assert.equal(code, 1);
  },
);

test(
  "finds a PowerShell-only pnpm shim when pnpm.cmd is unavailable",
  { skip: process.platform !== "win32" },
  async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "godgesture-pnpm-"));
    const shimPath = join(fixtureDirectory, "pnpm.ps1");
    await writeFile(
      shimPath,
      "param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)\n" +
        "Write-Output ($Arguments -join '|')\n" +
        "exit 0\n",
      "utf8",
    );

    try {
      const invocation = pnpmInvocation(
        ["--filter", "@godgesture/server", "value with spaces"],
        { platform: "win32" },
      );
      const child = spawn(invocation.command, invocation.args, {
        env: { ...process.env, Path: fixtureDirectory },
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      const [code, signal] = await once(child, "close");

      assert.equal(signal, null);
      assert.equal(code, 0);
      assert.equal(stdout.trim(), "--filter|@godgesture/server|value with spaces");
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  },
);

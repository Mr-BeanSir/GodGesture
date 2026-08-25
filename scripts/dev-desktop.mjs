import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

export const DEFAULT_DEV_PORT = 14200;
export const LAST_DEV_PORT = 14398;
const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DESKTOP_ROOT = join(REPOSITORY_ROOT, "apps", "desktop");
const TAURI_CLI = join(
  DESKTOP_ROOT,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

export async function canListen(port, host = "127.0.0.1") {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePortPair({
  firstPort = DEFAULT_DEV_PORT,
  lastPort = LAST_DEV_PORT,
  isAvailable = canListen,
} = {}) {
  for (let devPort = firstPort; devPort <= lastPort; devPort += 2) {
    const hmrPort = devPort + 1;
    if ((await isAvailable(devPort)) && (await isAvailable(hmrPort))) {
      return { devPort, hmrPort };
    }
  }
  throw new Error(
    `No free Desktop development port pair in ${firstPort}-${lastPort + 1}`,
  );
}

export function tauriDevArgs({ devPort }, forwardedArgs = []) {
  const override = JSON.stringify({
    build: { devUrl: `http://127.0.0.1:${devPort}` },
  });
  return [TAURI_CLI, "dev", "--config", override, ...forwardedArgs];
}

export function isWindowsProcessElevated({
  platform = process.platform,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (platform !== "win32") {
    return true;
  }

  try {
    execFileSyncImpl(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = New-Object Security.Principal.WindowsPrincipal($identity); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 }; exit 1",
      ],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

export async function runDesktopDev(forwardedArgs = process.argv.slice(2)) {
  if (!isWindowsProcessElevated()) {
    console.error(
      "[GodGesture] Windows Desktop development must be started from an elevated PowerShell or terminal.",
    );
    process.exitCode = 1;
    return;
  }

  const ports = await findAvailablePortPair();
  const url = `http://127.0.0.1:${ports.devPort}`;
  console.log(`[GodGesture] Desktop dev server: ${url}`);
  console.log(`[GodGesture] Desktop HMR: ws://127.0.0.1:${ports.hmrPort}`);

  const child = spawn(process.execPath, tauriDevArgs(ports, forwardedArgs), {
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      GODGESTURE_DEV_PORT: String(ports.devPort),
      GODGESTURE_HMR_PORT: String(ports.hmrPort),
    },
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
  process.exitCode = exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDesktopDev().catch((error) => {
    console.error(`[GodGesture] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

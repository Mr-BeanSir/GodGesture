import net from "node:net";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER_URL = (port) => `http://127.0.0.1:${port}`;

function command() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findPort(first, last, label) {
  for (let port = first; port <= last; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free ${label} development port in ${first}-${last}`);
}

function start(args, env) {
  return spawn(command(), args, {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

async function waitForHealth(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited before becoming ready (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // The Nest watcher needs a few seconds to compile and bind its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend health check timed out: ${url}/api/v1/health`);
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

export async function runDevServer() {
  const backendPort = await findPort(3000, 3099, "backend");
  const frontendPort = await findPort(5180, 5279, "Web Console");
  const backendUrl = SERVER_URL(backendPort);
  console.log(`[GodGesture] Backend: ${backendUrl}`);

  const backend = start(
    ["--filter", "@godgesture/server", "start:dev"],
    { PORT: String(backendPort), HOST: "127.0.0.1" },
  );
  let frontend;
  const cleanup = () => {
    stop(frontend);
    stop(backend);
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  try {
    await waitForHealth(backendUrl, backend);
    console.log(`[GodGesture] Web Console: http://127.0.0.1:${frontendPort}`);
    frontend = start(
      ["--filter", "@godgesture/web-console", "dev"],
      {
        GODGESTURE_SERVER_PORT: String(backendPort),
        GODGESTURE_WEB_PORT: String(frontendPort),
      },
    );
    const exitCode = await new Promise((resolve) => {
      frontend.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
      backend.once("exit", (code, signal) => {
        if (frontend && frontend.exitCode === null) stop(frontend);
        resolve(signal ? 1 : code ?? 1);
      });
    });
    process.exitCode = exitCode;
  } finally {
    cleanup();
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDevServer().catch((error) => {
    console.error(`[GodGesture] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

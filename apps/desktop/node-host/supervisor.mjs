import { Worker } from "node:worker_threads";

const MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_INVOCATION_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_FIELD_CHARS = 64;
const workers = new Map();
const definitions = new Map();
let input = Buffer.alloc(0);

function safeIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .slice(0, MAX_DIAGNOSTIC_FIELD_CHARS)
    .replace(/[^a-zA-Z0-9._:-]/g, "_");
  return normalized || undefined;
}

function lifecycleName(value) {
  return typeof value === "string" && value.startsWith("on")
    ? safeIdentifier(value)
    : undefined;
}

function writeDiagnostic(code, fields = {}) {
  const payload = {
    source: fields.source === "worker" ? "worker" : "supervisor",
    level: fields.level ?? "warn",
    code: safeIdentifier(code) ?? "diagnostic",
  };
  for (const key of ["pluginId", "actionId", "lifecycle"]) {
    const value = safeIdentifier(fields[key]);
    if (value !== undefined) payload[key] = value;
  }
  for (const key of ["durationMs", "exitCode", "lineLength"]) {
    if (Number.isSafeInteger(fields[key])) payload[key] = fields[key];
  }
  try {
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  } catch {
    // Diagnostics must never interrupt the protocol loop.
  }
}

function safeError(value) {
  const message = value?.message ?? String(value);
  const exit = message.match(/exited with code (-?\d+)/i);
  if (exit) return `node worker exited with code ${exit[1]}`;
  if (/unknown message type/i.test(message)) return "node unknown message type";
  if (/timed out|timeout/i.test(message)) return "node plugin invocation timed out";
  if (/does not export/i.test(message)) return "node plugin handler missing";
  if (/import/i.test(message)) return "node plugin import failed";
  return "node request failed";
}

function writeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length > MAX_FRAME_BYTES) {
    throw new Error(`frame exceeds ${MAX_FRAME_BYTES} bytes`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length);
  process.stdout.write(header);
  process.stdout.write(payload);
}

function response(id, ok, value) {
  writeFrame(
    ok
      ? { type: "response", id, ok, result: value ?? null }
      : { type: "response", id, ok, error: safeError(value) },
  );
}

function rejectPending(state, error) {
  for (const pending of state.pendingInvocations.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  state.pendingInvocations.clear();
}

async function stopPlugin(pluginId, reason) {
  const state = workers.get(pluginId);
  if (!state) return;
  workers.delete(pluginId);
  writeDiagnostic("plugin_worker_stop", {
    level: "debug",
    pluginId,
  });
  rejectPending(state, new Error("node plugin worker stopped"));
  await state.worker.terminate();
}

async function createPlugin(pluginId) {
  const definition = definitions.get(pluginId);
  if (!definition) throw new Error("node plugin definition missing");
  await stopPlugin(pluginId, "plugin reloaded");
  writeDiagnostic("plugin_worker_start", { level: "info", pluginId });

  const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    workerData: { pluginId, entryPath: definition.entryPath },
  });
  const state = {
    pluginId,
    worker,
    ready: false,
    pendingInvocations: new Map(),
    invocationTail: Promise.resolve(),
  };
  workers.set(pluginId, state);

  const ready = new Promise((resolve, reject) => {
    state.resolveReady = resolve;
    state.rejectReady = reject;
  });

  worker.on("message", (message) => {
    if (message.type === "diagnostic") {
      writeDiagnostic(message.code, message);
      return;
    }
    if (message.type === "ready") {
      state.ready = true;
      state.resolveReady();
      writeDiagnostic("plugin_worker_ready", { level: "info", pluginId });
      return;
    }
    if (message.type === "invocationResult") {
      const pending = state.pendingInvocations.get(message.requestId);
      if (!pending) return;
      state.pendingInvocations.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result ?? null);
      else pending.reject(new Error(message.error));
      return;
    }
    if (message.type === "hostCall") {
      writeFrame({
        type: "hostCall",
        pluginId,
        requestId: message.requestId,
        callId: message.callId,
        method: message.method,
        args: message.args,
      });
    }
  });
  worker.on("error", () => {
    writeDiagnostic("plugin_worker_error", { pluginId });
    const error = new Error("node plugin worker failed");
    state.rejectReady(error);
    rejectPending(state, error);
  });
  worker.on("exit", (code) => {
    if (workers.get(pluginId) === state) workers.delete(pluginId);
    if (code !== 0) {
      writeDiagnostic("plugin_worker_exit", { pluginId, exitCode: code });
    }
    const error = new Error(`node worker exited with code ${code}`);
    state.rejectReady(error);
    rejectPending(state, error);
  });

  await ready;
  return state;
}

async function ensurePlugin(pluginId) {
  const current = workers.get(pluginId);
  if (current?.ready) return current;
  return createPlugin(pluginId);
}

function invokeOnce(state, pluginId, requestId, handler, optional, context, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!state.pendingInvocations.delete(requestId)) return;
      writeDiagnostic("plugin_invocation_timeout", {
        pluginId,
        actionId: handler,
        lifecycle: lifecycleName(handler),
        durationMs: timeoutMs,
      });
      reject(new Error("node plugin invocation timed out"));
      if (workers.get(pluginId) === state) workers.delete(pluginId);
      rejectPending(state, new Error("plugin worker terminated after timeout"));
      void state.worker.terminate();
    }, timeoutMs);
    state.pendingInvocations.set(requestId, { resolve, reject, timer });
    state.worker.postMessage({ type: "invoke", requestId, handler, optional, context });
  });
}

async function invokePlugin(pluginId, requestId, handler, optional, context, timeoutMs) {
  const state = await ensurePlugin(pluginId);
  const invoke = () =>
    invokeOnce(state, pluginId, requestId, handler, optional, context, timeoutMs);
  const result = state.invocationTail.then(invoke, invoke);
  state.invocationTail = result.catch(() => undefined);
  return result;
}

async function handleMessage(message) {
  switch (message.type) {
    case "load": {
      const started = performance.now();
      writeDiagnostic("plugin_load_started", {
        level: "info",
        pluginId: message.pluginId,
      });
      definitions.set(message.pluginId, { entryPath: message.entryPath });
      await createPlugin(message.pluginId);
      writeDiagnostic("plugin_load_completed", {
        level: "info",
        pluginId: message.pluginId,
        durationMs: Math.round(performance.now() - started),
      });
      response(message.id, true, { loaded: message.pluginId });
      break;
    }
    case "unload": {
      definitions.delete(message.pluginId);
      await stopPlugin(message.pluginId, "plugin unloaded");
      writeDiagnostic("plugin_unload_completed", {
        level: "info",
        pluginId: message.pluginId,
      });
      response(message.id, true, null);
      break;
    }
    case "invoke": {
      const timeoutMs = Number.isSafeInteger(message.timeoutMs)
        ? Math.max(1, Math.min(message.timeoutMs, 60_000))
        : DEFAULT_INVOCATION_TIMEOUT_MS;
      const started = performance.now();
      try {
        const result = await invokePlugin(
          message.pluginId,
          message.id,
          message.handler,
          message.optional === true,
          message.context ?? {},
          timeoutMs,
        );
        writeDiagnostic("invocation_completed", {
          level: "debug",
          pluginId: message.pluginId,
          actionId: message.handler,
          lifecycle: lifecycleName(message.handler),
          durationMs: Math.round(performance.now() - started),
        });
        response(message.id, true, result);
      } catch (error) {
        writeDiagnostic("invocation_failed", {
          pluginId: message.pluginId,
          actionId: message.handler,
          lifecycle: lifecycleName(message.handler),
          durationMs: Math.round(performance.now() - started),
        });
        throw error;
      }
      break;
    }
    case "hostResult": {
      const state = workers.get(message.pluginId);
      if (!state) return;
      state.worker.postMessage(message);
      break;
    }
    case "shutdown":
      await Promise.all(
        [...workers.keys()].map((pluginId) => stopPlugin(pluginId, "host shutdown")),
      );
      definitions.clear();
      response(message.id, true, null);
      process.exitCode = 0;
      process.stdin.pause();
      break;
    default:
      throw new Error("unknown message type");
  }
}

function consumeInput() {
  while (input.length >= 4) {
    const length = input.readUInt32BE(0);
    if (length > MAX_FRAME_BYTES) {
      throw new Error(`frame exceeds ${MAX_FRAME_BYTES} bytes`);
    }
    if (input.length < length + 4) return;
    const payload = input.subarray(4, length + 4);
    input = input.subarray(length + 4);
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch {
      writeDiagnostic("ipc_payload_invalid");
      continue;
    }
    Promise.resolve(handleMessage(message)).catch((error) => {
      if (message?.id !== undefined) response(message.id, false, error?.stack ?? error);
      else writeDiagnostic("ipc_request_failed");
    });
  }
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  try {
    consumeInput();
  } catch (error) {
    writeDiagnostic("ipc_frame_invalid");
    process.exitCode = 1;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => {
  for (const state of workers.values()) void state.worker.terminate();
});
process.stdin.on("error", () => writeDiagnostic("ipc_stdin_error"));

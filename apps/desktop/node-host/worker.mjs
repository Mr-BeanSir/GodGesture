import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("plugin worker requires a parent port");

const pendingCalls = new Map();
let nextCallId = 1;
let initialized = false;
const INIT_HANDLER = "onInit";
const MAX_DIAGNOSTIC_FIELD_CHARS = 64;
const MAX_PLUGIN_OUTPUT_LINE_CHARS = 512;

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
    type: "diagnostic",
    source: "worker",
    level: fields.level ?? "warn",
    code: safeIdentifier(code) ?? "diagnostic",
    pluginId: safeIdentifier(workerData.pluginId),
  };
  for (const key of ["actionId", "lifecycle"]) {
    const value = safeIdentifier(fields[key]);
    if (value !== undefined) payload[key] = value;
  }
  if (Number.isSafeInteger(fields.durationMs)) payload.durationMs = fields.durationMs;
  try {
    parentPort.postMessage(payload);
  } catch {
    // The host may already be shutting down.
  }
}

function capturePluginOutput(stream, code) {
  let pending = "";
  stream.write = (chunk, encoding, callback) => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk ?? "");
    let cursor = 0;
    while (cursor < text.length) {
      const newline = text.indexOf("\n", cursor);
      const end = newline === -1 ? text.length : newline;
      const fragment = text.slice(cursor, end).replace(/\r$/, "");
      if (pending.length < MAX_PLUGIN_OUTPUT_LINE_CHARS) {
        pending += fragment.slice(0, MAX_PLUGIN_OUTPUT_LINE_CHARS - pending.length);
      }
      if (newline === -1) break;
      writeDiagnostic(code, {
        lineLength: Math.min(pending.length, MAX_PLUGIN_OUTPUT_LINE_CHARS),
      });
      pending = "";
      cursor = newline + 1;
    }
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
}

capturePluginOutput(process.stdout, "plugin_stdout_line");
capturePluginOutput(process.stderr, "plugin_stderr_line");

function hostCall(requestId, method, args) {
  const callId = nextCallId++;
  return new Promise((resolve, reject) => {
    pendingCalls.set(callId, { resolve, reject });
    parentPort.postMessage({ type: "hostCall", requestId, callId, method, args });
  });
}

function pluginContext(requestId, context) {
  const input = Object.freeze({
    keyCombo: (modifiers, keys) => hostCall(requestId, "input.keyCombo", [modifiers, keys]),
    sendText: (text) => hostCall(requestId, "input.sendText", [text]),
    mouseClick: (button) => hostCall(requestId, "input.mouseClick", [button]),
    mouseDown: (button) => hostCall(requestId, "input.mouseDown", [button]),
    mouseUp: (button) => hostCall(requestId, "input.mouseUp", [button]),
    movePointer: (x, y) => hostCall(requestId, "input.movePointer", [x, y]),
    wheel: (delta) => hostCall(requestId, "input.wheel", [delta]),
  });
  const window = Object.freeze({
    activateTarget: () => hostCall(requestId, "window.activateTarget", []),
    perform: (operation) => hostCall(requestId, "window.perform", [operation]),
  });
  const clipboard = Object.freeze({
    readText: () => hostCall(requestId, "clipboard.readText", []),
    writeText: (text) => hostCall(requestId, "clipboard.writeText", [text]),
    selectedText: () => hostCall(requestId, "clipboard.selectedText", []),
  });
  const status = Object.freeze({
    report: (message) => hostCall(requestId, "status.report", [message]),
  });
  return Object.freeze({ ...context, input, window, clipboard, status });
}

let plugin;
try {
  plugin = await import(pathToFileURL(workerData.entryPath).href);
} catch {
  writeDiagnostic("plugin_import_failed", { level: "error" });
  process.exitCode = 1;
  parentPort.close();
}

if (plugin) parentPort.postMessage({ type: "ready", pluginId: workerData.pluginId });

if (plugin) parentPort.on("message", async (message) => {
  if (message.type === "hostResult") {
    const pending = pendingCalls.get(message.callId);
    if (!pending) return;
    pendingCalls.delete(message.callId);
    if (message.ok) pending.resolve(message.result ?? null);
    else pending.reject(new Error(message.error));
    return;
  }
  if (message.type !== "invoke") return;

  try {
    if (!initialized && message.handler !== INIT_HANDLER) {
      const onInit = plugin[INIT_HANDLER];
      if (typeof onInit === "function") {
        await onInit(
          pluginContext(message.requestId, { ...message.context, phase: INIT_HANDLER }),
        );
      }
      initialized = true;
    }
    const handler = plugin[message.handler];
    if (typeof handler !== "function") {
      if (message.optional) {
        if (message.handler === INIT_HANDLER) initialized = true;
        parentPort.postMessage({
          type: "invocationResult",
          requestId: message.requestId,
          ok: true,
          result: null,
        });
        return;
      }
      throw new Error(`plugin does not export '${message.handler}'`);
    }
    const result = await handler(pluginContext(message.requestId, message.context));
    if (message.handler === INIT_HANDLER) initialized = true;
    parentPort.postMessage({
      type: "invocationResult",
      requestId: message.requestId,
      ok: true,
      result: result ?? null,
    });
  } catch (error) {
    writeDiagnostic("plugin_invocation_failed", {
      pluginId: workerData.pluginId,
      actionId: message.handler,
      lifecycle: lifecycleName(message.handler),
    });
    parentPort.postMessage({
      type: "invocationResult",
      requestId: message.requestId,
      ok: false,
      error: "node plugin invocation failed",
    });
  }
});

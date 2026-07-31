import { Worker } from "node:worker_threads";

const MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_INVOCATION_TIMEOUT_MS = 5_000;
const workers = new Map();
const definitions = new Map();
let input = Buffer.alloc(0);

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
      : { type: "response", id, ok, error: String(value) },
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
  rejectPending(state, new Error(reason));
  await state.worker.terminate();
}

async function createPlugin(pluginId) {
  const definition = definitions.get(pluginId);
  if (!definition) throw new Error(`plugin '${pluginId}' has no definition`);
  await stopPlugin(pluginId, "plugin reloaded");

  const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    workerData: { pluginId, entryPath: definition.entryPath },
  });
  const state = {
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
    if (message.type === "ready") {
      state.ready = true;
      state.resolveReady();
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
  worker.on("error", (error) => {
    state.rejectReady(error);
    rejectPending(state, error);
  });
  worker.on("exit", (code) => {
    if (workers.get(pluginId) === state) workers.delete(pluginId);
    const error = new Error(`plugin worker exited with code ${code}`);
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
      reject(new Error(`plugin invocation timed out after ${timeoutMs} ms`));
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
    case "load":
      definitions.set(message.pluginId, { entryPath: message.entryPath });
      await createPlugin(message.pluginId);
      response(message.id, true, { loaded: message.pluginId });
      break;
    case "unload":
      definitions.delete(message.pluginId);
      await stopPlugin(message.pluginId, "plugin unloaded");
      response(message.id, true, null);
      break;
    case "invoke": {
      const timeoutMs = Number.isSafeInteger(message.timeoutMs)
        ? Math.max(1, Math.min(message.timeoutMs, 60_000))
        : DEFAULT_INVOCATION_TIMEOUT_MS;
      const result = await invokePlugin(
        message.pluginId,
        message.id,
        message.handler,
        message.optional === true,
        message.context ?? {},
        timeoutMs,
      );
      response(message.id, true, result);
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
      throw new Error(`unknown message type '${message.type}'`);
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
    const message = JSON.parse(payload.toString("utf8"));
    Promise.resolve(handleMessage(message)).catch((error) => {
      if (message?.id !== undefined) response(message.id, false, error?.stack ?? error);
      else process.stderr.write(`${error?.stack ?? error}\n`);
    });
  }
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  try {
    consumeInput();
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => {
  for (const state of workers.values()) void state.worker.terminate();
});

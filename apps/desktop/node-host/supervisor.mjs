import { Worker } from "node:worker_threads";

const MAX_FRAME_BYTES = 1024 * 1024;
const workers = new Map();
let input = Buffer.alloc(0);

function writeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length);
  process.stdout.write(header);
  process.stdout.write(payload);
}

function response(id, ok, value) {
  writeFrame(ok
    ? { type: "response", id, ok, result: value ?? null }
    : { type: "response", id, ok, error: String(value) });
}

function rejectPending(state, error) {
  for (const pending of state.pendingInvocations.values()) {
    pending.reject(error);
  }
  state.pendingInvocations.clear();
}

async function createPlugin(pluginId, source) {
  const existing = workers.get(pluginId);
  if (existing) {
    workers.delete(pluginId);
    rejectPending(existing, new Error("plugin reloaded"));
    await existing.worker.terminate();
  }

  const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    workerData: { pluginId, source },
  });
  const state = {
    worker,
    ready: false,
    pendingInvocations: new Map(),
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
}

function invokePlugin(pluginId, requestId, handler, context) {
  const state = workers.get(pluginId);
  if (!state?.ready) throw new Error(`plugin '${pluginId}' is not loaded`);
  return new Promise((resolve, reject) => {
    state.pendingInvocations.set(requestId, { resolve, reject });
    state.worker.postMessage({ type: "invoke", requestId, handler, context });
  });
}

async function handleMessage(message) {
  switch (message.type) {
    case "load":
      await createPlugin(message.pluginId, message.source);
      response(message.id, true, { loaded: message.pluginId });
      break;
    case "invoke": {
      const result = await invokePlugin(
        message.pluginId,
        message.id,
        message.handler,
        message.context ?? {},
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
      await Promise.all([...workers.values()].map(({ worker }) => worker.terminate()));
      workers.clear();
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
      if (message?.id !== undefined) response(message.id, false, error.message);
      else process.stderr.write(`${error.stack ?? error}\n`);
    });
  }
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  try {
    consumeInput();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => {
  for (const state of workers.values()) state.worker.terminate();
});

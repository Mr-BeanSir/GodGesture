import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("plugin worker requires a parent port");

const pendingCalls = new Map();
let nextCallId = 1;

function hostCall(requestId, method, args) {
  const callId = nextCallId++;
  return new Promise((resolve, reject) => {
    pendingCalls.set(callId, { resolve, reject });
    parentPort.postMessage({ type: "hostCall", requestId, callId, method, args });
  });
}

function pluginContext(requestId, context) {
  return Object.freeze({
    ...context,
    input: Object.freeze({
      keyCombo: (modifiers, keys) => hostCall(requestId, "input.keyCombo", [modifiers, keys]),
      sendText: (text) => hostCall(requestId, "input.sendText", [text]),
      mouseClick: (button) => hostCall(requestId, "input.mouseClick", [button]),
      mouseDown: (button) => hostCall(requestId, "input.mouseDown", [button]),
      mouseUp: (button) => hostCall(requestId, "input.mouseUp", [button]),
      movePointer: (x, y) => hostCall(requestId, "input.movePointer", [x, y]),
      wheel: (delta) => hostCall(requestId, "input.wheel", [delta]),
    }),
  });
}

const sourceUrl = `data:text/javascript;base64,${Buffer.from(workerData.source).toString("base64")}`;
const plugin = await import(sourceUrl);
parentPort.postMessage({ type: "ready", pluginId: workerData.pluginId });

parentPort.on("message", async (message) => {
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
    const handler = plugin[message.handler];
    if (typeof handler !== "function") {
      throw new Error(`plugin does not export '${message.handler}'`);
    }
    const result = await handler(pluginContext(message.requestId, message.context));
    parentPort.postMessage({
      type: "invocationResult",
      requestId: message.requestId,
      ok: true,
      result: result ?? null,
    });
  } catch (error) {
    parentPort.postMessage({
      type: "invocationResult",
      requestId: message.requestId,
      ok: false,
      error: error?.stack ?? String(error),
    });
  }
});

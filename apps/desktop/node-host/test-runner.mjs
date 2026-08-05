import { pathToFileURL } from "node:url";

const [, , entryPath, handlerName] = process.argv;
if (!entryPath || !handlerName) throw new Error("test runner requires an entry path and handler");
const INIT_HANDLER = "onInit";
const LIFECYCLE_PHASES = new Set([
  INIT_HANDLER,
  "onExecute",
  "onGestureRecognized",
  "onModifierTriggered",
  "onEnd",
]);

const calls = [];
const logs = [];
const record = (name, args, result = null) => {
  calls.push({ name, args });
  return Promise.resolve(result);
};

for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => logs.push(`${level}: ${args.map(String).join(" ")}`);
}

const plugin = await import(pathToFileURL(entryPath).href);
const context = {
  phase: LIFECYCLE_PHASES.has(handlerName) ? handlerName : "onExecute",
  gesture: {
    origin: { x: 0, y: 0 },
    endpoint: { x: 10, y: 10 },
    nativeWindow: null,
  },
  trigger: "right",
  modifier: "none",
  input: {
    keyCombo: (modifiers, keys) => record("input.keyCombo", [modifiers, keys]),
    sendText: (value) => record("input.sendText", [value]),
    mouseClick: (button) => record("input.mouseClick", [button]),
    mouseDown: (button) => record("input.mouseDown", [button]),
    mouseUp: (button) => record("input.mouseUp", [button]),
    movePointer: (x, y) => record("input.movePointer", [x, y]),
    wheel: (delta) => record("input.wheel", [delta]),
  },
  window: {
    activateTarget: () => record("window.activateTarget", []),
    perform: (operation) => record("window.perform", [operation]),
  },
  clipboard: {
    readText: () => record("clipboard.readText", [], "dry-run clipboard"),
    writeText: (value) => record("clipboard.writeText", [value]),
    selectedText: () => record("clipboard.selectedText", [], "dry-run selection"),
  },
  status: {
    report: (message) => record("status.report", [message]),
  },
};

if (handlerName !== INIT_HANDLER && typeof plugin[INIT_HANDLER] === "function") {
  await plugin[INIT_HANDLER]({ ...context, phase: INIT_HANDLER });
}
const handler = plugin[handlerName];
if (typeof handler !== "function") throw new Error(`plugin does not export '${handlerName}'`);
const result = await handler(context);
process.stdout.write(`${JSON.stringify({ result: result ?? null, calls, logs })}\n`);

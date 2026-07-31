import type { Command, NodePlugin, NodePluginCommand } from "@godgesture/shared";
import { DEFAULT_NODE_PLUGIN_MANIFEST } from "@godgesture/shared";
import { newId } from "./id";

type ScriptCommand = Extract<Command, { type: "script" }>;

/**
 * The legacy runtime executed all slots in one persistent global context. Keep
 * that behavior during migration by evaluating the preserved source files in
 * one Node vm context, while adapting the old synchronous-looking host names
 * to the async Node SDK surface.
 */
export const LEGACY_NODE_PLUGIN_ENTRY = `import { readFileSync } from "node:fs";
import vm from "node:vm";

const legacyContext = vm.createContext({});
const sourceCache = new Map();

function source(name) {
  let value = sourceCache.get(name);
  if (value === undefined) {
    value = readFileSync(new URL(\`./legacy/\${name}.js\`, import.meta.url), "utf8");
    sourceCache.set(name, value);
  }
  return value;
}

function bind(context) {
  legacyContext.Input = context.input;
  legacyContext.Context = {
    origin: context.origin,
    endpoint: context.endpoint,
    triggerButton: context.triggerButton,
    modifier: context.modifier,
    phase: context.phase,
    targetWindowAvailable: context.targetWindowAvailable,
    activateTargetWindow: () => context.window.activateTarget(),
  };
  legacyContext.Window = context.window;
  legacyContext.Clipboard = context.clipboard;
  legacyContext.ReportStatus = (message) => context.status.report(String(message));
}

async function run(name, context) {
  bind(context);
  const result = new vm.Script(source(name), { filename: \`legacy/\${name}.js\` }).runInContext(legacyContext);
  return result && typeof result.then === "function" ? await result : result;
}
`;

const SLOT_FILES = [
  ["initScript", "init"],
  ["script", "execute"],
  ["gestureRecognizedScript", "gestureRecognized"],
  ["modifierTriggeredScript", "modifierTriggered"],
  ["gestureEndedScript", "gestureEnded"],
] as const;

export interface NodePluginMigration {
  plugin: NodePlugin;
  command: NodePluginCommand;
}

export function convertScriptCommandToNodePlugin(
  command: ScriptCommand,
  name: string,
): NodePluginMigration {
  if (command.language !== "js") {
    throw new Error("Only JavaScript scripts can be converted to Node plugins");
  }
  const files: Record<string, string> = {
    "index.mjs": LEGACY_NODE_PLUGIN_ENTRY,
  };
  const exports: string[] = [];

  for (const [field, handler] of SLOT_FILES) {
    const source = command[field];
    files[`legacy/${handler}.js`] = source;
    if (
      handler === "execute" ||
      (handler === "init" && source.trim()) ||
      (command.handleModifiers && source.trim())
    ) {
      exports.push(`export const ${handler} = (context) => run("${handler}", context);`);
    }
  }

  if (!command.handleModifiers) {
    exports.push('export const modifierTriggered = (context) => run("execute", context);');
  }

  files["index.mjs"] += `${exports.join("\n")}\n`;
  const plugin: NodePlugin = {
    id: newId(),
    name: name.trim() || "Converted JavaScript plugin",
    entry: "index.mjs",
    files,
    packageJson: DEFAULT_NODE_PLUGIN_MANIFEST,
    lockfile: null,
    allowLifecycleScripts: false,
  };
  return {
    plugin,
    command: { type: "nodePlugin", pluginId: plugin.id, exportName: "execute" },
  };
}

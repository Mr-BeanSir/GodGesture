import type { Command, ConfigDocument, NodePlugin, NodePluginCommand } from "@godgesture/shared";
import {
  configDocumentSizeBytes,
  DEFAULT_NODE_PLUGIN_MANIFEST,
  MAX_CONFIG_DOCUMENT_BYTES,
  MAX_NODE_PLUGINS,
} from "@godgesture/shared";
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

export interface LegacyScriptMigrationReport {
  converted: number;
  luaSkipped: number;
  capacitySkipped: number;
  sizeSkipped: number;
  pluginIds: string[];
}

/** Count legacy script commands without changing the document. */
export function countLegacyScriptCommands(document: ConfigDocument) {
  const commands = [
    ...document.global.intents.map((intent) => intent.command),
    ...document.apps.flatMap((app) => app.intents.map((intent) => intent.command)),
    ...document.boundaryIntents.map((intent) => intent.command),
  ];
  return commands.filter((command) => command.type === "script").length;
}

/** Convert every JavaScript legacy command in one document to Node plugins. */
export function migrateLegacyScriptsInDocument(
  document: ConfigDocument,
  nameFor: (name: string) => string,
): LegacyScriptMigrationReport {
  const report: LegacyScriptMigrationReport = {
    converted: 0,
    luaSkipped: 0,
    capacitySkipped: 0,
    sizeSkipped: 0,
    pluginIds: [],
  };
  const scopes = [
    document.global.intents,
    ...document.apps.map((app) => app.intents),
    document.boundaryIntents,
  ];
  for (const intents of scopes) {
    for (const intent of intents) {
      if (intent.command.type !== "script") continue;
      if (intent.command.language !== "js") {
        report.luaSkipped += 1;
        continue;
      }
      if (document.nodePlugins.length >= MAX_NODE_PLUGINS) {
        report.capacitySkipped += 1;
        continue;
      }
      const migration = convertScriptCommandToNodePlugin(
        intent.command,
        nameFor(intent.name),
      );
      const originalCommand = intent.command;
      document.nodePlugins.push(migration.plugin);
      intent.command = migration.command;
      if (configDocumentSizeBytes(document) > MAX_CONFIG_DOCUMENT_BYTES) {
        intent.command = originalCommand;
        document.nodePlugins.pop();
        report.sizeSkipped += 1;
        continue;
      }
      report.converted += 1;
      report.pluginIds.push(migration.plugin.id);
    }
  }
  return report;
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

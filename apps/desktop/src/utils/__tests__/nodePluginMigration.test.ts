import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  convertScriptCommandToNodePlugin,
  countLegacyScriptCommands,
  LEGACY_NODE_PLUGIN_ENTRY,
  migrateLegacyScriptsInDocument,
} from "../nodePluginMigration";
import { ConfigDocument } from "@godgesture/shared";

async function loadGeneratedPlugin(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "godgesture-node-migration-"));
  for (const [path, source] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }
  const module = await import(`${pathToFileURL(join(root, "index.mjs")).href}?test=${Date.now()}`);
  return { module, dispose: () => rm(root, { recursive: true, force: true }) };
}

function pluginContext(report: (value: string) => void, modifier = "none") {
  return {
    origin: { x: 1, y: 2 },
    endpoint: { x: 3, y: 4 },
    triggerButton: "right",
    modifier,
    phase: "execute",
    targetWindowAvailable: true,
    input: {},
    window: { activateTarget: async () => undefined },
    clipboard: {},
    status: { report: async (value: string) => report(value) },
  };
}

describe("legacy script migration", () => {
  it("counts and converts JavaScript commands across all scopes", () => {
    const document = ConfigDocument.parse({
      global: {
        intents: [{
          id: "30000000-0000-4000-8000-000000000011",
          name: "Global script",
          gesture: { trigger: "right", strokes: [], modifier: "none" },
          command: { type: "script", language: "js", script: "return 1;" },
        }],
      },
      apps: [{
        id: "30000000-0000-4000-8000-000000000012",
        name: "App",
        intents: [{
          id: "30000000-0000-4000-8000-000000000013",
          name: "App script",
          gesture: { trigger: "right", strokes: ["down"], modifier: "none" },
          command: { type: "script", language: "lua", script: "print('x')" },
        }],
      }],
      boundaryIntents: [],
    });
    expect(countLegacyScriptCommands(document)).toBe(2);
    const report = migrateLegacyScriptsInDocument(document, (name) => `Migrated ${name}`);
    expect(report).toMatchObject({ converted: 1, luaSkipped: 1, capacitySkipped: 0, sizeSkipped: 0 });
    expect(document.global.intents[0]!.command.type).toBe("nodePlugin");
    expect(document.apps[0]!.intents[0]!.command.type).toBe("script");
    expect(document.nodePlugins).toHaveLength(1);
  });

  it("leaves legacy scripts unchanged when the plugin capacity is full", () => {
    const document = ConfigDocument.parse({
      global: {
        intents: [{
          id: "30000000-0000-4000-8000-000000000021",
          name: "Overflow",
          gesture: { trigger: "right", strokes: [], modifier: "none" },
          command: { type: "script", language: "js", script: "return 1;" },
        }],
      },
      nodePlugins: Array.from({ length: 32 }, (_, index) => ({
        id: `40000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        name: `Plugin ${index}`,
      })),
    });
    const report = migrateLegacyScriptsInDocument(document, (name) => name);
    expect(report).toMatchObject({ converted: 0, luaSkipped: 0, capacitySkipped: 1, sizeSkipped: 0 });
    expect(document.global.intents[0]!.command.type).toBe("script");
  });

  it("preserves lifecycle sources in a persistent Node vm plugin", () => {
    const result = convertScriptCommandToNodePlugin(
      {
        type: "script",
        language: "js",
        initScript: "let count = 0;",
        script: "count += 1; ReportStatus(count);",
        handleModifiers: true,
        gestureRecognizedScript: "ReportStatus('recognized');",
        modifierTriggeredScript: "ReportStatus('modifier');",
        gestureEndedScript: "ReportStatus('ended');",
      },
      " Legacy conversion ",
    );

    expect(result.plugin.name).toBe("Legacy conversion");
    expect(result.plugin.files["index.mjs"]).toContain("vm.createContext");
    expect(result.plugin.files["index.mjs"]).toContain("export const gestureEnded");
    expect(result.plugin.files["legacy/init.js"]).toBe("let count = 0;");
    expect(result.plugin.files["legacy/execute.js"]).toContain("ReportStatus");
    expect(result.command).toMatchObject({
      type: "nodePlugin",
      pluginId: result.plugin.id,
      exportName: "execute",
    });
    expect(LEGACY_NODE_PLUGIN_ENTRY).toContain('readFileSync(new URL');
  });

  it("runs preserved lifecycle slots in one persistent Node context", async () => {
    const result = convertScriptCommandToNodePlugin(
      {
        type: "script",
        language: "js",
        initScript: "let count = 0;",
        script: "count += 1; ReportStatus(count);",
        handleModifiers: true,
        gestureRecognizedScript: "count += 10;",
        modifierTriggeredScript: "count += 100;",
        gestureEndedScript: "count += 1000;",
      },
      "Runtime migration",
    );
    const generated = await loadGeneratedPlugin(result.plugin.files);
    const statuses: string[] = [];
    const context = pluginContext((value) => statuses.push(value));

    try {
      await generated.module.init(context);
      await generated.module.gestureRecognized(context);
      await generated.module.modifierTriggered(context);
      await generated.module.gestureEnded(context);
      await generated.module.execute(context);
      expect(statuses).toEqual(["1111"]);
    } finally {
      await generated.dispose();
    }
  });

  it("executes the main slot for modifiers when legacy lifecycle handling is disabled", async () => {
    const result = convertScriptCommandToNodePlugin(
      {
        type: "script",
        language: "js",
        initScript: "",
        script: "ReportStatus('execute:' + Context.modifier);",
        handleModifiers: false,
        gestureRecognizedScript: "ReportStatus('must-not-run');",
        modifierTriggeredScript: "ReportStatus('must-not-run');",
        gestureEndedScript: "ReportStatus('must-not-run');",
      },
      "Immediate modifier migration",
    );
    const generated = await loadGeneratedPlugin(result.plugin.files);
    const statuses: string[] = [];

    try {
      await generated.module.modifierTriggered(
        pluginContext((value) => statuses.push(value), "wheelForward"),
      );
      expect(statuses).toEqual(["execute:wheelForward"]);
      expect(result.plugin.files["legacy/gestureRecognized.js"]).toContain("must-not-run");
      expect(result.plugin.files["index.mjs"]).not.toContain(
        'run("gestureRecognized", context)',
      );
    } finally {
      await generated.dispose();
    }
  });

  it("does not offer a Lua conversion", () => {
    expect(() =>
      convertScriptCommandToNodePlugin(
        {
          type: "script",
          language: "lua",
          initScript: "",
          script: "print('legacy')",
          handleModifiers: false,
          gestureRecognizedScript: "",
          modifierTriggeredScript: "",
          gestureEndedScript: "",
        },
        "Lua",
      ),
    ).toThrow("Only JavaScript scripts can be converted");
  });
});

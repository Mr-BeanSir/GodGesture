import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { convertScriptCommandToNodePlugin, LEGACY_NODE_PLUGIN_ENTRY } from "../nodePluginMigration";

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

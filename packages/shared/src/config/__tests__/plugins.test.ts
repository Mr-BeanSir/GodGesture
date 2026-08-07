import { describe, expect, it } from "vitest";
import {
  ConfigDocument,
  DEFAULT_NODE_PLUGIN_MANIFEST,
  DEFAULT_NODE_PLUGIN_SOURCE,
  MAX_NODE_PLUGINS,
  MAX_NODE_PLUGIN_FILE_BYTES,
  MAX_NODE_PLUGIN_FILES,
  MAX_NODE_PLUGIN_LOCKFILE_BYTES,
  MAX_NODE_PLUGIN_SOURCE_BYTES,
  NodePlugin,
} from "../../index.js";

const PLUGIN_ID = "30000000-0000-4000-8000-000000000001";

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    id: PLUGIN_ID,
    name: "Example",
    entry: "index.mjs",
    files: { "index.mjs": "export function onExecute() {}" },
    packageJson: DEFAULT_NODE_PLUGIN_MANIFEST,
    ...overrides,
  };
}

describe("Node plugin configuration", () => {
  it("ships a typed five-lifecycle starter template", () => {
    expect(DEFAULT_NODE_PLUGIN_SOURCE).toContain(
      'import("@godgesture/sdk").PluginContext',
    );
    for (const lifecycle of [
      "onInit",
      "onExecute",
      "onGestureRecognized",
      "onModifierTriggered",
      "onEnd",
    ]) {
      expect(DEFAULT_NODE_PLUGIN_SOURCE).toContain(
        `export const ${lifecycle} = defineHandler`,
      );
    }
    expect(DEFAULT_NODE_PLUGIN_SOURCE).not.toContain(
      "function onExecute(context) {",
    );
  });

  it("parses a filesystem plugin command reference without embedding source", () => {
    const document = ConfigDocument.parse({
      global: {
        intents: [{
          id: "40000000-0000-4000-8000-000000000001",
          name: "Run plugin",
          gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
          command: { type: "nodePlugin", pluginId: PLUGIN_ID },
          order: 0,
        }],
      },
    });

    expect(document.formatVersion).toBe(8);
    expect(document).not.toHaveProperty("nodePlugins");
    expect(document.global.intents[0]!.command.type).toBe("nodePlugin");
  });

  it("rejects the removed action reference field", () => {
    expect(() => ConfigDocument.parse({
      global: {
        intents: [{
          id: "40000000-0000-4000-8000-000000000003",
          name: "Legacy plugin reference",
          gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
          command: { type: "nodePlugin", pluginId: PLUGIN_ID, actionId: "default" },
          order: 0,
        }],
      },
    })).toThrow();
  });

  it("rejects missing entries, unsafe paths and invalid manifests", () => {
    expect(() => NodePlugin.parse(plugin({ entry: "missing.mjs" }))).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({ files: { "../escape.mjs": "" }, entry: "../escape.mjs" })),
    ).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({ files: { "C:/escape.mjs": "" }, entry: "C:/escape.mjs" })),
    ).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({ files: { "src/CON.js": "" }, entry: "src/CON.js" })),
    ).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({ files: { "package.json": "" }, entry: "package.json" })),
    ).toThrow(/reserved/);
    expect(() =>
      NodePlugin.parse(plugin({ files: { "node_modules/x.mjs": "" }, entry: "node_modules/x.mjs" })),
    ).toThrow(/reserved/);
    expect(() => NodePlugin.parse(plugin({ packageJson: "{}" }))).toThrow();
  });

  it("keeps filesystem plugin references valid when the project is absent locally", () => {
    const document = ConfigDocument.parse({
      global: {
        intents: [{
          id: "40000000-0000-4000-8000-000000000002",
          name: "Missing plugin",
          gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
          command: { type: "nodePlugin", pluginId: PLUGIN_ID },
          order: 0,
        }],
      },
    });
    expect(document.global.intents[0]?.command).toMatchObject({ pluginId: PLUGIN_ID });
  });

  it("enforces plugin, file, source and lockfile limits in UTF-8 bytes", () => {
    expect(() => NodePlugin.array().max(MAX_NODE_PLUGINS).parse(
      Array.from({ length: MAX_NODE_PLUGINS + 1 }, (_, index) => plugin({
        id: `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      })),
    )).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({
        files: Object.fromEntries(
          Array.from({ length: MAX_NODE_PLUGIN_FILES + 1 }, (_, index) => [
            `${index}.mjs`,
            "",
          ]),
        ),
        entry: "0.mjs",
      })),
    ).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({ files: { "index.mjs": "界".repeat(MAX_NODE_PLUGIN_FILE_BYTES) } })),
    ).toThrow();
    expect(() =>
      NodePlugin.parse(plugin({
        files: {
          "index.mjs": "x".repeat(MAX_NODE_PLUGIN_FILE_BYTES),
          "a.mjs": "x".repeat(MAX_NODE_PLUGIN_FILE_BYTES),
          "b.mjs": "x".repeat(MAX_NODE_PLUGIN_FILE_BYTES),
          "c.mjs": "x".repeat(MAX_NODE_PLUGIN_FILE_BYTES),
          "d.mjs": "x",
        },
      })),
    ).toThrow();
    expect(MAX_NODE_PLUGIN_SOURCE_BYTES).toBe(MAX_NODE_PLUGIN_FILE_BYTES * 4);
    expect(() =>
      NodePlugin.parse(plugin({ lockfile: "界".repeat(MAX_NODE_PLUGIN_LOCKFILE_BYTES) })),
    ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { ConfigDocument, migrateConfigDocument } from "../document.js";
import { GestureInput, GestureSpec } from "../gestures.js";

describe("configuration v6 migration", () => {
  it("migrates legacy corner and edge commands without losing enable flags", () => {
    const document = ConfigDocument.parse({
      formatVersion: 1,
      hotCorners: { enabled: false, commands: { leftTop: { type: "pause" } } },
      rubEdges: {
        enabled: true,
        commands: { bottom: { type: "hotKey", modifiers: ["meta"], keys: ["d"] } },
      },
    });

    expect(document.formatVersion).toBe(6);
    expect(document.hotCorners).toEqual({ enabled: false, commands: {} });
    expect(document.rubEdges).toEqual({ enabled: true, commands: {} });
    expect(document.boundaryIntents.every((intent) => intent.enabled)).toBe(true);
    expect(document.boundaryIntents).toEqual([
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        origin: { kind: "hotCorner", corner: "leftTop" },
        sequence: [],
        command: { type: "doNothing" },
      }),
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000007",
        origin: { kind: "rubEdge", edge: "bottom" },
        sequence: [],
        command: { type: "hotKey", modifiers: ["meta"], keys: ["d"] },
      }),
    ]);
  });

  it("is deterministic and idempotent", () => {
    const legacy = {
      formatVersion: 1,
      hotCorners: { commands: { rightBottom: { type: "doNothing" } } },
    };
    const first = ConfigDocument.parse(legacy);
    const second = ConfigDocument.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
    expect(migrateConfigDocument(legacy)).toEqual(migrateConfigDocument(legacy));
  });

  it("normalizes legacy stroke and modifier fields into ordered inputs", () => {
    const document = ConfigDocument.parse({
      formatVersion: 3,
      global: {
        intents: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            name: "Legacy wheel gesture",
            gesture: {
              trigger: "right",
              strokes: ["right", "down"],
              modifier: "wheelBackward",
            },
            command: { type: "pause" },
          },
        ],
      },
      apps: [
        {
          id: "30000000-0000-4000-8000-000000000002",
          name: "Legacy app",
          windows: { exeName: "legacy.exe" },
          intents: [
            {
              id: "30000000-0000-4000-8000-000000000003",
              name: "Legacy button gesture",
              gesture: {
                trigger: "right",
                strokes: ["left"],
                modifier: "middleButtonDown",
              },
              command: { type: "pause" },
            },
          ],
        },
      ],
    });

    expect(document.global.intents[0]?.gesture.inputs).toEqual([
      { type: "stroke", direction: "right" },
      { type: "stroke", direction: "down" },
      { type: "wheel", direction: "backward" },
    ]);
    expect(document.global.intents[0]?.gesture.modifier).toBe("none");
    expect(document.global.intents[0]).not.toHaveProperty("executeOnModifier");
    expect(document.apps[0]?.intents[0]?.gesture.inputs).toEqual([
      { type: "stroke", direction: "left" },
      { type: "button", button: "middle" },
    ]);
    expect(document.apps[0]?.intents[0]?.command).toEqual({ type: "doNothing" });
  });

  it("migrates an old immediate final input into an independent modifier", () => {
    const document = ConfigDocument.parse({
      formatVersion: 4,
      global: {
        intents: [
          {
            id: "40000000-0000-4000-8000-000000000010",
            name: "Repeat wheel",
            gesture: {
              trigger: "right",
              strokes: ["right"],
              modifier: "none",
              inputs: [
                { type: "stroke", direction: "right" },
                { type: "wheel", direction: "backward" },
              ],
            },
            command: { type: "audioVolume", delta: -1 },
            executeOnModifier: true,
          },
        ],
      },
    });

    expect(document.global.intents[0]?.gesture).toMatchObject({
      modifier: "wheelBackward",
      inputs: [{ type: "stroke", direction: "right" }],
    });
    expect(document.global.intents[0]).not.toHaveProperty("executeOnModifier");
  });

  it("preserves an explicitly recorded input order", () => {
    const inputOrder = [
      { type: "button", button: "middle" } as const,
      { type: "stroke", direction: "right" } as const,
      { type: "wheel", direction: "forward" } as const,
    ];
    const document = ConfigDocument.parse({
      formatVersion: 4,
      global: {
        intents: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            name: "Ordered gesture",
            gesture: {
              trigger: "right",
              strokes: ["right"],
              modifier: "none",
              inputs: inputOrder,
            },
            command: { type: "pause" },
          },
        ],
      },
    });

    expect(document.global.intents[0]?.gesture.inputs).toEqual(inputOrder);
  });

  it("validates input variants and the twelve-step limit", () => {
    expect(GestureInput.parse({ type: "button", button: "x2" })).toEqual({
      type: "button",
      button: "x2",
    });
    expect(GestureInput.parse({ type: "wheel", direction: "forward" })).toEqual({
      type: "wheel",
      direction: "forward",
    });
    expect(() => GestureInput.parse({ type: "button", button: "keyboard" })).toThrow();

    const twelveInputs = Array.from({ length: 12 }, () => ({
      type: "stroke" as const,
      direction: "right" as const,
    }));
    expect(GestureSpec.parse({
      trigger: "right",
      strokes: [],
      modifier: "none",
      inputs: twelveInputs,
    }).inputs).toHaveLength(12);
    expect(() => GestureSpec.parse({
      trigger: "right",
      strokes: [],
      modifier: "none",
      inputs: [...twelveInputs, { type: "wheel", direction: "forward" }],
    })).toThrow();
  });

  it("preserves version 2 boundary intents while adding the plugin collection", () => {
    const document = ConfigDocument.parse({
      formatVersion: 2,
      boundaryIntents: [{
        id: "20000000-0000-4000-8000-000000000001",
        name: "Existing boundary",
        origin: { kind: "rubEdge", edge: "left" },
        sequence: [],
        command: { type: "pause" },
        order: 0,
      }],
    });

    expect(document.formatVersion).toBe(6);
    expect(document.boundaryIntents).toHaveLength(1);
    expect(document.boundaryIntents[0]?.command).toEqual({ type: "doNothing" });
  });

  it("rejects removed pause commands in an already-current document", () => {
    expect(() => ConfigDocument.parse({
      formatVersion: 6,
      global: {
        intents: [{
          id: "50000000-0000-4000-8000-000000000001",
          name: "Invalid pause",
          gesture: { trigger: "right", strokes: ["down"], modifier: "none" },
          command: { type: "pause" },
        }],
      },
    })).toThrow();
  });

  it("migrates embedded plugin commands to stable action references", () => {
    const document = ConfigDocument.parse({
      formatVersion: 5,
      nodePlugins: [{
        id: "50000000-0000-4000-8000-000000000010",
        name: "Legacy plugin",
      }],
      global: {
        intents: [{
          id: "50000000-0000-4000-8000-000000000011",
          name: "Run legacy export",
          gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
          command: {
            type: "nodePlugin",
            pluginId: "50000000-0000-4000-8000-000000000010",
            exportName: "customHandler",
          },
        }],
      },
    });

    expect(document).not.toHaveProperty("nodePlugins");
    expect(document.global.intents[0]?.command).toEqual({
      type: "nodePlugin",
      pluginId: "50000000-0000-4000-8000-000000000010",
      actionId: "customHandler",
    });
  });

  it("rejects removed script commands instead of converting them", () => {
    const result = ConfigDocument.safeParse({
      formatVersion: 3,
      global: {
        intents: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            name: "Removed script",
            gesture: { trigger: "right", strokes: ["down"], modifier: "none" },
            command: {
              type: "script",
              language: "js",
              script: "return 1",
            },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });
});

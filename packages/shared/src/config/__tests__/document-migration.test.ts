import { describe, expect, it } from "vitest";
import { ConfigDocument, migrateConfigDocument } from "../document.js";

describe("configuration v2 migration", () => {
  it("migrates legacy corner and edge commands without losing enable flags", () => {
    const document = ConfigDocument.parse({
      formatVersion: 1,
      hotCorners: { enabled: false, commands: { leftTop: { type: "pause" } } },
      rubEdges: {
        enabled: true,
        commands: { bottom: { type: "hotKey", modifiers: ["meta"], keys: ["d"] } },
      },
    });

    expect(document.formatVersion).toBe(2);
    expect(document.hotCorners).toEqual({ enabled: false, commands: {} });
    expect(document.rubEdges).toEqual({ enabled: true, commands: {} });
    expect(document.boundaryIntents).toEqual([
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        origin: { kind: "hotCorner", corner: "leftTop" },
        sequence: [],
        command: { type: "pause" },
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
});

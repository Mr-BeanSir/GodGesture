import { describe, expect, it } from "vitest";
import { GestureTemplatePackage } from "@godgesture/shared";
import {
  buildGestureTemplatePackage,
  nodePluginIdsInIntents,
  type GestureExportMetadata,
} from "../gesture-export";

const metadata: GestureExportMetadata = {
  slug: "browser-basics",
  version: "1.0.0",
  author: "GodGesture",
  title: "浏览器基础",
  summary: "浏览器手势",
  tags: ["browser"],
};

const intent = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "向右",
  enabled: true,
  gesture: {
    trigger: "right" as const,
    strokes: ["right" as const],
    inputs: [{ type: "stroke" as const, direction: "right" as const }],
    modifier: "none" as const,
  },
  command: { type: "doNothing" as const },
  order: 4,
};

describe("gesture export", () => {
  it("creates a valid app template and removes local identity fields", () => {
    const result = buildGestureTemplatePackage(
      [{
        target: {
          scope: "app",
          id: "20000000-0000-4000-8000-000000000001",
          app: {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Chrome",
          groupId: "30000000-0000-4000-8000-000000000001",
          windows: { exeName: "chrome.exe", matchByExactPath: false },
          gesturingEnabled: true,
          inheritGlobalGestures: true,
          intents: [intent],
          order: 0,
          },
        },
        intents: [intent],
      }],
      metadata,
    );

    expect(GestureTemplatePackage.parse(result).targets[0]).toMatchObject({
      scope: "app",
      name: "Chrome",
      windows: { exeName: "chrome.exe" },
    });
    expect(result.targets[0]?.intents[0]).not.toHaveProperty("id");
    expect(result.targets[0]?.intents[0]).not.toHaveProperty("order");
  });

  it("reports Node.js plugin references that cannot be reconstructed from sync data", () => {
    const pluginIntent = {
      ...intent,
      command: {
        type: "nodePlugin" as const,
        pluginId: "40000000-0000-4000-8000-000000000001",
      },
    };
    expect(nodePluginIdsInIntents([pluginIntent])).toEqual([
      "40000000-0000-4000-8000-000000000001",
    ]);
    expect(() =>
      buildGestureTemplatePackage(
        [{ target: { scope: "global", id: "__global__" }, intents: [pluginIntent] }],
        metadata,
      ),
    ).toThrow(/Missing online sources/);
  });
});

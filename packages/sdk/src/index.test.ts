import { describe, expect, it } from "vitest";
import { defineHandler, type PluginContext } from "./index.js";

describe("GodGesture Node plugin SDK", () => {
  it("keeps handler identity while preserving the typed async context", async () => {
    const handler = defineHandler(async (context: PluginContext) => {
      await context.input.sendText(context.phase);
      return context.targetWindowAvailable;
    });

    expect(defineHandler(handler)).toBe(handler);
  });
});

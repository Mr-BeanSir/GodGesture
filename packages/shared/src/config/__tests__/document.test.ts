import { describe, expect, it } from "vitest";
import { ConfigDocument, CONFIG_FORMAT_VERSION, DEFAULT_APP_GROUP_ID } from "../document.js";
import { PathTrackerPreferences } from "../preferences.js";

describe("configuration document v8", () => {
  it("initializes the complete current document shape", () => {
    const document = ConfigDocument.parse({});

    expect(document.formatVersion).toBe(CONFIG_FORMAT_VERSION);
    expect(document.groups).toEqual([
      { id: DEFAULT_APP_GROUP_ID, name: "默认", order: 0 },
    ]);
    expect(document.apps).toEqual([]);
    expect(document.global.intents).toEqual([]);
    expect(document.boundaryIntents).toEqual([]);
    expect(document.preferences.gestureView.showBoundaryGuide).toBe(false);
  });

  it("defaults the boundary guide to off and preserves an explicit value", () => {
    expect(ConfigDocument.parse({}).preferences.gestureView.showBoundaryGuide).toBe(false);
    expect(
      ConfigDocument.parse({
        preferences: { gestureView: { showBoundaryGuide: true } },
      }).preferences.gestureView.showBoundaryGuide,
    ).toBe(true);
  });

  it("rejects previous format versions instead of migrating them at read time", () => {
    for (const formatVersion of [1, 2, 3, 4, 5, 6, 7]) {
      expect(() => ConfigDocument.parse({ formatVersion })).toThrow();
    }
  });

  it("rejects removed top-level and intent fields", () => {
    expect(() => ConfigDocument.parse({
      formatVersion: CONFIG_FORMAT_VERSION,
      nodePlugins: [],
    })).toThrow();
    expect(() => ConfigDocument.parse({
      formatVersion: CONFIG_FORMAT_VERSION,
      global: {
        intents: [{
          id: "40000000-0000-4000-8000-000000000001",
          name: "Legacy modifier",
          gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
          command: { type: "doNothing" },
          executeOnModifier: true,
        }],
      },
    })).toThrow();
  });

  it("normalizes the legacy diagonal gesture preference away", () => {
    const preferences = PathTrackerPreferences.parse({
      enable8Directions: false,
      triggerButtons: ["right"],
    });

    expect("enable8Directions" in preferences).toBe(false);
    expect(preferences.triggerButtons).toEqual(["right"]);
  });
});

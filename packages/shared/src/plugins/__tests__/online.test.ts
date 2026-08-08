import { describe, expect, it } from "vitest";
import {
  OFFICIAL_ONLINE_PLUGIN_REF,
  OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL,
  OnlinePluginCatalog,
  parseOnlinePluginCatalog,
} from "../../index.js";

const entry = {
  pluginId: "30000000-0000-4000-8000-000000000001",
  subdirectory: "plugins/demo",
  title: "Demo plugin",
  summary: "A plugin used for testing.",
  disabled: false,
};

describe("online plugin catalog protocol", () => {
  it("uses single plain-text metadata and the official fixed source", () => {
    const catalog = parseOnlinePluginCatalog(JSON.stringify({
      formatVersion: 1,
      generatedAt: "2026-08-08T00:00:00Z",
      entries: [entry],
    }));
    expect(catalog.entries[0]).toMatchObject(entry);
    expect(OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL).toBe("https://github.com/Mr-BeanSir/GodGesture-Plugins");
    expect(OFFICIAL_ONLINE_PLUGIN_REF).toBe("main");
    expect(() => OnlinePluginCatalog.parse({
      formatVersion: 1,
      generatedAt: "2026-08-08T00:00:00Z",
      entries: [{ ...entry, title: { "zh-CN": "演示", en: "Demo" } }],
    })).toThrow();
  });

  it("requires unique plugin IDs and safe non-empty subdirectories", () => {
    expect(() => OnlinePluginCatalog.parse({
      formatVersion: 1,
      generatedAt: "2026-08-08T00:00:00Z",
      entries: [entry, { ...entry, subdirectory: "plugins/other" }],
    })).toThrow();
    for (const subdirectory of ["", "../outside", "CON", "plugins/\u202Ehidden"]) {
      expect(() => OnlinePluginCatalog.parse({
        formatVersion: 1,
        generatedAt: "2026-08-08T00:00:00Z",
        entries: [{ ...entry, subdirectory }],
      })).toThrow();
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_ONLINE_PLUGIN_CATALOG_BYTES,
  OnlinePluginCatalog,
  OnlinePluginCatalogProtocolError,
  parseOnlinePluginCatalog,
} from "../../index.js";

const entry = {
  slug: "demo-plugin",
  version: "1.0.0",
  title: { "zh-CN": "演示插件", en: "Demo plugin" },
  summary: { "zh-CN": "用于测试", en: "For testing" },
  pluginId: "30000000-0000-4000-8000-000000000001",
  repositoryUrl: "https://github.com/owner/repository",
  ref: "main",
  subdirectory: "plugins/demo",
};

describe("online plugin catalog protocol", () => {
  it("parses a GitHub plugin source with a portable subdirectory", () => {
    const catalog = parseOnlinePluginCatalog(
      JSON.stringify({
        formatVersion: 1,
        generatedAt: "2026-08-07T08:00:00Z",
        entries: [entry],
      }),
    );
    expect(catalog.entries[0]).toMatchObject(entry);
  });

  it("rejects non-GitHub repositories, unsafe refs, and traversal paths", () => {
    for (const source of [
      { ...entry, repositoryUrl: "https://example.com/owner/repository" },
      { ...entry, ref: "feature..unsafe" },
      { ...entry, subdirectory: "../outside" },
    ]) {
      expect(() =>
        OnlinePluginCatalog.parse({
          formatVersion: 1,
          generatedAt: "2026-08-07T08:00:00Z",
          entries: [source],
        }),
      ).toThrow();
    }
  });

  it("rejects Windows reserved subdirectory names and oversized source fields", () => {
    for (const subdirectory of ["CON", "nested/PRN.txt", "com1", "LPT9.log"]) {
      expect(() =>
        OnlinePluginCatalog.parse({
          formatVersion: 1,
          generatedAt: "2026-08-07T08:00:00Z",
          entries: [{ ...entry, subdirectory }],
        }),
      ).toThrow();
    }
    expect(() =>
      OnlinePluginCatalog.parse({
        formatVersion: 1,
        generatedAt: "2026-08-07T08:00:00Z",
        entries: [{ ...entry, ref: "x".repeat(129) }],
      }),
    ).toThrow();
    expect(() =>
      OnlinePluginCatalog.parse({
        formatVersion: 1,
        generatedAt: "2026-08-07T08:00:00Z",
        entries: [{ ...entry, subdirectory: "x".repeat(257) }],
      }),
    ).toThrow();
  });

  it("uses stable errors for oversized and malformed catalog payloads", () => {
    expectProtocolCode(
      () => parseOnlinePluginCatalog("x".repeat(MAX_ONLINE_PLUGIN_CATALOG_BYTES + 1)),
      "catalog_too_large",
    );
    expectProtocolCode(() => parseOnlinePluginCatalog("{"), "invalid_json");
  });
});

function expectProtocolCode(operation: () => unknown, code: string) {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(OnlinePluginCatalogProtocolError);
    expect((error as OnlinePluginCatalogProtocolError).code).toBe(code);
  }
}

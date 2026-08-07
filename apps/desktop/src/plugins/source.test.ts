import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ONLINE_PLUGIN_CATALOG_URL,
  createRemoteOnlinePluginSource,
  type PluginCatalogTextTransport,
} from "./source";

const catalog = JSON.stringify({
  formatVersion: 1,
  generatedAt: "2026-08-07T08:00:00Z",
  entries: [
    {
      slug: "demo-plugin",
      version: "1.0.0",
      author: "GodGesture",
      title: { "zh-CN": "演示插件", en: "Demo plugin" },
      summary: { "zh-CN": "用于测试", en: "For testing" },
      pluginId: "30000000-0000-4000-8000-000000000001",
      repositoryUrl: "https://github.com/owner/repository",
      ref: "main",
      subdirectory: "plugin",
    },
  ],
});

describe("online plugin source", () => {
  it("uses the repository catalog by default", async () => {
    const transport = vi.fn<PluginCatalogTextTransport>(async (url) => {
      expect(url).toBe(DEFAULT_ONLINE_PLUGIN_CATALOG_URL);
      return catalog;
    });

    const source = createRemoteOnlinePluginSource(undefined, transport);
    await expect(source.loadCatalog()).resolves.toMatchObject({
      entries: [{ slug: "demo-plugin" }],
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not fall back to a GitHub Release catalog", async () => {
    const transport = vi.fn<PluginCatalogTextTransport>(async (url) => {
      expect(url).toBe(DEFAULT_ONLINE_PLUGIN_CATALOG_URL);
      return catalog;
    });

    const source = createRemoteOnlinePluginSource(undefined, transport);
    await expect(source.loadCatalog()).resolves.toMatchObject({
      entries: [{ slug: "demo-plugin" }],
    });
    expect(transport).toHaveBeenCalledOnce();
  });
});

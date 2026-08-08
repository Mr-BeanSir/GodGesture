import { describe, expect, it, vi } from "vitest";
import { BackendError } from "../api/backend";
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
        pluginId: "30000000-0000-4000-8000-000000000001",
        subdirectory: "plugins/plugin",
        title: "Demo plugin",
        summary: "For testing",
        disabled: false,
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
      entries: [{ pluginId: "30000000-0000-4000-8000-000000000001" }],
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
      entries: [{ pluginId: "30000000-0000-4000-8000-000000000001" }],
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("uses a valid cached catalog and falls back to it when refresh is offline", async () => {
    const cache = {
      catalogCacheGet: vi.fn(async () => catalog),
      catalogCacheSet: vi.fn(async () => undefined),
    };
    const transport = vi.fn<PluginCatalogTextTransport>(async () => {
      throw new BackendError("template_network", "offline");
    });
    const source = createRemoteOnlinePluginSource(
      undefined,
      transport,
      cache,
    );

    await expect(source.loadCatalog()).resolves.toMatchObject({
      entries: [{ pluginId: "30000000-0000-4000-8000-000000000001" }],
    });
    expect(transport).not.toHaveBeenCalled();
    await expect(source.loadCatalog(true)).resolves.toMatchObject({
      entries: [{ pluginId: "30000000-0000-4000-8000-000000000001" }],
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(cache.catalogCacheSet).not.toHaveBeenCalled();
  });
});

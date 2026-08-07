import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const slots = vi.hoisted(() => ({
  backend: null as ReturnType<typeof makeBackend> | null,
  source: null as ReturnType<typeof makeSource> | null,
}));

vi.mock("../../api/backend", () => ({
  useBackend: () => {
    if (!slots.backend) throw new Error("backend mock is not configured");
    return slots.backend;
  },
}));

vi.mock("../../plugins/source", () => {
  class OnlinePluginSourceError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "OnlinePluginSourceError";
    }
  }
  return {
    OnlinePluginSourceError,
    createOnlinePluginSource: () => {
      if (!slots.source) throw new Error("source mock is not configured");
      return slots.source;
    },
  };
});

import { usePluginsStore } from "../plugins";
import { OnlinePluginSourceError } from "../../plugins/source";

const ready = {
  id: "plugin.demo",
  name: "gesture-demo",
  version: "0.1.0",
  path: "C:/plugins/gesture-demo",
  entry: "index.mjs",
  apiVersion: 1,
  lifecycles: ["onInit", "onExecute"],
  status: "ready" as const,
  error: null,
  lastReloadAt: 1,
};

const onlineEntry = {
  slug: "online-plugin",
  version: "1.0.0",
  author: "GodGesture",
  title: { "zh-CN": "在线插件", en: "Online plugin" },
  summary: { "zh-CN": "用于安装测试", en: "Used for installation tests" },
  pluginId: "50000000-0000-4000-8000-000000000001",
  repositoryUrl: "https://github.com/owner/online-plugin",
  ref: "v1.0.0",
  subdirectory: "packages/plugin",
};

function makeBackend() {
  let snapshot = { root: "C:/plugins", plugins: [ready] };
  return {
    isTauri: false,
    nodePluginsGet: vi.fn(async () => structuredClone(snapshot)),
    nodePluginsRescan: vi.fn(async () => structuredClone(snapshot)),
    nodePluginsDirectory: vi.fn(async () => snapshot.root),
    nodePluginInstall: vi.fn(async () => structuredClone(snapshot)),
    openPath: vi.fn(async (_path: string) => undefined),
    onNodePluginsChanged: vi.fn(async (listener: (next: typeof snapshot) => void) => {
      listener;
      return () => undefined;
    }),
    setSnapshot(next: typeof snapshot) {
      snapshot = next;
    },
  };
}

function makeSource() {
  return {
    loadCatalog: vi.fn(async () => ({ entries: [onlineEntry] })),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  slots.backend = makeBackend();
  slots.source = makeSource();
});

describe("plugins store", () => {
  it("deduplicates initialization and keeps the selected project across rescans", async () => {
    const store = usePluginsStore();
    await Promise.all([store.initialize(), store.initialize()]);
    expect(slots.backend!.nodePluginsGet).toHaveBeenCalledOnce();
    expect(store.selected?.id).toBe(ready.id);

    const updated = { ...ready, version: "0.2.0" };
    slots.backend!.setSnapshot({ root: "C:/plugins", plugins: [updated] });
    await store.refresh();
    expect(store.selected?.path).toBe(ready.path);
    expect(store.selected?.version).toBe("0.2.0");
  });

  it("retains an actionable error when opening a plugin directory fails", async () => {
    slots.backend!.openPath.mockRejectedValueOnce(new Error("access denied"));
    const store = usePluginsStore();
    await store.initialize();
    await store.openRoot();
    expect(store.error?.message).toBe("access denied");
    expect(store.error?.operation).toBe("openRoot");
    expect(store.error?.path).toBe("C:/plugins");
    expect(store.error?.stack).toContain("Error: access denied");
  });

  it("preserves structured host errors for reporting", async () => {
    slots.backend!.openPath.mockRejectedValueOnce({
      error: "Not allowed to open path C:/plugins",
    });
    const store = usePluginsStore();
    await store.initialize();
    await store.openRoot();
    expect(store.error?.message).toBe("Not allowed to open path C:/plugins");
    expect(store.error?.thrownValue).toContain("Not allowed to open path C:/plugins");
    expect(store.error?.operation).toBe("openRoot");
  });

  it("recovers after a failed initial scan", async () => {
    slots.backend!.nodePluginsGet.mockRejectedValueOnce(new Error("scan failed"));
    const store = usePluginsStore();
    await store.initialize();
    expect(store.error?.message).toBe("scan failed");
    expect(store.error?.operation).toBe("initialize");
    await store.refresh();
    expect(store.error).toBeNull();
    expect(store.plugins).toHaveLength(1);
  });

  it("loads the online catalog once and applies a successful installation snapshot", async () => {
    const store = usePluginsStore();
    await Promise.all([store.loadOnlineCatalog(), store.loadOnlineCatalog()]);
    expect(slots.source!.loadCatalog).toHaveBeenCalledOnce();
    expect(store.onlineEntries).toEqual([onlineEntry]);

    const installed = {
      ...ready,
      id: onlineEntry.pluginId,
      name: "online-plugin",
      path: "C:/plugins/online-plugin",
    };
    slots.backend!.nodePluginInstall.mockResolvedValueOnce({
      root: "C:/plugins",
      plugins: [ready, installed],
    });

    await expect(store.installOnline(onlineEntry)).resolves.toBe(true);
    expect(slots.backend!.nodePluginInstall).toHaveBeenCalledWith({
      pluginId: onlineEntry.pluginId,
      repositoryUrl: onlineEntry.repositoryUrl,
      ref: onlineEntry.ref,
      subdirectory: onlineEntry.subdirectory,
    });
    expect(store.installedPluginIds.has(onlineEntry.pluginId)).toBe(true);

    await expect(store.installOnline(onlineEntry)).resolves.toBe(true);
    expect(slots.backend!.nodePluginInstall).toHaveBeenCalledOnce();
  });

  it("keeps a stable online catalog error after a failed request", async () => {
    slots.source!.loadCatalog.mockRejectedValueOnce(
      new OnlinePluginSourceError("template_network", "catalog offline"),
    );
    const store = usePluginsStore();

    await store.loadOnlineCatalog();
    expect(store.onlineCatalogError).toBe("template_network");
    expect(store.onlineEntries).toEqual([]);
    expect(store.loadingOnlineCatalog).toBe(false);
  });

  it("tracks one in-progress online installation and clears its state afterward", async () => {
    const store = usePluginsStore();
    const installation = deferred<{ root: string; plugins: typeof ready[] }>();
    slots.backend!.nodePluginInstall.mockImplementationOnce(
      () => installation.promise,
    );

    const first = store.installOnline(onlineEntry);
    expect(store.installingPluginId).toBe(onlineEntry.pluginId);
    await expect(
      store.installOnline({
        ...onlineEntry,
        slug: "another-online-plugin",
        pluginId: "50000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toBe(false);
    expect(slots.backend!.nodePluginInstall).toHaveBeenCalledOnce();

    installation.resolve({ root: "C:/plugins", plugins: [ready] });
    await expect(first).resolves.toBe(true);
    expect(store.installingPluginId).toBeNull();
  });

  it("retains a structured online installation error without changing the snapshot", async () => {
    const store = usePluginsStore();
    const hostError = Object.assign(new Error("manifest id mismatch"), {
      name: "BackendError",
      code: "plugin_manifest_mismatch",
    });
    slots.backend!.nodePluginInstall.mockRejectedValueOnce(hostError);

    await expect(store.installOnline(onlineEntry)).resolves.toBe(false);
    expect(store.error).toMatchObject({
      operation: "installOnline",
      path: onlineEntry.repositoryUrl,
      code: "plugin_manifest_mismatch",
      message: "manifest id mismatch",
    });
    expect(store.plugins).toEqual([]);
    expect(store.installingPluginId).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

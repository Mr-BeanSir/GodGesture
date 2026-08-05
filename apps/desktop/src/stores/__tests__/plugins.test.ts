import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const slots = vi.hoisted(() => ({ backend: null as ReturnType<typeof makeBackend> | null }));

vi.mock("../../api/backend", () => ({
  useBackend: () => {
    if (!slots.backend) throw new Error("backend mock is not configured");
    return slots.backend;
  },
}));

import { usePluginsStore } from "../plugins";

const ready = {
  id: "plugin.demo",
  name: "gesture-demo",
  version: "0.1.0",
  path: "C:/plugins/gesture-demo",
  entry: "index.mjs",
  apiVersion: 1,
  actions: [{ id: "default", name: "Execute", exportName: "onExecute" }],
  status: "ready" as const,
  error: null,
  lastReloadAt: 1,
};

function makeBackend() {
  let snapshot = { root: "C:/plugins", plugins: [ready] };
  return {
    nodePluginsGet: vi.fn(async () => structuredClone(snapshot)),
    nodePluginsRescan: vi.fn(async () => structuredClone(snapshot)),
    nodePluginsDirectory: vi.fn(async () => snapshot.root),
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

beforeEach(() => {
  setActivePinia(createPinia());
  slots.backend = makeBackend();
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
});

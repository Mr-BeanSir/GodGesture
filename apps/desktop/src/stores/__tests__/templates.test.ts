import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import {
  ConfigDocument,
  GestureTemplateCatalog,
  GestureTemplatePackage,
  type GestureTemplateCatalog as GestureTemplateCatalogValue,
  type GestureTemplatePackage as GestureTemplatePackageValue,
} from "@godgesture/shared";

const slots = vi.hoisted(() => ({
  config: null as ReturnType<typeof makeConfig> | null,
  source: null as ReturnType<typeof makeSource> | null,
}));

vi.mock("../config", () => ({
  useConfigStore: () => {
    if (!slots.config) throw new Error("config mock is not configured");
    return slots.config;
  },
}));

vi.mock("../../templates/source", () => {
  class TemplateSourceError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "TemplateSourceError";
    }
  }
  return {
    TemplateSourceError,
    createGestureTemplateSource: () => {
      if (!slots.source) throw new Error("source mock is not configured");
      return slots.source;
    },
  };
});

import { useTemplatesStore } from "../templates";

const pluginSource = {
  pluginId: "40000000-0000-4000-8000-000000000001",
  repositoryUrl: "https://github.com/owner/plugin-repository",
  ref: "v1.0.0",
  subdirectory: "plugin",
};

function fixture(withPlugin = false) {
  const entry = {
    slug: "global-basics",
    version: "1.0.0",
    title: { "zh-CN": "全局基础", en: "Global basics" },
    summary: { "zh-CN": "窗口操作", en: "Window commands" },
    author: "GodGesture",
    tags: ["window"],
    targets: [{ scope: "global" as const }],
    risks: [],
    packageUrl: "https://example.com/global-basics.json",
  };
  const catalog = GestureTemplateCatalog.parse({
    formatVersion: 2,
    generatedAt: "2026-07-28T15:00:00Z",
    entries: [entry],
  });
  const templatePackage = GestureTemplatePackage.parse({
    formatVersion: 2,
    slug: entry.slug,
    version: entry.version,
    author: "GodGesture",
    ...(withPlugin ? { plugins: [pluginSource] } : {}),
    targets: [{
      scope: "global",
      intents: [
        {
          name: "No operation",
          gesture: {
            trigger: "right",
            strokes: ["up"],
            modifier: "none",
          },
          command: withPlugin
            ? { type: "nodePlugin", pluginId: pluginSource.pluginId }
            : { type: "doNothing" },
        },
      ],
    }],
  });
  return { catalog, entry: catalog.entries[0]!, templatePackage };
}

function makeConfig() {
  return {
    backend: {
      isTauri: false,
      nodePluginInstall: vi.fn(
        async (_source: unknown): Promise<void> => undefined,
      ),
    },
    doc: reactive(ConfigDocument.parse({})),
    applyTemplateDocument: vi.fn(
      async (
        _document: ReturnType<typeof ConfigDocument.parse>,
        _expectedDocument: ReturnType<typeof ConfigDocument.parse>,
      ) => true,
    ),
  };
}

function makeSource(
  catalog: GestureTemplateCatalogValue,
  templatePackage: GestureTemplatePackageValue,
) {
  return {
    loadCatalog: vi.fn(async () => structuredClone(catalog)),
    loadPackage: vi.fn(async () => structuredClone(templatePackage)),
  };
}

describe("templates store", () => {
  beforeEach(() => {
    const values = fixture();
    slots.config = makeConfig();
    slots.source = makeSource(values.catalog, values.templatePackage);
    setActivePinia(createPinia());
  });

  it("deduplicates catalog loads and filters localized metadata", async () => {
    const store = useTemplatesStore();

    await Promise.all([store.loadCatalog(), store.loadCatalog()]);
    expect(slots.source!.loadCatalog).toHaveBeenCalledTimes(1);
    expect(store.filteredEntries).toHaveLength(1);

    store.query = "窗口";
    expect(store.filteredEntries).toHaveLength(1);
    store.query = "missing";
    expect(store.filteredEntries).toHaveLength(0);
  });

  it("caches packages, plans fresh intents, and applies the expected snapshot", async () => {
    const store = useTemplatesStore();
    await store.loadCatalog();
    const entry = store.entries[0]!;

    await store.openDetails(entry);
    expect(store.adoptionPlan?.stats).toEqual({
      added: 1,
      replaced: 0,
      skipped: 0,
    });
    expect(store.adoptionPlan?.document.global.intents[0]?.id).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    await expect(store.adopt()).resolves.toBe(true);
    expect(slots.config!.applyTemplateDocument).toHaveBeenCalledTimes(1);

    await store.openDetails(entry);
    expect(slots.source!.loadPackage).toHaveBeenCalledTimes(1);
  });

  it("reports a stale configuration without claiming adoption", async () => {
    slots.config!.applyTemplateDocument.mockResolvedValueOnce(false);
    const store = useTemplatesStore();
    await store.loadCatalog();
    await store.openDetails(store.entries[0]!);

    await expect(store.adopt()).resolves.toBe(false);
    expect(store.adoptionError).toBe("template_config_changed");
    expect(store.adopted).toBe(false);
  });

  it("installs template plugins before committing the planned configuration", async () => {
    const values = fixture(true);
    slots.source = makeSource(values.catalog, values.templatePackage);
    const installation = deferred<void>();
    slots.config!.backend.nodePluginInstall.mockImplementationOnce(
      () => installation.promise,
    );
    const store = useTemplatesStore();
    await store.loadCatalog();
    await store.openDetails(store.entries[0]!);

    const adoption = store.adopt();
    expect(store.adopting).toBe(true);
    expect(slots.config!.backend.nodePluginInstall).toHaveBeenCalledWith(pluginSource);
    expect(slots.config!.applyTemplateDocument).not.toHaveBeenCalled();

    installation.resolve();
    await expect(adoption).resolves.toBe(true);
    expect(slots.config!.applyTemplateDocument).toHaveBeenCalledTimes(1);
    expect(store.adopted).toBe(true);
    expect(store.adopting).toBe(false);
  });

  it("does not commit a template when a plugin installation fails", async () => {
    const values = fixture(true);
    slots.source = makeSource(values.catalog, values.templatePackage);
    slots.config!.backend.nodePluginInstall.mockRejectedValueOnce(
      Object.assign(new Error("plugin download failed"), {
        code: "plugin_download_failed",
      }),
    );
    const store = useTemplatesStore();
    await store.loadCatalog();
    await store.openDetails(store.entries[0]!);

    await expect(store.adopt()).resolves.toBe(false);
    expect(slots.config!.applyTemplateDocument).not.toHaveBeenCalled();
    expect(store.adoptionError).toBe("template_plugin_install_failed");
    expect(store.adopted).toBe(false);
    expect(store.adopting).toBe(false);
  });

  it("commits the plan that was confirmed before plugin installation began", async () => {
    const values = fixture(true);
    slots.source = makeSource(values.catalog, values.templatePackage);
    const installation = deferred<void>();
    slots.config!.backend.nodePluginInstall.mockImplementationOnce(
      () => installation.promise,
    );
    const store = useTemplatesStore();
    await store.loadCatalog();
    await store.openDetails(store.entries[0]!);
    const confirmedIntentId = store.adoptionPlan!.document.global.intents[0]!.id;

    const adoption = store.adopt();
    store.setConflictPolicy("replaceExisting");
    expect(store.adoptionPlan!.document.global.intents[0]!.id).not.toBe(
      confirmedIntentId,
    );

    installation.resolve();
    await expect(adoption).resolves.toBe(true);
    const [appliedDocument] = slots.config!.applyTemplateDocument.mock.calls[0]!;
    expect(appliedDocument.global.intents[0]!.id).toBe(confirmedIntentId);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

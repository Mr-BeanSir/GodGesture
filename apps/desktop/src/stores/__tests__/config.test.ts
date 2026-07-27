import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import {
  ConfigDocument,
  MachineLocalSettings,
  importLegacyConfig,
  type LegacyImportResult,
} from "@godgesture/shared";

const backendSlot = vi.hoisted(() => ({ current: null as ReturnType<typeof makeBackend> | null }));

vi.mock("../../api/backend", () => {
  class BackendError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "BackendError";
    }
  }
  return {
    BackendError,
    useBackend: () => {
      if (!backendSlot.current) throw new Error("mock backend is not configured");
      return backendSlot.current;
    },
  };
});

import { BackendError } from "../../api/backend";
import { useConfigStore } from "../config";

const EMPTY_WG2 = JSON.stringify({
  FileVersion: "3",
  Global: { GestureIntents: [] },
  Apps: {},
});

function documentWithLocale(locale: "auto" | "zh-CN" | "en") {
  const imported = importLegacyConfig({ gesturesWg2: EMPTY_WG2 }).document;
  return ConfigDocument.parse({
    ...imported,
    preferences: { ...imported.preferences, locale },
  });
}

function makeBackend() {
  let document = documentWithLocale("auto");
  let machine = MachineLocalSettings.parse({ runAsAdmin: true });
  return {
    isTauri: false,
    configGet: vi.fn(async () => structuredClone(document)),
    configSet: vi.fn(async (next: ConfigDocument) => {
      document = ConfigDocument.parse(next);
    }),
    machineGet: vi.fn(async () => ({ ...machine })),
    machineSet: vi.fn(async (next: MachineLocalSettings) => {
      machine = MachineLocalSettings.parse(next);
    }),
    legacyImportApply: vi.fn(async (nextDocument: ConfigDocument, nextMachine: MachineLocalSettings) => {
      document = ConfigDocument.parse(nextDocument);
      machine = MachineLocalSettings.parse(nextMachine);
    }),
    engineIsPaused: vi.fn(async () => false),
    engineTogglePause: vi.fn(async () => false),
    onPauseChanged: vi.fn(async () => () => undefined),
    captureStart: vi.fn(async () => undefined),
    captureCancel: vi.fn(async () => undefined),
    onGestureCaptured: vi.fn(async () => () => undefined),
    pickWindow: vi.fn(async () => null),
    appIcon: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    getAppVersion: vi.fn(async () => "test"),
    setDiskState(nextDocument: ConfigDocument, nextMachine: MachineLocalSettings) {
      document = ConfigDocument.parse(nextDocument);
      machine = MachineLocalSettings.parse(nextMachine);
    },
  };
}

function importResult(locale: "auto" | "zh-CN" | "en" = "en"): LegacyImportResult {
  const result = importLegacyConfig({ gesturesWg2: EMPTY_WG2 });
  return {
    ...result,
    document: ConfigDocument.parse({
      ...result.document,
      preferences: { ...result.document.preferences, locale },
    }),
  };
}

describe("config store legacy import", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backendSlot.current = makeBackend();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    backendSlot.current = null;
  });

  it("flushes existing edits, preserves runAsAdmin, and prevents stale timers", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    store.doc!.preferences.locale = "zh-CN";
    store.machine!.autoStart = true;
    await nextTick();

    await store.applyLegacyImport(importResult("en"));

    expect(backend.configSet).toHaveBeenCalledTimes(1);
    expect(backend.machineSet).toHaveBeenCalledTimes(1);
    expect(backend.legacyImportApply).toHaveBeenCalledTimes(1);
    expect(store.doc!.preferences.locale).toBe("en");
    expect(store.machine).toMatchObject({ autoStart: false, runAsAdmin: true });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(backend.configSet).toHaveBeenCalledTimes(1);
    expect(backend.machineSet).toHaveBeenCalledTimes(1);
  });

  it("does not publish imported values when the backend rolls back normally", async () => {
    const backend = backendSlot.current!;
    backend.legacyImportApply.mockRejectedValueOnce(new BackendError("apply_failed", "failed"));
    const store = useConfigStore();
    await store.load();

    await expect(store.applyLegacyImport(importResult("en"))).rejects.toMatchObject({
      code: "apply_failed",
    });
    expect(store.doc!.preferences.locale).toBe("auto");
    expect(store.machine!.runAsAdmin).toBe(true);
  });

  it("reloads observable disk state after an incomplete rollback", async () => {
    const backend = backendSlot.current!;
    const recoveredDocument = documentWithLocale("zh-CN");
    const recoveredMachine = MachineLocalSettings.parse({
      autoStart: true,
      runAsAdmin: false,
      trayIconVisible: false,
    });
    backend.legacyImportApply.mockImplementationOnce(async () => {
      backend.setDiskState(recoveredDocument, recoveredMachine);
      throw new BackendError("rollback_incomplete", "incomplete");
    });
    const store = useConfigStore();
    await store.load();

    await expect(store.applyLegacyImport(importResult("en"))).rejects.toMatchObject({
      code: "rollback_incomplete",
    });
    expect(backend.configGet).toHaveBeenCalledTimes(2);
    expect(store.doc!.preferences.locale).toBe("zh-CN");
    expect(store.machine).toMatchObject({
      autoStart: true,
      runAsAdmin: false,
      trayIconVisible: false,
    });
  });
});

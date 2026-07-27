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
    machineStatus: vi.fn(async () => ({ healthy: true, code: null, message: null })),
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
    resolveAppFile: vi.fn(async () => ({
      exeName: "test.exe",
      exePath: "C:\\Test\\test.exe",
      appName: "Test",
      aumid: null,
    })),
    onAppFileDrop: vi.fn(async () => () => undefined),
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

describe("config store machine updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backendSlot.current = makeBackend();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    backendSlot.current = null;
  });

  it("serializes explicit writes and exposes pending state", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => pending);
    const store = useConfigStore();
    await store.load();

    const write = store.updateMachineSetting("autoStart", true)!;
    await Promise.resolve();
    expect(store.machinePending.autoStart).toBe(1);
    expect(store.machine!.autoStart).toBe(true);

    release();
    await write;
    expect(store.machinePending.autoStart).toBe(0);
    expect(backend.machineSet).toHaveBeenCalledTimes(1);
  });

  it("restores the confirmed value after a complete failure", async () => {
    const backend = backendSlot.current!;
    backend.machineSet.mockRejectedValueOnce(new BackendError("uac_cancelled", "cancelled"));
    const store = useConfigStore();
    await store.load();

    await expect(store.updateMachineSetting("autoStart", true)).rejects.toMatchObject({
      code: "uac_cancelled",
    });
    expect(store.machine!.autoStart).toBe(false);
    expect(store.machineError?.code).toBe("uac_cancelled");
  });

  it("does not let an older failed request overwrite a newer edit", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstCall = new Promise<void>((_, reject) => { rejectFirst = reject; });
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => firstCall);
    const store = useConfigStore();
    await store.load();

    const first = store.updateMachineSetting("runAsAdmin", false)!;
    await Promise.resolve();
    const second = store.updateMachineSetting("runAsAdmin", true)!;
    rejectFirst(new BackendError("apply_failed", "failed"));

    await expect(first).rejects.toMatchObject({ code: "apply_failed" });
    expect(store.machine!.runAsAdmin).toBe(true);
    await second;
    expect(store.machine!.runAsAdmin).toBe(true);
  });

  it("keeps a newer whole-document request consistent across different fields", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstCall = new Promise<void>((_, reject) => { rejectFirst = reject; });
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => firstCall);
    const store = useConfigStore();
    await store.load();

    const first = store.updateMachineSetting("autoStart", true)!;
    await Promise.resolve();
    const second = store.updateMachineSetting("trayIconVisible", false)!;
    rejectFirst(new BackendError("apply_failed", "failed"));

    await expect(first).rejects.toMatchObject({ code: "apply_failed" });
    expect(store.machine).toMatchObject({ autoStart: true, trayIconVisible: false });
    await second;
    expect(backend.machineSet.mock.calls[1][0]).toMatchObject({
      autoStart: true,
      trayIconVisible: false,
    });
    expect(store.machine).toMatchObject({ autoStart: true, trayIconVisible: false });
  });

  it("reloads machine state after an incomplete rollback", async () => {
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => {
      backend.setDiskState(
        documentWithLocale("auto"),
        MachineLocalSettings.parse({ autoStart: true, runAsAdmin: false, trayIconVisible: false }),
      );
      throw new BackendError("rollback_incomplete", "incomplete");
    });
    const store = useConfigStore();
    await store.load();

    await expect(store.updateMachineSetting("trayIconVisible", false)).rejects.toMatchObject({
      code: "rollback_incomplete",
    });
    expect(backend.machineGet).toHaveBeenCalledTimes(2);
    expect(store.machine).toMatchObject({
      autoStart: true,
      runAsAdmin: false,
      trayIconVisible: false,
    });
  });

  it("keeps machine errors independent from later document saves", async () => {
    const backend = backendSlot.current!;
    backend.machineSet.mockRejectedValueOnce(new BackendError("apply_failed", "failed"));
    const store = useConfigStore();
    await store.load();
    await expect(store.updateMachineSetting("autoStart", true)).rejects.toBeInstanceOf(BackendError);

    store.doc!.preferences.locale = "en";
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.configSet).toHaveBeenCalledTimes(1);
    expect(store.machineError?.code).toBe("apply_failed");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import {
  ConfigDocument,
  MachineLocalSettings,
} from "@godgesture/shared";
import type { MachineRuntimeStatus } from "../../api/backend";

const backendSlot = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeBackend> | null,
}));

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
      if (!backendSlot.current)
        throw new Error("mock backend is not configured");
      return backendSlot.current;
    },
  };
});

import { BackendError } from "../../api/backend";
import { useConfigStore } from "../config";

function documentWithLocale(locale: "auto" | "zh-CN" | "en") {
  return ConfigDocument.parse({
    preferences: { locale },
  });
}

function makeBackend() {
  let document = documentWithLocale("auto");
  let machine = MachineLocalSettings.parse({});
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
    machineStatus: vi.fn(async (): Promise<MachineRuntimeStatus> => ({
      healthy: true,
      code: null,
      message: null,
    })),
    platformStatus: vi.fn(async () => ({
      platform: "windows" as const,
      gestureEngineRunning: true,
      accessibility: true,
      inputMonitoring: true,
      eventPosting: true,
      code: null,
      message: null,
    })),
    platformRequestPermissions: vi.fn(async () => ({
      platform: "windows" as const,
      gestureEngineRunning: true,
      accessibility: true,
      inputMonitoring: true,
      eventPosting: true,
      code: null,
      message: null,
    })),
    platformOpenPermissionSettings: vi.fn(async () => undefined),
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
      bundleId: null,
    })),
    onAppFileDrop: vi.fn(async () => () => undefined),
    appIcon: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    getAppVersion: vi.fn(async () => "test"),
    setDiskState(
      nextDocument: ConfigDocument,
      nextMachine: MachineLocalSettings,
    ) {
      document = ConfigDocument.parse(nextDocument);
      machine = MachineLocalSettings.parse(nextMachine);
    },
  };
}

describe("config store cloud synchronization barriers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backendSlot.current = makeBackend();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    backendSlot.current = null;
  });

  it("flushes the latest document and cancels its stale debounce timer", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    store.doc!.preferences.locale = "en";
    await nextTick();

    const snapshot = await store.flushDocumentSaves();

    expect(snapshot.preferences.locale).toBe("en");
    expect(backend.configSet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(backend.configSet).toHaveBeenCalledTimes(1);
  });

  it("persists pending local work before atomically applying a synced document", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    store.doc!.preferences.locale = "zh-CN";
    await nextTick();

    await store.applySyncedDocument(
      documentWithLocale("en"),
      documentWithLocale("zh-CN"),
    );

    expect(
      backend.configSet.mock.calls.map(
        ([document]) => document.preferences.locale,
      ),
    ).toEqual(["zh-CN", "en"]);
    expect(store.doc!.preferences.locale).toBe("en");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(backend.configSet).toHaveBeenCalledTimes(2);
  });

  it("keeps the locally persisted document observable when remote apply fails", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    store.doc!.preferences.locale = "zh-CN";
    await nextTick();
    backend.configSet.mockImplementationOnce(async (next: ConfigDocument) => {
      backend.setDiskState(next, await backend.machineGet());
    });
    backend.configSet.mockRejectedValueOnce(new Error("remote apply failed"));

    await expect(
      store.applySyncedDocument(
        documentWithLocale("en"),
        documentWithLocale("zh-CN"),
      ),
    ).rejects.toThrow("remote apply failed");
    expect(store.doc!.preferences.locale).toBe("zh-CN");
  });

  it("preserves and re-persists an edit made while a remote apply is in flight", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    store.doc!.preferences.locale = "zh-CN";
    await nextTick();

    let releaseRemoteWrite!: () => void;
    const remoteWrite = new Promise<void>((resolve) => {
      releaseRemoteWrite = resolve;
    });
    backend.configSet.mockImplementation(async (next: ConfigDocument) => {
      if (next.preferences.locale === "en") await remoteWrite;
      backend.setDiskState(next, await backend.machineGet());
    });

    const applying = store.applySyncedDocument(
      documentWithLocale("en"),
      documentWithLocale("zh-CN"),
    );
    await vi.waitFor(() => {
      expect(
        backend.configSet.mock.calls.some(
          ([next]) => next.preferences.locale === "en",
        ),
      ).toBe(true);
    });
    store.doc!.preferences.locale = "auto";
    await nextTick();
    releaseRemoteWrite();

    await expect(applying).resolves.toBe(false);
    expect(store.doc!.preferences.locale).toBe("auto");
    expect((await backend.configGet()).preferences.locale).toBe("auto");
  });
});

describe("config store template adoption barrier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backendSlot.current = makeBackend();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    backendSlot.current = null;
  });

  it("applies a planned document once when the expected snapshot is current", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();

    await expect(
      store.applyTemplateDocument(
        documentWithLocale("en"),
        documentWithLocale("auto"),
      ),
    ).resolves.toBe(true);

    expect(backend.configSet).toHaveBeenCalledTimes(1);
    expect(store.doc!.preferences.locale).toBe("en");
  });

  it("rejects a stale plan without writing its document", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    store.doc!.preferences.locale = "zh-CN";
    await nextTick();

    await expect(
      store.applyTemplateDocument(
        documentWithLocale("en"),
        documentWithLocale("auto"),
      ),
    ).resolves.toBe(false);

    expect(backend.configSet).toHaveBeenCalledTimes(1);
    expect(backend.configSet.mock.calls[0]![0].preferences.locale).toBe("zh-CN");
    expect(store.doc!.preferences.locale).toBe("zh-CN");
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
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
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

  it("refreshes platform machine status after a successful write", async () => {
    const backend = backendSlot.current!;
    const store = useConfigStore();
    await store.load();
    backend.machineStatus.mockResolvedValue({
      healthy: false,
      code: "login_item_requires_approval",
      message: "approval required",
    });

    await store.updateMachineSetting("autoStart", true);

    expect(store.machineStatus).toEqual({
      healthy: false,
      code: "login_item_requires_approval",
      message: "approval required",
    });
  });

  it("restores the confirmed value after a complete failure", async () => {
    const backend = backendSlot.current!;
    backend.machineSet.mockRejectedValueOnce(
      new BackendError("uac_cancelled", "cancelled"),
    );
    const store = useConfigStore();
    await store.load();

    await expect(
      store.updateMachineSetting("autoStart", true),
    ).rejects.toMatchObject({
      code: "uac_cancelled",
    });
    expect(store.machine!.autoStart).toBe(false);
    expect(store.machineError?.code).toBe("uac_cancelled");
  });

  it("does not let an older failed request overwrite a newer edit", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstCall = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => firstCall);
    const store = useConfigStore();
    await store.load();

    const first = store.updateMachineSetting("autoStart", false)!;
    await Promise.resolve();
    const second = store.updateMachineSetting("autoStart", true)!;
    rejectFirst(new BackendError("apply_failed", "failed"));

    await expect(first).rejects.toMatchObject({ code: "apply_failed" });
    expect(store.machine!.autoStart).toBe(true);
    await second;
    expect(store.machine!.autoStart).toBe(true);
  });

  it("keeps a newer whole-document request consistent across different fields", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstCall = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => firstCall);
    const store = useConfigStore();
    await store.load();

    const first = store.updateMachineSetting("autoStart", true)!;
    await Promise.resolve();
    const second = store.updateMachineSetting("trayIconVisible", false)!;
    rejectFirst(new BackendError("apply_failed", "failed"));

    await expect(first).rejects.toMatchObject({ code: "apply_failed" });
    expect(store.machine).toMatchObject({
      autoStart: true,
      trayIconVisible: false,
    });
    await second;
    expect(backend.machineSet.mock.calls[1][0]).toMatchObject({
      autoStart: true,
      trayIconVisible: false,
    });
    expect(store.machine).toMatchObject({
      autoStart: true,
      trayIconVisible: false,
    });
  });

  it("reloads machine state after an incomplete rollback", async () => {
    const backend = backendSlot.current!;
    backend.machineSet.mockImplementationOnce(async () => {
      backend.setDiskState(
        documentWithLocale("auto"),
        MachineLocalSettings.parse({
          autoStart: true,
          trayIconVisible: false,
        }),
      );
      throw new BackendError("rollback_incomplete", "incomplete");
    });
    const store = useConfigStore();
    await store.load();

    await expect(
      store.updateMachineSetting("trayIconVisible", false),
    ).rejects.toMatchObject({
      code: "rollback_incomplete",
    });
    expect(backend.machineGet).toHaveBeenCalledTimes(2);
    expect(store.machine).toMatchObject({
      autoStart: true,
      trayIconVisible: false,
    });
  });

  it("keeps machine errors independent from later document saves", async () => {
    const backend = backendSlot.current!;
    backend.machineSet.mockRejectedValueOnce(
      new BackendError("apply_failed", "failed"),
    );
    const store = useConfigStore();
    await store.load();
    await expect(
      store.updateMachineSetting("autoStart", true),
    ).rejects.toBeInstanceOf(BackendError);

    store.doc!.preferences.locale = "en";
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.configSet).toHaveBeenCalledTimes(1);
    expect(store.machineError?.code).toBe("apply_failed");
  });
});

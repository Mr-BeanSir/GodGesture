import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { UpdateDownloadEvent, UpdateMetadata } from "../../api/backend";

const slots = vi.hoisted(() => ({
  backend: null as ReturnType<typeof makeBackend> | null,
  config: null as ReturnType<typeof makeConfig> | null,
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
      if (!slots.backend) throw new Error("backend mock is not configured");
      return slots.backend;
    },
  };
});

vi.mock("../config", () => ({
  useConfigStore: () => {
    if (!slots.config) throw new Error("config mock is not configured");
    return slots.config;
  },
}));

import { BackendError } from "../../api/backend";
import { useUpdateStore } from "../update";

const UPDATE: UpdateMetadata = {
  currentVersion: "0.1.0",
  version: "0.2.0",
  notes: "Release notes",
  publishedAt: "2026-07-28T15:00:00Z",
};

function makeBackend() {
  return {
    updateCheck: vi.fn(async (): Promise<UpdateMetadata | null> => ({ ...UPDATE })),
    updateCancel: vi.fn(async () => undefined),
    updateInstall: vi.fn(
      async (handler: (event: UpdateDownloadEvent) => void) => {
        handler({ event: "started", data: { contentLength: 1_000 } });
        handler({
          event: "progress",
          data: { chunkLength: 1_000, downloaded: 1_000 },
        });
        handler({ event: "finished", data: { downloaded: 1_000 } });
      },
    ),
  };
}

function makeConfig() {
  return { flushPendingSaves: vi.fn(async () => undefined) };
}

describe("update store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    slots.backend = makeBackend();
    slots.config = makeConfig();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    slots.backend = null;
    slots.config = null;
  });

  it("deduplicates concurrent checks and prompts once per discovered version", async () => {
    let release!: (value: UpdateMetadata) => void;
    slots.backend!.updateCheck.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const store = useUpdateStore();
    const automatic = store.check(true);
    const manual = store.check(false);
    release({ ...UPDATE });

    await expect(automatic).resolves.toEqual(UPDATE);
    await expect(manual).resolves.toEqual(UPDATE);
    expect(slots.backend!.updateCheck).toHaveBeenCalledTimes(1);
    expect(store.automaticPromptPending).toBe(true);
    store.dismissAutomaticPrompt();
    await store.check(true);
    expect(store.automaticPromptPending).toBe(false);
  });

  it("only schedules an automatic check when the preference is enabled", async () => {
    const store = useUpdateStore();
    store.scheduleAutomaticCheck(false, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(slots.backend!.updateCheck).not.toHaveBeenCalled();

    store.scheduleAutomaticCheck(true, 100);
    await vi.advanceTimersByTimeAsync(99);
    expect(slots.backend!.updateCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(slots.backend!.updateCheck).toHaveBeenCalledTimes(1);
    expect(store.state).toBe("available");
  });

  it("flushes configuration before installing and tracks bounded progress", async () => {
    const order: string[] = [];
    slots.config!.flushPendingSaves.mockImplementationOnce(async () => {
      order.push("flush");
    });
    slots.backend!.updateInstall.mockImplementationOnce(async (handler) => {
      order.push("install");
      handler({ event: "started", data: { contentLength: 1_000 } });
      handler({
        event: "progress",
        data: { chunkLength: 1_000, downloaded: 1_500 },
      });
      handler({ event: "finished", data: { downloaded: 1_500 } });
    });
    const store = useUpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(true);
    expect(order).toEqual(["flush", "install"]);
    expect(store.progress).toBe(100);
    expect(store.state).toBe("ready");
  });

  it("retains stable backend error codes", async () => {
    slots.backend!.updateCheck.mockRejectedValueOnce(
      new BackendError("update_signature_invalid", "invalid"),
    );
    const store = useUpdateStore();

    await expect(store.check()).resolves.toBeNull();
    expect(store.state).toBe("failed");
    expect(store.errorCode).toBe("update_signature_invalid");
  });
});

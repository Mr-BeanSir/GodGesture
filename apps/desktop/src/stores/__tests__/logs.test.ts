import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { LogEntry } from "../../api/backend";

const backendSlot = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeBackend> | null,
}));

vi.mock("../../api/backend", () => ({
  useBackend: () => {
    if (!backendSlot.current) throw new Error("backend mock is not configured");
    return backendSlot.current;
  },
}));

import { useLogsStore } from "../logs";

const OLD_ENTRY: LogEntry = {
  timestamp: "2026-08-05T00:00:00.000Z",
  level: "info",
  target: "old",
  message: "old message",
};
const NEW_ENTRY: LogEntry = {
  timestamp: "2026-08-05T00:00:01.000Z",
  level: "warn",
  target: "new",
  message: "new message",
};

function makeBackend(initialEntries: LogEntry[] = []) {
  let listener: ((entry: LogEntry) => void) | null = null;
  return {
    logLevelGet: vi.fn(async () => "debug" as const),
    onLogEvent: vi.fn(async (next: (entry: LogEntry) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    logsQuery: vi.fn(async () => ({
      entries: initialEntries,
      total: initialEntries.length,
      files: [],
      level: "debug" as const,
    })),
    logsClear: vi.fn(async () => undefined),
    emit(entry: LogEntry) {
      listener?.(entry);
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  backendSlot.current = makeBackend([OLD_ENTRY, NEW_ENTRY]);
});

describe("logs store ordering and follow state", () => {
  it("keeps the newest queried record at the front", async () => {
    const store = useLogsStore();

    await store.initialize();

    expect(store.entries.map((entry) => entry.target)).toEqual(["new", "old"]);
  });

  it("prepends live records while automatic follow is enabled", async () => {
    const store = useLogsStore();
    await store.initialize();

    backendSlot.current!.emit({
      timestamp: "2026-08-05T00:00:02.000Z",
      level: "error",
      target: "live",
      message: "live message",
    });

    expect(store.live).toBe(true);
    expect(store.entries[0]?.target).toBe("live");
  });

  it("turns automatic follow gray without changing live record order", async () => {
    const store = useLogsStore();
    await store.initialize();
    store.toggleLive();

    backendSlot.current!.emit({
      timestamp: "2026-08-05T00:00:02.000Z",
      level: "info",
      target: "manual",
      message: "manual message",
    });

    expect(store.live).toBe(false);
    expect(store.entries[0]?.target).toBe("manual");
  });

  it("returns a successful clear result after discarding a previous error", async () => {
    const store = useLogsStore();
    await store.initialize();
    store.error = "Previous log request failed";
    backendSlot.current!.logsClear = vi.fn(async () => undefined);

    await expect(store.clear()).resolves.toBe(true);

    expect(store.error).toBeNull();
    expect(store.entries).toEqual([]);
    expect(store.total).toBe(0);
  });

  it("keeps records and reports a failed clear result when the backend rejects", async () => {
    const store = useLogsStore();
    await store.initialize();
    backendSlot.current!.logsClear = vi.fn(async () => {
      throw new Error("Unable to clear logs");
    });

    await expect(store.clear()).resolves.toBe(false);

    expect(store.error).toBe("Unable to clear logs");
    expect(store.entries.map((entry) => entry.target)).toEqual(["new", "old"]);
    expect(store.total).toBe(2);
  });
});

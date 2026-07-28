import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigDocument, type PullConfigResponse } from "@godgesture/shared";
import type { ConfigDocument as ConfigDocumentValue } from "@godgesture/shared";
import type { SyncMetadata } from "../../api/backend";
import { CloudError } from "../errors";
import { CloudSyncEngine, type CloudSyncStatus } from "../sync-engine";

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-07-28T12:00:00.000Z");

function document(locale: "auto" | "zh-CN" | "en"): ConfigDocumentValue {
  return ConfigDocument.parse({ preferences: { locale } });
}

function cloneDocument(value: ConfigDocumentValue): ConfigDocumentValue {
  return ConfigDocument.parse(JSON.parse(JSON.stringify(value)));
}

function metadata(
  version: number,
  baseline: ConfigDocumentValue,
  accountId = ACCOUNT_ID,
): SyncMetadata {
  return {
    accountId,
    serverVersion: version,
    lastSyncedDocument: cloneDocument(baseline),
    lastSyncAt: "2026-07-28T11:00:00.000Z",
  };
}

function pull(
  version: number,
  value: ConfigDocumentValue | null,
): PullConfigResponse {
  return {
    version,
    document: value ? cloneDocument(value) : null,
    updatedAt: value ? "2026-07-28T11:30:00.000Z" : null,
    updatedByDeviceId: value ? "20000000-0000-4000-8000-000000000001" : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(
  options: {
    local?: ConfigDocumentValue;
    stored?: SyncMetadata | null;
    pulled?: PullConfigResponse;
  } = {},
) {
  let local = cloneDocument(options.local ?? document("auto"));
  let savedMetadata = options.stored ? structuredClone(options.stored) : null;
  const statuses: CloudSyncStatus[] = [];
  const config = {
    getDocument: vi.fn(() => cloneDocument(local)),
    flushDocumentSaves: vi.fn(async () => cloneDocument(local)),
    applySyncedDocument: vi.fn(async (next: ConfigDocumentValue) => {
      local = cloneDocument(next);
      return true;
    }),
    setLocal(next: ConfigDocumentValue) {
      local = cloneDocument(next);
    },
    current: () => cloneDocument(local),
  };
  const backend = {
    syncMetadataGet: vi.fn(async () =>
      savedMetadata ? structuredClone(savedMetadata) : null,
    ),
    syncMetadataSet: vi.fn(async (next: SyncMetadata) => {
      savedMetadata = structuredClone(next);
    }),
    current: () => (savedMetadata ? structuredClone(savedMetadata) : null),
  };
  const api = {
    pullConfig: vi.fn(async () => options.pulled ?? pull(0, null)),
    pushConfig: vi.fn(async ({ baseVersion }: { baseVersion: number }) => ({
      version: baseVersion + 1,
      updatedAt: NOW.toISOString(),
    })),
    listSnapshots: vi.fn(async () => ({ snapshots: [] })),
    restoreSnapshot: vi.fn(
      async (_version: number, input: { baseVersion: number }) => ({
        version: input.baseVersion + 1,
        updatedAt: NOW.toISOString(),
      }),
    ),
  };
  const engine = new CloudSyncEngine({
    accountId: ACCOUNT_ID,
    api,
    backend,
    config,
    now: () => NOW,
    onStatus: (status) => statuses.push(status),
  });
  return { engine, api, backend, config, statuses };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cloud sync initial reconciliation", () => {
  it("pushes the local document when the account has no cloud configuration", async () => {
    const local = document("zh-CN");
    const { engine, api, backend } = harness({ local, pulled: pull(0, null) });

    await engine.start();

    expect(api.pushConfig).toHaveBeenCalledWith({
      baseVersion: 0,
      document: local,
    });
    expect(backend.current()).toMatchObject({
      accountId: ACCOUNT_ID,
      serverVersion: 1,
      lastSyncedDocument: local,
      lastSyncAt: NOW.toISOString(),
    });
    expect(engine.currentStatus.phase).toBe("current");
    engine.stop();
  });

  it("uses an existing cloud document as a new device baseline", async () => {
    const remote = document("en");
    const { engine, api, config, backend } = harness({
      local: document("zh-CN"),
      pulled: pull(7, remote),
    });

    await engine.start();

    expect(config.applySyncedDocument).toHaveBeenCalledWith(
      remote,
      document("zh-CN"),
    );
    expect(api.pushConfig).not.toHaveBeenCalled();
    expect(config.current()).toEqual(remote);
    expect(backend.current()?.serverVersion).toBe(7);
    engine.stop();
  });

  it("applies a newer remote version when the local baseline is clean", async () => {
    const baseline = document("auto");
    const remote = document("en");
    const { engine, config } = harness({
      local: baseline,
      stored: metadata(3, baseline),
      pulled: pull(4, remote),
    });

    await engine.start();

    expect(config.applySyncedDocument).toHaveBeenCalledWith(remote, baseline);
    expect(config.current()).toEqual(remote);
    expect(engine.currentStatus.serverVersion).toBe(4);
    engine.stop();
  });

  it("pushes restart-time offline edits against the saved baseline", async () => {
    const baseline = document("auto");
    const changed = document("zh-CN");
    const { engine, api } = harness({
      local: changed,
      stored: metadata(3, baseline),
      pulled: pull(99, document("en")),
    });

    await engine.start();

    expect(api.pullConfig).not.toHaveBeenCalled();
    expect(api.pushConfig).toHaveBeenCalledWith({
      baseVersion: 3,
      document: changed,
    });
    engine.stop();
  });

  it("does not reuse another account's persisted version or baseline", async () => {
    const remote = document("en");
    const { engine, api, config } = harness({
      local: document("zh-CN"),
      stored: metadata(42, document("auto"), OTHER_ACCOUNT_ID),
      pulled: pull(2, remote),
    });

    await engine.start();

    expect(api.pushConfig).not.toHaveBeenCalled();
    expect(config.applySyncedDocument).toHaveBeenCalledWith(
      remote,
      document("zh-CN"),
    );
    expect(engine.currentStatus.serverVersion).toBe(2);
    engine.stop();
  });
});

describe("cloud sync local changes and conflicts", () => {
  it("debounces a local edit for three quiet seconds", async () => {
    vi.useFakeTimers();
    const baseline = document("auto");
    const { engine, api, config } = harness({
      local: baseline,
      stored: metadata(3, baseline),
      pulled: pull(3, baseline),
    });
    await engine.start();
    api.pushConfig.mockClear();

    config.setLocal(document("en"));
    engine.markLocalChange();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(api.pushConfig).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(api.pushConfig).toHaveBeenCalledTimes(1);
    expect(engine.currentStatus.phase).toBe("current");
    engine.stop();
  });

  it("pulls the winning version and republishes the exact local snapshot after 409", async () => {
    const baseline = document("auto");
    const local = document("zh-CN");
    const { engine, api } = harness({ local, stored: metadata(3, baseline) });
    api.pushConfig
      .mockRejectedValueOnce(
        new CloudError(409, "version_conflict", {
          error: "version_conflict",
          serverVersion: 4,
        }),
      )
      .mockResolvedValueOnce({ version: 5, updatedAt: NOW.toISOString() });
    api.pullConfig.mockResolvedValueOnce(pull(4, document("en")));

    await engine.start();

    expect(api.pushConfig.mock.calls).toEqual([
      [{ baseVersion: 3, document: local }],
      [{ baseVersion: 4, document: local }],
    ]);
    expect(engine.currentStatus.serverVersion).toBe(5);
    engine.stop();
  });

  it("preserves an edit made while a pull is in flight and pushes it", async () => {
    const baseline = document("auto");
    const remote = document("en");
    const pendingPull = deferred<PullConfigResponse>();
    const { engine, api, config } = harness({
      local: baseline,
      stored: metadata(3, baseline),
    });
    api.pullConfig.mockReturnValueOnce(pendingPull.promise);

    const start = engine.start();
    await Promise.resolve();
    const edited = document("zh-CN");
    config.setLocal(edited);
    engine.markLocalChange();
    pendingPull.resolve(pull(4, remote));
    await start;

    expect(config.applySyncedDocument).not.toHaveBeenCalled();
    expect(api.pushConfig).toHaveBeenCalledWith({
      baseVersion: 4,
      document: edited,
    });
    engine.stop();
  });

  it("pushes an edit preserved by the remote-apply barrier", async () => {
    const baseline = document("auto");
    const remote = document("en");
    const edited = document("zh-CN");
    const { engine, api, config } = harness({
      local: baseline,
      stored: metadata(3, baseline),
      pulled: pull(4, remote),
    });
    config.applySyncedDocument.mockImplementationOnce(async () => {
      config.setLocal(edited);
      return false;
    });

    await engine.start();

    expect(api.pushConfig).toHaveBeenCalledWith({
      baseVersion: 4,
      document: edited,
    });
    expect(engine.currentStatus.phase).toBe("current");
    engine.stop();
  });

  it("leaves a newer edit pending when it occurs during a push", async () => {
    vi.useFakeTimers();
    const baseline = document("auto");
    const firstEdit = document("zh-CN");
    const secondEdit = document("en");
    const pendingPush = deferred<{ version: number; updatedAt: string }>();
    const { engine, api, config } = harness({
      local: baseline,
      stored: metadata(3, baseline),
    });
    api.pullConfig.mockResolvedValueOnce(pull(3, baseline));
    await engine.start();
    config.setLocal(firstEdit);
    engine.markLocalChange();
    api.pushConfig.mockReturnValueOnce(pendingPush.promise);

    const syncing = engine.syncNow();
    await Promise.resolve();
    config.setLocal(secondEdit);
    engine.markLocalChange();
    pendingPush.resolve({ version: 4, updatedAt: NOW.toISOString() });
    await syncing;

    expect(engine.currentStatus.phase).toBe("pending");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(api.pushConfig).toHaveBeenLastCalledWith({
      baseVersion: 4,
      document: secondEdit,
    });
    engine.stop();
  });

  it("retries a transient push after the bounded five-second first delay", async () => {
    vi.useFakeTimers();
    const baseline = document("auto");
    const local = document("en");
    const { engine, api } = harness({ local, stored: metadata(3, baseline) });
    api.pushConfig
      .mockRejectedValueOnce(new CloudError(0, "network"))
      .mockResolvedValueOnce({ version: 4, updatedAt: NOW.toISOString() });

    await engine.start();
    expect(engine.currentStatus.phase).toBe("offline");
    expect(engine.currentStatus.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(api.pushConfig).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(api.pushConfig).toHaveBeenCalledTimes(2);
    expect(engine.currentStatus.phase).toBe("current");
    engine.stop();
  });

  it("does not push the same document again when metadata persistence fails", async () => {
    const baseline = document("auto");
    const local = document("en");
    const { engine, api, backend } = harness({
      local,
      stored: metadata(3, baseline),
    });
    backend.syncMetadataSet.mockRejectedValueOnce(
      new CloudError(0, "sync_metadata_write_failed"),
    );
    api.pullConfig.mockResolvedValueOnce(pull(4, local));

    await engine.start();
    expect(engine.currentStatus.errorCode).toBe("sync_metadata_write_failed");
    expect(api.pushConfig).toHaveBeenCalledTimes(1);

    await engine.syncNow();

    expect(api.pushConfig).toHaveBeenCalledTimes(1);
    expect(api.pullConfig).toHaveBeenCalledTimes(1);
    expect(backend.current()?.serverVersion).toBe(4);
    expect(engine.currentStatus.phase).toBe("current");
    engine.stop();
  });

  it("does not apply a pull that completes after the engine stops", async () => {
    const baseline = document("auto");
    const pendingPull = deferred<PullConfigResponse>();
    const { engine, api, backend, config, statuses } = harness({
      local: baseline,
      stored: metadata(3, baseline),
    });
    api.pullConfig.mockReturnValueOnce(pendingPull.promise);

    const starting = engine.start();
    await Promise.resolve();
    engine.stop();
    pendingPull.resolve(pull(4, document("en")));
    await starting;

    expect(config.applySyncedDocument).not.toHaveBeenCalled();
    expect(backend.syncMetadataSet).not.toHaveBeenCalled();
    expect(statuses[statuses.length - 1]?.phase).toBe("signedOut");
  });

  it("does not persist metadata or overwrite signed-out state after an in-flight push", async () => {
    const baseline = document("auto");
    const local = document("zh-CN");
    const pendingPush = deferred<{ version: number; updatedAt: string }>();
    const { engine, api, backend, statuses } = harness({
      local,
      stored: metadata(3, baseline),
    });
    api.pushConfig.mockReturnValueOnce(pendingPush.promise);

    const starting = engine.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.pushConfig).toHaveBeenCalledTimes(1);
    engine.stop();
    pendingPush.resolve({ version: 4, updatedAt: NOW.toISOString() });
    await starting;

    expect(backend.syncMetadataSet).not.toHaveBeenCalled();
    expect(statuses[statuses.length - 1]?.phase).toBe("signedOut");
  });
});

describe("cloud snapshot restore", () => {
  it("pushes pending local state before restoring and then applies the restored version", async () => {
    const baseline = document("auto");
    const local = document("zh-CN");
    const restored = document("en");
    const events: string[] = [];
    const { engine, api, config } = harness({
      local,
      stored: metadata(3, baseline),
    });
    api.pushConfig.mockImplementationOnce(async () => {
      events.push("push-local");
      return { version: 4, updatedAt: NOW.toISOString() };
    });
    api.restoreSnapshot.mockImplementationOnce(async (_version, input) => {
      events.push(`restore-${input.baseVersion}`);
      return { version: 5, updatedAt: NOW.toISOString() };
    });
    api.pullConfig.mockImplementationOnce(async () => {
      events.push("pull-restored");
      return pull(5, restored);
    });

    await engine.start();
    await engine.restore(2);

    expect(events).toEqual(["push-local", "restore-4", "pull-restored"]);
    expect(config.current()).toEqual(restored);
    expect(engine.currentStatus.serverVersion).toBe(5);
    engine.stop();
  });
});

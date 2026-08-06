import {
  ConfigDocument,
  type ConfigDocument as ConfigDocumentValue,
  type ListSnapshotsQuery,
  type ListSnapshotsResponse,
} from "@godgesture/shared";
import type { Backend, SyncMetadata } from "../api/backend";
import type { CloudApi } from "./api";
import { CloudError, normalizeCloudError } from "./errors";

const DEFAULT_PUSH_DEBOUNCE_MS = 3_000;
const DEFAULT_PULL_INTERVAL_MS = 30 * 60 * 1_000;
const DEFAULT_RETRY_DELAYS_MS = [
  5_000,
  15_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
];
const MAX_CONFLICT_RETRIES = 3;

type MetadataBackend = Pick<Backend, "syncMetadataGet" | "syncMetadataSet">;

export type SyncPhase =
  | "signedOut"
  | "initializing"
  | "current"
  | "pending"
  | "syncing"
  | "offline"
  | "error";

export interface CloudSyncStatus {
  phase: SyncPhase;
  lastSyncAt: string | null;
  serverVersion: number | null;
  errorCode: string | null;
  dirty: boolean;
}

export interface SyncConfigAdapter {
  getDocument(): ConfigDocumentValue | null;
  flushDocumentSaves(): Promise<ConfigDocumentValue>;
  applySyncedDocument(
    document: ConfigDocumentValue,
    expectedLocalDocument: ConfigDocumentValue,
  ): Promise<boolean>;
}

export interface CloudSyncEngineOptions {
  accountId: string;
  api: Pick<
    CloudApi,
    "pullConfig" | "pushConfig" | "listSnapshots" | "restoreSnapshot"
  >;
  backend: MetadataBackend;
  config: SyncConfigAdapter;
  onStatus?: (status: CloudSyncStatus) => void;
  onSnapshotsChanged?: () => void;
  now?: () => Date;
  pushDebounceMs?: number;
  pullIntervalMs?: number;
  retryDelaysMs?: readonly number[];
}

function serializeDocument(document: ConfigDocumentValue): string {
  return JSON.stringify(ConfigDocument.parse(document));
}

function parseMetadata(value: SyncMetadata | null): SyncMetadata | null {
  if (
    !value ||
    typeof value.accountId !== "string" ||
    value.accountId.length === 0
  )
    return null;
  if (!Number.isSafeInteger(value.serverVersion) || value.serverVersion < 0)
    return null;
  if (
    typeof value.lastSyncAt !== "string" ||
    !Number.isFinite(Date.parse(value.lastSyncAt))
  ) {
    return null;
  }
  const parsed = ConfigDocument.safeParse(value.lastSyncedDocument);
  if (!parsed.success) return null;
  return { ...value, lastSyncedDocument: parsed.data };
}

export class CloudSyncEngine {
  private readonly accountId: string;
  private readonly api: CloudSyncEngineOptions["api"];
  private readonly backend: MetadataBackend;
  private readonly config: SyncConfigAdapter;
  private readonly onStatus: (status: CloudSyncStatus) => void;
  private readonly onSnapshotsChanged: () => void;
  private readonly now: () => Date;
  private readonly pushDebounceMs: number;
  private readonly pullIntervalMs: number;
  private readonly retryDelaysMs: readonly number[];

  private metadata: SyncMetadata | null = null;
  private status: CloudSyncStatus = {
    phase: "signedOut",
    lastSyncAt: null,
    serverVersion: null,
    errorCode: null,
    dirty: false,
  };
  private started = false;
  private stopped = false;
  private applyingRemote = false;
  private dirty = false;
  private localRevision = 0;
  private lifecycle = 0;
  private retryAttempt = 0;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: CloudSyncEngineOptions) {
    this.accountId = options.accountId;
    this.api = options.api;
    this.backend = options.backend;
    this.config = options.config;
    this.onStatus = options.onStatus ?? (() => undefined);
    this.onSnapshotsChanged = options.onSnapshotsChanged ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.pushDebounceMs = options.pushDebounceMs ?? DEFAULT_PUSH_DEBOUNCE_MS;
    this.pullIntervalMs = options.pullIntervalMs ?? DEFAULT_PULL_INTERVAL_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  get currentStatus(): CloudSyncStatus {
    return { ...this.status };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    const lifecycle = ++this.lifecycle;
    const stored = parseMetadata(await this.backend.syncMetadataGet());
    this.assertActive(lifecycle);
    this.metadata = stored?.accountId === this.accountId ? stored : null;
    const current = this.requireDocument();
    this.dirty =
      this.metadata !== null &&
      serializeDocument(current) !==
        serializeDocument(this.metadata.lastSyncedDocument);
    this.publish(this.dirty ? "pending" : "initializing");
    this.pullTimer = setInterval(() => {
      void this.runSync().catch(() => undefined);
    }, this.pullIntervalMs);
    try {
      await this.runSync();
    } catch {
      // Status and retry scheduling are handled by runSync.
    }
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.lifecycle += 1;
    this.clearPushTimer();
    this.clearRetryTimer();
    if (this.pullTimer) clearInterval(this.pullTimer);
    this.pullTimer = null;
    this.status = {
      phase: "signedOut",
      lastSyncAt: null,
      serverVersion: null,
      errorCode: null,
      dirty: false,
    };
    this.onStatus({ ...this.status });
  }

  markLocalChange(): void {
    if (this.applyingRemote || this.stopped) return;
    this.localRevision += 1;
    this.dirty = true;
    this.clearRetryTimer();
    this.publish("pending", null);
    this.schedulePush();
  }

  syncNow(): Promise<void> {
    this.clearPushTimer();
    this.clearRetryTimer();
    return this.runSync();
  }

  async listSnapshots(
    query: ListSnapshotsQuery,
  ): Promise<ListSnapshotsResponse> {
    const lifecycle = this.lifecycle;
    this.assertActive(lifecycle);
    const response = await this.api.listSnapshots(query);
    this.assertActive(lifecycle);
    return response;
  }

  async restore(version: number): Promise<void> {
    const lifecycle = this.lifecycle;
    this.assertActive(lifecycle);
    if (this.inFlight) await this.inFlight;
    this.assertActive(lifecycle);
    if (
      this.metadata &&
      serializeDocument(this.requireDocument()) !==
        serializeDocument(this.metadata.lastSyncedDocument)
    ) {
      this.dirty = true;
    }
    if (this.dirty) await this.syncNow();
    this.assertActive(lifecycle);
    if (!this.metadata) throw new CloudError(0, "sync_baseline_missing");
    this.publish("syncing", null);
    try {
      await this.api.restoreSnapshot(version, {
        baseVersion: this.metadata.serverVersion,
      });
      this.assertActive(lifecycle);
      const pulled = await this.api.pullConfig();
      this.assertActive(lifecycle);
      if (!pulled.document) throw new CloudError(0, "invalid_server_response");
      const applied = await this.applyPulledDocument(
        lifecycle,
        pulled.version,
        pulled.document,
      );
      if (!applied) await this.pushCurrentDocument(lifecycle, pulled.version);
      this.assertActive(lifecycle);
      this.onSnapshotsChanged();
      this.resetRetry();
      this.publish("current", null);
    } catch (error) {
      const normalized = this.handleFailure(error);
      throw normalized;
    }
  }

  private runSync(): Promise<void> {
    if (this.stopped || !this.started) {
      return Promise.reject(new CloudError(0, "sync_not_started"));
    }
    if (this.inFlight) return this.inFlight;
    const lifecycle = this.lifecycle;
    const operation = this.performSync(lifecycle)
      .catch((error) => {
        if (!this.isActive(lifecycle)) throw normalizeCloudError(error);
        throw this.handleFailure(error);
      })
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
      });
    this.inFlight = operation;
    return operation;
  }

  private async performSync(lifecycle: number): Promise<void> {
    this.assertActive(lifecycle);
    this.publish("syncing", null);
    const current = this.requireDocument();
    if (
      this.metadata &&
      serializeDocument(current) !==
        serializeDocument(this.metadata.lastSyncedDocument)
    ) {
      this.dirty = true;
    }

    if (this.dirty && this.metadata) {
      await this.pushCurrentDocument(lifecycle, this.metadata.serverVersion);
      return;
    }

    const revisionBeforePull = this.localRevision;
    const pulled = await this.api.pullConfig();
    this.assertActive(lifecycle);
    if (this.localRevision !== revisionBeforePull) this.dirty = true;

    if (this.dirty) {
      await this.pushCurrentDocument(lifecycle, pulled.version);
      return;
    }

    if (!pulled.document) {
      await this.pushCurrentDocument(lifecycle, pulled.version);
      return;
    }

    const pulledSerialized = serializeDocument(pulled.document);
    const currentSerialized = serializeDocument(this.requireDocument());
    if (
      !this.metadata ||
      pulled.version !== this.metadata.serverVersion ||
      pulledSerialized !== serializeDocument(this.metadata.lastSyncedDocument)
    ) {
      if (pulledSerialized !== currentSerialized) {
        const applied = await this.applyPulledDocument(
          lifecycle,
          pulled.version,
          pulled.document,
        );
        if (!applied) {
          await this.pushCurrentDocument(lifecycle, pulled.version);
          return;
        }
      } else {
        await this.saveMetadata(lifecycle, pulled.version, pulled.document);
      }
    } else {
      await this.saveMetadata(lifecycle, pulled.version, pulled.document);
    }
    this.assertActive(lifecycle);
    this.dirty = false;
    this.resetRetry();
    this.publish("current", null);
  }

  private async pushCurrentDocument(
    lifecycle: number,
    baseVersion: number,
  ): Promise<void> {
    const document = await this.config.flushDocumentSaves();
    this.assertActive(lifecycle);
    const serialized = serializeDocument(document);
    let expectedVersion = baseVersion;
    let response = null as Awaited<
      ReturnType<CloudSyncEngineOptions["api"]["pushConfig"]>
    > | null;

    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
      try {
        response = await this.api.pushConfig({
          baseVersion: expectedVersion,
          document,
        });
        this.assertActive(lifecycle);
        break;
      } catch (error) {
        const normalized = normalizeCloudError(error, "/sync/config");
        if (normalized.status !== 409 || normalized.code !== "version_conflict")
          throw normalized;
        if (attempt === MAX_CONFLICT_RETRIES) {
          throw new CloudError(
            409,
            "version_conflict_retry_exhausted",
            normalized.body,
          );
        }
        const latest = await this.api.pullConfig();
        this.assertActive(lifecycle);
        expectedVersion = latest.version;
      }
    }
    if (!response)
      throw new CloudError(409, "version_conflict_retry_exhausted");

    this.dirty = serializeDocument(this.requireDocument()) !== serialized;
    await this.saveMetadata(lifecycle, response.version, document);
    this.assertActive(lifecycle);
    this.resetRetry();
    this.onSnapshotsChanged();
    this.publish(this.dirty ? "pending" : "current", null);
    if (this.dirty) this.schedulePush();
  }

  private async applyPulledDocument(
    lifecycle: number,
    serverVersion: number,
    document: ConfigDocumentValue,
  ): Promise<boolean> {
    this.assertActive(lifecycle);
    const parsed = ConfigDocument.parse(document);
    const expectedLocalDocument = this.requireDocument();
    this.applyingRemote = true;
    let applied: boolean;
    try {
      applied = await this.config.applySyncedDocument(
        parsed,
        expectedLocalDocument,
      );
      this.assertActive(lifecycle);
    } finally {
      this.applyingRemote = false;
    }
    if (!applied) {
      this.dirty = true;
      return false;
    }
    this.dirty = false;
    await this.saveMetadata(lifecycle, serverVersion, parsed);
    return true;
  }

  private async saveMetadata(
    lifecycle: number,
    serverVersion: number,
    document: ConfigDocumentValue,
  ): Promise<void> {
    this.assertActive(lifecycle);
    const metadata: SyncMetadata = {
      accountId: this.accountId,
      serverVersion,
      lastSyncedDocument: ConfigDocument.parse(document),
      lastSyncAt: this.now().toISOString(),
    };
    this.metadata = metadata;
    await this.backend.syncMetadataSet(metadata);
    this.assertActive(lifecycle);
  }

  private handleFailure(error: unknown): CloudError {
    const normalized = normalizeCloudError(error);
    if (this.stopped) return normalized;
    const offline =
      normalized.code === "network" || normalized.code === "request_timeout";
    this.publish(offline ? "offline" : "error", normalized.code);
    if (normalized.retryable) this.scheduleRetry();
    return normalized;
  }

  private schedulePush(): void {
    this.clearPushTimer();
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.runSync().catch(() => undefined);
    }, this.pushDebounceMs);
  }

  private scheduleRetry(): void {
    if (this.retryDelaysMs.length === 0 || this.stopped) return;
    this.clearRetryTimer();
    const index = Math.min(this.retryAttempt, this.retryDelaysMs.length - 1);
    const delay = this.retryDelaysMs[index];
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.runSync().catch(() => undefined);
    }, delay);
  }

  private resetRetry(): void {
    this.retryAttempt = 0;
    this.clearRetryTimer();
  }

  private clearPushTimer(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private requireDocument(): ConfigDocumentValue {
    const document = this.config.getDocument();
    if (!document) throw new CloudError(0, "config_not_ready");
    return ConfigDocument.parse(document);
  }

  private isActive(lifecycle: number): boolean {
    return this.started && !this.stopped && this.lifecycle === lifecycle;
  }

  private assertActive(lifecycle: number): void {
    if (!this.isActive(lifecycle)) throw new CloudError(0, "sync_not_started");
  }

  private publish(phase: SyncPhase, errorCode = this.status.errorCode): void {
    if (this.stopped && phase !== "signedOut") return;
    this.status = {
      phase,
      lastSyncAt: this.metadata?.lastSyncAt ?? null,
      serverVersion: this.metadata?.serverVersion ?? null,
      errorCode,
      dirty: this.dirty,
    };
    this.onStatus({ ...this.status });
  }
}

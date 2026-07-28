import { defineStore } from "pinia";
import { onScopeDispose, ref, watch } from "vue";
import {
  ConfigDocument,
  type MeResponse,
  type OAuthProvider,
  type SnapshotMeta,
} from "@godgesture/shared";
import { useBackend, type DesktopDeviceInfo } from "../api/backend";
import { CloudApi } from "../cloud/api";
import { CloudError, normalizeCloudError } from "../cloud/errors";
import {
  createOAuthPkceAttempt,
  parseOAuthLoopbackResult,
} from "../cloud/oauth";
import { CloudSession, resolveApiOrigin } from "../cloud/session";
import { CloudSyncEngine, type CloudSyncStatus } from "../cloud/sync-engine";
import { useConfigStore } from "./config";

export type { OAuthProvider } from "@godgesture/shared";

export type AccountPhase =
  "initializing" | "signedOut" | "signedIn" | "sessionError";

export type LogoutOutcome = "revoked" | "local_only";

const SIGNED_OUT_SYNC_STATUS: CloudSyncStatus = {
  phase: "signedOut",
  lastSyncAt: null,
  serverVersion: null,
  errorCode: null,
  dirty: false,
};

export const useAccountStore = defineStore("account", () => {
  const backend = useBackend();
  const config = useConfigStore();

  const phase = ref<AccountPhase>("initializing");
  const user = ref<MeResponse | null>(null);
  const device = ref<DesktopDeviceInfo | null>(null);
  const authBusy = ref(false);
  const authErrorCode = ref<string | null>(null);
  const cloudConfigured = ref(false);
  const providers = ref<OAuthProvider[]>([]);
  const providersLoading = ref(false);
  const providersError = ref(false);
  const syncStatus = ref<CloudSyncStatus>({ ...SIGNED_OUT_SYNC_STATUS });
  const snapshots = ref<SnapshotMeta[]>([]);
  const snapshotsLoading = ref(false);
  const snapshotsErrorCode = ref<string | null>(null);

  let session: CloudSession | null = null;
  let api: CloudApi | null = null;
  let syncEngine: CloudSyncEngine | null = null;
  let initializeInFlight: Promise<void> | null = null;
  let snapshotRequestGeneration = 0;
  let disposed = false;

  const stopDocumentWatch = watch(
    () => config.doc,
    () => syncEngine?.markLocalChange(),
    { deep: true, flush: "sync" },
  );

  const stopReadyWatch = watch(
    () => config.ready,
    (ready) => {
      if (ready && phase.value === "signedIn" && !syncEngine) void startSync();
      if (!ready && syncEngine) stopSync();
    },
    { flush: "sync" },
  );

  onScopeDispose(() => {
    disposed = true;
    stopDocumentWatch();
    stopReadyWatch();
    syncEngine?.stop();
    syncEngine = null;
  });

  function ensureCloud(): { session: CloudSession; api: CloudApi } {
    if (!session || !api) throw new CloudError(0, "server_not_configured");
    return { session, api };
  }

  function makeDevicePayload() {
    if (!device.value || device.value.platform === "unsupported") {
      throw new CloudError(0, "unsupported_platform");
    }
    return { name: device.value.name, platform: device.value.platform };
  }

  async function configureCloud(): Promise<void> {
    cloudConfigured.value = false;
    const origin = resolveApiOrigin();
    if (!origin) throw new CloudError(0, "server_not_configured");
    device.value = await backend.accountDeviceInfo();
    if (device.value.platform === "unsupported") {
      throw new CloudError(0, "unsupported_platform");
    }
    session = new CloudSession({ apiOrigin: origin, backend });
    session.setExpiredHandler(handleSessionExpired);
    api = new CloudApi(session);
    cloudConfigured.value = true;
  }

  function initialize(): Promise<void> {
    initializeInFlight ??= initializeNow().finally(() => {
      initializeInFlight = null;
    });
    return initializeInFlight;
  }

  async function initializeNow(): Promise<void> {
    phase.value = "initializing";
    authErrorCode.value = null;
    stopSync();
    try {
      await configureCloud();
      void loadProviders();
      const cloud = ensureCloud();
      if (!(await cloud.session.restore())) {
        phase.value = "signedOut";
        syncStatus.value = { ...SIGNED_OUT_SYNC_STATUS };
        return;
      }
      user.value = await cloud.api.me();
      phase.value = "signedIn";
      await startSync();
    } catch (error) {
      const normalized = normalizeCloudError(error);
      if (normalized.code === "session_expired") {
        handleSessionExpired();
        return;
      }
      phase.value = "sessionError";
      authErrorCode.value = normalized.code;
    }
  }

  async function loadProviders(): Promise<void> {
    if (!api) return;
    providersLoading.value = true;
    providersError.value = false;
    try {
      providers.value = (await api.providers()).providers;
    } catch {
      providers.value = [];
      providersError.value = true;
    } finally {
      providersLoading.value = false;
    }
  }

  async function loginWithPassword(
    email: string,
    password: string,
  ): Promise<void> {
    if (authBusy.value) return;
    authBusy.value = true;
    authErrorCode.value = null;
    try {
      const cloud = ensureCloud();
      await cloud.api.login({ email, password, device: makeDevicePayload() });
      await finishLogin();
    } catch (error) {
      const normalized = normalizeCloudError(error);
      authErrorCode.value = normalized.code;
      throw normalized;
    } finally {
      authBusy.value = false;
    }
  }

  async function registerWithPassword(
    email: string,
    password: string,
  ): Promise<void> {
    if (authBusy.value) return;
    authBusy.value = true;
    authErrorCode.value = null;
    try {
      const cloud = ensureCloud();
      await cloud.api.register({ email, password });
      await cloud.api.login({ email, password, device: makeDevicePayload() });
      await finishLogin();
    } catch (error) {
      const normalized = normalizeCloudError(error);
      authErrorCode.value = normalized.code;
      throw normalized;
    } finally {
      authBusy.value = false;
    }
  }

  async function loginWithOAuth(provider: OAuthProvider): Promise<void> {
    if (authBusy.value || !providers.value.includes(provider)) return;
    authBusy.value = true;
    authErrorCode.value = null;
    let attemptId: string | null = null;
    try {
      const cloud = ensureCloud();
      const pkce = await createOAuthPkceAttempt();
      const loopback = await backend.oauthLoopbackStart(pkce.state);
      attemptId = loopback.attemptId;
      await backend.openExternal(
        cloud.api.authorizeUrl(
          provider,
          loopback.redirectUri,
          pkce.state,
          pkce.challenge,
        ),
      );
      const callback = parseOAuthLoopbackResult(
        await backend.oauthLoopbackFinish(loopback.attemptId),
      );
      attemptId = null;
      if (callback.error) throw new CloudError(0, callback.error);
      await cloud.api.exchangeOAuth({
        code: callback.code,
        codeVerifier: pkce.verifier,
        device: makeDevicePayload(),
      });
      await finishLogin();
    } catch (error) {
      if (attemptId)
        await backend.oauthLoopbackCancel(attemptId).catch(() => undefined);
      const normalized = normalizeCloudError(error);
      authErrorCode.value = normalized.code;
      throw normalized;
    } finally {
      authBusy.value = false;
    }
  }

  async function finishLogin(): Promise<void> {
    const cloud = ensureCloud();
    user.value = await cloud.api.me();
    phase.value = "signedIn";
    authErrorCode.value = null;
    await startSync();
  }

  async function startSync(): Promise<void> {
    if (!user.value || !config.ready || disposed) return;
    stopSync();
    const cloud = ensureCloud();
    const engine = new CloudSyncEngine({
      accountId: user.value.id,
      api: cloud.api,
      backend,
      config: {
        getDocument: () =>
          config.doc ? ConfigDocument.parse(config.doc) : null,
        flushDocumentSaves: () => config.flushDocumentSaves(),
        applySyncedDocument: (document, expectedLocalDocument) =>
          config.applySyncedDocument(document, expectedLocalDocument),
      },
      onStatus: (status) => {
        if (syncEngine === engine) syncStatus.value = status;
      },
      onSnapshotsChanged: () => {
        if (syncEngine === engine) void loadSnapshots();
      },
    });
    syncEngine = engine;
    try {
      await engine.start();
    } catch (error) {
      if (syncEngine !== engine) return;
      const normalized = normalizeCloudError(error);
      syncStatus.value = {
        phase:
          normalized.code === "network" || normalized.code === "request_timeout"
            ? "offline"
            : "error",
        lastSyncAt: null,
        serverVersion: null,
        errorCode: normalized.code,
        dirty: false,
      };
    }
    if (!disposed && user.value && syncEngine === engine) void loadSnapshots();
  }

  function stopSync(): void {
    syncEngine?.stop();
    syncEngine = null;
    snapshotRequestGeneration += 1;
    snapshots.value = [];
    snapshotsLoading.value = false;
    snapshotsErrorCode.value = null;
    syncStatus.value = { ...SIGNED_OUT_SYNC_STATUS };
  }

  async function syncNow(): Promise<void> {
    if (!syncEngine) throw new CloudError(0, "sync_not_started");
    await syncEngine.syncNow();
    await loadSnapshots();
  }

  async function loadSnapshots(): Promise<void> {
    const engine = syncEngine;
    if (!engine || snapshotsLoading.value) return;
    const requestGeneration = ++snapshotRequestGeneration;
    snapshotsLoading.value = true;
    snapshotsErrorCode.value = null;
    try {
      const next = await engine.listSnapshots();
      if (
        syncEngine === engine &&
        snapshotRequestGeneration === requestGeneration
      ) {
        snapshots.value = next;
      }
    } catch (error) {
      if (
        syncEngine === engine &&
        snapshotRequestGeneration === requestGeneration
      ) {
        snapshotsErrorCode.value = normalizeCloudError(error).code;
      }
    } finally {
      if (snapshotRequestGeneration === requestGeneration) {
        snapshotsLoading.value = false;
      }
    }
  }

  async function restoreSnapshot(version: number): Promise<void> {
    if (!syncEngine) throw new CloudError(0, "sync_not_started");
    await syncEngine.restore(version);
    await loadSnapshots();
  }

  async function logout(): Promise<LogoutOutcome> {
    if (authBusy.value) return "local_only";
    authBusy.value = true;
    authErrorCode.value = null;
    stopSync();
    let outcome: LogoutOutcome = "revoked";
    try {
      const cloud = ensureCloud();
      try {
        await cloud.api.logoutRemote();
      } catch {
        outcome = "local_only";
      }
      await cloud.session.clearLocal();
      user.value = null;
      phase.value = "signedOut";
      return outcome;
    } catch (error) {
      const normalized = normalizeCloudError(error);
      authErrorCode.value = normalized.code;
      phase.value = "sessionError";
      throw normalized;
    } finally {
      authBusy.value = false;
    }
  }

  async function discardStoredSession(): Promise<void> {
    const cloud = ensureCloud();
    await cloud.session.clearLocal();
    user.value = null;
    authErrorCode.value = null;
    phase.value = "signedOut";
  }

  function handleSessionExpired(): void {
    stopSync();
    user.value = null;
    phase.value = "signedOut";
    authErrorCode.value = "session_expired";
  }

  return {
    phase,
    user,
    device,
    authBusy,
    authErrorCode,
    cloudConfigured,
    providers,
    providersLoading,
    providersError,
    syncStatus,
    snapshots,
    snapshotsLoading,
    snapshotsErrorCode,
    initialize,
    loadProviders,
    loginWithPassword,
    registerWithPassword,
    loginWithOAuth,
    syncNow,
    loadSnapshots,
    restoreSnapshot,
    logout,
    discardStoredSession,
  };
});

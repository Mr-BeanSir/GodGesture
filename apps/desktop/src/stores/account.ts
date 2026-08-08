import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, watch } from "vue";
import {
  ConfigDocument,
  DEFAULT_SNAPSHOT_PAGE_SIZE,
  PublicTemplateSubmissionResponse,
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
import { appLog } from "../logging";

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

const ENDPOINT_MODE_KEY = "godgesture.account.endpointMode";
const CUSTOM_ENDPOINT_KEY = "godgesture.account.customEndpoint";
type EndpointMode = "official" | "custom";

function readEndpointSettings(): { mode: EndpointMode; custom: string } {
  if (typeof localStorage === "undefined") return { mode: "official", custom: "" };
  const mode = localStorage.getItem(ENDPOINT_MODE_KEY) === "custom" ? "custom" : "official";
  return { mode, custom: localStorage.getItem(CUSTOM_ENDPOINT_KEY) ?? "" };
}

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
  const pendingOAuth = ref<{ bindingId: string; verifier: string } | null>(null);
  const providersLoading = ref(false);
  const providersError = ref(false);
  const syncStatus = ref<CloudSyncStatus>({ ...SIGNED_OUT_SYNC_STATUS });
  const snapshots = ref<SnapshotMeta[]>([]);
  const snapshotsPage = ref(1);
  const snapshotsPageSize = ref(DEFAULT_SNAPSHOT_PAGE_SIZE);
  const snapshotsTotal = ref(0);
  const snapshotsTotalPages = ref(1);
  const snapshotsLoading = ref(false);
  const snapshotsErrorCode = ref<string | null>(null);
  const endpointSettings = readEndpointSettings();
  const endpointMode = ref<EndpointMode>(endpointSettings.mode);
  const customApiOrigin = ref(endpointSettings.custom);
  const apiOrigin = computed(() =>
    endpointMode.value === "custom" ? customApiOrigin.value : resolveApiOrigin(),
  );

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
    const origin = resolveApiOrigin(apiOrigin.value ?? undefined, false);
    if (!origin) throw new CloudError(0, "server_not_configured");
    device.value = await backend.accountDeviceInfo();
    if (device.value.platform === "unsupported") {
      throw new CloudError(0, "unsupported_platform");
    }
    session = new CloudSession({ apiOrigin: origin, backend });
    appLog.info("cloud", `会话已配置 origin=${origin}`);
    session.setExpiredHandler(handleSessionExpired);
    api = new CloudApi(session);
    cloudConfigured.value = true;
  }

  async function setEndpoint(mode: EndpointMode, customOrigin = customApiOrigin.value): Promise<void> {
    const normalized = mode === "official"
      ? resolveApiOrigin()
      : resolveApiOrigin(customOrigin, false);
    if (!normalized) throw new CloudError(0, "invalid_api_origin");
    endpointMode.value = mode;
    customApiOrigin.value = mode === "custom" ? normalized : customOrigin;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ENDPOINT_MODE_KEY, mode);
      if (mode === "custom") localStorage.setItem(CUSTOM_ENDPOINT_KEY, normalized);
    }
    await initialize();
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
      appLog.error(
        "cloud",
        `会话初始化失败 origin=${apiOrigin.value ?? ""} status=${normalized.status} code=${normalized.code}`,
      );
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
      if (callback.pendingOAuth) {
        pendingOAuth.value = { bindingId: callback.pendingOAuth, verifier: pkce.verifier };
        return;
      }
      await cloud.api.exchangeOAuth({
        code: callback.code!,
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

  async function requestPendingOAuthEmailCode(email: string): Promise<void> {
    if (!pendingOAuth.value) throw new CloudError(0, "oauth_pending_missing");
    await ensureCloud().api.requestPendingOAuthEmailCode(pendingOAuth.value.bindingId, { email });
  }

  async function completePendingOAuth(email: string, verificationCode: string): Promise<void> {
    const pending = pendingOAuth.value;
    if (!pending) throw new CloudError(0, "oauth_pending_missing");
    await ensureCloud().api.completePendingOAuthBinding(pending.bindingId, { email, verificationCode, codeVerifier: pending.verifier, device: makeDevicePayload() });
    pendingOAuth.value = null;
    await finishLogin();
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
    snapshotsPage.value = 1;
    snapshotsPageSize.value = DEFAULT_SNAPSHOT_PAGE_SIZE;
    snapshotsTotal.value = 0;
    snapshotsTotalPages.value = 1;
    snapshotsLoading.value = false;
    snapshotsErrorCode.value = null;
    syncStatus.value = { ...SIGNED_OUT_SYNC_STATUS };
  }

  async function syncNow(): Promise<void> {
    if (!syncEngine) throw new CloudError(0, "sync_not_started");
    await syncEngine.syncNow();
    await loadSnapshots();
  }

  async function loadSnapshots(
    page = snapshotsPage.value,
    pageSize = snapshotsPageSize.value,
  ): Promise<void> {
    const engine = syncEngine;
    if (!engine || snapshotsLoading.value) return;
    const requestGeneration = ++snapshotRequestGeneration;
    snapshotsLoading.value = true;
    snapshotsErrorCode.value = null;
    try {
      const next = await engine.listSnapshots({ page, pageSize });
      if (
        syncEngine === engine &&
        snapshotRequestGeneration === requestGeneration
      ) {
        snapshots.value = next.snapshots;
        snapshotsPage.value = next.page;
        snapshotsPageSize.value = next.pageSize;
        snapshotsTotal.value = next.total;
        snapshotsTotalPages.value = next.totalPages;
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

  async function submitPublicTemplate(templatePackage: unknown) {
    if (endpointMode.value !== "official" || phase.value !== "signedIn" || !user.value?.emailVerified) {
      throw new CloudError(403, "official_endpoint_login_required");
    }
    const cloud = ensureCloud();
    const response = await cloud.session.authenticatedFetch(`${cloud.session.apiBase}/public/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ package: templatePackage }),
    });
    if (!response.ok) throw normalizeCloudError(await response.json().catch(() => null));
    const parsed = PublicTemplateSubmissionResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new CloudError(response.status, "invalid_server_response");
    return parsed.data;
  }

  async function updateDisplayName(displayName: string): Promise<void> {
    if (phase.value !== "signedIn" || !user.value) throw new CloudError(401, "session_expired");
    const cloud = ensureCloud();
    const response = await cloud.session.authenticatedFetch(`${cloud.session.apiBase}/account/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ displayName }),
    });
    if (!response.ok) throw new CloudError(response.status, "profile_update_failed");
    const profile = await response.json() as { displayName: string };
    user.value = { ...user.value, displayName: profile.displayName };
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
    endpointMode,
    customApiOrigin,
    apiOrigin,
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
    snapshotsPage,
    snapshotsPageSize,
    snapshotsTotal,
    snapshotsTotalPages,
    snapshotsLoading,
    snapshotsErrorCode,
    initialize,
    setEndpoint,
    loadProviders,
    loginWithPassword,
    loginWithOAuth,
    pendingOAuth,
    requestPendingOAuthEmailCode,
    completePendingOAuth,
    syncNow,
    loadSnapshots,
    restoreSnapshot,
    submitPublicTemplate,
    updateDisplayName,
    logout,
    discardStoredSession,
  };
});

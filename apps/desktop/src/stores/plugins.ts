import { computed, onScopeDispose, ref } from "vue";
import { defineStore } from "pinia";
import type { OnlinePluginCatalogEntry } from "@godgesture/shared";
import { type PluginWorkspaceSnapshot, useBackend } from "../api/backend";
import {
  OnlinePluginSourceError,
  createOnlinePluginSource,
} from "../plugins/source";

export type PluginErrorOperation =
  | "initialize"
  | "refresh"
  | "openRoot"
  | "openProject"
  | "installOnline";

export interface PluginErrorDiagnostic {
  operation: PluginErrorOperation;
  path: string | null;
  name: string;
  code: string | null;
  message: string;
  stack: string | null;
  thrownValue: string;
  timestamp: string;
}

function serializeThrownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return [
      `${value.name}: ${value.message}`,
      value.stack && value.stack !== `${value.name}: ${value.message}` ? value.stack : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      // Some host errors are not serializable; keep the stable fallback below.
    }
  }

  return String(value);
}

function isBackendError(cause: unknown): cause is Error & { code: string; cause?: unknown } {
  if (!(cause instanceof Error)) return false;
  const value = cause as Error & { code?: unknown };
  return cause.name === "BackendError" && typeof value.code === "string";
}

function thrownValue(cause: unknown): unknown {
  return isBackendError(cause) && cause.cause !== undefined ? cause.cause : cause;
}

function errorMessage(cause: unknown, raw: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && cause !== null) {
    const value = cause as { error?: unknown; message?: unknown };
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
  }
  return raw;
}

function capturePluginError(
  cause: unknown,
  operation: PluginErrorOperation,
  path: string | null,
): PluginErrorDiagnostic {
  const rawValue = thrownValue(cause);
  const raw = serializeThrownValue(rawValue);
  return {
    operation,
    path,
    name: cause instanceof Error ? cause.name : typeof cause,
    code: isBackendError(cause) ? cause.code : null,
    message: errorMessage(cause, raw),
    stack: cause instanceof Error ? cause.stack ?? null : null,
    thrownValue: raw,
    timestamp: new Date().toISOString(),
  };
}

export const usePluginsStore = defineStore("plugins", () => {
  const backend = useBackend();
  const onlineSource = createOnlinePluginSource(!backend.isTauri);
  const snapshot = ref<PluginWorkspaceSnapshot>({ root: "", plugins: [] });
  const loading = ref(false);
  const error = ref<PluginErrorDiagnostic | null>(null);
  const selectedPath = ref<string | null>(null);
  const onlineEntries = ref<OnlinePluginCatalogEntry[]>([]);
  const loadingOnlineCatalog = ref(false);
  const onlineCatalogError = ref<string | null>(null);
  const installingPluginId = ref<string | null>(null);
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let onlineCatalogRequest: Promise<void> | null = null;
  let onlineCatalogRequestForced = false;
  let unlisten: (() => void) | undefined;

  const plugins = computed(() => snapshot.value.plugins);
  const readyPlugins = computed(() =>
    plugins.value.filter((plugin) => plugin.status === "ready"),
  );
  const selected = computed(() =>
    plugins.value.find((plugin) => plugin.path === selectedPath.value) ?? plugins.value[0] ?? null,
  );
  const installedPluginIds = computed(() => new Set(readyPlugins.value.map((plugin) => plugin.id)));

  function apply(next: PluginWorkspaceSnapshot) {
    snapshot.value = next;
    if (!selectedPath.value || !next.plugins.some((plugin) => plugin.path === selectedPath.value)) {
      selectedPath.value = next.plugins[0]?.path ?? null;
    }
  }

  function applyEvent(next: PluginWorkspaceSnapshot) {
    apply(next);
    error.value = null;
  }

  async function ensureSubscription() {
    if (!unlisten) unlisten = await backend.onNodePluginsChanged(applyEvent);
  }

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      apply(await backend.nodePluginsRescan());
      await ensureSubscription();
      initialized = true;
    } catch (cause) {
      error.value = capturePluginError(cause, "refresh", snapshot.value.root || null);
    } finally {
      loading.value = false;
    }
  }

  async function loadOnlineCatalog(force = false) {
    if (onlineCatalogRequest) {
      const pending = onlineCatalogRequest;
      if (!force || onlineCatalogRequestForced) return pending;
      await pending;
      return loadOnlineCatalog(true);
    }
    if (onlineEntries.value.length > 0 && !force) return;
    const request = (async () => {
      loadingOnlineCatalog.value = true;
      onlineCatalogError.value = null;
      try {
        const catalog = await onlineSource.loadCatalog(force);
        onlineEntries.value = catalog.entries;
      } catch (cause) {
        onlineCatalogError.value =
          cause instanceof OnlinePluginSourceError
            ? cause.code
            : errorMessage(cause, "plugin_catalog_failed");
      } finally {
        loadingOnlineCatalog.value = false;
      }
    })();
    onlineCatalogRequest = request;
    onlineCatalogRequestForced = force;
    const clearRequest = () => {
      if (onlineCatalogRequest === request) {
        onlineCatalogRequest = null;
        onlineCatalogRequestForced = false;
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  async function installOnline(entry: OnlinePluginCatalogEntry) {
    if (installingPluginId.value) return false;
    if (installedPluginIds.value.has(entry.pluginId)) return true;
    installingPluginId.value = entry.pluginId;
    error.value = null;
    try {
      apply(
        await backend.nodePluginInstall({
          pluginId: entry.pluginId,
          repositoryUrl: entry.repositoryUrl,
          ref: entry.ref,
          subdirectory: entry.subdirectory,
        }),
      );
      return true;
    } catch (cause) {
      error.value = capturePluginError(cause, "installOnline", entry.repositoryUrl);
      return false;
    } finally {
      installingPluginId.value = null;
    }
  }

  function initialize() {
    if (initialized) return Promise.resolve();
    if (initializePromise) return initializePromise;

    initializePromise = (async () => {
      loading.value = true;
      error.value = null;
      try {
        apply(await backend.nodePluginsGet());
        await ensureSubscription();
        initialized = true;
      } catch (cause) {
        error.value = capturePluginError(cause, "initialize", snapshot.value.root || null);
      } finally {
        loading.value = false;
        initializePromise = null;
      }
    })();
    return initializePromise;
  }

  async function openRoot() {
    let path = snapshot.value.root || null;
    try {
      path = path || (await backend.nodePluginsDirectory());
      await backend.openPath(path);
    } catch (cause) {
      error.value = capturePluginError(cause, "openRoot", path);
    }
  }

  async function openProject(path: string) {
    try {
      await backend.openPath(path);
    } catch (cause) {
      error.value = capturePluginError(cause, "openProject", path);
    }
  }

  onScopeDispose(() => unlisten?.());

  return {
    backend,
    snapshot,
    plugins,
    readyPlugins,
    onlineEntries,
    installedPluginIds,
    selected,
    selectedPath,
    loading,
    error,
    loadingOnlineCatalog,
    onlineCatalogError,
    installingPluginId,
    initialize,
    refresh,
    loadOnlineCatalog,
    installOnline,
    openRoot,
    openProject,
  };
});

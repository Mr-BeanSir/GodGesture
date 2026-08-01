/**
 * Tauri IPC 唯一网关(类型化)。
 *
 * Rust 侧需实现的命令(snake_case,与本文件一一对应):
 * - config_get(): ConfigDocument
 * - config_set(document: ConfigDocument)        // 保存并即时生效
 * - node_plugin_install(plugin): NodePackageResult // 用户主动解析/准备依赖
 * - node_plugin_package_search(query): NodePackageSearchResult[] // npm registry metadata
 * - node_plugin_package_latest(name): string // npm dist-tag metadata
 * - machine_get(): MachineLocalSettings
 * - machine_set(settings: MachineLocalSettings)
 * - machine_status(): MachineRuntimeStatus
 * - legacy_import_apply(document, machine)       // 双配置批量应用与进程内回滚
 * - engine_is_paused(): boolean
 * - engine_toggle_pause(): boolean
 *     + Tauri event "pause-changed", payload: boolean
 * - capture_start() / capture_cancel()
 *     + tauri 事件 "gesture-captured",payload: {trigger, strokes, mnemonic}
 * - pick_window(): {exeName, exePath, appName, aumid, bundleId} | null
 * - resolve_app_file(path): {exeName, exePath, appName, aumid, bundleId}
 * - app_icon(request): string | null             // base64 png
 * - download_template_text(url, resourceKind): string
 *
 * 浏览器(无 Tauri)环境自动降级为内存 mock(见 ./mock.ts),整套 UI 可独立自测。
 */
import type {
  ConfigDocument,
  DevicePlatform,
  MachineLocalSettings,
  NodePlugin,
} from "@godgesture/shared";
import { createMockBackend } from "./mock";

/** 录制中/录制完成推送的手势载荷 */
export interface CapturedGesture {
  trigger: string;
  strokes: string[];
  mnemonic: string;
}

export interface PickedWindow {
  exeName: string;
  exePath: string;
  appName: string;
  aumid: string | null;
  bundleId: string | null;
}

export interface AppFileDropEvent {
  type: "enter" | "over" | "drop" | "leave";
  paths: string[];
}

export type TemplateResourceKind = "catalog" | "package";

export interface AppIconRequest {
  windowsExeName?: string;
  macBundleId?: string;
}

export type LegacyImportApplyErrorCode = "apply_failed" | "rollback_incomplete";

export interface MachineRuntimeStatus {
  healthy: boolean;
  code: string | null;
  message: string | null;
}

export interface PlatformRuntimeStatus {
  platform: "windows" | "macos" | "unsupported";
  gestureEngineRunning: boolean;
  accessibility: boolean;
  inputMonitoring: boolean;
  eventPosting: boolean;
  code: string | null;
  message: string | null;
}

export interface SyncMetadata {
  accountId: string;
  serverVersion: number;
  lastSyncedDocument: ConfigDocument;
  lastSyncAt: string;
}

export interface DesktopDeviceInfo {
  name: string;
  platform: DevicePlatform | "unsupported";
}

export interface OAuthLoopbackStart {
  attemptId: string;
  redirectUri: string;
}

export interface OAuthLoopbackResult {
  code: string | null;
  error: string | null;
}

export interface UpdateMetadata {
  currentVersion: string;
  version: string;
  notes: string | null;
  publishedAt: string | null;
}

export interface NodePackageResult {
  lockfile: string | null;
  output: string;
  ready: boolean;
}

export interface NodeTestResult {
  output: string;
  ready: boolean;
}

export interface NodeTypecheckDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface NodeTypecheckResult {
  output: string;
  ready: boolean;
  diagnostics: NodeTypecheckDiagnostic[];
}

export interface NodePluginCacheStatus {
  state: "notRequired" | "lockfileMissing" | "missing" | "ready";
  revision: string;
}

export interface NodePackageSearchResult {
  name: string;
  version: string;
  description: string | null;
  weeklyDownloads: number | null;
}

export type UpdateDownloadEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | {
      event: "progress";
      data: { chunkLength: number; downloaded: number };
    }
  | { event: "finished"; data: { downloaded: number } };

/** Stable error contract for callers that must distinguish an incomplete rollback. */
export class BackendError extends Error {
  public readonly cause: unknown;

  constructor(
    public readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "BackendError";
    this.cause = cause;
  }
}

export interface Backend {
  readonly isTauri: boolean;

  configGet(): Promise<ConfigDocument>;
  /** 保存并即时生效 */
  configSet(document: ConfigDocument): Promise<void>;
  nodePluginInstall(plugin: NodePlugin): Promise<NodePackageResult>;
  nodePluginPackageSearch(query: string): Promise<NodePackageSearchResult[]>;
  nodePluginPackageLatest(name: string): Promise<string>;
  nodePluginTest(plugin: NodePlugin, handler: string): Promise<NodeTestResult>;
  nodePluginTypecheck(plugin: NodePlugin): Promise<NodeTypecheckResult>;
  nodePluginCacheStatus(plugin: NodePlugin): Promise<NodePluginCacheStatus>;

  machineGet(): Promise<MachineLocalSettings>;
  machineSet(settings: MachineLocalSettings): Promise<void>;
  machineStatus(): Promise<MachineRuntimeStatus>;
  platformStatus(): Promise<PlatformRuntimeStatus>;
  platformRequestPermissions(): Promise<PlatformRuntimeStatus>;
  platformOpenPermissionSettings(): Promise<void>;
  /** Atomically applies a legacy import, or restores the previous backend state. */
  legacyImportApply(
    document: ConfigDocument,
    machine: MachineLocalSettings,
  ): Promise<void>;

  engineIsPaused(): Promise<boolean>;
  engineTogglePause(): Promise<boolean>;
  onPauseChanged(handler: (paused: boolean) => void): Promise<() => void>;

  captureStart(): Promise<void>;
  captureCancel(): Promise<void>;
  /** 订阅 "gesture-captured" 事件;返回退订函数 */
  onGestureCaptured(
    handler: (gesture: CapturedGesture) => void,
  ): Promise<() => void>;

  pickWindow(): Promise<PickedWindow | null>;
  resolveAppFile(path: string): Promise<PickedWindow>;
  onAppFileDrop(
    handler: (event: AppFileDropEvent) => void,
  ): Promise<() => void>;
  /** base64 png,失败返回 null */
  appIcon(request: AppIconRequest): Promise<string | null>;
  downloadTemplateText(
    url: string,
    resourceKind: TemplateResourceKind,
  ): Promise<string>;

  accountCredentialGet(apiOrigin: string): Promise<string | null>;
  accountCredentialSet(apiOrigin: string, refreshToken: string): Promise<void>;
  accountCredentialDelete(apiOrigin: string): Promise<void>;
  accountDeviceInfo(): Promise<DesktopDeviceInfo>;
  syncMetadataGet(): Promise<SyncMetadata | null>;
  syncMetadataSet(metadata: SyncMetadata): Promise<void>;
  oauthLoopbackStart(clientState: string): Promise<OAuthLoopbackStart>;
  oauthLoopbackFinish(attemptId: string): Promise<OAuthLoopbackResult>;
  oauthLoopbackCancel(attemptId: string): Promise<void>;

  updateCheck(): Promise<UpdateMetadata | null>;
  updateCancel(): Promise<void>;
  updateInstall(
    handler: (event: UpdateDownloadEvent) => void,
  ): Promise<void>;

  /** 系统浏览器打开外部链接 */
  openExternal(url: string): Promise<void>;

  getAppVersion(): Promise<string>;
}

function normalizeBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;

  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string") {
      return new BackendError(
        value.code,
        typeof value.message === "string" ? value.message : value.code,
        error,
      );
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === "string") {
      return new BackendError(
        parsed.code,
        typeof parsed.message === "string" ? parsed.message : message,
        error,
      );
    }
  } catch {
    // Tauri may reject with a plain string; fall through to the stable-code scan.
  }

  const code = message.includes("rollback_incomplete")
    ? "rollback_incomplete"
    : message.includes("apply_failed")
      ? "apply_failed"
      : "unknown";
  return new BackendError(code, message, error);
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createTauriBackend(): Backend {
  return {
    isTauri: true,

    async configGet() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<ConfigDocument>("config_get");
    },
    async configSet(document) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("config_set", { document });
    },
    async nodePluginInstall(plugin) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<NodePackageResult>("node_plugin_install", { plugin });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async nodePluginPackageSearch(query) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<NodePackageSearchResult[]>("node_plugin_package_search", { query });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async nodePluginPackageLatest(name) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<string>("node_plugin_package_latest", { name });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async nodePluginTest(plugin, handler) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<NodeTestResult>("node_plugin_test", { plugin, handler });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async nodePluginTypecheck(plugin) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<NodeTypecheckResult>("node_plugin_typecheck", { plugin });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async nodePluginCacheStatus(plugin) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<NodePluginCacheStatus>("node_plugin_cache_status", { plugin });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async machineGet() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<MachineLocalSettings>("machine_get");
    },
    async machineSet(settings) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("machine_set", { settings });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async machineStatus() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<MachineRuntimeStatus>("machine_status");
    },
    async platformStatus() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<PlatformRuntimeStatus>("platform_status");
    },
    async platformRequestPermissions() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<PlatformRuntimeStatus>("platform_request_permissions");
    },
    async platformOpenPermissionSettings() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("platform_open_permission_settings");
    },
    async legacyImportApply(document, machine) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("legacy_import_apply", { document, machine });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async engineIsPaused() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<boolean>("engine_is_paused");
    },
    async engineTogglePause() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<boolean>("engine_toggle_pause");
    },
    async onPauseChanged(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<boolean>("pause-changed", (event) =>
        handler(event.payload),
      );
    },
    async captureStart() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("capture_start");
    },
    async captureCancel() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("capture_cancel");
    },
    async onGestureCaptured(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<CapturedGesture>("gesture-captured", (event) =>
        handler(event.payload),
      );
    },
    async pickWindow() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<PickedWindow | null>("pick_window");
    },
    async resolveAppFile(path) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<PickedWindow>("resolve_app_file", { path });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async onAppFileDrop(handler) {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      return getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        handler({
          type: payload.type,
          paths: "paths" in payload ? payload.paths : [],
        });
      });
    },
    async appIcon(request) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string | null>("app_icon", { request });
    },
    async downloadTemplateText(url, resourceKind) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<string>("download_template_text", {
          url,
          resourceKind,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountCredentialGet(apiOrigin) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<string | null>("account_credential_get", {
          apiOrigin,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountCredentialSet(apiOrigin, refreshToken) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("account_credential_set", { apiOrigin, refreshToken });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountCredentialDelete(apiOrigin) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("account_credential_delete", { apiOrigin });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountDeviceInfo() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<DesktopDeviceInfo>("account_device_info");
    },
    async syncMetadataGet() {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<SyncMetadata | null>("sync_metadata_get");
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async syncMetadataSet(metadata) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("sync_metadata_set", { metadata });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async oauthLoopbackStart(clientState) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<OAuthLoopbackStart>("oauth_loopback_start", {
          clientState,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async oauthLoopbackFinish(attemptId) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<OAuthLoopbackResult>("oauth_loopback_finish", {
          attemptId,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async oauthLoopbackCancel(attemptId) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("oauth_loopback_cancel", { attemptId });
    },
    async updateCheck() {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<UpdateMetadata | null>("update_check");
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async updateCancel() {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("update_cancel");
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async updateInstall(handler) {
      const { Channel, invoke } = await import("@tauri-apps/api/core");
      const onEvent = new Channel<UpdateDownloadEvent>();
      onEvent.onmessage = handler;
      try {
        await invoke("update_install", { onEvent });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async openExternal(url) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    },
    async getAppVersion() {
      const { getVersion } = await import("@tauri-apps/api/app");
      return getVersion();
    },
  };
}

let instance: Backend | null = null;

/** 获取后端网关单例(Tauri 或浏览器 mock) */
export function useBackend(): Backend {
  if (!instance) {
    instance = isTauriRuntime() ? createTauriBackend() : createMockBackend();
  }
  return instance;
}

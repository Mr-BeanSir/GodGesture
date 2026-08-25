/**
 * Tauri IPC 唯一网关(类型化)。
 *
 * Rust 侧需实现的命令(snake_case,与本文件一一对应):
 * - config_get(): ConfigDocument
 * - config_set(document: ConfigDocument)        // 保存并即时生效
 * - node_plugins_get()/node_plugins_rescan(): PluginWorkspaceSnapshot
 * - node_plugins_directory(): string
 *     + Tauri event "node-plugins-changed", payload: PluginWorkspaceSnapshot
 * - machine_get(): MachineLocalSettings
 * - machine_set(settings: MachineLocalSettings)
 * - machine_status(): MachineRuntimeStatus
 * - engine_is_paused(): boolean
 * - engine_toggle_pause(): boolean
 *     + Tauri event "pause-changed", payload: boolean
 * - capture_start() / capture_cancel()
 *     + tauri 事件 "gesture-captured",payload: {trigger, strokes, inputs, modifier, mnemonic}
 * - pick_window(): {exeName, exePath, appName, aumid, bundleId} | null
 * - resolve_app_file(path): {exeName, exePath, appName, aumid, bundleId}
 * - app_icon(request): string | null             // base64 png
 * - gesture_template_save(fileName, contents, title): string | null
 * - download_template_text(url, resourceKind): string
 * - catalog_cache_get(kind): string | null
 * - catalog_cache_set(kind, contents): void
 *
 * 浏览器(无 Tauri)环境自动降级为内存 mock(见 ./mock.ts),整套 UI 可独立自测。
 */
import type {
  ConfigDocument,
  DevicePlatform,
  GestureInput,
  MachineLocalSettings,
  OnlinePluginSource,
} from "@godgesture/shared";
import { createMockBackend } from "./mock";
import { writeBackendDiagnostic } from "../runtime-diagnostics";

export { setBackendDiagnosticWriter, type BackendDiagnosticWriter } from "../runtime-diagnostics";

/** 录制中/录制完成推送的手势载荷 */
export interface CapturedGesture {
  trigger: string;
  strokes: string[];
  /** 按实际捕获顺序推送的输入步骤。旧运行时可能不提供。 */
  inputs?: GestureInput[];
  mnemonic: string;
  modifier: string;
}

/** 原生低级键盘钩子在快捷键录制期间转发的事件。 */
export interface HotkeyCaptureEvent {
  code: string;
  pressed: boolean;
  repeat: boolean;
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

export type TemplateResourceKind = "catalog" | "package" | "pluginCatalog";
export type CatalogCacheKind = "templates" | "plugins";

export interface AppIconRequest {
  windowsExeName?: string;
  macBundleId?: string;
}

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
  deviceKey: string;
}

export interface OAuthLoopbackStart {
  attemptId: string;
  redirectUri: string;
}

export interface OAuthLoopbackResult {
  code: string | null;
  pendingOAuth: string | null;
  error: string | null;
}

export interface UpdateMetadata {
  currentVersion: string;
  version: string;
  notes: string | null;
  publishedAt: string | null;
}

export interface PluginProjectSummary {
  id: string;
  name: string;
  version: string;
  path: string;
  entry: string;
  apiVersion: number;
  lifecycles: string[];
  status: "ready" | "error";
  error: string | null;
  lastReloadAt: number | null;
}

export interface PluginWorkspaceSnapshot {
  root: string;
  plugins: PluginProjectSummary[];
}

export type LogLevel = "off" | "error" | "warn" | "info" | "debug";
export type LogEntryLevel = Exclude<LogLevel, "off">;

export interface LogEntry {
  timestamp: string;
  level: LogEntryLevel;
  target: string;
  message: string;
}

export interface LogsQueryRequest {
  level?: LogLevel | null;
  target?: string | null;
  keyword?: string | null;
  limit?: number | null;
}

export interface LogsQueryResponse {
  entries: LogEntry[];
  total?: number;
  files?: string[];
  logPath?: string;
  level?: LogLevel;
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
  nodePluginsGet(): Promise<PluginWorkspaceSnapshot>;
  nodePluginsRescan(): Promise<PluginWorkspaceSnapshot>;
  nodePluginsDirectory(): Promise<string>;
  nodePluginInstall(source: OnlinePluginSource): Promise<PluginWorkspaceSnapshot>;
  onNodePluginsChanged(
    handler: (snapshot: PluginWorkspaceSnapshot) => void,
  ): Promise<() => void>;

  logLevelGet(): Promise<LogLevel>;
  logLevelSet(level: LogLevel): Promise<LogLevel>;
  logWrite(level: LogEntryLevel, target: string, message: string): Promise<void>;
  logsQuery(request: LogsQueryRequest): Promise<LogsQueryResponse>;
  logsExport(request: LogsQueryRequest): Promise<string>;
  logsClear(): Promise<void>;
  onLogEvent(handler: (entry: LogEntry) => void): Promise<() => void>;

  machineGet(): Promise<MachineLocalSettings>;
  machineSet(settings: MachineLocalSettings): Promise<void>;
  machineStatus(): Promise<MachineRuntimeStatus>;
  platformStatus(): Promise<PlatformRuntimeStatus>;
  platformRequestPermissions(): Promise<PlatformRuntimeStatus>;
  platformOpenPermissionSettings(): Promise<void>;
  engineIsPaused(): Promise<boolean>;
  engineTogglePause(): Promise<boolean>;
  onPauseChanged(handler: (paused: boolean) => void): Promise<() => void>;

  captureStart(): Promise<void>;
  captureCancel(): Promise<void>;
  /** Windows 录制期间尝试阻断系统快捷键的原生键盘捕获。 */
  hotkeyCaptureStart(): Promise<void>;
  hotkeyCaptureCancel(): Promise<void>;
  onHotkeyCapture(handler: (event: HotkeyCaptureEvent) => void): Promise<() => void>;
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
  /** 打开系统保存面板并写出一个手势模板;取消时返回 null。 */
  gestureTemplateSave(
    fileName: string,
    contents: string,
    title: string,
  ): Promise<string | null>;
  downloadTemplateText(
    url: string,
    resourceKind: TemplateResourceKind,
  ): Promise<string>;
  /** Read a previously validated online catalog from the native AppData cache. */
  catalogCacheGet(kind: CatalogCacheKind): Promise<string | null>;
  /** Replace an online catalog cache entry in the native AppData directory. */
  catalogCacheSet(kind: CatalogCacheKind, contents: string): Promise<void>;

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
  devtoolsToggle(): Promise<boolean>;

  /** 系统浏览器打开外部链接 */
  openExternal(url: string): Promise<void>;
  /** 使用系统文件管理器打开本地目录。 */
  openPath(path: string): Promise<void>;

  getAppVersion(): Promise<string>;
}

function normalizeBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;

  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; error?: unknown; message?: unknown };
    const detail =
      typeof value.message === "string"
        ? value.message
        : typeof value.error === "string"
          ? value.error
          : null;
    if (typeof value.code === "string") {
      return new BackendError(
        value.code,
        detail ?? value.code,
        error,
      );
    }
    if (detail) return new BackendError("unknown", detail, error);
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

export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  writeBackendDiagnostic("debug", "ipc", `start command=${command}`);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = args === undefined
      ? await invoke<T>(command)
      : await invoke<T>(command, args);
    writeBackendDiagnostic(
      "debug",
      "ipc",
      `success command=${command} durationMs=${Date.now() - startedAt}`,
    );
    return result;
  } catch (error) {
    writeBackendDiagnostic(
      "error",
      "ipc",
      `failed command=${command} durationMs=${Date.now() - startedAt}`,
    );
    throw error;
  }
}

function createTauriBackend(): Backend {
  return {
    isTauri: true,

    async configGet() {
      return invokeCommand<ConfigDocument>("config_get");
    },
    async configSet(document) {
      await invokeCommand("config_set", { document });
    },
    async nodePluginsGet() {
      return invokeCommand<PluginWorkspaceSnapshot>("node_plugins_get");
    },
    async nodePluginsRescan() {
      return invokeCommand<PluginWorkspaceSnapshot>("node_plugins_rescan");
    },
    async nodePluginsDirectory() {
      return invokeCommand<string>("node_plugins_directory");
    },
    async nodePluginInstall(source) {
      try {
        return await invokeCommand<PluginWorkspaceSnapshot>("node_plugin_install", {
          source,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async onNodePluginsChanged(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<PluginWorkspaceSnapshot>("node-plugins-changed", (event) =>
        handler(event.payload),
      );
    },
    async logLevelGet() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<LogLevel>("log_level_get");
    },
    async logLevelSet(level) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<LogLevel>("log_level_set", { level });
    },
    async logWrite(level, target, message) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("log_write", { level, target, message });
    },
    async logsQuery(request) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<LogsQueryResponse>("logs_query", { request });
    },
    async logsExport(request) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string>("logs_export", { request });
    },
    async logsClear() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("logs_clear");
    },
    async onLogEvent(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<LogEntry>("log-event", (event) => handler(event.payload));
    },
    async machineGet() {
      return invokeCommand<MachineLocalSettings>("machine_get");
    },
    async machineSet(settings) {
      try {
        await invokeCommand("machine_set", { settings });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async machineStatus() {
      return invokeCommand<MachineRuntimeStatus>("machine_status");
    },
    async platformStatus() {
      return invokeCommand<PlatformRuntimeStatus>("platform_status");
    },
    async platformRequestPermissions() {
      return invokeCommand<PlatformRuntimeStatus>("platform_request_permissions");
    },
    async platformOpenPermissionSettings() {
      await invokeCommand("platform_open_permission_settings");
    },
    async engineIsPaused() {
      return invokeCommand<boolean>("engine_is_paused");
    },
    async engineTogglePause() {
      return invokeCommand<boolean>("engine_toggle_pause");
    },
    async onPauseChanged(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<boolean>("pause-changed", (event) =>
        handler(event.payload),
      );
    },
    async captureStart() {
      await invokeCommand("capture_start");
    },
    async captureCancel() {
      await invokeCommand("capture_cancel");
    },
    async hotkeyCaptureStart() {
      await invokeCommand("hotkey_capture_start");
    },
    async hotkeyCaptureCancel() {
      await invokeCommand("hotkey_capture_cancel");
    },
    async onHotkeyCapture(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<HotkeyCaptureEvent>("hotkey-capture", (event) =>
        handler(event.payload),
      );
    },
    async onGestureCaptured(handler) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<CapturedGesture>("gesture-captured", (event) =>
        handler(event.payload),
      );
    },
    async pickWindow() {
      return invokeCommand<PickedWindow | null>("pick_window");
    },
    async resolveAppFile(path) {
      try {
        return await invokeCommand<PickedWindow>("resolve_app_file", { path });
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
      return invokeCommand<string | null>("app_icon", { request });
    },
    async gestureTemplateSave(fileName, contents, title) {
      try {
        return await invokeCommand<string | null>("gesture_template_save", {
          fileName,
          contents,
          title,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async downloadTemplateText(url, resourceKind) {
      try {
        return await invokeCommand<string>("download_template_text", {
          url,
          resourceKind,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async catalogCacheGet(kind) {
      try {
        return await invokeCommand<string | null>("catalog_cache_get", { kind });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async catalogCacheSet(kind, contents) {
      try {
        await invokeCommand("catalog_cache_set", { kind, contents });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountCredentialGet(apiOrigin) {
      try {
        return await invokeCommand<string | null>("account_credential_get", {
          apiOrigin,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountCredentialSet(apiOrigin, refreshToken) {
      try {
        await invokeCommand("account_credential_set", { apiOrigin, refreshToken });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountCredentialDelete(apiOrigin) {
      try {
        await invokeCommand("account_credential_delete", { apiOrigin });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async accountDeviceInfo() {
      return invokeCommand<DesktopDeviceInfo>("account_device_info");
    },
    async syncMetadataGet() {
      try {
        return await invokeCommand<SyncMetadata | null>("sync_metadata_get");
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async syncMetadataSet(metadata) {
      try {
        await invokeCommand("sync_metadata_set", { metadata });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async oauthLoopbackStart(clientState) {
      try {
        return await invokeCommand<OAuthLoopbackStart>("oauth_loopback_start", {
          clientState,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async oauthLoopbackFinish(attemptId) {
      try {
        return await invokeCommand<OAuthLoopbackResult>("oauth_loopback_finish", {
          attemptId,
        });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async oauthLoopbackCancel(attemptId) {
      await invokeCommand("oauth_loopback_cancel", { attemptId });
    },
    async updateCheck() {
      try {
        return await invokeCommand<UpdateMetadata | null>("update_check");
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async updateCancel() {
      try {
        await invokeCommand("update_cancel");
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async updateInstall(handler) {
      const { Channel } = await import("@tauri-apps/api/core");
      const onEvent = new Channel<UpdateDownloadEvent>();
      onEvent.onmessage = handler;
      try {
        await invokeCommand("update_install", { onEvent });
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async devtoolsToggle() {
      return invokeCommand<boolean>("devtools_toggle");
    },
    async openExternal(url) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      try {
        await openUrl(url);
      } catch (error) {
        throw normalizeBackendError(error);
      }
    },
    async openPath(path) {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      try {
        await openPath(path);
      } catch (error) {
        throw normalizeBackendError(error);
      }
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

/**
 * Tauri IPC 唯一网关(类型化)。
 *
 * Rust 侧需实现的命令(snake_case,与本文件一一对应):
 * - config_get(): ConfigDocument
 * - config_set(document: ConfigDocument)        // 保存并即时生效
 * - machine_get(): MachineLocalSettings
 * - machine_set(settings: MachineLocalSettings)
 * - legacy_import_apply(document, machine)       // 双配置批量应用与进程内回滚
 * - engine_is_paused(): boolean
 * - engine_toggle_pause(): boolean
 *     + Tauri event "pause-changed", payload: boolean
 * - capture_start() / capture_cancel()
 *     + tauri 事件 "gesture-captured",payload: {trigger, strokes, mnemonic}
 * - pick_window(): {exeName, exePath, appName, aumid} | null
 * - app_icon(exeName: string): string | null    // base64 png
 *
 * 浏览器(无 Tauri)环境自动降级为内存 mock(见 ./mock.ts),整套 UI 可独立自测。
 */
import type { ConfigDocument, MachineLocalSettings } from "@godgesture/shared";
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
}

export type LegacyImportApplyErrorCode = "apply_failed" | "rollback_incomplete";

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

  machineGet(): Promise<MachineLocalSettings>;
  machineSet(settings: MachineLocalSettings): Promise<void>;
  /** Atomically applies a legacy import, or restores the previous backend state. */
  legacyImportApply(document: ConfigDocument, machine: MachineLocalSettings): Promise<void>;

  engineIsPaused(): Promise<boolean>;
  engineTogglePause(): Promise<boolean>;
  onPauseChanged(handler: (paused: boolean) => void): Promise<() => void>;

  captureStart(): Promise<void>;
  captureCancel(): Promise<void>;
  /** 订阅 "gesture-captured" 事件;返回退订函数 */
  onGestureCaptured(handler: (gesture: CapturedGesture) => void): Promise<() => void>;

  pickWindow(): Promise<PickedWindow | null>;
  /** base64 png,失败返回 null */
  appIcon(exeName: string): Promise<string | null>;

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
    async machineGet() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<MachineLocalSettings>("machine_get");
    },
    async machineSet(settings) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("machine_set", { settings });
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
      return listen<boolean>("pause-changed", (event) => handler(event.payload));
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
      return listen<CapturedGesture>("gesture-captured", (event) => handler(event.payload));
    },
    async pickWindow() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<PickedWindow | null>("pick_window");
    },
    async appIcon(exeName) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string | null>("app_icon", { exeName });
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

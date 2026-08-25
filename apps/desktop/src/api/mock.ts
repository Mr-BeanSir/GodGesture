/**
 * 浏览器 mock 后端:vite dev(无 Tauri)时的内存实现,
 * 让整套设置 UI 可在浏览器里完整浏览与自测。
 */
import {
  ConfigDocument,
  DEFAULT_APP_GROUP_ID,
  MachineLocalSettings,
  type Command,
  type GestureInput,
  type GestureIntent,
  type GestureSpec,
  type StrokeDirection,
  type TriggerButton,
} from "@godgesture/shared";
import type {
  Backend,
  CapturedGesture,
  LogEntry,
  LogEntryLevel,
  LogLevel,
  LogsQueryRequest,
  PluginWorkspaceSnapshot,
  UpdateMetadata,
} from "./backend";
import { gestureMnemonic } from "../utils/mnemonic";
import { newId } from "../utils/id";

function intent(
  name: string,
  trigger: TriggerButton,
  strokes: StrokeDirection[],
  command: Command,
  order: number,
): GestureIntent {
  return {
    id: newId(),
    name,
    enabled: true,
    gesture: { trigger, strokes, modifier: "none" },
    command,
    order,
  };
}

/** 默认演示配置(接近 WGestures 出厂手势的一个子集) */
function seedDocument(): ConfigDocument {
  return ConfigDocument.parse({
    global: {
      gesturingEnabled: true,
      intents: [
        intent(
          "关闭窗口",
          "right",
          ["down", "right"],
          { type: "windowControl", operation: "close" },
          0,
        ),
        intent(
          "最大化 / 还原",
          "right",
          ["up"],
          { type: "windowControl", operation: "maximizeRestore" },
          1,
        ),
        intent(
          "最小化",
          "right",
          ["down"],
          { type: "windowControl", operation: "minimize" },
          2,
        ),
        intent(
          "任务切换",
          "right",
          ["left", "right"],
          { type: "taskSwitcher" },
          3,
        ),
        intent(
          "Web 搜索",
          "right",
          ["rightDown"],
          {
            type: "webSearch",
            engineName: "Google",
            engineUrl: "https://www.google.com/search?q={0}",
            browser: null,
          },
          4,
        ),
        intent(
          "复制",
          "middle",
          ["down"],
          { type: "hotKey", modifiers: ["ctrl"], keys: ["c"] },
          5,
        ),
        intent("静默手势", "right", ["leftUp"], { type: "doNothing" }, 6),
      ],
    },
    apps: [
      {
        id: newId(),
        name: "Chrome",
        groupId: DEFAULT_APP_GROUP_ID,
        windows: { exeName: "chrome.exe", matchByExactPath: false },
        mac: { bundleId: "com.google.Chrome" },
        gesturingEnabled: true,
        inheritGlobalGestures: true,
        intents: [
          intent(
            "关闭标签页",
            "right",
            ["down", "right"],
            { type: "hotKey", modifiers: ["ctrl"], keys: ["w"] },
            0,
          ),
          intent(
            "恢复标签页",
            "right",
            ["up", "left"],
            { type: "hotKey", modifiers: ["ctrl", "shift"], keys: ["t"] },
            1,
          ),
        ],
        order: 0,
      },
    ],
    hotCorners: {
      enabled: false,
      commands: {
        leftTop: { type: "taskSwitcher" },
      },
    },
    rubEdges: {
      enabled: false,
      commands: {},
    },
  });
}

const CAPTURE_POOL: Array<{
  trigger: TriggerButton;
  strokes: StrokeDirection[];
  inputs?: GestureInput[];
}> = [
  { trigger: "right", strokes: ["up", "right"] },
  { trigger: "right", strokes: ["down", "left", "up"] },
  { trigger: "middle", strokes: ["right"] },
  { trigger: "right", strokes: ["rightUp", "down"] },
  { trigger: "x1", strokes: ["left"] },
  { trigger: "right", strokes: ["down", "right"] }, // 与演示配置冲突,用于测试覆盖提示
  {
    trigger: "right",
    strokes: ["right"],
    inputs: [
      { type: "button", button: "middle" },
      { type: "stroke", direction: "right" },
    ],
  },
  {
    trigger: "right",
    strokes: [],
    inputs: [{ type: "wheel", direction: "forward" }],
  },
];

export function createMockBackend(): Backend {
  let doc = seedDocument();
  let machine = MachineLocalSettings.parse({});
  let paused = false;
  let refreshToken: string | null = null;
  let syncMetadata: Awaited<ReturnType<Backend["syncMetadataGet"]>> = null;
  let pendingUpdate: UpdateMetadata | null = null;
  let logLevel: LogLevel = "off";
  let logEntries: LogEntry[] = [];
  const catalogCache = new Map<string, string>();
  const pluginSnapshot: PluginWorkspaceSnapshot = {
    root: "C:\\Users\\demo\\AppData\\Roaming\\GodGesture\\plugins",
    plugins: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        name: "gesture-demo",
        version: "0.1.0",
        path: "C:\\Users\\demo\\AppData\\Roaming\\GodGesture\\plugins\\gesture-demo",
        entry: "index.mjs",
        apiVersion: 1,
        lifecycles: ["onInit", "onExecute", "onGestureRecognized", "onModifierTriggered", "onEnd"],
        status: "ready",
        error: null,
        lastReloadAt: Date.now(),
      },
      {
        id: "invalid:broken-plugin",
        name: "broken-plugin",
        version: "",
        path: "C:\\Users\\demo\\AppData\\Roaming\\GodGesture\\plugins\\broken-plugin",
        entry: "",
        apiVersion: 0,
        lifecycles: [],
        status: "error",
        error: "package.json godgesture.lifecycles must not be empty",
        lastReloadAt: null,
      },
    ],
  };
  const pluginPreview =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("plugins");
  if (pluginPreview === "empty") pluginSnapshot.plugins = [];
  if (pluginPreview === "error") pluginSnapshot.plugins = pluginSnapshot.plugins.slice(1);

  const listeners = new Set<(g: CapturedGesture) => void>();
  const pauseListeners = new Set<(paused: boolean) => void>();
  const logListeners = new Set<(entry: LogEntry) => void>();
  let captureTimers: ReturnType<typeof setTimeout>[] = [];

  function stopCapture() {
    captureTimers.forEach(clearTimeout);
    captureTimers = [];
  }

  function emit(gesture: CapturedGesture) {
    listeners.forEach((l) => l(gesture));
  }

  function levelRank(level: LogEntryLevel | LogLevel): number {
    return { error: 0, warn: 1, info: 2, debug: 3, off: 4 }[level];
  }

  function accepts(level: LogEntryLevel): boolean {
    return logLevel !== "off" && levelRank(level) <= levelRank(logLevel);
  }

  return {
    isTauri: false,

    async configGet() {
      return JSON.parse(JSON.stringify(doc)) as ConfigDocument;
    },
    async configSet(document) {
      doc = ConfigDocument.parse(document);
    },
    async nodePluginsGet() {
      return structuredClone(pluginSnapshot);
    },
    async nodePluginsRescan() {
      return structuredClone(pluginSnapshot);
    },
    async nodePluginsDirectory() {
      return pluginSnapshot.root;
    },
    async nodePluginInstall(source) {
      const existing = pluginSnapshot.plugins.find((plugin) => plugin.id === source.pluginId);
      if (!existing) {
        pluginSnapshot.plugins.push({
          id: source.pluginId,
          name: source.repositoryUrl.split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") || "online-plugin",
          version: "online",
          path: `${pluginSnapshot.root}\\${source.pluginId}`,
          entry: "index.mjs",
          apiVersion: 1,
          lifecycles: ["onExecute"],
          status: "ready",
          error: null,
          lastReloadAt: Date.now(),
        });
      }
      return structuredClone(pluginSnapshot);
    },
    async onNodePluginsChanged() {
      return () => undefined;
    },
    async logLevelGet() { return logLevel; },
    async logLevelSet(level) { logLevel = level; return logLevel; },
    async logWrite(level, target, message) {
      if (!accepts(level)) return;
      const entry: LogEntry = { timestamp: new Date().toISOString(), level, target, message };
      logEntries = [...logEntries, entry].slice(-2000);
      logListeners.forEach((listener) => listener(entry));
    },
    async logsQuery(request: LogsQueryRequest) {
      const keyword = request.keyword?.trim().toLocaleLowerCase();
      const target = request.target?.trim().toLocaleLowerCase();
      const filtered = logEntries.filter((entry) => {
        if (request.level && request.level !== "off" && entry.level !== request.level) return false;
        if (target && !entry.target.toLocaleLowerCase().includes(target)) return false;
        if (keyword && !`${entry.target} ${entry.message}`.toLocaleLowerCase().includes(keyword)) return false;
        return true;
      });
      const limit = Math.max(1, Math.min(request.limit ?? 1000, 5000));
      return { entries: filtered.slice(-limit).reverse(), total: filtered.length, files: [], level: logLevel };
    },
    async logsExport(request) {
      const result = await this.logsQuery(request);
      return `browser-preview://logs/${result.entries.length}`;
    },
    async logsClear() { logEntries = []; },
    async onLogEvent(handler) {
      logListeners.add(handler);
      return () => logListeners.delete(handler);
    },
    async machineGet() {
      return { ...machine };
    },
    async machineSet(settings) {
      machine = MachineLocalSettings.parse(settings);
    },
    async machineStatus() {
      return { healthy: true, code: null, message: null };
    },
    async platformStatus() {
      return {
        platform: "windows" as const,
        gestureEngineRunning: true,
        accessibility: true,
        inputMonitoring: true,
        eventPosting: true,
        code: null,
        message: null,
      };
    },
    async platformRequestPermissions() {
      return this.platformStatus();
    },
    async platformOpenPermissionSettings() {
      return undefined;
    },
    async engineIsPaused() {
      return paused;
    },
    async engineTogglePause() {
      paused = !paused;
      pauseListeners.forEach((listener) => listener(paused));
      return paused;
    },
    async onPauseChanged(handler) {
      pauseListeners.add(handler);
      return () => pauseListeners.delete(handler);
    },

    async captureStart() {
      stopCapture();
      const pick =
        CAPTURE_POOL[Math.floor(Math.random() * CAPTURE_POOL.length)];
      const captureInputs: GestureInput[] = pick.inputs ?? pick.strokes.map((direction) => ({
        type: "stroke",
        direction,
      }));
      // 模拟"实时助记符":逐笔推送
      const initial: GestureSpec = {
        trigger: pick.trigger,
        strokes: [],
        modifier: "none",
        inputs: [],
      };
      emit({
        trigger: initial.trigger,
        strokes: [],
        inputs: [],
        modifier: initial.modifier,
        mnemonic: gestureMnemonic(initial),
      });
      for (let i = 1; i <= captureInputs.length; i++) {
        const partialInputs = captureInputs.slice(0, i);
        const partial: GestureSpec = {
          trigger: pick.trigger,
          strokes: partialInputs
            .filter((input): input is Extract<GestureInput, { type: "stroke" }> => input.type === "stroke")
            .map((input) => input.direction),
          modifier: "none",
          inputs: partialInputs,
        };
        captureTimers.push(
          setTimeout(() => {
            emit({
              trigger: partial.trigger,
              strokes: [...partial.strokes],
              inputs: [...partialInputs],
              modifier: partial.modifier,
              mnemonic: gestureMnemonic(partial),
            });
          }, 500 * i),
        );
      }
    },
    async captureCancel() {
      stopCapture();
    },
    async hotkeyCaptureStart() {
      // Browser preview cannot install a process-wide keyboard hook. The
      // HotkeyInput component falls back to WebView keyboard events here.
    },
    async hotkeyCaptureCancel() {
      // No native capture to release in browser preview.
    },
    async onHotkeyCapture() {
      return () => undefined;
    },
    async onGestureCaptured(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    async pickWindow() {
      const samples = [
        {
          exeName: "notepad.exe",
          exePath: "C:\\Windows\\System32\\notepad.exe",
          appName: "记事本",
          aumid: null,
          bundleId: null,
        },
        {
          exeName: "Code.exe",
          exePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
          appName: "Visual Studio Code",
          aumid: null,
          bundleId: null,
        },
        {
          exeName: "explorer.exe",
          exePath: "C:\\Windows\\explorer.exe",
          appName: "文件资源管理器",
          aumid: null,
          bundleId: null,
        },
      ];
      // 模拟准星取窗口的延迟
      await new Promise((r) => setTimeout(r, 400));
      return samples[Math.floor(Math.random() * samples.length)];
    },
    async resolveAppFile(path) {
      const normalized = path.replace(/\//g, "\\");
      const sourceName = normalized.split("\\").pop() || "application.exe";
      const stem = sourceName.replace(/\.(exe|lnk)$/i, "");
      const exeName = sourceName.toLowerCase().endsWith(".lnk")
        ? `${stem.toLowerCase()}.exe`
        : sourceName.toLowerCase();
      return {
        exeName,
        exePath: normalized,
        appName: stem,
        aumid: null,
        bundleId: null,
      };
    },
    async onAppFileDrop() {
      return () => undefined;
    },
    async appIcon() {
      return null;
    },
    async gestureTemplateSave() {
      return null;
    },
    async downloadTemplateText() {
      throw new Error("Template downloads are unavailable in browser preview");
    },
    async catalogCacheGet(kind) {
      return catalogCache.get(kind) ?? null;
    },
    async catalogCacheSet(kind, contents) {
      catalogCache.set(kind, contents);
    },
    async accountCredentialGet() {
      return refreshToken;
    },
    async accountCredentialSet(_apiOrigin, nextRefreshToken) {
      refreshToken = nextRefreshToken;
    },
    async accountCredentialDelete() {
      refreshToken = null;
    },
    async accountDeviceInfo() {
      return {
        name: "GodGesture Browser Preview",
        platform: "windows" as const,
        deviceKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };
    },
    async syncMetadataGet() {
      return syncMetadata ? structuredClone(syncMetadata) : null;
    },
    async syncMetadataSet(metadata) {
      syncMetadata = structuredClone(metadata);
    },
    async oauthLoopbackStart() {
      throw new Error("OAuth loopback is unavailable in browser preview");
    },
    async oauthLoopbackFinish() {
      throw new Error("OAuth loopback is unavailable in browser preview");
    },
    async oauthLoopbackCancel() {
      return undefined;
    },
    async updateCheck() {
      pendingUpdate = {
        currentVersion: "0.1.0-dev",
        version: "0.2.0",
        notes:
          "Template Library, signed desktop updates, and distribution reliability improvements.",
        publishedAt: "2026-07-28T15:00:00Z",
      };
      return { ...pendingUpdate };
    },
    async updateCancel() {
      pendingUpdate = null;
    },
    async updateInstall(handler) {
      if (!pendingUpdate) throw new Error("update_not_pending");
      handler({ event: "started", data: { contentLength: 1024 } });
      handler({
        event: "progress",
        data: { chunkLength: 512, downloaded: 512 },
      });
      handler({ event: "finished", data: { downloaded: 1024 } });
      pendingUpdate = null;
    },
    async devtoolsToggle() {
      return false;
    },
    async openExternal(url) {
      window.open(url, "_blank", "noopener");
    },
    async openPath() {
      return undefined;
    },
    async getAppVersion() {
      return "0.1.0-dev";
    },
  };
}

/**
 * 浏览器 mock 后端:vite dev(无 Tauri)时的内存实现,
 * 让整套设置 UI 可在浏览器里完整浏览与自测。
 */
import {
  ConfigDocument,
  MachineLocalSettings,
  type Command,
  type GestureIntent,
  type GestureSpec,
  type StrokeDirection,
  type TriggerButton,
} from "@godgesture/shared";
import type { Backend, CapturedGesture } from "./backend";
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
    gesture: { trigger, strokes, modifier: "none" },
    command,
    executeOnModifier: false,
    order,
  };
}

/** 默认演示配置(接近 WGestures 出厂手势的一个子集) */
function seedDocument(): ConfigDocument {
  return ConfigDocument.parse({
    global: {
      gesturingEnabled: true,
      intents: [
        intent("关闭窗口", "right", ["down", "right"], { type: "windowControl", operation: "close" }, 0),
        intent("最大化 / 还原", "right", ["up"], { type: "windowControl", operation: "maximizeRestore" }, 1),
        intent("最小化", "right", ["down"], { type: "windowControl", operation: "minimize" }, 2),
        intent("任务切换", "right", ["left", "right"], { type: "taskSwitcher" }, 3),
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
        intent("复制", "middle", ["down"], { type: "hotKey", modifiers: ["ctrl"], keys: ["c"] }, 5),
        intent("暂停手势", "right", ["leftUp"], { type: "pause" }, 6),
      ],
    },
    apps: [
      {
        id: newId(),
        name: "Chrome",
        windows: { exeName: "chrome.exe", matchByExactPath: false },
        mac: { bundleId: "com.google.Chrome" },
        gesturingEnabled: true,
        inheritGlobalGestures: true,
        intents: [
          intent("关闭标签页", "right", ["down", "right"], { type: "hotKey", modifiers: ["ctrl"], keys: ["w"] }, 0),
          intent("恢复标签页", "right", ["up", "left"], { type: "hotKey", modifiers: ["ctrl", "shift"], keys: ["t"] }, 1),
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

const CAPTURE_POOL: Array<{ trigger: TriggerButton; strokes: StrokeDirection[] }> = [
  { trigger: "right", strokes: ["up", "right"] },
  { trigger: "right", strokes: ["down", "left", "up"] },
  { trigger: "middle", strokes: ["right"] },
  { trigger: "right", strokes: ["rightUp", "down"] },
  { trigger: "x1", strokes: ["left"] },
  { trigger: "right", strokes: ["down", "right"] }, // 与演示配置冲突,用于测试覆盖提示
];

export function createMockBackend(): Backend {
  let doc = seedDocument();
  let machine = MachineLocalSettings.parse({});
  let paused = false;

  const listeners = new Set<(g: CapturedGesture) => void>();
  const pauseListeners = new Set<(paused: boolean) => void>();
  let captureTimers: ReturnType<typeof setTimeout>[] = [];

  function stopCapture() {
    captureTimers.forEach(clearTimeout);
    captureTimers = [];
  }

  function emit(gesture: CapturedGesture) {
    listeners.forEach((l) => l(gesture));
  }

  return {
    isTauri: false,

    async configGet() {
      return JSON.parse(JSON.stringify(doc)) as ConfigDocument;
    },
    async configSet(document) {
      doc = ConfigDocument.parse(document);
    },
    async machineGet() {
      return { ...machine };
    },
    async machineSet(settings) {
      machine = MachineLocalSettings.parse(settings);
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
      const pick = CAPTURE_POOL[Math.floor(Math.random() * CAPTURE_POOL.length)];
      // 模拟"实时助记符":逐笔推送
      for (let i = 1; i <= pick.strokes.length; i++) {
        const partial: GestureSpec = {
          trigger: pick.trigger,
          strokes: pick.strokes.slice(0, i),
          modifier: "none",
        };
        captureTimers.push(
          setTimeout(() => {
            emit({
              trigger: partial.trigger,
              strokes: [...partial.strokes],
              mnemonic: gestureMnemonic(partial),
            });
          }, 500 * i),
        );
      }
    },
    async captureCancel() {
      stopCapture();
    },
    async onGestureCaptured(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    async pickWindow() {
      const samples = [
        { exeName: "notepad.exe", exePath: "C:\\Windows\\System32\\notepad.exe", appName: "记事本" },
        { exeName: "Code.exe", exePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe", appName: "Visual Studio Code" },
        { exeName: "explorer.exe", exePath: "C:\\Windows\\explorer.exe", appName: "文件资源管理器" },
      ];
      // 模拟准星取窗口的延迟
      await new Promise((r) => setTimeout(r, 400));
      return samples[Math.floor(Math.random() * samples.length)];
    },
    async appIcon() {
      return null;
    },
    async openExternal(url) {
      window.open(url, "_blank", "noopener");
    },
    async getAppVersion() {
      return "0.1.0-dev";
    },
  };
}

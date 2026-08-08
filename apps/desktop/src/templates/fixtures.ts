/**
 * Browser-preview-only fixtures. Native desktop builds always use the
 * published GitHub catalog and its AppData cache.
 */
export const gestureTemplateCatalogFixture = {
  formatVersion: 2,
  generatedAt: "2026-08-07T15:44:10.499Z",
  entries: [
    {
      slug: "global-window-basics",
      version: "1.0.0",
      title: {
        "zh-CN": "全局窗口基础手势",
        en: "Global window basics",
      },
      summary: {
        "zh-CN": "用三个简单手势最大化、最小化和关闭当前窗口。",
        en: "Maximize, minimize, and close the current window with three simple gestures.",
      },
      author: "GodGesture",
      tags: ["window", "global"],
      targets: [{ scope: "global" }],
      risks: [],
      packageUrl:
        "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/packages/global-window-basics.json",
    },
    {
      slug: "browser-window-basics",
      version: "1.0.0",
      title: {
        "zh-CN": "Chrome 窗口基础手势",
        en: "Chrome window basics",
      },
      summary: {
        "zh-CN": "为 Windows 和 macOS Chrome 添加最大化、最小化和关闭窗口手势。",
        en: "Add maximize, minimize, and close-window gestures for Chrome on Windows and macOS.",
      },
      author: "GodGesture",
      tags: ["browser", "window"],
      targets: [
        {
          scope: "app",
          name: "Google Chrome",
          windows: { exeName: "chrome.exe" },
          mac: { bundleId: "com.google.Chrome" },
        },
      ],
      risks: [],
      packageUrl:
        "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/packages/browser-window-basics.json",
    },
  ],
} as const;

export const gestureTemplatePackageFixtures = {
  "global-window-basics": {
    formatVersion: 1,
    slug: "global-window-basics",
    version: "1.0.0",
    target: {
      scope: "global",
      intents: [
        {
          name: "最大化或还原窗口 / Maximize or restore window",
          gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
          command: { type: "windowControl", operation: "maximizeRestore" },
        },
        {
          name: "最小化窗口 / Minimize window",
          gesture: { trigger: "right", strokes: ["down"], modifier: "none" },
          command: { type: "windowControl", operation: "minimize" },
        },
        {
          name: "关闭窗口 / Close window",
          gesture: { trigger: "right", strokes: ["rightDown"], modifier: "none" },
          command: { type: "windowControl", operation: "close" },
        },
      ],
    },
  },
  "browser-window-basics": {
    formatVersion: 1,
    slug: "browser-window-basics",
    version: "1.0.0",
    target: {
      scope: "app",
      name: "Google Chrome",
      windows: { exeName: "chrome.exe" },
      mac: { bundleId: "com.google.Chrome" },
      gesturingEnabled: true,
      inheritGlobalGestures: true,
      intents: [
        {
          name: "最大化或还原 Chrome / Maximize or restore Chrome",
          gesture: { trigger: "middle", strokes: ["up"], modifier: "none" },
          command: { type: "windowControl", operation: "maximizeRestore" },
        },
        {
          name: "最小化 Chrome / Minimize Chrome",
          gesture: { trigger: "middle", strokes: ["down"], modifier: "none" },
          command: { type: "windowControl", operation: "minimize" },
        },
        {
          name: "关闭 Chrome 窗口 / Close Chrome window",
          gesture: { trigger: "middle", strokes: ["rightDown"], modifier: "none" },
          command: { type: "windowControl", operation: "close" },
        },
      ],
    },
  },
} as const;

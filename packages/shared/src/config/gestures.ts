/**
 * 手势领域模型 —— 与 CONTEXT.md 术语表一一对应。
 * 这是同步的载荷格式,也是桌面端本地配置的持久化格式(单一事实源)。
 */
import { z } from "zod";

/** 触发键:按住即进入手势状态的鼠标键 */
export const TriggerButton = z.enum(["right", "middle", "x1", "x2"]);
export type TriggerButton = z.infer<typeof TriggerButton>;

/** 笔画方向(8 向;斜向仅允许首笔,约束由引擎保证,Schema 不限制) */
export const StrokeDirection = z.enum([
  "up",
  "rightUp",
  "right",
  "rightDown",
  "down",
  "leftDown",
  "left",
  "leftUp",
]);
export type StrokeDirection = z.infer<typeof StrokeDirection>;

/** 修饰:手势按住期间叠加的额外动作 */
export const GestureModifier = z.enum([
  "none",
  "wheelForward",
  "wheelBackward",
  "leftButtonDown",
  "middleButtonDown",
  "rightButtonDown",
  "x1Down",
  "x2Down",
]);
export type GestureModifier = z.infer<typeof GestureModifier>;

/** 手势 = 触发键 + 笔画序列 + 修饰,三者共同决定唯一性 */
export const GestureSpec = z.object({
  trigger: TriggerButton,
  strokes: z.array(StrokeDirection).max(12),
  modifier: GestureModifier.default("none"),
});
export type GestureSpec = z.infer<typeof GestureSpec>;

// ---------------------------------------------------------------------------
// 命令(12 类,对齐 WGestures 出厂行为;窗口控制额外含贴靠左/右)
// ---------------------------------------------------------------------------

const base = <T extends string>(type: T) => ({ type: z.literal(type) });

export const DoNothingCommand = z.object(base("doNothing"));

export const HotKeyCommand = z.object({
  ...base("hotKey"),
  /** 修饰键 + 主键序列,取值为跨平台键码名(见 keycodes.ts) */
  modifiers: z.array(z.string()),
  keys: z.array(z.string()),
});

export const WebSearchCommand = z.object({
  ...base("webSearch"),
  engineName: z.string(),
  /** 含 {0} 占位符的搜索 URL */
  engineUrl: z.string(),
  /** null = 系统默认浏览器;否则为浏览器标识(本机解析) */
  browser: z.string().nullable().default(null),
});

export const WindowControlCommand = z.object({
  ...base("windowControl"),
  operation: z.enum([
    "maximizeRestore",
    "minimize",
    "close",
    "toggleTopmost",
    "dockLeft",
    "dockRight",
  ]),
});

export const TaskSwitcherCommand = z.object(base("taskSwitcher"));

export const OpenFileCommand = z.object({
  ...base("openFile"),
  path: z.string(),
});

export const SendTextCommand = z.object({
  ...base("sendText"),
  /** 按键序列文本,支持 {sleep N} 停顿标记 */
  text: z.string(),
});

export const GotoUrlCommand = z.object({
  ...base("gotoUrl"),
  url: z.string(),
});

export const CmdCommand = z.object({
  ...base("cmd"),
  code: z.string(),
  showWindow: z.boolean().default(true),
  autoSetWorkingDir: z.boolean().default(true),
});

/** 脚本命令:JavaScript(QuickJS),四脚本槽模型 */
export const ScriptCommand = z.object({
  ...base("script"),
  /** 语言标记:导入的老 WGestures Lua 脚本保留原文并标 "lua"(不可执行,待手动改写) */
  language: z.enum(["js", "lua"]).default("js"),
  initScript: z.string().default(""),
  script: z.string().default(""),
  handleModifiers: z.boolean().default(false),
  gestureRecognizedScript: z.string().default(""),
  modifierTriggeredScript: z.string().default(""),
  gestureEndedScript: z.string().default(""),
});

export const PauseCommand = z.object(base("pause"));

export const AudioVolumeCommand = z.object({
  ...base("audioVolume"),
  delta: z.number().int().min(1).max(20).default(1),
});

export const Command = z.discriminatedUnion("type", [
  DoNothingCommand,
  HotKeyCommand,
  WebSearchCommand,
  WindowControlCommand,
  TaskSwitcherCommand,
  OpenFileCommand,
  SendTextCommand,
  GotoUrlCommand,
  CmdCommand,
  ScriptCommand,
  PauseCommand,
  AudioVolumeCommand,
]);
export type Command = z.infer<typeof Command>;

// ---------------------------------------------------------------------------
// 手势意图与应用
// ---------------------------------------------------------------------------

/** 手势意图:"手势 → 命令" 的一条映射 */
export const GestureIntent = z.object({
  id: z.string().uuid(),
  name: z.string().max(64),
  gesture: GestureSpec,
  command: Command,
  /** 带修饰的手势:修饰触发时立即执行 */
  executeOnModifier: z.boolean().default(false),
  /** UI 排序 */
  order: z.number().int().default(0),
});
export type GestureIntent = z.infer<typeof GestureIntent>;

/**
 * 应用绑定 —— 机器无关、可跨设备漫游(ADR 术语表)。
 * Windows: exe 文件名为主键(小写,如 "chrome.exe");AUMID 识别商店应用;
 *          exactPath 仅在需要区分同名程序时参与匹配,其余场合只作本机提示。
 * macOS:  Bundle ID(如 "com.google.Chrome")。
 */
export const WindowsBinding = z.object({
  exeName: z.string().min(1),
  aumid: z.string().optional(),
  exactPath: z.string().optional(),
  matchByExactPath: z.boolean().default(false),
});
export type WindowsBinding = z.infer<typeof WindowsBinding>;

export const MacBinding = z.object({
  bundleId: z.string().min(1),
});
export type MacBinding = z.infer<typeof MacBinding>;

/** 应用:配置分组单位;缺某平台绑定时在该平台休眠 */
export const AppEntry = z.object({
  id: z.string().uuid(),
  name: z.string().max(64),
  windows: WindowsBinding.optional(),
  mac: MacBinding.optional(),
  /** 黑名单开关:false = 在该应用上禁用一切手势 */
  gesturingEnabled: z.boolean().default(true),
  inheritGlobalGestures: z.boolean().default(true),
  intents: z.array(GestureIntent).default([]),
  order: z.number().int().default(0),
});
export type AppEntry = z.infer<typeof AppEntry>;

/** 全局应用:兜底条目;其 gesturingEnabled 是总开关 */
export const GlobalApp = z.object({
  gesturingEnabled: z.boolean().default(true),
  intents: z.array(GestureIntent).default([]),
});
export type GlobalApp = z.infer<typeof GlobalApp>;

// ---------------------------------------------------------------------------
// 触发角 & 摩擦边(全部命令类型可选 —— 相对 WGestures 的放开项)
// ---------------------------------------------------------------------------

export const ScreenCorner = z.enum(["leftTop", "rightTop", "leftBottom", "rightBottom"]);
export type ScreenCorner = z.infer<typeof ScreenCorner>;

export const ScreenEdge = z.enum(["left", "top", "right", "bottom"]);
export type ScreenEdge = z.infer<typeof ScreenEdge>;

export const HotCornersConfig = z.object({
  enabled: z.boolean().default(true),
  commands: z.record(ScreenCorner, Command).default({}),
});
export type HotCornersConfig = z.infer<typeof HotCornersConfig>;

export const RubEdgesConfig = z.object({
  enabled: z.boolean().default(true),
  commands: z.record(ScreenEdge, Command).default({}),
});
export type RubEdgesConfig = z.infer<typeof RubEdgesConfig>;

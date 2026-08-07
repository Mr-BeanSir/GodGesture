/**
 * 手势领域模型 —— 与 CONTEXT.md 术语表一一对应。
 * 这是同步的载荷格式,也是桌面端本地配置的持久化格式(单一事实源)。
 */
import { z } from "zod";
import { HotkeyKeyName, HotkeyModifier } from "./hotkeys.js";
import {
  MAX_COMMAND_TEXT_LENGTH,
  MAX_BOUNDARY_INTENTS,
  MAX_BOUNDARY_SEQUENCE_TOKENS,
  MAX_HOTKEY_KEYS,
  MAX_HOTKEY_MODIFIERS,
  MAX_INTENTS_PER_SCOPE,
  MAX_PATH_LENGTH,
  MAX_URL_LENGTH,
} from "./limits.js";
import { NodePluginCommand } from "./plugins.js";
import { parseSendTextDsl } from "./send-text-dsl.js";

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

/** 手势输入步骤:保留用户实际输入的时序。 */
export const GestureInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stroke"), direction: StrokeDirection }),
  z.object({
    type: z.literal("button"),
    button: z.enum(["left", "middle", "right", "x1", "x2"]),
  }),
  z.object({
    type: z.literal("wheel"),
    direction: z.enum(["forward", "backward"]),
  }),
  z.object({
    type: z.literal("key"),
    /** KeyboardEvent.code 风格的跨平台物理键名,如 KeyQ/F4/Enter。 */
    key: z.string().min(1).max(32),
  }),
]);
export type GestureInput = z.infer<typeof GestureInput>;

/** 手势 = 触发键 + 基础有序输入 + 独立修饰符。 */
export const GestureSpec = z.object({
  trigger: TriggerButton,
  strokes: z.array(StrokeDirection).max(12),
  /** v5 独立修饰符;不加入基础 inputs,每次触发都可重复执行。 */
  modifier: GestureModifier.default("none"),
  inputs: z.array(GestureInput).max(12).optional(),
});
export type GestureSpec = z.infer<typeof GestureSpec>;

// ---------------------------------------------------------------------------
// 命令(11 类;窗口控制含贴靠左/右)
// ---------------------------------------------------------------------------

const base = <T extends string>(type: T) => ({ type: z.literal(type) });

export const DoNothingCommand = z.object(base("doNothing"));

export const HotKeyCommand = z.object({
  ...base("hotKey"),
  /** 修饰键 + 主键序列,解析时迁移旧别名并拒绝未知键名 */
  // Keep Command's established string[] TypeScript surface for importers and
  // consumers; the runtime schemas still canonicalize every array element.
  modifiers: z.array(HotkeyModifier).max(MAX_HOTKEY_MODIFIERS) as z.ZodType<
    string[]
  >,
  keys: z.array(HotkeyKeyName).max(MAX_HOTKEY_KEYS) as z.ZodType<string[]>,
});

export const WebSearchCommand = z.object({
  ...base("webSearch"),
  engineName: z.string().max(64),
  /** 含 {0} 占位符的搜索 URL */
  engineUrl: z.string().max(MAX_URL_LENGTH),
  /** null = 系统默认浏览器;否则为浏览器标识(本机解析) */
  browser: z.string().max(MAX_PATH_LENGTH).nullable().default(null),
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
  path: z.string().max(MAX_PATH_LENGTH),
});

export const SendTextCommand = z.object({
  ...base("sendText"),
  /** 按键/文字序列 DSL,每行一个 text/key/hotkey/sleep 语句。 */
  text: z.string().max(MAX_COMMAND_TEXT_LENGTH).superRefine((source, ctx) => {
    try {
      parseSendTextDsl(source);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid key/text sequence",
      });
    }
  }),
}).strict();

export const GotoUrlCommand = z.object({
  ...base("gotoUrl"),
  url: z.string().max(MAX_URL_LENGTH),
});

export const CmdCommand = z.object({
  ...base("cmd"),
  code: z.string().max(MAX_COMMAND_TEXT_LENGTH),
  showWindow: z.boolean().default(true),
  autoSetWorkingDir: z.boolean().default(true),
});

export const PowerShellCommand = z.object({
  ...base("powershell"),
  code: z.string().max(MAX_COMMAND_TEXT_LENGTH),
  showWindow: z.boolean().default(true),
  autoSetWorkingDir: z.boolean().default(true),
});

export const AudioVolumeCommand = z.object({
  ...base("audioVolume"),
  /** 正数提高、负数降低、0 切换静音;绝对值是音量百分点 */
  delta: z.number().int().min(-20).max(20).default(1),
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
    PowerShellCommand,
    NodePluginCommand,
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
  /** 单条动作开关;旧配置缺失时保持启用 */
  enabled: z.boolean().default(true),
  gesture: GestureSpec,
  command: Command,
  /** UI 排序 */
  order: z.number().int().default(0),
}).strict();
export type GestureIntent = z.infer<typeof GestureIntent>;

/**
 * 应用绑定 —— 机器无关、可跨设备漫游(ADR 术语表)。
 * Windows: exe 文件名为主键(小写,如 "chrome.exe");AUMID 识别商店应用;
 *          exactPath 仅在需要区分同名程序时参与匹配,其余场合只作本机提示。
 * macOS:  Bundle ID(如 "com.google.Chrome")。
 */
export const WindowsBinding = z.object({
  exeName: z.string().min(1).max(255),
  aumid: z.string().max(512).optional(),
  exactPath: z.string().max(MAX_PATH_LENGTH).optional(),
  matchByExactPath: z.boolean().default(false),
});
export type WindowsBinding = z.infer<typeof WindowsBinding>;

export const MacBinding = z.object({
  bundleId: z.string().min(1).max(512),
});
export type MacBinding = z.infer<typeof MacBinding>;

/** 应用分组:决定应用条目在手势工作区中的归属 */
export const AppGroup = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
  order: z.number().int().default(0),
});
export type AppGroup = z.infer<typeof AppGroup>;

/** 应用:配置分组单位;缺某平台绑定时在该平台休眠 */
export const AppEntry = z.object({
  id: z.string().uuid(),
  name: z.string().max(64),
  groupId: z.string().uuid(),
  windows: WindowsBinding.optional(),
  mac: MacBinding.optional(),
  /** 黑名单开关:false = 在该应用上禁用一切手势 */
  gesturingEnabled: z.boolean().default(true),
  inheritGlobalGestures: z.boolean().default(true),
  intents: z.array(GestureIntent).max(MAX_INTENTS_PER_SCOPE).default([]),
  order: z.number().int().default(0),
});
export type AppEntry = z.infer<typeof AppEntry>;

/** 全局应用:兜底条目;其 gesturingEnabled 是总开关 */
export const GlobalApp = z.object({
  gesturingEnabled: z.boolean().default(true),
  intents: z.array(GestureIntent).max(MAX_INTENTS_PER_SCOPE).default([]),
});
export type GlobalApp = z.infer<typeof GlobalApp>;

// ---------------------------------------------------------------------------
// 触发角 & 摩擦边(全部命令类型可选 —— 相对 WGestures 的放开项)
// ---------------------------------------------------------------------------

export const ScreenCorner = z.enum([
  "leftTop",
  "rightTop",
  "leftBottom",
  "rightBottom",
]);
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

// ---------------------------------------------------------------------------
// 边角动作意图（全局）
// ---------------------------------------------------------------------------

export const BoundaryOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hotCorner"), corner: ScreenCorner }),
  z.object({ kind: z.literal("rubEdge"), edge: ScreenEdge }),
]);
export type BoundaryOrigin = z.infer<typeof BoundaryOrigin>;

export const BoundaryMouseButton = z.enum(["left", "middle", "right", "x1", "x2"]);
export type BoundaryMouseButton = z.infer<typeof BoundaryMouseButton>;

export const BoundaryToken = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wheel"), direction: z.enum(["forward", "backward"]) }),
  z.object({ type: z.literal("button"), button: BoundaryMouseButton }),
  z.object({ type: z.literal("stroke"), direction: StrokeDirection }),
]);
export type BoundaryToken = z.infer<typeof BoundaryToken>;

export const BoundaryIntent = z.object({
  id: z.string().uuid(),
  name: z.string().max(64),
  /** 单条动作开关;旧配置缺失时保持启用 */
  enabled: z.boolean().default(true),
  origin: BoundaryOrigin,
  sequence: z.array(BoundaryToken).max(MAX_BOUNDARY_SEQUENCE_TOKENS).default([]),
  command: Command,
  order: z.number().int().default(0),
});
export type BoundaryIntent = z.infer<typeof BoundaryIntent>;

export const BoundaryIntents = z
  .array(BoundaryIntent)
  .max(MAX_BOUNDARY_INTENTS)
  .default([]);

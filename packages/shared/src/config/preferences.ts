/**
 * 偏好设置 —— 参与同步的部分(SyncedPreferences)与本机专属部分(MachineLocalSettings)。
 * 术语表:本机专属设置 = 开机自启、以管理员身份运行、托盘图标隐藏,其余全部同步。
 */
import { z } from "zod";
import { TriggerButton } from "./gestures.js";
import { HotkeyKeyName, HotkeyModifier } from "./hotkeys.js";
import { MAX_HOTKEY_MODIFIERS } from "./limits.js";

/** ARGB 十六进制颜色,如 "#FF32C864" */
const argb = z.string().regex(/^#[0-9A-Fa-f]{8}$/);

export const PathTrackerPreferences = z.object({
  /** 启用的触发键集合 */
  triggerButtons: z
    .array(TriggerButton)
    .max(4)
    .default(["right", "middle", "x1", "x2"]),
  /** 允许斜线(8 向)手势 */
  enable8Directions: z.boolean().default(true),
  /** Windows 键触发(等价于右键;Windows 平台专有能力,mac 端忽略) */
  enableWindowsKeyGesturing: z.boolean().default(false),
  /** 总是作用于指针下方的窗口(而非前台窗口) */
  preferCursorWindow: z.boolean().default(true),
  /** 全屏时自动禁用手势 */
  disableInFullscreen: z.boolean().default(false),
  /** 起始移动距离(像素) */
  initialValidMovePx: z.number().int().min(1).max(50).default(4),
  /** 起始超时(按住不动则放行为普通拖拽) */
  initialStayTimeout: z.boolean().default(false),
  initialStayTimeoutMs: z.number().int().min(20).max(2000).default(200),
  /** 停留超时(路径中途停留则取消) */
  stayTimeout: z.boolean().default(false),
  stayTimeoutMs: z.number().int().min(50).max(10000).default(500),
});
export type PathTrackerPreferences = z.infer<typeof PathTrackerPreferences>;

export const GestureViewPreferences = z.object({
  showPath: z.boolean().default(true),
  showCommandName: z.boolean().default(true),
  fadeOut: z.boolean().default(true),
  rightButtonPathColor: argb.default("#FF27E518"),
  middleButtonPathColor: argb.default("#FF2DE0FF"),
  xButtonPathColor: argb.default("#FF667EE9"),
  unrecognizedPathColor: argb.default("#FFFF8040"),
});
export type GestureViewPreferences = z.infer<typeof GestureViewPreferences>;

/** 暂停/继续全局快捷键(跨平台键码名 + 修饰键) */
export const PauseHotkey = z.object({
  modifiers: z
    .array(HotkeyModifier)
    .max(MAX_HOTKEY_MODIFIERS)
    .default(["ctrl", "shift", "alt"]),
  /** 空串显式表示禁用全局暂停快捷键。 */
  key: z.union([HotkeyKeyName, z.literal("")]).default("w"),
});
export type PauseHotkey = z.infer<typeof PauseHotkey>;

/** 参与同步的偏好设置 */
export const SyncedPreferences = z.object({
  pathTracker: PathTrackerPreferences.default({}),
  gestureView: GestureViewPreferences.default({}),
  pauseHotkey: PauseHotkey.default({}),
  /** 界面语言:跟随系统或指定 */
  locale: z.enum(["auto", "zh-CN", "en"]).default("auto"),
  /** 自动检查更新(GitHub Releases) */
  autoCheckForUpdate: z.boolean().default(true),
});
export type SyncedPreferences = z.infer<typeof SyncedPreferences>;

/** 本机专属设置 —— 不随账户漫游,不进同步载荷 */
export const MachineLocalSettings = z.object({
  autoStart: z.boolean().default(false),
  runAsAdmin: z.boolean().default(false),
  trayIconVisible: z.boolean().default(true),
});
export type MachineLocalSettings = z.infer<typeof MachineLocalSettings>;

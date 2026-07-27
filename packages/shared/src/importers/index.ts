/**
 * WGestures 1.8.5 旧配置导入器 —— 对外入口。
 *
 * 输入:gestures.wg2(手势库,JSON 文本)+ 可选 config.plist(偏好,XML 文本)。
 * 输出:一份合法的 {@link ConfigDocument},外加本机专属设置与降级告警。
 *
 * 映射策略:能对齐 WGestures 出厂语义的一律映射,无法表达的项降级到 schema 默认
 * 并写入 warnings;不静默丢弃用户数据(本机专属项另置于 machineLocal 返回)。
 */
import {
  CONFIG_FORMAT_VERSION,
  ConfigDocument,
} from "../config/document.js";
import { MachineLocalSettings } from "../config/preferences.js";
import { TriggerButton } from "../config/gestures.js";
import { PlistDict, PlistValue, parsePlist } from "./plist.js";
import { decodeHotKeyCombo } from "./vk.js";
import { importWg2 } from "./wg2.js";
import { LegacyImportDiagnostic } from "./diagnostics.js";

export * from "./diagnostics.js";
export * from "./vk.js";
export * from "./plist.js";
export * from "./wg2.js";

export interface LegacyConfigInput {
  /** gestures.wg2 文本(WGestures 手势库,纯 JSON) */
  gesturesWg2: string;
  /** config.plist 文本(XML);缺省时全部偏好取 schema 默认 */
  configPlist?: string;
}

export interface LegacyImportResult {
  /** 可直接同步/持久化的配置文档 */
  document: ConfigDocument;
  /**
   * 本机专属设置(不进同步载荷,ADR-0009/术语表)。
   * 从 config.plist 的 AutoStart / TrayIconVisible 映射;runAsAdmin 老版无对应键,取默认。
   */
  machineLocal: MachineLocalSettings;
  /** 降级/丢弃项的结构化诊断,由调用方负责本地化展示 */
  warnings: LegacyImportDiagnostic[];
}

// ---------------------------------------------------------------------------
// config.plist 键名(逐字对齐 WGestures.App/ConfigKeys.cs)
// ---------------------------------------------------------------------------

const K = {
  autoStart: "AutoStart",
  autoCheckForUpdate: "AutoCheckForUpdate",
  trayIconVisible: "TrayIconVisible",
  triggerButton: "PathTrackerTriggerButton",
  initialValidMove: "PathTrackerInitialValidMove",
  stayTimeout: "PathTrackerStayTimeout",
  stayTimeoutMillis: "PathTrackerStayTimeoutMillis",
  initialStayTimeout: "PathTrackerInitialStayTimeout",
  // 注:老版键名把 "Timeout" 误拼为 "Timout",此处必须照抄
  initialStayTimoutMillis: "PathTrackerInitialStayTimoutMillis",
  preferCursorWindow: "PathTrackerPreferCursorWindow",
  disableInFullScreen: "GestureParserDisableInFullScreenMode",
  enableWindowsKeyGesturing: "EnableWindowsKeyGesturing",
  enable8DirGesture: "GestureParserEnable8DirGesture",
  enableHotCorners: "GestureParserEnableHotCorners",
  enableRubEdges: "GestureParserEnableRubEdges",
  showPath: "GestureViewShowPath",
  showCommandName: "GestureViewShowCommandName",
  fadeOut: "GestureViewFadeOut",
  mainPathColor: "GestureViewMainPathColor",
  middleBtnColor: "GestureViewMiddleBtnMainColor",
  alternativePathColor: "GestureViewAlternativePathColor",
  xBtnPathColor: "GestureViewXBtnPathColor",
  pauseResumeHotKey: "PauseResumeHotKey",
} as const;

/** GestureTriggerButton 位掩码(Right=1, Middle=2, X1=4, X2=8;X=X1|X2) */
const TRIGGER_BITS: ReadonlyArray<readonly [number, TriggerButton]> = [
  [1, "right"],
  [2, "middle"],
  [4, "x1"],
  [8, "x2"],
];

function isPlistDict(v: PlistValue): v is PlistDict {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

function getBool(dict: PlistDict, key: string): boolean | undefined {
  const v = dict[key];
  return typeof v === "boolean" ? v : undefined;
}

function getInt(dict: PlistDict, key: string): number | undefined {
  const v = dict[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

function getData(dict: PlistDict, key: string): Uint8Array | undefined {
  const v = dict[key];
  return v instanceof Uint8Array ? v : undefined;
}

/** 有符号 ARGB int(Color.ToArgb())→ "#AARRGGBB" */
function argbFromInt(n: number): string {
  return "#" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** 位掩码 → 触发键名数组(规范顺序 right,middle,x1,x2) */
function decodeTriggerButtons(mask: number): TriggerButton[] {
  const out: TriggerButton[] = [];
  for (const [bit, name] of TRIGGER_BITS) {
    if ((mask & bit) !== 0) out.push(name);
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 导入一份 WGestures 旧配置,返回可用的 {@link ConfigDocument}。
 *
 * config.plist 缺省或解析失败时:手势库照常导入,偏好整体退回 schema 默认,
 * 并记录一条告警。任何单个偏好键缺失都自动落到对应字段默认值。
 */
export function importLegacyConfig(input: LegacyConfigInput): LegacyImportResult {
  const wg2 = importWg2(input.gesturesWg2);
  const warnings: LegacyImportDiagnostic[] = [...wg2.warnings];

  // 待喂给 zod 的偏好载荷(以纯对象累积,避开 exactOptionalPropertyTypes 约束)。
  const pathTracker: Record<string, unknown> = {};
  const gestureView: Record<string, unknown> = {};
  const preferences: Record<string, unknown> = {};
  const machineLocal: Record<string, unknown> = {};

  let hotCornersEnabled = wg2.hotCorners.enabled;
  let rubEdgesEnabled = wg2.rubEdges.enabled;

  if (input.configPlist !== undefined) {
    let dict: PlistDict | undefined;
    try {
      const root = parsePlist(input.configPlist);
      if (isPlistDict(root)) {
        dict = root;
      } else {
        warnings.push({
          code: "plist_root_not_dictionary",
          source: "config.plist",
          location: { scope: "preferences" },
        });
      }
    } catch {
      warnings.push({
        code: "plist_parse_failed",
        source: "config.plist",
        location: { scope: "preferences" },
      });
    }

    if (dict !== undefined) {
      mapPreferences(dict, {
        pathTracker,
        gestureView,
        preferences,
        machineLocal,
        warnings,
        setHotCorners: (v) => (hotCornersEnabled = v),
        setRubEdges: (v) => (rubEdgesEnabled = v),
      });
    }
  }

  if (Object.keys(pathTracker).length > 0) preferences["pathTracker"] = pathTracker;
  if (Object.keys(gestureView).length > 0) preferences["gestureView"] = gestureView;

  const document = ConfigDocument.parse({
    formatVersion: CONFIG_FORMAT_VERSION,
    global: wg2.global,
    apps: wg2.apps,
    hotCorners: { enabled: hotCornersEnabled, commands: wg2.hotCorners.commands },
    rubEdges: { enabled: rubEdgesEnabled, commands: wg2.rubEdges.commands },
    preferences,
  });

  return {
    document,
    machineLocal: MachineLocalSettings.parse(machineLocal),
    warnings,
  };
}

interface MapCtx {
  pathTracker: Record<string, unknown>;
  gestureView: Record<string, unknown>;
  preferences: Record<string, unknown>;
  machineLocal: Record<string, unknown>;
  warnings: LegacyImportDiagnostic[];
  setHotCorners: (v: boolean) => void;
  setRubEdges: (v: boolean) => void;
}

function mapPreferences(dict: PlistDict, ctx: MapCtx): void {
  const { pathTracker, gestureView, preferences, machineLocal, warnings } = ctx;

  // --- PathTracker ---
  const triggerMask = getInt(dict, K.triggerButton);
  if (triggerMask !== undefined) {
    const buttons = decodeTriggerButtons(triggerMask);
    if (buttons.length === 0) {
      warnings.push({
        code: "trigger_mask_empty",
        source: "config.plist",
        location: { scope: "preferences", field: K.triggerButton },
        details: { value: triggerMask },
      });
    } else {
      pathTracker["triggerButtons"] = buttons;
    }
  }
  assignBool(dict, K.enable8DirGesture, pathTracker, "enable8Directions");
  assignBool(dict, K.enableWindowsKeyGesturing, pathTracker, "enableWindowsKeyGesturing");
  assignBool(dict, K.preferCursorWindow, pathTracker, "preferCursorWindow");
  assignBool(dict, K.disableInFullScreen, pathTracker, "disableInFullscreen");
  assignBool(dict, K.initialStayTimeout, pathTracker, "initialStayTimeout");
  assignBool(dict, K.stayTimeout, pathTracker, "stayTimeout");
  assignClampedInt(dict, K.initialValidMove, pathTracker, "initialValidMovePx", 1, 50, warnings);
  assignClampedInt(dict, K.initialStayTimoutMillis, pathTracker, "initialStayTimeoutMs", 20, 2000, warnings);
  assignClampedInt(dict, K.stayTimeoutMillis, pathTracker, "stayTimeoutMs", 50, 10000, warnings);

  // --- GestureView ---
  assignBool(dict, K.showPath, gestureView, "showPath");
  assignBool(dict, K.showCommandName, gestureView, "showCommandName");
  assignBool(dict, K.fadeOut, gestureView, "fadeOut");
  assignColor(dict, K.mainPathColor, gestureView, "rightButtonPathColor");
  assignColor(dict, K.middleBtnColor, gestureView, "middleButtonPathColor");
  assignColor(dict, K.xBtnPathColor, gestureView, "xButtonPathColor");
  assignColor(dict, K.alternativePathColor, gestureView, "unrecognizedPathColor");

  // --- 顶层同步偏好 ---
  assignBool(dict, K.autoCheckForUpdate, preferences, "autoCheckForUpdate");

  // --- 暂停/继续热键 ---
  const hkData = getData(dict, K.pauseResumeHotKey);
  if (hkData !== undefined) {
    const combo = decodeHotKeyCombo(hkData);
    if (combo?.key !== undefined) {
      preferences["pauseHotkey"] = { modifiers: combo.modifiers, key: combo.key };
    } else {
      warnings.push({
        code: "pause_hotkey_invalid",
        source: "config.plist",
        location: { scope: "preferences", field: K.pauseResumeHotKey },
        details: { byteLength: hkData.length },
      });
    }
  }

  // --- 触发角 / 摩擦边启用开关(命令本体来自 wg2) ---
  const hotCorners = getBool(dict, K.enableHotCorners);
  if (hotCorners !== undefined) ctx.setHotCorners(hotCorners);
  const rubEdges = getBool(dict, K.enableRubEdges);
  if (rubEdges !== undefined) ctx.setRubEdges(rubEdges);

  // --- 本机专属 ---
  assignBool(dict, K.autoStart, machineLocal, "autoStart");
  assignBool(dict, K.trayIconVisible, machineLocal, "trayIconVisible");
}

function assignBool(
  dict: PlistDict,
  key: string,
  target: Record<string, unknown>,
  field: string,
): void {
  const v = getBool(dict, key);
  if (v !== undefined) target[field] = v;
}

function assignColor(
  dict: PlistDict,
  key: string,
  target: Record<string, unknown>,
  field: string,
): void {
  const v = getInt(dict, key);
  if (v !== undefined) target[field] = argbFromInt(v);
}

function assignClampedInt(
  dict: PlistDict,
  key: string,
  target: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  warnings: LegacyImportDiagnostic[],
): void {
  const v = getInt(dict, key);
  if (v === undefined) return;
  const clamped = clamp(v, min, max);
  if (clamped !== v) {
    warnings.push({
      code: "preference_clamped",
      source: "config.plist",
      location: { scope: "preferences", field: key },
      details: { value: v, min, max, clamped },
    });
  }
  target[field] = clamped;
}

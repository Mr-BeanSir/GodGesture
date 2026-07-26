/**
 * WGestures 1.8.5 gestures.wg2(FileVersion "3")导入器。
 *
 * 格式来源(参考克隆,均已核对源码):
 * - JsonGestureIntentStore.cs:SerializeWrapper { FileVersion, Apps, Global, HotCornerCommands[8] },
 *   Newtonsoft TypeNameHandling.Auto → 命令带 "$type" 判别符;GestureIntentDict 序列化为意图数组。
 * - Gesture.cs:Dirs 0-7 = Up,RightUp,Right,RightDown,Down,LeftDown,Left,LeftUp。
 * - GestureButton.cs:Right=1, Middle=2, X1=4, X2=8(FileVersion 1/2 时数值整体 -1,读取时 +1)。
 * - GestureModifier.cs:WheelForward=1, WheelBackward=2, MiddleButtonDown=4, LeftButtonDown=8,
 *   RightButtonDown=16, X1=32, X2=64。
 * - ScreenCornerAndEdge.cs:HotCornerCommands 槽位 0-3 = leftBottom,leftTop,rightTop,rightBottom;
 *   4-7 = left,top,right,bottom(摩擦边)。
 */
import {
  AppEntry,
  Command,
  GestureIntent,
  GestureModifier,
  GestureSpec,
  GlobalApp,
  HotCornersConfig,
  HotKeyCommand,
  RubEdgesConfig,
  ScreenCorner,
  ScreenEdge,
  StrokeDirection,
  TriggerButton,
} from "../config/gestures.js";
import { vkToKeyName } from "./vk.js";

export interface Wg2ImportResult {
  global: GlobalApp;
  apps: AppEntry[];
  hotCorners: HotCornersConfig;
  rubEdges: RubEdgesConfig;
  warnings: string[];
}

const DIRS: readonly StrokeDirection[] = [
  "up",
  "rightUp",
  "right",
  "rightDown",
  "down",
  "leftDown",
  "left",
  "leftUp",
];

const TRIGGERS = new Map<number, TriggerButton>([
  [1, "right"],
  [2, "middle"],
  [4, "x1"],
  [8, "x2"],
]);

const MODIFIERS = new Map<number, GestureModifier>([
  [0, "none"],
  [1, "wheelForward"],
  [2, "wheelBackward"],
  [4, "middleButtonDown"],
  [8, "leftButtonDown"],
  [16, "rightButtonDown"],
  [32, "x1Down"],
  [64, "x2Down"],
]);

const WINDOW_OPERATIONS = [
  "maximizeRestore", // MAXIMIZE_RESTORE = 0
  "minimize", // MINIMIZE = 1
  "close", // CLOSE = 2
  "toggleTopmost", // TOP_MOST = 3
  "dockLeft", // DOCK_LEFT = 4
  "dockRight", // DOCK_RIGHT = 5
] as const;

const CORNER_SLOTS: readonly ScreenCorner[] = ["leftBottom", "leftTop", "rightTop", "rightBottom"];
const EDGE_SLOTS: readonly ScreenEdge[] = ["left", "top", "right", "bottom"];

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

// ---------------------------------------------------------------------------
// 确定性 UUID(自实现,FNV-1a 派生,勿引依赖)
// ---------------------------------------------------------------------------

function fnv1a(str: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 由种子字符串确定性生成 UUID(版本/变体位符合 v4 形态,便于 zod 校验) */
export function deterministicUuid(seed: string): string {
  const bytes = new Uint8Array(16);
  for (let part = 0; part < 4; part++) {
    const h = fnv1a(`${part}:${seed}`, Math.imul(part + 1, 0x9e3779b9) >>> 0);
    bytes[part * 4] = (h >>> 24) & 0xff;
    bytes[part * 4 + 1] = (h >>> 16) & 0xff;
    bytes[part * 4 + 2] = (h >>> 8) & 0xff;
    bytes[part * 4 + 3] = h & 0xff;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// 导入实现
// ---------------------------------------------------------------------------

class Wg2Importer {
  readonly warnings: string[] = [];

  private warn(msg: string): void {
    this.warnings.push(msg);
  }

  /** "$type": "WGestures.Core.Commands.Impl.HotKeyCommand, WGestures.Core" → "HotKeyCommand" */
  private simpleTypeName(dollarType: unknown): string | undefined {
    if (typeof dollarType !== "string") return undefined;
    const full = dollarType.split(",")[0]!.trim();
    const last = full.split(".").pop();
    return last === "" ? undefined : last;
  }

  private mapVkList(list: unknown, context: string): string[] {
    if (!Array.isArray(list)) return [];
    const names: string[] = [];
    for (const item of list) {
      const vk = asInt(item);
      if (vk === undefined) {
        this.warn(`${context}: 非法 VK 值 ${String(item)},快捷键命令将禁用`);
        names.push(`invalidVk:${String(item)}`);
        continue;
      }
      const name = vkToKeyName(vk);
      if (name === undefined) {
        this.warn(`${context}: 未知 VK 数值 ${vk},以 "vk${vk}" 占位`);
        names.push(`vk${vk}`);
      } else {
        names.push(name);
      }
    }
    return names;
  }

  mapCommand(raw: unknown, context: string): Command {
    if (!isObject(raw)) {
      this.warn(`${context}: 命令缺失或非法,替换为“什么也不做”`);
      return { type: "doNothing" };
    }
    const typeName = this.simpleTypeName(raw["$type"]);
    switch (typeName) {
      case "DoNothingCommand":
        return { type: "doNothing" };
      case "HotKeyCommand":
        {
          const candidate = {
            type: "hotKey",
            modifiers: this.mapVkList(raw["Modifiers"], `${context}(修饰键)`),
            keys: this.mapVkList(raw["Keys"], `${context}(主键)`),
          };
          const parsed = HotKeyCommand.safeParse(candidate);
          if (!parsed.success) {
            this.warn(`${context}: 快捷键含未知或错位键名,替换为“什么也不做”`);
            return { type: "doNothing" };
          }
          return parsed.data;
        }
      case "WebSearchCommand":
        return {
          type: "webSearch",
          // 注:legacy 属性名 SearchEngingName 为原版拼写
          engineName: asString(raw["SearchEngingName"], "Web"),
          engineUrl: asString(raw["SearchEngineUrl"]),
          browser: typeof raw["UseBrowser"] === "string" ? (raw["UseBrowser"] as string) : null,
        };
      case "WindowControlCommand": {
        const op = asInt(raw["ChangeWindowStateTo"]) ?? 0;
        const operation = WINDOW_OPERATIONS[op];
        if (operation === undefined) {
          this.warn(`${context}: 未知窗口操作枚举值 ${op},替换为“什么也不做”`);
          return { type: "doNothing" };
        }
        return { type: "windowControl", operation };
      }
      case "TaskSwitcherCommand":
        return { type: "taskSwitcher" };
      case "OpenFileCommand":
        return { type: "openFile", path: asString(raw["FilePath"]) };
      case "SendTextCommand":
        return { type: "sendText", text: asString(raw["Text"]) };
      case "GotoUrlCommand":
        return { type: "gotoUrl", url: asString(raw["Url"]) };
      case "CmdCommand":
        return {
          type: "cmd",
          code: asString(raw["Code"]),
          showWindow: asBool(raw["ShowWindow"], true),
          autoSetWorkingDir: asBool(raw["AutoSetWorkingDir"], true),
        };
      case "ScriptCommand":
        // 老版为 Lua 脚本:原文保留、标记 language:"lua",待用户手动改写为 JS
        return {
          type: "script",
          language: "lua",
          initScript: asString(raw["InitScript"]),
          script: asString(raw["Script"]),
          handleModifiers: asBool(raw["HandleModifiers"], false),
          gestureRecognizedScript: asString(raw["GestureRecognizedScript"]),
          modifierTriggeredScript: asString(raw["ModifierTriggeredScript"]),
          gestureEndedScript: asString(raw["GestureEndedScript"]),
        };
      case "PauseWGesturesCommand":
        return { type: "pause" };
      case "ChangeAudioVolumeCommand": {
        const delta = asInt(raw["Delta"]) ?? 1;
        return { type: "audioVolume", delta: Math.min(20, Math.max(1, delta)) };
      }
      default: {
        const label = typeName ?? String(raw["$type"] ?? "(缺失 $type)");
        this.warn(`${context}: 未知命令类型 ${label},替换为“什么也不做”`);
        return { type: "doNothing" };
      }
    }
  }

  mapGesture(raw: unknown, buttonShift: number, context: string): GestureSpec {
    const obj = isObject(raw) ? raw : {};
    const rawButton = (asInt(obj["GestureButton"]) ?? 1) + buttonShift;
    let trigger = TRIGGERS.get(rawButton);
    if (trigger === undefined) {
      this.warn(`${context}: 未知触发键数值 ${rawButton},按右键处理`);
      trigger = "right";
    }

    const strokes: StrokeDirection[] = [];
    const rawDirs = Array.isArray(obj["Dirs"]) ? obj["Dirs"] : [];
    for (const d of rawDirs) {
      const idx = asInt(d);
      const dir = idx === undefined ? undefined : DIRS[idx];
      if (dir === undefined) {
        this.warn(`${context}: 忽略非法笔画方向 ${String(d)}`);
        continue;
      }
      strokes.push(dir);
    }
    if (strokes.length > 12) {
      this.warn(`${context}: 笔画数 ${strokes.length} 超过上限 12,已截断`);
      strokes.length = 12;
    }

    const rawModifier = asInt(obj["Modifier"]) ?? 0;
    let modifier = MODIFIERS.get(rawModifier);
    if (modifier === undefined) {
      this.warn(`${context}: 未知修饰数值 ${rawModifier},按无修饰处理`);
      modifier = "none";
    }

    return { trigger, strokes, modifier };
  }

  mapIntents(rawList: unknown, buttonShift: number, scope: string): GestureIntent[] {
    if (rawList === undefined || rawList === null) return [];
    if (!Array.isArray(rawList)) {
      this.warn(`${scope}: GestureIntents 不是数组,已忽略`);
      return [];
    }
    const intents: GestureIntent[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const raw = rawList[i];
      if (!isObject(raw)) {
        this.warn(`${scope}: 忽略第 ${i + 1} 条非法手势意图`);
        continue;
      }
      const name = asString(raw["Name"]).slice(0, 64);
      const context = `${scope} → 意图「${name || `#${i + 1}`}」`;
      intents.push({
        id: deterministicUuid(`intent:${scope}:${i}:${name}`),
        name,
        gesture: this.mapGesture(raw["Gesture"], buttonShift, context),
        command: this.mapCommand(raw["Command"], context),
        executeOnModifier: asBool(raw["ExecuteOnModifier"], false),
        order: asInt(raw["Order"]) ?? i,
      });
    }
    return intents;
  }
}

/**
 * 解析 gestures.wg2 JSON 文本,返回部分 ConfigDocument
 * (global / apps / hotCorners.commands / rubEdges.commands)与告警列表。
 */
export function importWg2(json: string): Wg2ImportResult {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    throw new Error(`gestures.wg2 不是合法 JSON: ${(e as Error).message}`);
  }
  if (!isObject(root)) throw new Error("gestures.wg2 根节点必须是对象");

  const importer = new Wg2Importer();
  const fileVersion = asString(root["FileVersion"], "3");
  // FileVersion 1/2 时代 GestureButton 数值整体小 1(见 JsonGestureIntentStore.Deserialize)
  const buttonShift = fileVersion === "1" || fileVersion === "2" ? 1 : 0;
  if (fileVersion !== "3" && buttonShift === 0) {
    importer.warnings.push(`未知的 FileVersion "${fileVersion}",按版本 3 处理`);
  }

  // 全局应用
  const rawGlobal = isObject(root["Global"]) ? root["Global"] : {};
  const global = GlobalApp.parse({
    gesturingEnabled: asBool(rawGlobal["IsGesturingEnabled"], true),
    intents: importer.mapIntents(rawGlobal["GestureIntents"], buttonShift, "全局"),
  });

  // 应用列表(保留 JSON 键序)
  const apps: AppEntry[] = [];
  const rawApps = isObject(root["Apps"]) ? root["Apps"] : {};
  let appIndex = 0;
  for (const [key, rawApp] of Object.entries(rawApps)) {
    if (!isObject(rawApp)) {
      importer.warnings.push(`忽略非法应用条目 "${key}"`);
      continue;
    }
    const executablePath = asString(rawApp["ExecutablePath"], key);
    const exeName = (executablePath.split(/[\\/]/).pop() ?? "").toLowerCase();
    if (exeName === "") {
      importer.warnings.push(`应用 "${key}" 的可执行文件路径为空,已跳过`);
      continue;
    }
    const name = asString(rawApp["Name"], exeName).slice(0, 64);
    apps.push(
      AppEntry.parse({
        id: deterministicUuid(`app:${appIndex}:${executablePath.toLowerCase()}`),
        name,
        windows: {
          exeName,
          exactPath: executablePath,
          matchByExactPath: false,
        },
        gesturingEnabled: asBool(rawApp["IsGesturingEnabled"], true),
        inheritGlobalGestures: asBool(rawApp["InheritGlobalGestures"], true),
        intents: importer.mapIntents(rawApp["GestureIntents"], buttonShift, `应用「${name}」`),
        order: asInt(rawApp["Order"]) ?? appIndex,
      }),
    );
    appIndex++;
  }

  // 触发角(槽 0-3)与摩擦边(槽 4-7)
  const cornerCommands: Partial<Record<ScreenCorner, Command>> = {};
  const edgeCommands: Partial<Record<ScreenEdge, Command>> = {};
  const rawHotCorners = root["HotCornerCommands"];
  if (Array.isArray(rawHotCorners)) {
    if (rawHotCorners.length > 8) {
      importer.warnings.push(`HotCornerCommands 数量 ${rawHotCorners.length} 超过 8,多余槽位忽略`);
    }
    for (let slot = 0; slot < Math.min(8, rawHotCorners.length); slot++) {
      const raw = rawHotCorners[slot];
      if (raw === null || raw === undefined) continue;
      if (slot < 4) {
        const corner = CORNER_SLOTS[slot]!;
        cornerCommands[corner] = importer.mapCommand(raw, `触发角「${corner}」`);
      } else {
        const edge = EDGE_SLOTS[slot - 4]!;
        edgeCommands[edge] = importer.mapCommand(raw, `摩擦边「${edge}」`);
      }
    }
  } else if (rawHotCorners !== undefined && rawHotCorners !== null) {
    importer.warnings.push("HotCornerCommands 不是数组,已忽略");
  }

  return {
    global,
    apps,
    hotCorners: HotCornersConfig.parse({ commands: cornerCommands }),
    rubEdges: RubEdgesConfig.parse({ commands: edgeCommands }),
    warnings: importer.warnings,
  };
}

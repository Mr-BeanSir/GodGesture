/**
 * 配置文档 —— 同步的最小单元(整库版本化,ADR-0009)。
 */
import { z } from "zod";
import {
  AppEntry,
  AppGroup,
  BoundaryIntents,
  type BoundaryIntent,
  GlobalApp,
  HotCornersConfig,
  RubEdgesConfig,
  type GestureInput,
  type GestureModifier,
} from "./gestures.js";
import { SyncedPreferences } from "./preferences.js";
import { MAX_APPS, MAX_APP_GROUPS } from "./limits.js";
/** 配置文档格式版本(载荷结构演进用,与同步版本号无关) */
export const CONFIG_FORMAT_VERSION = 7;
export const DEFAULT_APP_GROUP_ID = "20000000-0000-4000-8000-000000000001";

const DEFAULT_APP_GROUP: AppGroup = {
  id: DEFAULT_APP_GROUP_ID,
  name: "默认",
  order: 0,
};

const LEGACY_BOUNDARY_IDS = {
  "hotCorner:leftTop": "10000000-0000-4000-8000-000000000001",
  "hotCorner:rightTop": "10000000-0000-4000-8000-000000000002",
  "hotCorner:leftBottom": "10000000-0000-4000-8000-000000000003",
  "hotCorner:rightBottom": "10000000-0000-4000-8000-000000000004",
  "rubEdge:top": "10000000-0000-4000-8000-000000000005",
  "rubEdge:right": "10000000-0000-4000-8000-000000000006",
  "rubEdge:bottom": "10000000-0000-4000-8000-000000000007",
  "rubEdge:left": "10000000-0000-4000-8000-000000000008",
} as const;

const LEGACY_BOUNDARY_NAMES: Readonly<Record<keyof typeof LEGACY_BOUNDARY_IDS, string>> = {
  "hotCorner:leftTop": "Left top corner",
  "hotCorner:rightTop": "Right top corner",
  "hotCorner:leftBottom": "Left bottom corner",
  "hotCorner:rightBottom": "Right bottom corner",
  "rubEdge:top": "Top rub edge",
  "rubEdge:right": "Right rub edge",
  "rubEdge:bottom": "Bottom rub edge",
  "rubEdge:left": "Left rub edge",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyModifierInput(modifier: unknown): GestureInput | undefined {
  return modifier === "wheelForward"
    ? { type: "wheel", direction: "forward" }
    : modifier === "wheelBackward"
      ? { type: "wheel", direction: "backward" }
      : modifier === "leftButtonDown"
        ? { type: "button", button: "left" }
        : modifier === "middleButtonDown"
          ? { type: "button", button: "middle" }
          : modifier === "rightButtonDown"
            ? { type: "button", button: "right" }
            : modifier === "x1Down"
              ? { type: "button", button: "x1" }
              : modifier === "x2Down"
                ? { type: "button", button: "x2" }
                : undefined;
}

function inputModifier(input: GestureInput | undefined): GestureModifier {
  if (!input) return "none";
  if (input.type === "wheel") {
    return input.direction === "forward" ? "wheelForward" : "wheelBackward";
  }
  if (input.type === "button") {
    return `${input.button}ButtonDown` as GestureModifier;
  }
  return "none";
}

function legacyGestureInputs(gesture: Record<string, unknown>): GestureInput[] {
  const inputs: GestureInput[] = Array.isArray(gesture.strokes)
    ? gesture.strokes.map((direction) => ({ type: "stroke", direction }) as GestureInput)
    : [];
  const modifierInput = legacyModifierInput(gesture.modifier);
  if (modifierInput) inputs.push(modifierInput);
  return inputs;
}

function normalizeGesture(
  value: unknown,
  legacy: boolean,
  executeOnModifier: boolean,
): unknown {
  if (!isRecord(value)) return value;
  const inputs = Array.isArray(value.inputs)
    ? [...value.inputs]
    : legacy
      ? legacyGestureInputs(value)
      : Array.isArray(value.strokes)
        ? value.strokes.map((direction) => ({ type: "stroke", direction }))
        : [];
  const nextModifier = legacy ? "none" : (value.modifier ?? "none");
  if (legacy && executeOnModifier) {
    const last = inputs.at(-1) as GestureInput | undefined;
    const migratedModifier = inputModifier(last);
    if (migratedModifier !== "none") {
      inputs.pop();
      return {
        ...value,
        modifier: migratedModifier,
        inputs,
      };
    }
  }
  return {
    ...value,
    modifier: nextModifier,
    inputs,
  };
}

function normalizeCommand(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.type === "pause") return { type: "doNothing" };
  if (value.type === "nodePlugin" && typeof value.pluginId === "string") {
    const actionId = typeof value.actionId === "string"
      ? value.actionId
      : typeof value.exportName === "string"
        ? value.exportName
        : "onExecute";
    return { type: "nodePlugin", pluginId: value.pluginId, actionId };
  }
  return value;
}

function normalizeGestureInputs(
  value: unknown,
  legacy: boolean,
  executeOnModifier: boolean,
): unknown {
  if (!isRecord(value)) return value;
  return normalizeGesture(value, legacy, executeOnModifier);
}

function normalizeIntentInputs(value: unknown, legacy: boolean): unknown {
  if (!isRecord(value) || !Array.isArray(value.intents)) return value;
  return {
    ...value,
    intents: value.intents.map((intent) => {
      if (!isRecord(intent)) return intent;
      const { executeOnModifier, ...current } = intent;
      return {
        ...current,
        command: legacy ? normalizeCommand(intent.command) : intent.command,
        gesture: normalizeGestureInputs(
          intent.gesture,
          legacy,
          executeOnModifier === true,
        ),
      };
    }),
  };
}

function normalizeBoundaryCommands(value: unknown, legacy: boolean): unknown {
  if (!isRecord(value)) return value;
  return legacy ? normalizeCommand(value) : value;
}

function normalizeAppGroups(value: Record<string, unknown>, version: number) {
  const rawGroups = Array.isArray(value.groups) ? value.groups : [];
  const groups = rawGroups.flatMap((group, index) => {
    if (!isRecord(group)) return [];
    if (
      typeof group.id !== "string" ||
      !z.string().uuid().safeParse(group.id).success ||
      typeof group.name !== "string" ||
      group.name.trim().length === 0
    ) {
      return [];
    }
    return [
      {
        id: group.id,
        name: group.name,
        order: typeof group.order === "number" && Number.isInteger(group.order)
          ? group.order
          : index,
      },
    ];
  });
  if (!groups.some((group) => group.id === DEFAULT_APP_GROUP_ID)) {
    groups.push({ ...DEFAULT_APP_GROUP });
  }
  const groupIds = new Set(groups.map((group) => group.id));
  const hasExplicitGroups = Array.isArray(value.groups);
  const apps = Array.isArray(value.apps)
    ? value.apps.map((app) => {
        if (!isRecord(app)) return app;
        const candidateGroupId =
          typeof app.groupId === "string" ? app.groupId : null;
        const groupId =
          (version >= CONFIG_FORMAT_VERSION || hasExplicitGroups) &&
          candidateGroupId !== null &&
          z.string().uuid().safeParse(candidateGroupId).success &&
          groupIds.has(candidateGroupId)
            ? candidateGroupId
            : DEFAULT_APP_GROUP_ID;
        return { ...app, groupId };
      })
    : value.apps;
  return { groups, apps };
}

/** Upgrade legacy corner/edge command maps into deterministic boundary intents. */
export function migrateConfigDocument(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const version = Number(value.formatVersion ?? 1);
  if (![1, 2, 3, 4, 5, 6, CONFIG_FORMAT_VERSION].includes(version)) return value;
  const legacy = version < CONFIG_FORMAT_VERSION;

  const hotCorners = isRecord(value.hotCorners) ? value.hotCorners : {};
  const rubEdges = isRecord(value.rubEdges) ? value.rubEdges : {};
  const hotCommands = isRecord(hotCorners.commands) ? hotCorners.commands : {};
  const rubCommands = isRecord(rubEdges.commands) ? rubEdges.commands : {};
  const existing = Array.isArray(value.boundaryIntents)
    ? value.boundaryIntents.map((intent) => {
        if (!isRecord(intent)) return intent;
        return { ...intent, command: normalizeBoundaryCommands(intent.command, legacy) };
      })
    : [];
  const existingIds = new Set(
    existing.flatMap((intent) =>
      isRecord(intent) && typeof intent.id === "string" ? [intent.id] : [],
    ),
  );

  const migrated: BoundaryIntent[] = [];
  for (const corner of ["leftTop", "rightTop", "leftBottom", "rightBottom"] as const) {
    const command = hotCommands[corner];
    if (command === undefined) continue;
    const key = `hotCorner:${corner}` as const;
    if (!existingIds.has(LEGACY_BOUNDARY_IDS[key])) {
      migrated.push({
        id: LEGACY_BOUNDARY_IDS[key],
        name: LEGACY_BOUNDARY_NAMES[key],
        enabled: true,
        origin: { kind: "hotCorner", corner },
        sequence: [],
        command: normalizeBoundaryCommands(command, legacy) as BoundaryIntent["command"],
        order: existing.length + migrated.length,
      });
    }
  }
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const command = rubCommands[edge];
    if (command === undefined) continue;
    const key = `rubEdge:${edge}` as const;
    if (!existingIds.has(LEGACY_BOUNDARY_IDS[key])) {
      migrated.push({
        id: LEGACY_BOUNDARY_IDS[key],
        name: LEGACY_BOUNDARY_NAMES[key],
        enabled: true,
        origin: { kind: "rubEdge", edge },
        sequence: [],
        command: normalizeBoundaryCommands(command, legacy) as BoundaryIntent["command"],
        order: existing.length + migrated.length,
      });
    }
  }

  const global = normalizeIntentInputs(value.global, legacy);
  const normalizedGroups = normalizeAppGroups(value, version);
  const apps = Array.isArray(normalizedGroups.apps)
    ? normalizedGroups.apps.map((app) => normalizeIntentInputs(app, legacy))
    : normalizedGroups.apps;
  return {
    ...value,
    formatVersion: CONFIG_FORMAT_VERSION,
    global,
    apps,
    groups: normalizedGroups.groups,
    hotCorners: { ...hotCorners, commands: {} },
    rubEdges: { ...rubEdges, commands: {} },
    boundaryIntents: [...existing, ...migrated],
  };
}

/**
 * 用户配置整体文档:云同步的载荷,也是本地 config 文件的主体。
 * 不含本机专属设置(MachineLocalSettings 单独存本地)。
 */
const ConfigDocumentV7 = z
  .object({
    formatVersion: z
      .literal(CONFIG_FORMAT_VERSION)
      .default(CONFIG_FORMAT_VERSION),
    global: GlobalApp.default({}),
    groups: z.array(AppGroup).max(MAX_APP_GROUPS).default([DEFAULT_APP_GROUP]),
    apps: z.array(AppEntry).max(MAX_APPS).default([]),
    hotCorners: HotCornersConfig.default({}),
    rubEdges: RubEdgesConfig.default({}),
    boundaryIntents: BoundaryIntents,
    preferences: SyncedPreferences.default({}),
  });
export const ConfigDocument = z.preprocess(migrateConfigDocument, ConfigDocumentV7);
export type ConfigDocument = z.infer<typeof ConfigDocument>;

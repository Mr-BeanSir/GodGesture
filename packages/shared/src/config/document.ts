/**
 * 配置文档 —— 同步的最小单元(整库版本化,ADR-0009)。
 */
import { z } from "zod";
import {
  AppEntry,
  BoundaryIntents,
  type BoundaryIntent,
  GlobalApp,
  HotCornersConfig,
  RubEdgesConfig,
} from "./gestures.js";
import { SyncedPreferences } from "./preferences.js";
import { MAX_APPS } from "./limits.js";
import { NodePlugins } from "./plugins.js";

/** 配置文档格式版本(载荷结构演进用,与同步版本号无关) */
export const CONFIG_FORMAT_VERSION = 3;

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

/** Upgrade legacy corner/edge command maps into deterministic boundary intents. */
export function migrateConfigDocument(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const version = value.formatVersion ?? 1;
  if (version !== 1 && version !== 2 && version !== CONFIG_FORMAT_VERSION) return value;

  const hotCorners = isRecord(value.hotCorners) ? value.hotCorners : {};
  const rubEdges = isRecord(value.rubEdges) ? value.rubEdges : {};
  const hotCommands = isRecord(hotCorners.commands) ? hotCorners.commands : {};
  const rubCommands = isRecord(rubEdges.commands) ? rubEdges.commands : {};
  const existing = Array.isArray(value.boundaryIntents)
    ? [...value.boundaryIntents]
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
        command: command as BoundaryIntent["command"],
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
        command: command as BoundaryIntent["command"],
        order: existing.length + migrated.length,
      });
    }
  }

  return {
    ...value,
    formatVersion: CONFIG_FORMAT_VERSION,
    hotCorners: { ...hotCorners, commands: {} },
    rubEdges: { ...rubEdges, commands: {} },
    boundaryIntents: [...existing, ...migrated],
    nodePlugins: Array.isArray(value.nodePlugins) ? value.nodePlugins : [],
  };
}

/**
 * 用户配置整体文档:云同步的载荷,也是本地 config 文件的主体。
 * 不含本机专属设置(MachineLocalSettings 单独存本地)。
 */
const ConfigDocumentV3 = z
  .object({
    formatVersion: z
      .literal(CONFIG_FORMAT_VERSION)
      .default(CONFIG_FORMAT_VERSION),
    global: GlobalApp.default({}),
    apps: z.array(AppEntry).max(MAX_APPS).default([]),
    hotCorners: HotCornersConfig.default({}),
    rubEdges: RubEdgesConfig.default({}),
    boundaryIntents: BoundaryIntents,
    nodePlugins: NodePlugins,
    preferences: SyncedPreferences.default({}),
  })
  .superRefine((document, ctx) => {
    const pluginIds = new Set(document.nodePlugins.map((plugin) => plugin.id));
    const commands = [
      ...document.global.intents.map((intent) => intent.command),
      ...document.apps.flatMap((app) => app.intents.map((intent) => intent.command)),
      ...document.boundaryIntents.map((intent) => intent.command),
    ];
    for (const command of commands) {
      if (command.type === "nodePlugin" && !pluginIds.has(command.pluginId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodePlugins"],
          message: `Node plugin command references missing plugin '${command.pluginId}'`,
        });
      }
    }
  });
export const ConfigDocument = z.preprocess(migrateConfigDocument, ConfigDocumentV3);
export type ConfigDocument = z.infer<typeof ConfigDocument>;

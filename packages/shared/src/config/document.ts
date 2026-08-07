/**
 * 配置文档 —— 同步的最小单元(整库版本化,ADR-0009)。
 */
import { z } from "zod";
import {
  AppEntry,
  AppGroup,
  BoundaryIntents,
  GlobalApp,
  HotCornersConfig,
  RubEdgesConfig,
} from "./gestures.js";
import { SyncedPreferences } from "./preferences.js";
import { MAX_APPS, MAX_APP_GROUPS } from "./limits.js";
/** 配置文档格式版本(载荷结构演进用,与同步版本号无关) */
export const CONFIG_FORMAT_VERSION = 8;
export const DEFAULT_APP_GROUP_ID = "20000000-0000-4000-8000-000000000001";

const DEFAULT_APP_GROUP: AppGroup = {
  id: DEFAULT_APP_GROUP_ID,
  name: "默认",
  order: 0,
};

/**
 * 用户配置整体文档:云同步的载荷,也是本地 config 文件的主体。
 * 不含本机专属设置(MachineLocalSettings 单独存本地)。
 */
export const ConfigDocument = z
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
  })
  .strict();
export type ConfigDocument = z.infer<typeof ConfigDocument>;

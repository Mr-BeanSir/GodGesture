/**
 * 配置文档 —— 同步的最小单元(整库版本化,ADR-0009)。
 */
import { z } from "zod";
import {
  AppEntry,
  GlobalApp,
  HotCornersConfig,
  RubEdgesConfig,
} from "./gestures.js";
import { SyncedPreferences } from "./preferences.js";
import { MAX_APPS } from "./limits.js";

/** 配置文档格式版本(载荷结构演进用,与同步版本号无关) */
export const CONFIG_FORMAT_VERSION = 1;

/**
 * 用户配置整体文档:云同步的载荷,也是本地 config 文件的主体。
 * 不含本机专属设置(MachineLocalSettings 单独存本地)。
 */
export const ConfigDocument = z.object({
  formatVersion: z
    .literal(CONFIG_FORMAT_VERSION)
    .default(CONFIG_FORMAT_VERSION),
  global: GlobalApp.default({}),
  apps: z.array(AppEntry).max(MAX_APPS).default([]),
  hotCorners: HotCornersConfig.default({}),
  rubEdges: RubEdgesConfig.default({}),
  preferences: SyncedPreferences.default({}),
});
export type ConfigDocument = z.infer<typeof ConfigDocument>;

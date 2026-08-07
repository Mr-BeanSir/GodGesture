/**
 * 同步协议 —— 整库版本 + 乐观并发 + 后写胜出 + 快照(ADR-0009)。
 * REST 端点的请求/响应体;服务端与桌面端共用。
 */
import { z } from "zod";
import { AppEntry, AppGroup, BoundaryIntent, GlobalApp, HotCornersConfig, RubEdgesConfig } from "../config/gestures.js";
import { SyncedPreferences } from "../config/preferences.js";
import { ConfigDocument } from "../config/document.js";

/** GET /sync/config 响应 */
export const PullConfigResponse = z.object({
  /** 服务端当前版本号;0 = 该账户还没有配置 */
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
  /** 最近一次推送的设备 */
  updatedByDeviceId: z.string().uuid().nullable(),
  document: ConfigDocument.nullable(),
});
export type PullConfigResponse = z.infer<typeof PullConfigResponse>;

/** PUT /sync/config 请求:携带基准版本做乐观并发控制 */
export const PushConfigRequest = z.object({
  /** 客户端所基于的服务端版本;不一致则 409,先拉取再推送 */
  baseVersion: z.number().int().nonnegative(),
  document: ConfigDocument,
});
export type PushConfigRequest = z.infer<typeof PushConfigRequest>;

export const PushConfigResponse = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type PushConfigResponse = z.infer<typeof PushConfigResponse>;

/** 409 冲突响应体 */
export const PushConflictResponse = z.object({
  error: z.literal("version_conflict"),
  serverVersion: z.number().int().positive(),
});
export type PushConflictResponse = z.infer<typeof PushConflictResponse>;

/** 413:配置文档超过协议字节上限。 */
export const ConfigTooLargeResponse = z.object({
  error: z.literal("config_too_large"),
  maxBytes: z.number().int().positive(),
});
export type ConfigTooLargeResponse = z.infer<typeof ConfigTooLargeResponse>;

/** GET /sync/snapshots 列表项(不含载荷) */
export const SnapshotMeta = z.object({
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  deviceId: z.string().uuid().nullable(),
  deviceName: z.string().nullable(),
  /** 该版本的来源说明;旧服务端缺失时按空备注兼容。 */
  note: z.string().max(512).default(""),
  /** 载荷字节数,列表展示用 */
  sizeBytes: z.number().int().nonnegative(),
});
export type SnapshotMeta = z.infer<typeof SnapshotMeta>;

export const DEFAULT_SNAPSHOT_PAGE_SIZE = 10;
export const MAX_SNAPSHOT_PAGE_SIZE = 50;

export const ListSnapshotsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SNAPSHOT_PAGE_SIZE)
    .default(DEFAULT_SNAPSHOT_PAGE_SIZE),
});
export type ListSnapshotsQuery = z.infer<typeof ListSnapshotsQuery>;

export const ListSnapshotsResponse = z.object({
  snapshots: z.array(SnapshotMeta),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(MAX_SNAPSHOT_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
});
export type ListSnapshotsResponse = z.infer<typeof ListSnapshotsResponse>;

export const ConfigAppSummary = AppEntry.omit({ intents: true }).extend({
  intentCount: z.number().int().nonnegative(),
});
export type ConfigAppSummary = z.infer<typeof ConfigAppSummary>;

export const ConfigIndexResponse = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
  groups: z.array(AppGroup),
  apps: z.array(ConfigAppSummary),
  global: GlobalApp.omit({ intents: true }).extend({
    intentCount: z.number().int().nonnegative(),
  }),
  preferences: SyncedPreferences,
  hotCorners: HotCornersConfig.omit({ commands: true }),
  rubEdges: RubEdgesConfig.omit({ commands: true }),
  boundaryIntentCount: z.number().int().nonnegative(),
});
export type ConfigIndexResponse = z.infer<typeof ConfigIndexResponse>;

export const ConfigScopeResponse = z.object({
  version: z.number().int().nonnegative(),
  scope: z.union([
    z.object({ kind: z.literal("global"), global: GlobalApp }),
    z.object({ kind: z.literal("app"), app: AppEntry }),
  ]),
  boundaryIntents: z.array(BoundaryIntent),
});
export type ConfigScopeResponse = z.infer<typeof ConfigScopeResponse>;

/** POST /sync/snapshots/:version/restore —— 回滚 = 以该快照为内容推进一个新版本 */
export const RestoreSnapshotRequest = z.object({
  /** 用户确认回滚时看到的当前配置版本;其后版本变化则返回 409 */
  baseVersion: z.number().int().nonnegative(),
});
export type RestoreSnapshotRequest = z.infer<typeof RestoreSnapshotRequest>;

export const RestoreSnapshotResponse = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type RestoreSnapshotResponse = z.infer<typeof RestoreSnapshotResponse>;

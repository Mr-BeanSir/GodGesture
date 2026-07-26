/**
 * 同步协议 —— 整库版本 + 乐观并发 + 后写胜出 + 快照(ADR-0009)。
 * REST 端点的请求/响应体;服务端与桌面端共用。
 */
import { z } from "zod";
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
  /** 载荷字节数,列表展示用 */
  sizeBytes: z.number().int().nonnegative(),
});
export type SnapshotMeta = z.infer<typeof SnapshotMeta>;

export const ListSnapshotsResponse = z.object({
  snapshots: z.array(SnapshotMeta),
});
export type ListSnapshotsResponse = z.infer<typeof ListSnapshotsResponse>;

/** POST /sync/snapshots/:version/restore —— 回滚 = 以该快照为内容推进一个新版本 */
export const RestoreSnapshotResponse = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type RestoreSnapshotResponse = z.infer<typeof RestoreSnapshotResponse>;

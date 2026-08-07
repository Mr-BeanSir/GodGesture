import {
  HttpException,
  HttpStatus,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ConfigIndexResponse,
  ConfigScopeResponse,
  ListSnapshotsQuery,
  ListSnapshotsResponse,
  PullConfigResponse,
  PushConfigRequest,
  PushConfigResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
} from '@godgesture/shared';
import {
  ConfigDocument,
  MAX_CONFIG_DOCUMENT_BYTES,
  configDocumentSizeBytes,
} from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../common/prisma-exception.filter';

/** 快照留存条数:每用户保留最新 100 个,推送事务内裁剪 */
export const SNAPSHOT_RETENTION = 100;
/** 插件源码提高单文档上限后,历史正文仍保持有界。 */
export const SNAPSHOT_STORAGE_BYTES = 64 * 1024 * 1024;

/**
 * 同步:整库版本 + 乐观并发 + 后写胜出 + 快照(ADR-0009)。
 * 回滚 = 以快照内容推进一个新版本(自身同样入快照)。
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async pull(userId: string): Promise<PullConfigResponse> {
    const config = await this.prisma.userConfig.findUnique({
      where: { userId },
    });
    if (!config) {
      return {
        version: 0,
        updatedAt: null,
        updatedByDeviceId: null,
        document: null,
      };
    }
    const document = ConfigDocument.parse(config.document);
    return {
      version: config.version,
      updatedAt: config.updatedAt.toISOString(),
      updatedByDeviceId: config.updatedByDeviceId,
      document,
    };
  }

  async configIndex(userId: string): Promise<ConfigIndexResponse> {
    const config = await this.prisma.userConfig.findUnique({ where: { userId } });
    const document = ConfigDocument.parse(config?.document ?? {});
    return {
      version: config?.version ?? 0,
      updatedAt: config?.updatedAt.toISOString() ?? null,
      groups: document.groups,
      apps: document.apps.map(({ intents, ...app }) => ({ ...app, intentCount: intents.length })),
      global: { gesturingEnabled: document.global.gesturingEnabled, intentCount: document.global.intents.length },
      preferences: document.preferences,
      hotCorners: { enabled: document.hotCorners.enabled },
      rubEdges: { enabled: document.rubEdges.enabled },
      boundaryIntentCount: document.boundaryIntents.length,
    };
  }

  async configScope(userId: string, scope: string): Promise<ConfigScopeResponse> {
    const config = await this.prisma.userConfig.findUnique({ where: { userId } });
    const document = ConfigDocument.parse(config?.document ?? {});
    if (scope === 'global') {
      return {
        version: config?.version ?? 0,
        scope: { kind: 'global', global: document.global },
        boundaryIntents: document.boundaryIntents,
      };
    }
    const app = document.apps.find((candidate) => candidate.id === scope);
    if (!app) throw new NotFoundException('App not found');
    return {
      version: config?.version ?? 0,
      scope: { kind: 'app', app },
      boundaryIntents: [],
    };
  }

  async push(
    userId: string,
    deviceId: string,
    dto: PushConfigRequest,
  ): Promise<PushConfigResponse> {
    // Apply the size limit to the received payload before schema parsing.
    const sizeBytes = this.assertConfigSize(dto.document);
    // The pipe already returns the shared type, but parse again at the service
    // boundary so direct callers receive the same v8 validation and defaults.
    const document = ConfigDocument.parse(dto.document);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await this.advanceVersion(
          tx,
          userId,
          deviceId,
          dto.baseVersion,
          document,
          sizeBytes,
          `配置同步推送；基于云端版本 v${dto.baseVersion}。`,
        );
        return result;
      });
    } catch (error) {
      return this.rethrowSyncWriteError(error, userId);
    }
  }

  private isVersionConflict(error: unknown): boolean {
    if (error instanceof ConflictException) {
      const response = error.getResponse();
      return (
        typeof response === 'object' &&
        response !== null &&
        'error' in response &&
        response.error === 'version_conflict'
      );
    }
    if (!isPrismaError(error, 'P2002')) return false;
    const modelName = error.meta?.modelName;
    return modelName === 'UserConfig' || modelName === 'ConfigSnapshot';
  }

  private async rethrowSyncWriteError(
    error: unknown,
    userId: string,
  ): Promise<never> {
    if (this.isVersionConflict(error)) {
      // A P2002 aborts PostgreSQL's transaction, so re-read only after the
      // rollback. This also reports the winning version for update CAS races.
      const current = await this.prisma.userConfig.findUnique({
        where: { userId },
        select: { version: true },
      });
      if (current) {
        throw new ConflictException({
          error: 'version_conflict',
          serverVersion: current.version,
        });
      }
    }
    if (isPrismaError(error, 'P2003')) {
      // The user/device was valid in the guard but disappeared before the
      // snapshot insert. Treat revocation as an authentication failure.
      throw new UnauthorizedException({ error: 'invalid_access_token' });
    }
    throw error;
  }

  async listSnapshots(
    userId: string,
    query: ListSnapshotsQuery,
  ): Promise<ListSnapshotsResponse> {
    const total = await this.prisma.configSnapshot.count({
      where: { userId },
    });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const snapshots = await this.prisma.configSnapshot.findMany({
      where: { userId },
      orderBy: { version: 'desc' },
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      include: { device: { select: { name: true } } },
    });
    return {
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      snapshots: snapshots.map((s) => ({
        version: s.version,
        createdAt: s.createdAt.toISOString(),
        deviceId: s.deviceId,
        deviceName: s.device?.name ?? null,
        note: s.note,
        sizeBytes: s.sizeBytes,
      })),
    };
  }

  async restoreSnapshot(
    userId: string,
    deviceId: string,
    version: number,
    dto: RestoreSnapshotRequest,
  ): Promise<RestoreSnapshotResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.configSnapshot.findUnique({
          where: { userId_version: { userId, version } },
        });
        if (!snapshot) {
          throw new NotFoundException({ error: 'snapshot_not_found' });
        }
        const document = ConfigDocument.parse(snapshot.document);
        // 使用用户确认时看到的版本推进。advanceVersion 会在同一事务先校验当前
        // 版本，再以 updateMany(userId, version) 抵御确认后的并发写。
        return this.advanceVersion(
          tx,
          userId,
          deviceId,
          dto.baseVersion,
          document,
          this.assertConfigSize(document),
          `从配置快照 v${version} 回滚；回滚前云端版本为 v${dto.baseVersion}。`,
        );
      });
    } catch (error) {
      return this.rethrowSyncWriteError(error, userId);
    }
  }

  /**
   * 事务内推进一个版本:乐观并发校验 → 写 UserConfig → 建快照 → 裁剪留存 →
   * 更新设备 lastSeenAt。
   */
  private async advanceVersion(
    tx: Prisma.TransactionClient,
    userId: string,
    deviceId: string,
    baseVersion: number,
    document: ConfigDocument,
    sizeBytes: number,
    note: string,
  ): Promise<PushConfigResponse> {
    const current = await tx.userConfig.findUnique({ where: { userId } });
    const currentVersion = current?.version ?? 0;
    if (baseVersion !== currentVersion) {
      throw new ConflictException({
        error: 'version_conflict',
        serverVersion: currentVersion,
      });
    }
    const newVersion = currentVersion + 1;
    const now = new Date();
    const json = document as unknown as Prisma.InputJsonValue;

    if (current) {
      // 带版本条件的更新,拦截同事务窗口内的并发写
      const updated = await tx.userConfig.updateMany({
        where: { userId, version: currentVersion },
        data: {
          version: newVersion,
          document: json,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          error: 'version_conflict',
          serverVersion: currentVersion,
        });
      }
    } else {
      await tx.userConfig.create({
        data: {
          userId,
          version: newVersion,
          document: json,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        },
      });
    }

    await tx.configSnapshot.create({
      data: {
        userId,
        version: newVersion,
        document: json,
        sizeBytes,
        note,
        deviceId,
        createdAt: now,
      },
    });
    await this.pruneSnapshots(tx, userId);
    await tx.device.updateMany({
      where: { id: deviceId },
      data: { lastSeenAt: now },
    });

    return { version: newVersion, updatedAt: now.toISOString() };
  }

  private assertConfigSize(document: unknown): number {
    const sizeBytes = configDocumentSizeBytes(document);
    if (sizeBytes > MAX_CONFIG_DOCUMENT_BYTES) {
      throw new HttpException(
        { error: 'config_too_large', maxBytes: MAX_CONFIG_DOCUMENT_BYTES },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    return sizeBytes;
  }

  private async pruneSnapshots(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const candidates = await tx.configSnapshot.findMany({
      where: { userId },
      orderBy: { version: 'desc' },
      take: SNAPSHOT_RETENTION,
      select: { version: true, sizeBytes: true },
    });
    let retainedBytes = 0;
    let oldestRetainedVersion: number | null = null;
    for (const snapshot of candidates) {
      if (
        oldestRetainedVersion !== null &&
        retainedBytes + snapshot.sizeBytes > SNAPSHOT_STORAGE_BYTES
      ) {
        break;
      }
      retainedBytes += snapshot.sizeBytes;
      oldestRetainedVersion = snapshot.version;
    }
    if (oldestRetainedVersion === null) return;
    await tx.configSnapshot.deleteMany({
      where: { userId, version: { lt: oldestRetainedVersion } },
    });
  }
}

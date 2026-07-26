import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ConfigDocument,
  ListSnapshotsResponse,
  PullConfigResponse,
  PushConfigRequest,
  PushConfigResponse,
  RestoreSnapshotResponse,
} from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';

/** 快照留存条数:每用户保留最新 100 个,推送事务内裁剪 */
export const SNAPSHOT_RETENTION = 100;

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
    return {
      version: config.version,
      updatedAt: config.updatedAt.toISOString(),
      updatedByDeviceId: config.updatedByDeviceId,
      document: config.document as ConfigDocument,
    };
  }

  async push(
    userId: string,
    deviceId: string,
    dto: PushConfigRequest,
  ): Promise<PushConfigResponse> {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.advanceVersion(
        tx,
        userId,
        deviceId,
        dto.baseVersion,
        dto.document,
      );
      return result;
    });
  }

  async listSnapshots(userId: string): Promise<ListSnapshotsResponse> {
    const snapshots = await this.prisma.configSnapshot.findMany({
      where: { userId },
      orderBy: { version: 'desc' },
      take: SNAPSHOT_RETENTION,
      include: { device: { select: { name: true } } },
    });
    return {
      snapshots: snapshots.map((s) => ({
        version: s.version,
        createdAt: s.createdAt.toISOString(),
        deviceId: s.deviceId,
        deviceName: s.device?.name ?? null,
        sizeBytes: s.sizeBytes,
      })),
    };
  }

  async restoreSnapshot(
    userId: string,
    deviceId: string,
    version: number,
  ): Promise<RestoreSnapshotResponse> {
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.configSnapshot.findUnique({
        where: { userId_version: { userId, version } },
      });
      if (!snapshot) {
        throw new NotFoundException({ error: 'snapshot_not_found' });
      }
      const current = await tx.userConfig.findUnique({ where: { userId } });
      // 回滚以服务端当前版本为基准推进,不做乐观并发拒绝
      return this.advanceVersion(
        tx,
        userId,
        deviceId,
        current?.version ?? 0,
        snapshot.document as ConfigDocument,
      );
    });
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
        sizeBytes: Buffer.byteLength(JSON.stringify(document), 'utf8'),
        deviceId,
        createdAt: now,
      },
    });
    await tx.configSnapshot.deleteMany({
      where: { userId, version: { lte: newVersion - SNAPSHOT_RETENTION } },
    });
    await tx.device.updateMany({
      where: { id: deviceId },
      data: { lastSeenAt: now },
    });

    return { version: newVersion, updatedAt: now.toISOString() };
  }
}

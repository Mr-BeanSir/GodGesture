import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigDocument } from '@godgesture/shared';
import { SyncService, SNAPSHOT_RETENTION } from './sync.service';
import { PrismaService } from '../prisma/prisma.service';

/** 文档内容本身不在 Service 层校验(由控制器的 ZodValidationPipe 负责) */
const doc = { formatVersion: 1, apps: [] } as unknown as ConfigDocument;

describe('SyncService(乐观并发 + 快照)', () => {
  let tx: {
    userConfig: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    configSnapshot: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
    };
    device: { updateMany: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    userConfig: { findUnique: jest.Mock };
    configSnapshot: { findMany: jest.Mock };
  };
  let service: SyncService;

  beforeEach(() => {
    tx = {
      userConfig: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      configSnapshot: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
      device: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      userConfig: { findUnique: jest.fn() },
      configSnapshot: { findMany: jest.fn() },
    };
    service = new SyncService(prisma as unknown as PrismaService);
  });

  describe('pull', () => {
    it('无配置 → version 0 + null 文档', async () => {
      prisma.userConfig.findUnique.mockResolvedValue(null);
      await expect(service.pull('user-1')).resolves.toEqual({
        version: 0,
        updatedAt: null,
        updatedByDeviceId: null,
        document: null,
      });
    });

    it('有配置 → 返回当前版本与文档', async () => {
      const updatedAt = new Date('2026-07-26T00:00:00.000Z');
      prisma.userConfig.findUnique.mockResolvedValue({
        userId: 'user-1',
        version: 7,
        document: doc,
        updatedAt,
        updatedByDeviceId: 'dev-9',
      });
      await expect(service.pull('user-1')).resolves.toEqual({
        version: 7,
        updatedAt: updatedAt.toISOString(),
        updatedByDeviceId: 'dev-9',
        document: doc,
      });
    });
  });

  describe('push', () => {
    it('首次推送(baseVersion 0)→ 创建 version 1 并入快照', async () => {
      tx.userConfig.findUnique.mockResolvedValue(null);

      const res = await service.push('user-1', 'dev-1', {
        baseVersion: 0,
        document: doc,
      });

      expect(res.version).toBe(1);
      expect(tx.userConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          version: 1,
          updatedByDeviceId: 'dev-1',
        }),
      });
      expect(tx.configSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          version: 1,
          deviceId: 'dev-1',
          sizeBytes: Buffer.byteLength(JSON.stringify(doc), 'utf8'),
        }),
      });
      expect(tx.device.updateMany).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
        data: { lastSeenAt: expect.any(Date) },
      });
    });

    it('baseVersion 相符 → 版本 +1(带版本条件更新)', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 4 });

      const res = await service.push('user-1', 'dev-1', {
        baseVersion: 4,
        document: doc,
      });

      expect(res.version).toBe(5);
      expect(tx.userConfig.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: 4 },
        data: expect.objectContaining({ version: 5 }),
      });
    });

    it('baseVersion 落后 → 409 version_conflict(附 serverVersion),不写库', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 6 });

      const err = await service
        .push('user-1', 'dev-1', { baseVersion: 4, document: doc })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        error: 'version_conflict',
        serverVersion: 6,
      });
      expect(tx.userConfig.updateMany).not.toHaveBeenCalled();
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
    });

    it('事务窗口内被并发写抢先(updateMany 命中 0 行)→ 409', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 4 });
      tx.userConfig.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.push('user-1', 'dev-1', { baseVersion: 4, document: doc }),
      ).rejects.toThrow(ConflictException);
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
    });

    it('留存裁剪:同事务内删除版本 ≤ newVersion-100 的旧快照', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 149 });

      await service.push('user-1', 'dev-1', { baseVersion: 149, document: doc });

      expect(tx.configSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: { lte: 150 - SNAPSHOT_RETENTION } },
      });
    });
  });

  describe('restoreSnapshot', () => {
    it('回滚 = 以快照内容推进新版本,自身入快照', async () => {
      const snapshotDoc = { formatVersion: 1, apps: ['old'] };
      tx.configSnapshot.findUnique.mockResolvedValue({
        userId: 'user-1',
        version: 3,
        document: snapshotDoc,
        sizeBytes: 42,
      });
      tx.userConfig.findUnique.mockResolvedValue({ version: 9 });

      const res = await service.restoreSnapshot('user-1', 'dev-2', 3);

      expect(res.version).toBe(10);
      expect(tx.userConfig.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: 9 },
        data: expect.objectContaining({ version: 10, document: snapshotDoc }),
      });
      expect(tx.configSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 10, document: snapshotDoc }),
      });
    });

    it('快照不存在 → 404', async () => {
      tx.configSnapshot.findUnique.mockResolvedValue(null);
      await expect(
        service.restoreSnapshot('user-1', 'dev-1', 99),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listSnapshots', () => {
    it('按版本降序取至多 100 条,带设备名', async () => {
      const createdAt = new Date('2026-07-25T12:00:00.000Z');
      prisma.configSnapshot.findMany.mockResolvedValue([
        {
          version: 2,
          createdAt,
          deviceId: 'dev-1',
          device: { name: '工作机' },
          sizeBytes: 1024,
        },
        {
          version: 1,
          createdAt,
          deviceId: null,
          device: null,
          sizeBytes: 512,
        },
      ]);

      const res = await service.listSnapshots('user-1');

      expect(prisma.configSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { version: 'desc' },
          take: 100,
        }),
      );
      expect(res.snapshots).toEqual([
        {
          version: 2,
          createdAt: createdAt.toISOString(),
          deviceId: 'dev-1',
          deviceName: '工作机',
          sizeBytes: 1024,
        },
        {
          version: 1,
          createdAt: createdAt.toISOString(),
          deviceId: null,
          deviceName: null,
          sizeBytes: 512,
        },
      ]);
    });
  });
});

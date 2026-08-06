import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConfigDocument as ConfigDocumentSchema,
  MAX_CONFIG_DOCUMENT_BYTES,
  configDocumentSizeBytes,
  type ConfigDocument,
} from '@godgesture/shared';
import {
  SNAPSHOT_RETENTION,
  SNAPSHOT_STORAGE_BYTES,
  SyncService,
} from './sync.service';
import { PrismaService } from '../prisma/prisma.service';

/** 文档内容本身不在 Service 层校验(由控制器的 ZodValidationPipe 负责) */
const doc = { formatVersion: 1, apps: [] } as unknown as ConfigDocument;

function sizedDocument(targetBytes: number): ConfigDocument {
  const shell = ConfigDocumentSchema.parse({});
  const padding = targetBytes - configDocumentSizeBytes(shell) - 13;
  if (padding < 0) throw new Error('target is smaller than the document shell');
  const document = { ...shell, padding: 'x'.repeat(padding) } as ConfigDocument;
  if (configDocumentSizeBytes(document) !== targetBytes) {
    throw new Error('could not construct an exact-size valid document');
  }
  return document;
}

function prismaError(
  code: string,
  modelName: string,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('test database failure', {
    code,
    clientVersion: '6.19.3',
    meta: { modelName },
  });
}

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
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    device: { updateMany: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    userConfig: { findUnique: jest.Mock };
    configSnapshot: { count: jest.Mock; findMany: jest.Mock };
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
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      device: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      userConfig: { findUnique: jest.fn() },
      configSnapshot: { count: jest.fn(), findMany: jest.fn() },
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
    it('接受恰好 4 MiB 的文档并记录精确快照字节数', async () => {
      tx.userConfig.findUnique.mockResolvedValue(null);
      const document = sizedDocument(MAX_CONFIG_DOCUMENT_BYTES);

      await service.push('user-1', 'dev-1', {
        baseVersion: 0,
        document,
      });

      expect(tx.configSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sizeBytes: MAX_CONFIG_DOCUMENT_BYTES }),
      });
    });

    it('超过文档上限 1 字节时在进入事务前返回 413', async () => {
      const document = sizedDocument(MAX_CONFIG_DOCUMENT_BYTES + 1);

      const error = await service
        .push('user-1', 'dev-1', { baseVersion: 0, document })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(413);
      expect((error as HttpException).getResponse()).toEqual({
        error: 'config_too_large',
        maxBytes: MAX_CONFIG_DOCUMENT_BYTES,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

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
      prisma.userConfig.findUnique.mockResolvedValue({ version: 7 });

      const err = await service
        .push('user-1', 'dev-1', { baseVersion: 4, document: doc })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({
        error: 'version_conflict',
        serverVersion: 7,
      });
      expect(tx.userConfig.updateMany).not.toHaveBeenCalled();
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
    });

    it('事务窗口内被并发写抢先(updateMany 命中 0 行)→ 409', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 4 });
      tx.userConfig.updateMany.mockResolvedValue({ count: 0 });
      prisma.userConfig.findUnique.mockResolvedValue({ version: 5 });

      const error = await service
        .push('user-1', 'dev-1', { baseVersion: 4, document: doc })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        error: 'version_conflict',
        serverVersion: 5,
      });
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
    });

    it('并发首次创建的唯一约束失败 → 回滚后重读 winner 并返回 409', async () => {
      tx.userConfig.findUnique.mockResolvedValue(null);
      tx.userConfig.create.mockRejectedValue(
        prismaError('P2002', 'UserConfig'),
      );
      prisma.userConfig.findUnique.mockResolvedValue({ version: 1 });

      const error = await service
        .push('user-1', 'dev-1', { baseVersion: 0, document: doc })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        error: 'version_conflict',
        serverVersion: 1,
      });
      expect(prisma.userConfig.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { version: true },
      });
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
    });

    it('guard 后设备被删除导致快照 FK 失败 → 401 会话错误', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 2 });
      tx.configSnapshot.create.mockRejectedValue(
        prismaError('P2003', 'ConfigSnapshot'),
      );

      const error = await service
        .push('user-1', 'deleted-device', {
          baseVersion: 2,
          document: doc,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        error: 'invalid_access_token',
      });
    });

    it('非同步约束的 P2002 不猜测为版本冲突', async () => {
      const databaseError = prismaError('P2002', 'OAuthAccount');
      tx.userConfig.findUnique.mockRejectedValue(databaseError);

      await expect(
        service.push('user-1', 'dev-1', { baseVersion: 0, document: doc }),
      ).rejects.toBe(databaseError);
    });

    it('留存裁剪:只保留按版本倒序的最新 100 个快照', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 149 });
      tx.configSnapshot.findMany.mockResolvedValue(
        Array.from({ length: SNAPSHOT_RETENTION }, (_, index) => ({
          version: 150 - index,
          sizeBytes: 1,
        })),
      );

      await service.push('user-1', 'dev-1', {
        baseVersion: 149,
        document: doc,
      });

      expect(tx.configSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: { lt: 51 } },
      });
    });

    it('留存裁剪:累计正文超过 64 MiB 时删除更老快照', async () => {
      tx.userConfig.findUnique.mockResolvedValue({ version: 149 });
      const snapshotBytes = 20 * 1024 * 1024;
      expect(snapshotBytes * 3).toBeLessThanOrEqual(SNAPSHOT_STORAGE_BYTES);
      expect(snapshotBytes * 4).toBeGreaterThan(SNAPSHOT_STORAGE_BYTES);
      tx.configSnapshot.findMany.mockResolvedValue(
        [150, 149, 148, 147].map((version) => ({
          version,
          sizeBytes: snapshotBytes,
        })),
      );

      await service.push('user-1', 'dev-1', {
        baseVersion: 149,
        document: doc,
      });

      expect(tx.configSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: { lt: 148 } },
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

      const res = await service.restoreSnapshot('user-1', 'dev-2', 3, {
        baseVersion: 9,
      });

      expect(res.version).toBe(10);
      expect(tx.userConfig.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: 9 },
        data: expect.objectContaining({ version: 10, document: snapshotDoc }),
      });
      expect(tx.configSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          version: 10,
          document: snapshotDoc,
          note: '从配置快照 v3 回滚；回滚前云端版本为 v9。',
        }),
      });
    });

    it('快照不存在 → 404', async () => {
      tx.configSnapshot.findUnique.mockResolvedValue(null);
      await expect(
        service.restoreSnapshot('user-1', 'dev-1', 99, { baseVersion: 9 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('确认时 baseVersion 已落后 → 409 且不写入', async () => {
      tx.configSnapshot.findUnique.mockResolvedValue({
        userId: 'user-1',
        version: 3,
        document: doc,
      });
      tx.userConfig.findUnique.mockResolvedValue({ version: 10 });
      prisma.userConfig.findUnique.mockResolvedValue({ version: 10 });

      const error = await service
        .restoreSnapshot('user-1', 'dev-1', 3, { baseVersion: 9 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        error: 'version_conflict',
        serverVersion: 10,
      });
      expect(tx.userConfig.updateMany).not.toHaveBeenCalled();
      expect(tx.userConfig.create).not.toHaveBeenCalled();
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
      expect(tx.configSnapshot.deleteMany).not.toHaveBeenCalled();
      expect(tx.device.updateMany).not.toHaveBeenCalled();
    });

    it('确认后被并发写抢先 → CAS 返回 409 且事务内不建快照', async () => {
      tx.configSnapshot.findUnique.mockResolvedValue({
        userId: 'user-1',
        version: 3,
        document: doc,
      });
      tx.userConfig.findUnique.mockResolvedValue({ version: 9 });
      tx.userConfig.updateMany.mockResolvedValue({ count: 0 });
      prisma.userConfig.findUnique.mockResolvedValue({ version: 10 });

      const error = await service
        .restoreSnapshot('user-1', 'dev-1', 3, { baseVersion: 9 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        error: 'version_conflict',
        serverVersion: 10,
      });
      expect(tx.userConfig.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', version: 9 },
        data: expect.objectContaining({ version: 10 }),
      });
      expect(tx.configSnapshot.create).not.toHaveBeenCalled();
      expect(tx.configSnapshot.deleteMany).not.toHaveBeenCalled();
      expect(tx.device.updateMany).not.toHaveBeenCalled();
    });

    it('回滚写入前设备被删除导致 P2003 → 401 会话错误', async () => {
      tx.configSnapshot.findUnique.mockResolvedValue({
        userId: 'user-1',
        version: 3,
        document: doc,
      });
      tx.userConfig.findUnique.mockResolvedValue({ version: 9 });
      tx.configSnapshot.create.mockRejectedValue(
        prismaError('P2003', 'ConfigSnapshot'),
      );

      const error = await service
        .restoreSnapshot('user-1', 'deleted-device', 3, { baseVersion: 9 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        error: 'invalid_access_token',
      });
    });
  });

  describe('listSnapshots', () => {
    it('按版本降序获取请求页并返回分页元数据', async () => {
      const createdAt = new Date('2026-07-25T12:00:00.000Z');
      prisma.configSnapshot.count.mockResolvedValue(23);
      prisma.configSnapshot.findMany.mockResolvedValue([
        {
          version: 2,
          createdAt,
          deviceId: 'dev-1',
          device: { name: '工作机' },
          note: '',
          sizeBytes: 1024,
        },
        {
          version: 1,
          createdAt,
          deviceId: null,
          device: null,
          note: '',
          sizeBytes: 512,
        },
      ]);

      const res = await service.listSnapshots('user-1', {
        page: 2,
        pageSize: 10,
      });

      expect(prisma.configSnapshot.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.configSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { version: 'desc' },
          skip: 10,
          take: 10,
        }),
      );
      expect(res).toEqual({
        page: 2,
        pageSize: 10,
        total: 23,
        totalPages: 3,
        snapshots: [
          {
            version: 2,
            createdAt: createdAt.toISOString(),
            deviceId: 'dev-1',
            deviceName: '工作机',
            note: '',
            sizeBytes: 1024,
          },
          {
            version: 1,
            createdAt: createdAt.toISOString(),
            deviceId: null,
            deviceName: null,
            note: '',
            sizeBytes: 512,
          },
        ],
      });
    });

    it('请求页超过范围时返回最后一页', async () => {
      prisma.configSnapshot.count.mockResolvedValue(23);
      prisma.configSnapshot.findMany.mockResolvedValue([]);

      const res = await service.listSnapshots('user-1', {
        page: 9,
        pageSize: 10,
      });

      expect(prisma.configSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(res).toMatchObject({
        page: 3,
        pageSize: 10,
        total: 23,
        totalPages: 3,
      });
    });

    it('空列表规范化为第一页', async () => {
      prisma.configSnapshot.count.mockResolvedValue(0);
      prisma.configSnapshot.findMany.mockResolvedValue([]);

      const res = await service.listSnapshots('user-1', {
        page: 4,
        pageSize: 20,
      });

      expect(prisma.configSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(res).toEqual({
        snapshots: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      });
    });
  });
});

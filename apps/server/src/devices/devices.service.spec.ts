import { NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DevicesService(列表 / 改名 / 踢下线,归属校验)', () => {
  let prisma: {
    device: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let service: DevicesService;

  beforeEach(() => {
    prisma = {
      device: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    service = new DevicesService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('仅查本人设备,按创建时间升序,标记 current 并序列化时间', async () => {
      const createdAt = new Date('2026-07-01T00:00:00.000Z');
      const lastSeenAt = new Date('2026-07-25T08:00:00.000Z');
      prisma.device.findMany.mockResolvedValue([
        {
          id: 'dev-1',
          name: '工作机',
          platform: 'windows',
          createdAt,
          lastSeenAt,
        },
        {
          id: 'dev-2',
          name: 'Chrome · Windows',
          platform: 'web',
          createdAt,
          lastSeenAt: null,
        },
      ]);

      const res = await service.list('user-1', 'dev-2');

      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(res).toEqual({
        devices: [
          {
            id: 'dev-1',
            name: '工作机',
            platform: 'windows',
            createdAt: createdAt.toISOString(),
            lastSeenAt: lastSeenAt.toISOString(),
            current: false,
          },
          {
            id: 'dev-2',
            name: 'Chrome · Windows',
            platform: 'web',
            createdAt: createdAt.toISOString(),
            lastSeenAt: null,
            current: true,
          },
        ],
      });
    });
  });

  describe('rename', () => {
    it('带 userId 条件更新(归属校验与更新一步完成)', async () => {
      prisma.device.updateMany.mockResolvedValue({ count: 1 });

      await service.rename('user-1', 'dev-1', '新名字');

      expect(prisma.device.updateMany).toHaveBeenCalledWith({
        where: { id: 'dev-1', userId: 'user-1' },
        data: { name: '新名字' },
      });
    });

    it('设备不存在或不属于该用户 → 404 device_not_found', async () => {
      prisma.device.updateMany.mockResolvedValue({ count: 0 });

      const err = await service
        .rename('user-1', 'dev-x', '名字')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toEqual({
        error: 'device_not_found',
      });
    });
  });

  describe('remove', () => {
    it('删除唯一的写语句必须带 userId(归属校验与删除一步完成)', async () => {
      prisma.device.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('user-1', 'dev-1');

      expect(prisma.device.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.device.deleteMany).toHaveBeenCalledWith({
        where: { id: 'dev-1', userId: 'user-1' },
      });
    });

    it('允许删除当前设备(等效登出)—— 服务层不做特殊限制', async () => {
      prisma.device.deleteMany.mockResolvedValue({ count: 1 });

      await expect(
        service.remove('user-1', 'dev-current'),
      ).resolves.toBeUndefined();
    });

    it('设备不属于该用户 → 404,且不产生任何其他写操作', async () => {
      prisma.device.deleteMany.mockResolvedValue({ count: 0 });

      const err = await service
        .remove('user-1', 'dev-other')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toEqual({
        error: 'device_not_found',
      });
      expect(prisma.device.updateMany).not.toHaveBeenCalled();
    });

    // 并发重复踢下线:第二次删到 0 行。旧实现是 findFirst 通过后再 delete by id,
    // 两次都能通过校验,第二次 delete 抛 P2025 → 500;deleteMany 是幂等的 404。
    it('并发重复删除 → 第二次 404,而不是 Prisma 记录不存在错误', async () => {
      prisma.device.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(service.remove('user-1', 'dev-1')).resolves.toBeUndefined();
      await expect(service.remove('user-1', 'dev-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

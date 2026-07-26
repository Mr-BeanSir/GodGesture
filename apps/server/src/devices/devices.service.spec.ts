import { NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';

describe('DevicesService(列表 / 改名 / 踢下线,归属校验)', () => {
  let prisma: {
    device: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
  };
  let tokens: { revokeDeviceTokens: jest.Mock };
  let service: DevicesService;

  beforeEach(() => {
    prisma = {
      device: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    tokens = { revokeDeviceTokens: jest.fn().mockResolvedValue(undefined) };
    service = new DevicesService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokenService,
    );
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
    it('撤销该设备全部刷新令牌后删除设备', async () => {
      prisma.device.findFirst.mockResolvedValue({ id: 'dev-1' });

      await service.remove('user-1', 'dev-1');

      expect(prisma.device.findFirst).toHaveBeenCalledWith({
        where: { id: 'dev-1', userId: 'user-1' },
        select: { id: true },
      });
      expect(tokens.revokeDeviceTokens).toHaveBeenCalledWith('dev-1');
      expect(prisma.device.delete).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
      });
    });

    it('允许删除当前设备(等效登出)—— 服务层不做特殊限制', async () => {
      prisma.device.findFirst.mockResolvedValue({ id: 'dev-current' });

      await expect(
        service.remove('user-1', 'dev-current'),
      ).resolves.toBeUndefined();
      expect(tokens.revokeDeviceTokens).toHaveBeenCalledWith('dev-current');
    });

    it('设备不属于该用户 → 404,不撤销、不删除', async () => {
      prisma.device.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-1', 'dev-other')).rejects.toThrow(
        NotFoundException,
      );
      expect(tokens.revokeDeviceTokens).not.toHaveBeenCalled();
      expect(prisma.device.delete).not.toHaveBeenCalled();
    });
  });
});

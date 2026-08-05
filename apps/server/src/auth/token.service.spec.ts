import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  REFRESH_ROTATION_RACE_GRACE_MS,
  TokenService,
  sha256Hex,
} from './token.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { Prisma } from '@prisma/client';

describe('TokenService(刷新令牌轮换)', () => {
  const now = Date.now();
  let prisma: {
    $transaction: jest.Mock;
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    device: { update: jest.Mock };
  };
  let tx: {
    refreshToken: { create: jest.Mock; updateMany: jest.Mock };
    device: { update: jest.Mock };
  };
  let service: TokenService;

  const jwt = new JwtService({ secret: 'test-secret-test-secret' });
  const config = {
    get: (key: string) =>
      ({ ACCESS_TOKEN_TTL_SEC: 900, REFRESH_TOKEN_TTL_DAYS: 30 })[key],
  } as unknown as ConfigService;

  const activeRecord = (raw: string) => ({
    id: 'rt-1',
    deviceId: 'dev-1',
    tokenHash: sha256Hex(raw),
    expiresAt: new Date(now + 86_400_000),
    revokedAt: null,
    createdAt: new Date(now - 1000),
    device: { id: 'dev-1', userId: 'user-1', user: { disabledAt: null } },
  });

  beforeEach(() => {
    tx = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      device: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((operation) => operation(tx)),
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      device: { update: jest.fn().mockResolvedValue({}) },
    };
    service = new TokenService(
      jwt,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    );
  });

  it('签发令牌对:JWT 载荷 {sub, dev},刷新令牌只存哈希', async () => {
    const pair = await service.issueTokenPair('user-1', 'dev-1');

    expect(pair.accessTokenExpiresIn).toBe(900);
    const payload = jwt.verify<{ sub: string; dev: string }>(pair.accessToken);
    expect(payload.sub).toBe('user-1');
    expect(payload.dev).toBe('dev-1');

    const stored = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(stored.deviceId).toBe('dev-1');
    expect(stored.tokenHash).toBe(sha256Hex(pair.refreshToken));
    expect(stored.tokenHash).not.toBe(pair.refreshToken);
  });

  it('轮换成功:旧令牌置 revokedAt,签发新令牌对', async () => {
    const raw = 'raw-refresh-token';
    prisma.refreshToken.findUnique.mockResolvedValue(activeRecord(raw));

    const pair = await service.rotateRefreshToken(raw);

    // 旧令牌被原子作废
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.device.update).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: { lastSeenAt: expect.any(Date) },
    });
    // 新刷新令牌与旧的不同
    expect(sha256Hex(pair.refreshToken)).not.toBe(sha256Hex(raw));
    expect(tx.refreshToken.create).toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    const payload = jwt.verify<{ sub: string }>(pair.accessToken);
    expect(payload.sub).toBe('user-1');
  });

  it('未知令牌 → 401', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotateRefreshToken('nope')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('已作废令牌重放 → 401 且撤销该设备全部令牌', async () => {
    const raw = 'reused-token';
    prisma.refreshToken.findUnique.mockResolvedValue({
      ...activeRecord(raw),
      revokedAt: new Date(now - REFRESH_ROTATION_RACE_GRACE_MS - 1_000),
    });

    await expect(service.rotateRefreshToken(raw)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { deviceId: 'dev-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('过期令牌 → 401,不签发新令牌', async () => {
    const raw = 'expired-token';
    prisma.refreshToken.findUnique.mockResolvedValue({
      ...activeRecord(raw),
      expiresAt: new Date(now - 1),
    });

    await expect(service.rotateRefreshToken(raw)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('账户已停用 → refresh 立即拒绝且不启动轮换', async () => {
    const raw = 'disabled-account-token';
    prisma.refreshToken.findUnique.mockResolvedValue({
      ...activeRecord(raw),
      device: {
        ...activeRecord(raw).device,
        user: { disabledAt: new Date() },
      },
    });

    const error = await service
      .rotateRefreshToken(raw)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'account_disabled',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('并发轮换竞争(CAS loser)→ 409 race 且不撤销设备 token family', async () => {
    const raw = 'race-token';
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(activeRecord(raw))
      .mockResolvedValueOnce({
        deviceId: 'dev-1',
        revokedAt: new Date(),
      });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    const error = await service
      .rotateRefreshToken(raw)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      error: 'refresh_rotation_race',
    });
    expect(prisma.refreshToken.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'rt-1' },
      select: { deviceId: true, revokedAt: true },
    });
    expect(tx.device.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('CAS loser 重读到 grace 外作废时间 → 401 replay 并撤销 token family', async () => {
    const raw = 'stale-race-token';
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(activeRecord(raw))
      .mockResolvedValueOnce({
        deviceId: 'dev-1',
        revokedAt: new Date(
          Date.now() - REFRESH_ROTATION_RACE_GRACE_MS - 1_000,
        ),
      });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    const error = await service
      .rotateRefreshToken(raw)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'refresh_token_reused',
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { deviceId: 'dev-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  it('轮换期间设备被删除导致 P2025 → 401 invalid_refresh_token', async () => {
    const raw = 'deleted-device-token';
    prisma.refreshToken.findUnique.mockResolvedValue(activeRecord(raw));
    tx.device.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('record not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
        meta: { modelName: 'Device' },
      }),
    );

    const error = await service
      .rotateRefreshToken(raw)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'invalid_refresh_token',
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  it('successor 创建失败时整个 rotation transaction 失败,不走独立写入', async () => {
    const raw = 'successor-create-fails';
    const databaseError = new Error('database unavailable');
    prisma.refreshToken.findUnique.mockResolvedValue(activeRecord(raw));
    tx.refreshToken.create.mockRejectedValue(databaseError);

    await expect(service.rotateRefreshToken(raw)).rejects.toBe(databaseError);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.device.update).toHaveBeenCalledTimes(1);
    expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService, sha256Hex } from './token.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';

describe('TokenService(刷新令牌轮换)', () => {
  const now = Date.now();
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
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
    device: { id: 'dev-1', userId: 'user-1' },
  });

  beforeEach(() => {
    prisma = {
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
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // 新刷新令牌与旧的不同
    expect(sha256Hex(pair.refreshToken)).not.toBe(sha256Hex(raw));
    expect(prisma.refreshToken.create).toHaveBeenCalled();
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
      revokedAt: new Date(now - 500),
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

  it('并发轮换竞争(updateMany 命中 0 行)→ 401 并撤销设备令牌', async () => {
    const raw = 'race-token';
    prisma.refreshToken.findUnique.mockResolvedValue(activeRecord(raw));
    prisma.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 }) // 作废旧令牌失败(已被并发轮换抢先)
      .mockResolvedValue({ count: 1 }); // 随后的整设备撤销

    await expect(service.rotateRefreshToken(raw)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

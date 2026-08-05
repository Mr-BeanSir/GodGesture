import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, type AuthedRequest } from './jwt-auth.guard';
import type { PrismaService } from '../prisma/prisma.service';

describe('JwtAuthGuard(验签 + 设备即时撤销)', () => {
  const user1 = '11111111-1111-4111-8111-111111111111';
  const user2 = '22222222-2222-4222-8222-222222222222';
  const device1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const device2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const deletedDevice = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  let jwt: { verifyAsync: jest.Mock };
  let prisma: { device: { findUnique: jest.Mock } };
  let guard: JwtAuthGuard;

  const request = (authorization = 'Bearer access-token') =>
    ({ headers: { authorization } }) as AuthedRequest;

  const contextFor = (req: AuthedRequest) =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as ExecutionContext;

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    prisma = { device: { findUnique: jest.fn() } };
    guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
  });

  it('令牌有效且设备属于 sub → 通过并写入认证上下文', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user1, dev: device1 });
    prisma.device.findUnique.mockResolvedValue({
      id: device1,
      userId: user1,
      user: { disabledAt: null },
    });
    const req = request();

    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);

    expect(prisma.device.findUnique).toHaveBeenCalledWith({
      where: { id: device1 },
      select: {
        id: true,
        userId: true,
        user: { select: { disabledAt: true } },
      },
    });
    expect(req.auth).toEqual({ userId: user1, deviceId: device1 });
  });

  it('设备已删除(包括删除赢得验证竞争) → 401', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user1, dev: deletedDevice });
    prisma.device.findUnique.mockResolvedValue(null);

    const error = await guard
      .canActivate(contextFor(request()))
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'invalid_access_token',
    });
  });

  it('设备存在但不属于 JWT sub → 401', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user1, dev: device2 });
    prisma.device.findUnique.mockResolvedValue({
      id: device2,
      userId: user2,
      user: { disabledAt: null },
    });

    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('账户已停用 → 现有 access token 立即失效', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user1, dev: device1 });
    prisma.device.findUnique.mockResolvedValue({
      id: device1,
      userId: user1,
      user: { disabledAt: new Date() },
    });

    const error = await guard
      .canActivate(contextFor(request()))
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'account_disabled',
    });
  });

  it('设备查询的数据库异常保持原样,不误报为 token invalid', async () => {
    const databaseError = new Error('database unavailable');
    jwt.verifyAsync.mockResolvedValue({ sub: user1, dev: device1 });
    prisma.device.findUnique.mockRejectedValue(databaseError);

    await expect(guard.canActivate(contextFor(request()))).rejects.toBe(
      databaseError,
    );
  });

  it('缺少认证头不查 JWT 或数据库 → 401', async () => {
    const error = await guard
      .canActivate(contextFor(request('')))
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'missing_access_token',
    });
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
  });

  it('验签失败或载荷缺少设备上下文 → 401,不查数据库', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad signature'));
    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(
      UnauthorizedException,
    );

    jwt.verifyAsync.mockResolvedValueOnce({ sub: user1 });
    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(
      UnauthorizedException,
    );

    jwt.verifyAsync.mockResolvedValueOnce({ sub: user1, dev: 'not-a-uuid' });
    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
  });
});

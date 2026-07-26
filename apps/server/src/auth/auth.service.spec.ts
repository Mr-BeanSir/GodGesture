import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { hash, verify } from '@node-rs/argon2';
import { DUMMY_PASSWORD_HASH, PASSWORD_HASH_OPTIONS } from './password-hash';

jest.mock('@node-rs/argon2', () => ({
  Algorithm: { Argon2id: 2 },
  Version: { V0x13: 1 },
  hash: jest.fn(),
  verify: jest.fn(),
}));

const mockHash = jest.mocked(hash);
const mockVerify = jest.mocked(verify);

const CURRENT_HASH = DUMMY_PASSWORD_HASH;
const LEGACY_HASH =
  '$argon2id$v=19$m=4096,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg';
const STRONGER_HASH =
  '$argon2id$v=19$m=65536,t=4,p=2$c2FsdHNhbHRzYWx0c2FsdA$eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg';

function loginFixture(passwordHash: string | null = CURRENT_HASH) {
  const user = {
    id: 'user-id',
    email: 'user@example.com',
    passwordHash,
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    device: {
      create: jest.fn().mockResolvedValue({ id: 'device-id' }),
    },
  };
  const tokens = {
    issueTokenPair: jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresIn: 900,
    }),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    tokens as unknown as TokenService,
  );
  return { service, prisma, tokens, user };
}

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHash.mockResolvedValue('password-hash');
    mockVerify.mockResolvedValue(false);
  });

  it('并发注册撞上 User.email 唯一约束 → 409 email_taken', async () => {
    const databaseError = new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { modelName: 'User', target: ['email'] },
      },
    );
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(databaseError),
      },
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as TokenService,
    );

    const error = await service
      .register({ email: 'user@example.com', password: 'password123' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      error: 'email_taken',
    });
  });

  it('注册时未知数据库错误保持原样上抛', async () => {
    const databaseError = new Error('database unavailable');
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(databaseError),
      },
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as TokenService,
    );

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'password123',
      }),
    ).rejects.toBe(databaseError);
  });

  it('注册使用固定的 Argon2id 安全参数', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-id',
          email: 'user@example.com',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as TokenService,
    );

    await service.register({
      email: 'user@example.com',
      password: 'password123',
    });

    expect(mockHash).toHaveBeenCalledWith('password123', PASSWORD_HASH_OPTIONS);
  });

  it.each([
    ['不存在的用户', null],
    ['纯 OAuth 用户', { id: 'oauth-user', passwordHash: null }],
  ])('%s 仍执行一次 dummy verify 并统一返回 401', async (_name, user) => {
    const { service, prisma, tokens } = loginFixture();
    prisma.user.findUnique.mockResolvedValue(user);

    const error = await service
      .login({
        email: 'missing@example.com',
        password: 'wrong-password',
        device: { name: 'Browser', platform: 'web' },
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'invalid_credentials',
    });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      'wrong-password',
    );
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(tokens.issueTokenPair).not.toHaveBeenCalled();
  });

  it('错误密码只返回统一 401 且不创建设备', async () => {
    const { service, prisma } = loginFixture();

    await expect(
      service.login({
        email: 'user@example.com',
        password: 'wrong-password',
        device: { name: 'Browser', platform: 'web' },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockVerify).toHaveBeenCalledWith(CURRENT_HASH, 'wrong-password');
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it('当前策略哈希登录成功时不重复 rehash', async () => {
    const { service, prisma, tokens } = loginFixture();
    mockVerify.mockResolvedValue(true);

    const result = await service.login({
      email: 'user@example.com',
      password: 'correct-password',
      device: { name: 'Browser', platform: 'web' },
    });

    expect(result.accessToken).toBe('access');
    expect(mockHash).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(tokens.issueTokenPair).toHaveBeenCalledWith('user-id', 'device-id');
  });

  it('高于当前策略的哈希不会被降级', async () => {
    const { service, prisma } = loginFixture(STRONGER_HASH);
    mockVerify.mockResolvedValue(true);

    await service.login({
      email: 'user@example.com',
      password: 'correct-password',
      device: { name: 'Browser', platform: 'web' },
    });

    expect(mockHash).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('旧哈希登录成功后以 CAS 升级且不降低已有更强参数', async () => {
    const { service, prisma } = loginFixture(LEGACY_HASH);
    mockVerify.mockResolvedValue(true);
    mockHash.mockResolvedValue('upgraded-hash');

    await service.login({
      email: 'user@example.com',
      password: 'correct-password',
      device: { name: 'Browser', platform: 'web' },
    });

    expect(mockHash).toHaveBeenCalledWith('correct-password', {
      ...PASSWORD_HASH_OPTIONS,
      timeCost: 3,
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-id', passwordHash: LEGACY_HASH },
      data: { passwordHash: 'upgraded-hash' },
    });
  });

  it('并发密码修改使 rehash CAS 命中 0 行时仍正常登录', async () => {
    const { service, prisma, tokens } = loginFixture(LEGACY_HASH);
    mockVerify.mockResolvedValue(true);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await service.login({
      email: 'user@example.com',
      password: 'correct-password',
      device: { name: 'Browser', platform: 'web' },
    });

    expect(tokens.issueTokenPair).toHaveBeenCalledWith('user-id', 'device-id');
  });

  it('注册时非 email constraint 的 P2002 保持原样上抛', async () => {
    const databaseError = new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { modelName: 'User', target: ['id'] },
      },
    );
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(databaseError),
      },
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as TokenService,
    );

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'password123',
      }),
    ).rejects.toBe(databaseError);
  });

  it('guard 后用户被删除导致 me 的 P2025 → 401 access token 错误', async () => {
    const databaseError = new Prisma.PrismaClientKnownRequestError(
      'record not found',
      {
        code: 'P2025',
        clientVersion: '6.19.3',
        meta: { modelName: 'User' },
      },
    );
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockRejectedValue(databaseError) },
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as TokenService,
    );

    const error = await service.me('deleted-user').catch((caught) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: 'invalid_access_token',
    });
  });
});

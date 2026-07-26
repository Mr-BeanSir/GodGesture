import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

jest.mock('@node-rs/argon2', () => ({
  hash: jest.fn().mockResolvedValue('password-hash'),
  verify: jest.fn(),
}));

describe('AuthService', () => {
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

import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { sha256Hex } from './token.service';
import { EmailVerificationService } from './email-verification.service';

function fixture() {
  const prisma = {
    emailVerificationCode: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'code-id' }),
      delete: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const values: Record<string, unknown> = {
    NODE_ENV: 'test',
    EMAIL_CODE_TTL_SEC: 600,
    EMAIL_CODE_COOLDOWN_SEC: 60,
    EMAIL_CODE_MAX_ATTEMPTS: 5,
    SMTP_HOST: undefined,
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  };
  return {
    prisma,
    service: new EmailVerificationService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Env, true>,
    ),
  };
}

describe('EmailVerificationService', () => {
  it('creates a short-lived hashed code through the development adapter', async () => {
    const { service, prisma } = fixture();
    prisma.emailVerificationCode.findFirst.mockResolvedValue(null);

    await expect(service.issue('User@Example.com', 'register')).resolves.toEqual({
      accepted: true,
      expiresInSec: 600,
      retryAfterSec: 60,
    });
    expect(prisma.emailVerificationCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'user@example.com',
        purpose: 'register',
        codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('consumes a matching code once and rejects an invalid code', async () => {
    const { service, prisma } = fixture();
    prisma.emailVerificationCode.findFirst.mockResolvedValue({
      id: 'code-id',
      codeHash: sha256Hex('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });

    await expect(
      service.consume('user@example.com', 'resetPassword', '123456'),
    ).resolves.toBeUndefined();
    expect(prisma.emailVerificationCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-id', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });

    prisma.emailVerificationCode.updateMany.mockClear();
    await expect(
      service.consume('user@example.com', 'resetPassword', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.emailVerificationCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-id', consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
  });
});

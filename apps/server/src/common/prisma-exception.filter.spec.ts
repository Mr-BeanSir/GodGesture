import {
  ConflictException,
  HttpStatus,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  mapPrismaException,
  PrismaExceptionFilter,
} from './prisma-exception.filter';

function prismaError(
  code: string,
  meta: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('test database failure', {
    code,
    clientVersion: '6.19.3',
    meta,
  });
}

describe('PrismaExceptionFilter', () => {
  it('User.email P2002 → 409 email_taken', () => {
    const mapped = mapPrismaException(
      prismaError('P2002', { modelName: 'User', target: ['email'] }),
    );

    expect(mapped).toBeInstanceOf(ConflictException);
    expect(mapped?.getResponse()).toEqual({ error: 'email_taken' });
  });

  it('ConfigSnapshot device FK P2003 → 401 invalid_access_token', () => {
    const mapped = mapPrismaException(
      prismaError('P2003', {
        modelName: 'ConfigSnapshot',
        field_name: 'ConfigSnapshot_deviceId_fkey (index)',
      }),
    );

    expect(mapped).toBeInstanceOf(UnauthorizedException);
    expect(mapped?.getResponse()).toEqual({ error: 'invalid_access_token' });
  });

  it.each([
    prismaError('P2002', {
      modelName: 'OAuthAccount',
      target: ['provider', 'providerUserId'],
    }),
    prismaError('P2003', {
      modelName: 'OAuthAccount',
      field_name: 'OAuthAccount_userId_fkey (index)',
    }),
    prismaError('P2025', { modelName: 'ConfigSnapshot' }),
    prismaError('P2025', { modelName: 'User' }),
    prismaError('P2025', { modelName: 'Device' }),
  ])('未知 constraint/context 不做错误猜测', (error) => {
    expect(mapPrismaException(error)).toBeNull();
  });

  it('未知 Prisma 错误由 filter 返回不泄漏细节的 500', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status, json }) }),
    } as unknown as ArgumentsHost;
    const filter = new PrismaExceptionFilter();

    filter.catch(
      prismaError('P2002', {
        modelName: 'OAuthAccount',
        target: ['provider', 'providerUserId'],
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  });
});

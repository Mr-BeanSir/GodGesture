import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

type KnownRequestError = Prisma.PrismaClientKnownRequestError;

/** Narrow a caught value without treating every database failure as a client error. */
export function isPrismaError(
  error: unknown,
  code: string,
): error is KnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function metaString(error: KnownRequestError, key: string): string | null {
  const value = error.meta?.[key];
  return typeof value === 'string' ? value : null;
}

function targetFields(error: KnownRequestError): string[] {
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((field): field is string => typeof field === 'string');
  }
  return typeof target === 'string' ? [target] : [];
}

function constraintContains(
  error: KnownRequestError,
  expected: string,
): boolean {
  const constraint =
    metaString(error, 'constraint') ?? metaString(error, 'field_name');
  return constraint?.includes(expected) ?? false;
}

/**
 * Map only Prisma failures whose model/constraint identifies a stable API error.
 * Context-dependent failures (notably sync version conflicts) are handled by the
 * owning service, where the current server version can be queried after rollback.
 */
export function mapPrismaException(
  error: KnownRequestError,
): HttpException | null {
  const modelName = metaString(error, 'modelName');

  if (error.code === 'P2002') {
    const isUserEmail =
      (modelName === 'User' && targetFields(error).includes('email')) ||
      constraintContains(error, 'User_email_key');
    return isUserEmail ? new ConflictException({ error: 'email_taken' }) : null;
  }

  if (error.code === 'P2003') {
    if (
      modelName === 'ConfigSnapshot' ||
      constraintContains(error, 'ConfigSnapshot_userId_fkey') ||
      constraintContains(error, 'ConfigSnapshot_deviceId_fkey')
    ) {
      return new UnauthorizedException({ error: 'invalid_access_token' });
    }
    if (
      modelName === 'RefreshToken' ||
      constraintContains(error, 'RefreshToken_deviceId_fkey')
    ) {
      return new UnauthorizedException({ error: 'invalid_refresh_token' });
    }
    return null;
  }

  return null;
}

/** Keep known, context-free Prisma failures from leaking as generic 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: KnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = mapPrismaException(exception);
    if (mapped) {
      response.status(mapped.getStatus()).json(mapped.getResponse());
      return;
    }

    // Unknown constraints/models must remain server errors instead of being
    // guessed into a misleading public contract.
    this.logger.error(
      `Unhandled Prisma ${exception.code} (${metaString(exception, 'modelName') ?? 'unknown model'})`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}

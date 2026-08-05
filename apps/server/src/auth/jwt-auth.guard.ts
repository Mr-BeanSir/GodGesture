import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthContext {
  userId: string;
  deviceId: string;
}

export type AuthedRequest = Request & { auth?: AuthContext };

interface AccessTokenPayload {
  sub: string;
  dev: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: 'missing_access_token' });
    }
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice('Bearer '.length),
      );
    } catch {
      throw new UnauthorizedException({ error: 'invalid_access_token' });
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.dev !== 'string' ||
      !UUID_PATTERN.test(payload.sub) ||
      !UUID_PATTERN.test(payload.dev)
    ) {
      throw new UnauthorizedException({ error: 'invalid_access_token' });
    }

    // Device removal is the access-token revocation boundary. Keep this lookup
    // outside the JWT verification catch: a database outage is not an invalid
    // token and must remain visible to the global error handling/monitoring.
    const device = await this.prisma.device.findUnique({
      where: { id: payload.dev },
      select: {
        id: true,
        userId: true,
        user: { select: { disabledAt: true } },
      },
    });
    if (!device || device.userId !== payload.sub) {
      throw new UnauthorizedException({ error: 'invalid_access_token' });
    }
    if (device.user.disabledAt) {
      throw new UnauthorizedException({ error: 'account_disabled' });
    }

    req.auth = { userId: payload.sub, deviceId: device.id };
    return true;
  }
}

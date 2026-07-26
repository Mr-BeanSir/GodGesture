import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  deviceId: string;
}

export type AuthedRequest = Request & { auth?: AuthContext };

interface AccessTokenPayload {
  sub: string;
  dev: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: 'missing_access_token' });
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice('Bearer '.length),
      );
      req.auth = { userId: payload.sub, deviceId: payload.dev };
      return true;
    } catch {
      throw new UnauthorizedException({ error: 'invalid_access_token' });
    }
  }
}

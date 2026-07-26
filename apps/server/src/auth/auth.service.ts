import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  LoginRequest,
  MeResponse,
  RegisterRequest,
  TokenPairResponse,
} from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPrismaError,
  mapPrismaException,
} from '../common/prisma-exception.filter';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterRequest): Promise<MeResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException({ error: 'email_taken' });
    }
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await argon2Hash(dto.password),
        },
      });
    } catch (error) {
      // The pre-check is only a friendly fast path. The unique constraint is
      // the actual concurrency-safe email claim.
      if (isPrismaError(error, 'P2002')) {
        const mapped = mapPrismaException(error);
        if (mapped) throw mapped;
      }
      throw error;
    }
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      linkedProviders: [],
    };
  }

  async login(dto: LoginRequest): Promise<TokenPairResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    const ok = await argon2Verify(user.passwordHash, dto.password);
    if (!ok) {
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    const device = await this.prisma.device.create({
      data: {
        userId: user.id,
        name: dto.device.name,
        platform: dto.device.platform,
        lastSeenAt: new Date(),
      },
    });
    return this.tokens.issueTokenPair(user.id, device.id);
  }

  async logout(deviceId: string): Promise<void> {
    await this.tokens.revokeDeviceTokens(deviceId);
  }

  async me(userId: string): Promise<MeResponse> {
    let user;
    try {
      user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { oauthAccounts: { select: { provider: true } } },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new UnauthorizedException({ error: 'invalid_access_token' });
      }
      throw error;
    }
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      linkedProviders: user.oauthAccounts.map((a) => a.provider),
    };
  }
}

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
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await argon2Hash(dto.password),
      },
    });
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
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { oauthAccounts: { select: { provider: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      linkedProviders: user.oauthAccounts.map((a) => a.provider),
    };
  }
}

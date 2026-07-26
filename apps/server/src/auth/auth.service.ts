import {
  ConflictException,
  Injectable,
  Logger,
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
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  passwordHashUpgradeOptions,
  verifyPassword,
} from './password-hash';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
          passwordHash: await hashPassword(dto.password),
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
    let passwordMatches = false;
    try {
      passwordMatches = await verifyPassword(
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
        dto.password,
      );
    } catch (error) {
      this.logger.error('Argon2 password verification failed', error);
    }
    if (!user?.passwordHash || !passwordMatches) {
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }

    const upgradeOptions = passwordHashUpgradeOptions(user.passwordHash);
    if (upgradeOptions) {
      try {
        const upgradedHash = await hashPassword(dto.password, upgradeOptions);
        await this.prisma.user.updateMany({
          where: { id: user.id, passwordHash: user.passwordHash },
          data: { passwordHash: upgradedHash },
        });
      } catch (error) {
        // A rehash is maintenance after a successful verification. Do not lock
        // a user out during a transient write failure; the next login retries.
        this.logger.warn('Password hash upgrade failed', error);
      }
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

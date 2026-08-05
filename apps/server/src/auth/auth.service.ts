import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LoginRequest,
  MeResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RequestEmailCodeResponse,
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
import { EmailVerificationService } from './email-verification.service';
import type { Env } from '../config/env';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly emailVerification?: EmailVerificationService,
    private readonly config?: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterRequest): Promise<MeResponse> {
    if (this.emailVerification && dto.verificationCode) {
      await this.emailVerification.consume(dto.email, 'register', dto.verificationCode);
    } else if (this.emailVerification) {
      throw new BadRequestException({ error: 'verification_code_required' });
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException({ error: 'email_taken' });
    }
    let user;
    const bootstrapEmail = this.config?.get('ADMIN_BOOTSTRAP_EMAIL', { infer: true });
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await hashPassword(dto.password),
          emailVerifiedAt: new Date(),
          ...(bootstrapEmail && dto.email === bootstrapEmail.toLowerCase()
            ? { role: 'admin' as const }
            : {}),
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
      role: user.role ?? 'user',
      emailVerified: Boolean(user.emailVerifiedAt),
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
    if (user?.disabledAt) {
      throw new UnauthorizedException({ error: 'account_disabled' });
    }
    if (!user?.passwordHash || !passwordMatches) {
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    if (user.emailVerifiedAt === null) {
      throw new UnauthorizedException({ error: 'email_not_verified' });
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
      role: user.role ?? 'user',
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }

  requestRegistrationCode(email: string): Promise<RequestEmailCodeResponse> {
    if (!this.emailVerification) {
      throw new BadRequestException({ error: 'email_verification_unavailable' });
    }
    return this.emailVerification.issue(email, 'register');
  }

  async requestPasswordReset(dto: PasswordResetRequest): Promise<RequestEmailCodeResponse> {
    if (!this.emailVerification) {
      throw new BadRequestException({ error: 'email_verification_unavailable' });
    }
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { passwordHash: true, disabledAt: true },
    });
    if (!user?.passwordHash || user.disabledAt) {
      return this.emailVerification.acceptedResponse();
    }
    return this.emailVerification.issue(dto.email, 'resetPassword');
  }

  async confirmPasswordReset(dto: PasswordResetConfirmRequest): Promise<void> {
    if (!this.emailVerification) {
      throw new BadRequestException({ error: 'email_verification_unavailable' });
    }
    await this.emailVerification.consume(dto.email, 'resetPassword', dto.verificationCode);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, passwordHash: true, disabledAt: true },
    });
    if (!user?.passwordHash || user.disabledAt) {
      throw new BadRequestException({ error: 'verification_code_invalid' });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(dto.password),
        emailVerifiedAt: new Date(),
      },
    });
    await this.tokens.revokeUserTokens(user.id);
  }
}

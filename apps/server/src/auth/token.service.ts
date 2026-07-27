import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import type { TokenPairResponse } from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { isPrismaError } from '../common/prisma-exception.filter';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 合法并发轮换只在此极短窗口内降级为可重试冲突,窗口外仍按重放处理。 */
export const REFRESH_ROTATION_RACE_GRACE_MS = 5_000;

type RefreshTokenClient = Pick<Prisma.TransactionClient, 'refreshToken'>;

/**
 * 双令牌:JWT 访问令牌(15 分钟,payload {sub, dev})+
 * 不透明刷新令牌(256 位随机,存 sha256 哈希,30 天,轮换 + 按设备撤销)。
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get accessTtlSec(): number {
    return this.config.get('ACCESS_TOKEN_TTL_SEC', { infer: true });
  }

  private get refreshTtlMs(): number {
    return (
      this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000
    );
  }

  /** 登录 / OAuth 换取 / 轮换成功后签发新令牌对 */
  async issueTokenPair(
    userId: string,
    deviceId: string,
  ): Promise<TokenPairResponse> {
    return this.issueTokenPairWith(this.prisma, userId, deviceId);
  }

  private async issueTokenPairWith(
    client: RefreshTokenClient,
    userId: string,
    deviceId: string,
  ): Promise<TokenPairResponse> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, dev: deviceId },
      { expiresIn: this.accessTtlSec },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    await client.refreshToken.create({
      data: {
        deviceId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: this.accessTtlSec,
    };
  }

  /**
   * 刷新令牌轮换:旧令牌立即作废,签发新对。
   * 已作废令牌被重放 → 视为泄露,撤销该设备全部令牌。
   */
  async rotateRefreshToken(rawToken: string): Promise<TokenPairResponse> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(rawToken) },
      include: { device: true },
    });
    if (!record) {
      throw new UnauthorizedException({ error: 'invalid_refresh_token' });
    }
    if (record.revokedAt) {
      return this.handleReplay(record.deviceId, record.revokedAt);
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ error: 'refresh_token_expired' });
    }
    try {
      const pair = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        // PostgreSQL READ COMMITTED 下,与 winner 冲突时本语句会等待其提交,
        // 随后返回 count=0。后续重读必须在该事务结束后从基础 client 执行。
        const revoked = await tx.refreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: now },
        });
        if (revoked.count === 0) return null;

        await tx.device.update({
          where: { id: record.deviceId },
          data: { lastSeenAt: now },
        });
        return this.issueTokenPairWith(
          tx,
          record.device.userId,
          record.deviceId,
        );
      });
      if (pair) return pair;
    } catch (error) {
      if (isPrismaError(error, 'P2025') || isPrismaError(error, 'P2003')) {
        throw new UnauthorizedException({ error: 'invalid_refresh_token' });
      }
      throw error;
    }

    // CAS loser:winner 的提交现已对基础 client 可见。只把刚发生的作废
    // 视为合法并发；旧重放仍撤销整个 device token family。
    const current = await this.prisma.refreshToken.findUnique({
      where: { id: record.id },
      select: { deviceId: true, revokedAt: true },
    });
    if (!current?.revokedAt) {
      throw new UnauthorizedException({ error: 'invalid_refresh_token' });
    }
    return this.handleReplay(current.deviceId, current.revokedAt);
  }

  private async handleReplay(
    deviceId: string,
    revokedAt: Date,
  ): Promise<never> {
    const ageMs = Date.now() - revokedAt.getTime();
    if (ageMs >= 0 && ageMs <= REFRESH_ROTATION_RACE_GRACE_MS) {
      throw new ConflictException({ error: 'refresh_rotation_race' });
    }
    await this.revokeDeviceTokens(deviceId);
    throw new UnauthorizedException({ error: 'refresh_token_reused' });
  }

  /** 按设备撤销(登出 / Web 控制台踢下线) */
  async revokeDeviceTokens(deviceId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

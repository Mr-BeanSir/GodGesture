import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { TokenPairResponse } from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

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
    const accessToken = await this.jwt.signAsync(
      { sub: userId, dev: deviceId },
      { expiresIn: this.accessTtlSec },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
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
      await this.revokeDeviceTokens(record.deviceId);
      throw new UnauthorizedException({ error: 'refresh_token_reused' });
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ error: 'refresh_token_expired' });
    }
    // 原子作废旧令牌;并发轮换只允许一个成功
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      await this.revokeDeviceTokens(record.deviceId);
      throw new UnauthorizedException({ error: 'refresh_token_reused' });
    }
    await this.prisma.device.update({
      where: { id: record.deviceId },
      data: { lastSeenAt: new Date() },
    });
    return this.issueTokenPair(record.device.userId, record.deviceId);
  }

  /** 按设备撤销(登出 / Web 控制台踢下线) */
  async revokeDeviceTokens(deviceId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

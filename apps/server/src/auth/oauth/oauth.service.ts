import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OAuthExchangeRequest,
  OAuthProvider,
  TokenPairResponse,
} from '@godgesture/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../token.service';
import type { Env } from '../../config/env';
import { OAuthProviderRegistry } from './provider.registry';
import { OneTimeStore } from './one-time-store';
import type { OAuthIdentity } from './provider.interface';

interface PendingAuthorization {
  provider: OAuthProvider;
  /** 客户端(桌面回环 / Web 控制台)的最终回跳地址 */
  redirectUri: string;
  /** 客户端自带的 state,原样带回 */
  clientState: string | null;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/**
 * 桌面回环(RFC 8252)+ Web 的授权码流:
 * authorize → 302 提供方 → callback 换身份、发一次性授权码回跳 →
 * 客户端 POST exchange 换令牌对。
 */
@Injectable()
export class OAuthService {
  /** 跳转提供方前登记的会话(键即发给提供方的 state) */
  private readonly pendingStates = new OneTimeStore<PendingAuthorization>(
    STATE_TTL_MS,
  );
  /** 一次性授权码 → userId(5 分钟 TTL,用后即焚) */
  private readonly authCodes = new OneTimeStore<string>(AUTH_CODE_TTL_MS);

  constructor(
    private readonly registry: OAuthProviderRegistry,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private callbackUrl(provider: OAuthProvider): string {
    const base = this.config
      .get('PUBLIC_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    return `${base}/api/v1/auth/oauth/${provider}/callback`;
  }

  /** redirect_uri 白名单:仅回环地址(RFC 8252)或已配置的 Web 控制台源 */
  private assertRedirectUriAllowed(redirectUri: string): void {
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new BadRequestException({ error: 'invalid_redirect_uri' });
    }
    const isLoopback =
      url.protocol === 'http:' && url.hostname === '127.0.0.1';
    const webOrigin = this.config.get('WEB_CONSOLE_ORIGIN', { infer: true });
    const isWebConsole = webOrigin != null && url.origin === webOrigin;
    if (!isLoopback && !isWebConsole) {
      throw new BadRequestException({
        error: 'redirect_uri_not_allowed',
        message:
          'redirect_uri 仅允许 http://127.0.0.1:<port>/*(桌面回环)或已配置的 Web 控制台源',
      });
    }
  }

  /** GET /auth/oauth/:provider/authorize → 提供方授权页 URL */
  buildAuthorizeRedirect(
    providerName: string,
    redirectUri: string | undefined,
    clientState: string | undefined,
  ): string {
    const plugin = this.registry.resolveEnabled(providerName);
    if (!redirectUri) {
      throw new BadRequestException({ error: 'missing_redirect_uri' });
    }
    this.assertRedirectUriAllowed(redirectUri);
    const state = this.pendingStates.put({
      provider: plugin.name,
      redirectUri,
      clientState: clientState ?? null,
    });
    return plugin.buildAuthorizeUrl(this.callbackUrl(plugin.name), state);
  }

  /** GET /auth/oauth/:provider/callback → 客户端回跳 URL(带一次性授权码) */
  async handleCallback(
    providerName: string,
    code: string | undefined,
    state: string | undefined,
  ): Promise<string> {
    const plugin = this.registry.resolveEnabled(providerName);
    if (!code || !state) {
      throw new BadRequestException({ error: 'missing_code_or_state' });
    }
    const pending = this.pendingStates.consume(state);
    if (!pending || pending.provider !== plugin.name) {
      throw new BadRequestException({ error: 'invalid_or_expired_state' });
    }
    const identity = await plugin.fetchIdentity(
      code,
      this.callbackUrl(plugin.name),
    );
    const userId = await this.upsertOAuthUser(plugin.name, identity);
    const authCode = this.authCodes.put(userId);
    const target = new URL(pending.redirectUri);
    target.searchParams.set('code', authCode);
    if (pending.clientState != null) {
      target.searchParams.set('state', pending.clientState);
    }
    return target.toString();
  }

  /** POST /auth/oauth/exchange → 令牌对 */
  async exchange(dto: OAuthExchangeRequest): Promise<TokenPairResponse> {
    const userId = this.authCodes.consume(dto.code);
    if (!userId) {
      throw new BadRequestException({ error: 'invalid_or_expired_auth_code' });
    }
    const device = await this.prisma.device.create({
      data: {
        userId,
        name: dto.device.name,
        platform: dto.device.platform,
        lastSeenAt: new Date(),
      },
    });
    return this.tokens.issueTokenPair(userId, device.id);
  }

  /**
   * OAuthAccount upsert:
   * 已绑定 → 直接登录;未绑定但邮箱可信且已注册 → 关联既有账户;否则新建用户。
   */
  private async upsertOAuthUser(
    provider: OAuthProvider,
    identity: OAuthIdentity,
  ): Promise<string> {
    const existing = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId: identity.providerUserId,
        },
      },
    });
    if (existing) return existing.userId;

    let userId: string | null = null;
    if (identity.email) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email: identity.email },
      });
      if (byEmail?.passwordHash) {
        // 不按邮箱自动关联到"本地密码账户"。
        //
        // register 不做任何邮箱验证,所以密码账户上的邮箱从未被证明属于注册者:
        // 攻击者先用受害者的邮箱注册一个账户,受害者之后用 OAuth 登录同一邮箱时,
        // 就会被并进攻击者的账户 —— 而同步文档里带 Cmd / Script 命令
        // (packages/shared/src/config/gestures.ts),接管账户会进一步升级成
        // 在受害者机器上执行任意命令。宁可让登录失败,也不能自动合并。
        //
        // 显式关联(登录后在设置里绑定 provider)属于后续里程碑;在那之前,
        // 用户仍可用密码正常登录。
        throw new ConflictException({ error: 'oauth_email_conflict' });
      }
      // 纯 OAuth 账户(无密码)之间仍按邮箱合并:这类账户的邮箱来自 provider 断言,
      // 而非用户自称。
      if (byEmail) userId = byEmail.id;
    }
    if (!userId) {
      const user = await this.prisma.user.create({
        data: { email: identity.email ?? null },
      });
      userId = user.id;
    }
    await this.prisma.oAuthAccount.create({
      data: {
        provider,
        providerUserId: identity.providerUserId,
        userId,
      },
    });
    return userId;
  }
}

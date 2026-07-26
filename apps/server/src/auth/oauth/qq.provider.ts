import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { OAuthIdentity, OAuthProviderPlugin } from './provider.interface';

interface QqTokenResponse {
  access_token?: string;
  error?: number;
  error_description?: string;
}

interface QqMeResponse {
  openid?: string;
  unionid?: string;
  error?: number;
  error_description?: string;
}

/**
 * QQ 互联登录。留配置位:
 * 需 OAUTH_QQ_ENABLED=true 且配置 AppID/AppKey 才启用。
 */
@Injectable()
export class QqOAuthProvider implements OAuthProviderPlugin {
  readonly name = 'qq' as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get appId(): string | undefined {
    return this.config.get('OAUTH_QQ_APP_ID', { infer: true });
  }

  private get appSecret(): string | undefined {
    return this.config.get('OAUTH_QQ_APP_SECRET', { infer: true });
  }

  isEnabled(): boolean {
    return Boolean(
      this.config.get('OAUTH_QQ_ENABLED', { infer: true }) &&
        this.appId &&
        this.appSecret,
    );
  }

  buildAuthorizeUrl(callbackUrl: string, state: string): string {
    const url = new URL('https://graph.qq.com/oauth2.0/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.appId!);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async fetchIdentity(
    code: string,
    callbackUrl: string,
  ): Promise<OAuthIdentity> {
    const tokenUrl = new URL('https://graph.qq.com/oauth2.0/token');
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('client_id', this.appId!);
    tokenUrl.searchParams.set('client_secret', this.appSecret!);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('redirect_uri', callbackUrl);
    tokenUrl.searchParams.set('fmt', 'json');
    const tokenRes = await fetch(tokenUrl);
    const token = (await tokenRes.json()) as QqTokenResponse;
    if (!tokenRes.ok || !token.access_token) {
      throw new BadGatewayException({
        error: 'oauth_token_exchange_failed',
        provider: this.name,
        detail: token.error_description,
      });
    }
    const meUrl = new URL('https://graph.qq.com/oauth2.0/me');
    meUrl.searchParams.set('access_token', token.access_token);
    meUrl.searchParams.set('fmt', 'json');
    const meRes = await fetch(meUrl);
    const me = (await meRes.json()) as QqMeResponse;
    if (!meRes.ok || !me.openid) {
      throw new BadGatewayException({
        error: 'oauth_userinfo_failed',
        provider: this.name,
        detail: me.error_description,
      });
    }
    return { providerUserId: me.unionid ?? me.openid, email: null };
  }
}

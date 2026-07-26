import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { OAuthIdentity, OAuthProviderPlugin } from './provider.interface';

interface WechatTokenResponse {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信扫码登录(开放平台网站应用)。留配置位:
 * 需 OAUTH_WECHAT_ENABLED=true 且配置 AppID/AppSecret 才启用。
 */
@Injectable()
export class WechatOAuthProvider implements OAuthProviderPlugin {
  readonly name = 'wechat' as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get appId(): string | undefined {
    return this.config.get('OAUTH_WECHAT_APP_ID', { infer: true });
  }

  private get appSecret(): string | undefined {
    return this.config.get('OAUTH_WECHAT_APP_SECRET', { infer: true });
  }

  isEnabled(): boolean {
    return Boolean(
      this.config.get('OAUTH_WECHAT_ENABLED', { infer: true }) &&
        this.appId &&
        this.appSecret,
    );
  }

  buildAuthorizeUrl(callbackUrl: string, state: string): string {
    const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
    url.searchParams.set('appid', this.appId!);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_login');
    url.searchParams.set('state', state);
    return `${url.toString()}#wechat_redirect`;
  }

  async fetchIdentity(code: string): Promise<OAuthIdentity> {
    const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    url.searchParams.set('appid', this.appId!);
    url.searchParams.set('secret', this.appSecret!);
    url.searchParams.set('code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const res = await fetch(url);
    const data = (await res.json()) as WechatTokenResponse;
    if (!res.ok || data.errcode || !data.openid) {
      throw new BadGatewayException({
        error: 'oauth_token_exchange_failed',
        provider: this.name,
        detail: data.errmsg,
      });
    }
    // 优先 unionid(同一开放平台账号下跨应用稳定)
    return { providerUserId: data.unionid ?? data.openid, email: null };
  }
}

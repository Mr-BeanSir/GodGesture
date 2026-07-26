import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { OAuthProvider } from '@godgesture/shared';
import type { OAuthProviderPlugin } from './provider.interface';
import { GithubOAuthProvider } from './github.provider';
import { GoogleOAuthProvider } from './google.provider';
import { WechatOAuthProvider } from './wechat.provider';
import { QqOAuthProvider } from './qq.provider';

/** 可插拔提供方注册表:github/google 先行,wechat/qq 注册但默认停用 */
@Injectable()
export class OAuthProviderRegistry {
  private readonly providers: ReadonlyMap<OAuthProvider, OAuthProviderPlugin>;

  constructor(
    github: GithubOAuthProvider,
    google: GoogleOAuthProvider,
    wechat: WechatOAuthProvider,
    qq: QqOAuthProvider,
  ) {
    this.providers = new Map<OAuthProvider, OAuthProviderPlugin>([
      [github.name, github],
      [google.name, google],
      [wechat.name, wechat],
      [qq.name, qq],
    ]);
  }

  /** 解析并校验提供方:未知 → 404,未启用 → 501 */
  resolveEnabled(name: string): OAuthProviderPlugin {
    const parsed = OAuthProvider.safeParse(name);
    if (!parsed.success) {
      throw new NotFoundException({ error: 'unknown_oauth_provider' });
    }
    const plugin = this.providers.get(parsed.data)!;
    if (!plugin.isEnabled()) {
      throw new NotImplementedException({
        error: 'oauth_provider_disabled',
        message:
          `OAuth 提供方 "${parsed.data}" 未启用:请在服务端环境变量中配置 ` +
          `对应的客户端凭证(微信/QQ 另需 OAUTH_*_ENABLED=true),详见 .env.example。`,
      });
    }
    return plugin;
  }
}

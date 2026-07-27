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

  listEnabled(): OAuthProvider[] {
    return [...this.providers.values()]
      .filter((provider) => provider.isEnabled())
      .map((provider) => provider.name);
  }

  /** 仅校验 provider 名称与注册关系；callback 用它恢复已建立会话。 */
  resolveKnown(name: string): OAuthProviderPlugin {
    const parsed = OAuthProvider.safeParse(name);
    if (!parsed.success) {
      throw new NotFoundException({ error: 'unknown_oauth_provider' });
    }
    return this.providers.get(parsed.data)!;
  }

  /** 解析并校验提供方:未知 → 404,未启用 → 501 */
  resolveEnabled(name: string): OAuthProviderPlugin {
    const plugin = this.resolveKnown(name);
    if (!plugin.isEnabled()) {
      throw new NotImplementedException({
        error: 'oauth_provider_disabled',
        message:
          `OAuth 提供方 "${plugin.name}" 未启用:请在服务端环境变量中配置 ` +
          `对应的客户端凭证(微信/QQ 另需 OAUTH_*_ENABLED=true),详见 .env.example。`,
      });
    }
    return plugin;
  }
}

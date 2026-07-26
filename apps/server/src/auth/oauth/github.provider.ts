import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { OAuthIdentity, OAuthProviderPlugin } from './provider.interface';

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUser {
  id: number;
  email: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class GithubOAuthProvider implements OAuthProviderPlugin {
  readonly name = 'github' as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get clientId(): string | undefined {
    return this.config.get('OAUTH_GITHUB_CLIENT_ID', { infer: true });
  }

  private get clientSecret(): string | undefined {
    return this.config.get('OAUTH_GITHUB_CLIENT_SECRET', { infer: true });
  }

  isEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  buildAuthorizeUrl(callbackUrl: string, state: string): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'read:user user:email');
    return url.toString();
  }

  async fetchIdentity(
    code: string,
    callbackUrl: string,
  ): Promise<OAuthIdentity> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });
    const token = (await tokenRes.json()) as GithubTokenResponse;
    if (!tokenRes.ok || !token.access_token) {
      throw new BadGatewayException({
        error: 'oauth_token_exchange_failed',
        provider: this.name,
        detail: token.error_description ?? token.error,
      });
    }
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'GodGesture-Server',
    };
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) {
      throw new BadGatewayException({
        error: 'oauth_userinfo_failed',
        provider: this.name,
      });
    }
    const user = (await userRes.json()) as GithubUser;
    let email = user.email;
    if (!email) {
      // 公开邮箱为空时,读私有邮箱列表取已验证的主邮箱
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers,
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as GithubEmail[];
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails.find((e) => e.verified)?.email ??
          null;
      }
    }
    return { providerUserId: String(user.id), email };
  }
}

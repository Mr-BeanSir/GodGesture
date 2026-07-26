import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { OAuthIdentity, OAuthProviderPlugin } from './provider.interface';

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

@Injectable()
export class GoogleOAuthProvider implements OAuthProviderPlugin {
  readonly name = 'google' as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get clientId(): string | undefined {
    return this.config.get('OAUTH_GOOGLE_CLIENT_ID', { infer: true });
  }

  private get clientSecret(): string | undefined {
    return this.config.get('OAUTH_GOOGLE_CLIENT_SECRET', { infer: true });
  }

  isEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  buildAuthorizeUrl(callbackUrl: string, state: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async fetchIdentity(
    code: string,
    callbackUrl: string,
  ): Promise<OAuthIdentity> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId!,
        client_secret: this.clientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      }),
    });
    const token = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenRes.ok || !token.access_token) {
      throw new BadGatewayException({
        error: 'oauth_token_exchange_failed',
        provider: this.name,
        detail: token.error_description ?? token.error,
      });
    }
    const userRes = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    if (!userRes.ok) {
      throw new BadGatewayException({
        error: 'oauth_userinfo_failed',
        provider: this.name,
      });
    }
    const info = (await userRes.json()) as GoogleUserInfo;
    return {
      providerUserId: info.sub,
      email: info.email_verified && info.email ? info.email : null,
    };
  }
}

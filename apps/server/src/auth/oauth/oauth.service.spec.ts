import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { OAuthProvider } from '@godgesture/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env';
import type { TokenService } from '../token.service';
import { OAuthService } from './oauth.service';
import type { OAuthIdentity } from './provider.interface';
import type { OAuthProviderRegistry } from './provider.registry';

// OAuthService only needs the registry for authorize/callback flows. Isolate it
// here so this account-matching unit test does not pull shared's ESM build into
// the server's CommonJS Jest runtime.
jest.mock('./provider.registry', () => ({ OAuthProviderRegistry: class {} }));

describe('OAuthService account matching', () => {
  let prisma: {
    oAuthAccount: { findUnique: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock; create: jest.Mock };
  };
  let service: OAuthService;

  const identity: OAuthIdentity = {
    providerUserId: 'github-user-1',
    email: 'user@example.com',
  };

  const upsert = (candidate: OAuthIdentity = identity) =>
    (
      service as unknown as {
        upsertOAuthUser(
          provider: OAuthProvider,
          identity: OAuthIdentity,
        ): Promise<string>;
      }
    ).upsertOAuthUser('github', candidate);

  beforeEach(() => {
    prisma = {
      oAuthAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    service = new OAuthService(
      {} as OAuthProviderRegistry,
      prisma as unknown as PrismaService,
      {} as TokenService,
      {} as ConfigService<Env, true>,
    );
  });

  it('password account with the same email returns 409 and creates no OAuthAccount', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'password-user',
      passwordHash: 'argon2-hash',
    });

    const error = await upsert().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      error: 'oauth_email_conflict',
    });
    expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('existing provider identity returns its original user', async () => {
    prisma.oAuthAccount.findUnique.mockResolvedValue({
      userId: 'linked-user',
    });

    await expect(upsert()).resolves.toBe('linked-user');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
  });

  it('pure OAuth account with the same provider-asserted email is merged', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'oauth-user',
      passwordHash: null,
    });

    await expect(upsert()).resolves.toBe('oauth-user');
    expect(prisma.oAuthAccount.create).toHaveBeenCalledWith({
      data: {
        provider: 'github',
        providerUserId: identity.providerUserId,
        userId: 'oauth-user',
      },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('unmatched identity creates a new OAuth user and account', async () => {
    prisma.user.create.mockResolvedValue({ id: 'new-user' });

    await expect(upsert()).resolves.toBe('new-user');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: identity.email },
    });
    expect(prisma.oAuthAccount.create).toHaveBeenCalledWith({
      data: {
        provider: 'github',
        providerUserId: identity.providerUserId,
        userId: 'new-user',
      },
    });
  });
});

describe('OAuthService PKCE and loopback redirect validation', () => {
  const verifier =
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const tokenPair = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresIn: 900,
  };

  let providerState: string;
  let plugin: {
    name: 'github';
    buildAuthorizeUrl: jest.Mock;
    fetchIdentity: jest.Mock;
  };
  let registry: { resolveEnabled: jest.Mock };
  let prisma: {
    oAuthAccount: { findUnique: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock; create: jest.Mock };
    device: { create: jest.Mock };
  };
  let tokens: { issueTokenPair: jest.Mock };
  let service: OAuthService;

  beforeEach(() => {
    providerState = '';
    plugin = {
      name: 'github',
      buildAuthorizeUrl: jest.fn((_callbackUrl: string, state: string) => {
        providerState = state;
        return `https://github.example/authorize?state=${state}`;
      }),
      fetchIdentity: jest.fn().mockResolvedValue({
        providerUserId: 'github-user',
        email: 'user@example.com',
      }),
    };
    registry = { resolveEnabled: jest.fn().mockReturnValue(plugin) };
    prisma = {
      oAuthAccount: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }),
        create: jest.fn(),
      },
      user: { findUnique: jest.fn(), create: jest.fn() },
      device: {
        create: jest.fn().mockResolvedValue({ id: 'device-1' }),
      },
    };
    tokens = { issueTokenPair: jest.fn().mockResolvedValue(tokenPair) };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'PUBLIC_BASE_URL') return 'https://api.example.com';
        if (key === 'WEB_CONSOLE_ORIGIN') return 'https://console.example.com';
        return undefined;
      }),
    };
    service = new OAuthService(
      registry as unknown as OAuthProviderRegistry,
      prisma as unknown as PrismaService,
      tokens as unknown as TokenService,
      config as unknown as ConfigService<Env, true>,
    );
  });

  function begin(redirectUri = 'http://127.0.0.1:49152/oauth/callback') {
    return service.buildAuthorizeRedirect(
      'github',
      redirectUri,
      'client-state',
      challenge,
      'S256',
    );
  }

  async function complete(): Promise<string> {
    begin();
    const target = await service.handleCallback(
      'github',
      'provider-code',
      providerState,
    );
    return new URL(target).searchParams.get('code')!;
  }

  it('requires S256 and a canonical 43-character challenge', () => {
    expect(() =>
      service.buildAuthorizeRedirect(
        'github',
        'http://127.0.0.1:49152/callback',
        'state',
        challenge,
        'plain',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.buildAuthorizeRedirect(
        'github',
        'http://127.0.0.1:49152/callback',
        'state',
        'A'.repeat(42),
        'S256',
      ),
    ).toThrow(BadRequestException);
    expect(plugin.buildAuthorizeUrl).not.toHaveBeenCalled();
  });

  it('keeps dynamic loopback ports but rejects credentials and fragments', () => {
    expect(begin('http://127.0.0.1:54321/arbitrary/path')).toContain(
      'https://github.example/authorize',
    );
    expect(() =>
      begin('http://user:password@127.0.0.1:54321/callback'),
    ).toThrow(BadRequestException);
    expect(() =>
      begin('http://127.0.0.1:54321/callback#fragment'),
    ).toThrow(BadRequestException);
  });

  it('binds the authorization code to the S256 verifier', async () => {
    const code = await complete();

    await expect(
      service.exchange({
        code,
        codeVerifier: verifier,
        device: { name: 'Browser', platform: 'web' },
      }),
    ).resolves.toEqual(tokenPair);
    expect(prisma.device.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        name: 'Browser',
        platform: 'web',
        lastSeenAt: expect.any(Date),
      },
    });
    expect(tokens.issueTokenPair).toHaveBeenCalledWith('user-1', 'device-1');
  });

  it('burns the authorization code after a wrong verifier', async () => {
    const code = await complete();
    const wrongVerifier = 'x'.repeat(43);

    const firstError = await service
      .exchange({
        code,
        codeVerifier: wrongVerifier,
        device: { name: 'Browser', platform: 'web' },
      })
      .catch((reason: unknown) => reason);
    expect(firstError).toBeInstanceOf(BadRequestException);
    expect((firstError as BadRequestException).getResponse()).toEqual({
      error: 'invalid_code_verifier',
    });

    const secondError = await service
      .exchange({
        code,
        codeVerifier: verifier,
        device: { name: 'Browser', platform: 'web' },
      })
      .catch((reason: unknown) => reason);
    expect(secondError).toBeInstanceOf(BadRequestException);
    expect((secondError as BadRequestException).getResponse()).toEqual({
      error: 'invalid_or_expired_auth_code',
    });
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(tokens.issueTokenPair).not.toHaveBeenCalled();
  });
});

import { ConflictException } from '@nestjs/common';
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

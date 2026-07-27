import {
  OAuthCodeVerifier,
  oauthChallengeFromSha256Digest,
  oauthVerifierFromRandomBytes,
} from "@godgesture/shared";

export const OAUTH_PKCE_SESSION_KEY = "godgesture.oauthPkce";

export interface OAuthPkceSession {
  state: string;
  verifier: string;
}

export async function createOAuthPkce(): Promise<{
  session: OAuthPkceSession;
  challenge: string;
}> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = oauthVerifierFromRandomBytes(random);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return {
    session: { state: crypto.randomUUID(), verifier },
    challenge: oauthChallengeFromSha256Digest(new Uint8Array(digest)),
  };
}

export function saveOAuthPkceSession(
  storage: Storage,
  session: OAuthPkceSession,
): void {
  storage.setItem(OAUTH_PKCE_SESSION_KEY, JSON.stringify(session));
}

/** 读取即删除；回调无论成功或失败都不能复用同一 verifier/state。 */
export function consumeOAuthPkceSession(
  storage: Storage,
): OAuthPkceSession | null {
  const raw = storage.getItem(OAUTH_PKCE_SESSION_KEY);
  storage.removeItem(OAUTH_PKCE_SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { state, verifier } = value as Record<string, unknown>;
    if (typeof state !== "string" || state.length === 0) return null;
    const parsedVerifier = OAuthCodeVerifier.safeParse(verifier);
    if (!parsedVerifier.success) return null;
    return { state, verifier: parsedVerifier.data };
  } catch {
    return null;
  }
}

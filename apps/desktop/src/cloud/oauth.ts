import {
  OAuthCallbackErrorCode,
  OAuthCodeChallenge,
  OAuthCodeVerifier,
  encodeBase64Url,
  oauthChallengeFromSha256Digest,
  oauthVerifierFromRandomBytes,
  type OAuthCallbackErrorCode as OAuthCallbackError,
  type OAuthCodeChallenge as OAuthChallenge,
  type OAuthCodeVerifier as OAuthVerifier,
} from "@godgesture/shared";
import type { OAuthLoopbackResult } from "../api/backend";
import { CloudError } from "./errors";

export interface OAuthPkceAttempt {
  state: string;
  verifier: OAuthVerifier;
  challenge: OAuthChallenge;
}

export interface OAuthCallbackCode {
  code: string;
  error: null;
}

export interface OAuthCallbackFailure {
  code: null;
  error: OAuthCallbackError;
}

export async function createOAuthPkceAttempt(
  cryptoApi: Crypto = globalThis.crypto,
): Promise<OAuthPkceAttempt> {
  const verifierBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const stateBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const verifier = oauthVerifierFromRandomBytes(verifierBytes);
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return {
    state: encodeBase64Url(stateBytes),
    verifier: OAuthCodeVerifier.parse(verifier),
    challenge: OAuthCodeChallenge.parse(
      oauthChallengeFromSha256Digest(new Uint8Array(digest)),
    ),
  };
}

export function parseOAuthLoopbackResult(
  result: OAuthLoopbackResult,
): OAuthCallbackCode | OAuthCallbackFailure {
  if (
    typeof result.code === "string" &&
    result.code.length > 0 &&
    result.error === null
  ) {
    return { code: result.code, error: null };
  }
  const parsedError = OAuthCallbackErrorCode.safeParse(result.error);
  if (result.code === null && parsedError.success) {
    return { code: null, error: parsedError.data };
  }
  throw new CloudError(0, "invalid_oauth_callback");
}

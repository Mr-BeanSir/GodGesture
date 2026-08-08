import { describe, expect, it } from "vitest";
import {
  LoginRequest,
  OAuthCodeChallenge,
  OAuthCodeChallengeMethod,
  OAuthCodeVerifier,
  OAuthCallbackErrorCode,
  OAuthEmailConflictResponse,
  OAuthExchangeRequest,
  OAuthPendingBindingCompleteRequest,
  OAuthPendingBindingEmailCodeRequest,
  OAuthProvidersResponse,
  RateLimitedResponse,
  RefreshRotationRaceResponse,
  RenameDeviceRequest,
} from "../protocol.js";

const deviceNameSchemas = [
  {
    request: "LoginRequest.device.name",
    parse: (name: string) =>
      LoginRequest.parse({
        email: "user@example.com",
        password: "password",
        device: { name, platform: "windows" },
      }).device.name,
  },
  {
    request: "OAuthExchangeRequest.device.name",
    parse: (name: string) =>
      OAuthExchangeRequest.parse({
        code: "one-time-code",
        codeVerifier: "v".repeat(43),
        device: { name, platform: "macos" },
      }).device.name,
  },
  {
    request: "RenameDeviceRequest.name",
    parse: (name: string) => RenameDeviceRequest.parse({ name }).name,
  },
] as const;

describe.each(deviceNameSchemas)("$request", ({ parse }) => {
  it("trims leading and trailing whitespace", () => {
    expect(parse("  Work laptop\t")).toBe("Work laptop");
  });

  it("rejects an all-whitespace name", () => {
    expect(() => parse(" \t\n ")).toThrow();
  });

  it("accepts exactly 64 characters after trimming", () => {
    const name = "a".repeat(64);
    expect(parse(`  ${name}\t`)).toBe(name);
  });

  it("rejects more than 64 characters after trimming", () => {
    expect(() => parse(`  ${"a".repeat(65)}\t`)).toThrow();
  });
});

describe("OAuth PKCE contract", () => {
  it("accepts verifier boundaries and RFC 7636 unreserved characters", () => {
    expect(OAuthCodeVerifier.parse("A".repeat(43))).toHaveLength(43);
    expect(
      OAuthCodeVerifier.parse(`${"A".repeat(124)}-._~`),
    ).toHaveLength(128);
  });

  it("rejects verifier length violations and non-ASCII characters", () => {
    expect(() => OAuthCodeVerifier.parse("A".repeat(42))).toThrow();
    expect(() => OAuthCodeVerifier.parse("A".repeat(129))).toThrow();
    expect(() => OAuthCodeVerifier.parse(`${"A".repeat(42)}+`)).toThrow();
    expect(() => OAuthCodeVerifier.parse(`${"A".repeat(42)}中`)).toThrow();
  });

  it("accepts only a 43-character base64url S256 challenge", () => {
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(OAuthCodeChallenge.parse(challenge)).toBe(challenge);
    expect(OAuthCodeChallengeMethod.parse("S256")).toBe("S256");
    expect(() => OAuthCodeChallenge.parse(`${"A".repeat(42)}=`)).toThrow();
    expect(() => OAuthCodeChallengeMethod.parse("plain")).toThrow();
  });

  it("requires a verifier when exchanging an OAuth authorization code", () => {
    expect(() =>
      OAuthExchangeRequest.parse({
        code: "one-time-code",
        device: { name: "Browser", platform: "web" },
      }),
    ).toThrow();
  });

  it("requires a normalized email, six-digit code, PKCE verifier, and device for pending OAuth binding", () => {
    expect(OAuthPendingBindingEmailCodeRequest.parse({ email: " USER@example.com " })).toEqual({ email: "user@example.com" });
    expect(OAuthPendingBindingCompleteRequest.parse({
      email: "USER@example.com", verificationCode: "123456", codeVerifier: "v".repeat(43),
      device: { name: "Desktop", platform: "windows" },
    }).email).toBe("user@example.com");
    expect(() => OAuthPendingBindingCompleteRequest.parse({
      email: "user@example.com", verificationCode: "invalid", codeVerifier: "v".repeat(43),
      device: { name: "Desktop", platform: "windows" },
    })).toThrow();
  });
});

describe("OAuth discovery and callback contract", () => {
  it("publishes only canonical enabled provider names", () => {
    expect(
      OAuthProvidersResponse.parse({ providers: ["github", "google"] }),
    ).toEqual({ providers: ["github", "google"] });
    expect(() =>
      OAuthProvidersResponse.parse({ providers: ["unknown"] }),
    ).toThrow();
  });

  it("restricts callback redirects to normalized error codes", () => {
    expect(OAuthCallbackErrorCode.parse("oauth_access_denied")).toBe(
      "oauth_access_denied",
    );
    expect(() => OAuthCallbackErrorCode.parse("provider_raw_error")).toThrow();
  });
});

describe("RefreshRotationRaceResponse", () => {
  it("accepts only the retryable concurrent rotation code", () => {
    expect(
      RefreshRotationRaceResponse.parse({ error: "refresh_rotation_race" }),
    ).toEqual({ error: "refresh_rotation_race" });
    expect(() =>
      RefreshRotationRaceResponse.parse({ error: "refresh_token_reused" }),
    ).toThrow();
  });
});

describe("OAuthEmailConflictResponse", () => {
  it("accepts only the locked OAuth/password email conflict code", () => {
    expect(
      OAuthEmailConflictResponse.parse({ error: "oauth_email_conflict" }),
    ).toEqual({ error: "oauth_email_conflict" });
    expect(() =>
      OAuthEmailConflictResponse.parse({ error: "email_taken" }),
    ).toThrow();
  });
});

describe("RateLimitedResponse", () => {
  it("accepts only the rate limit error code", () => {
    expect(RateLimitedResponse.parse({ error: "rate_limited" })).toEqual({
      error: "rate_limited",
    });
    expect(() => RateLimitedResponse.parse({ error: "network" })).toThrow();
  });
});

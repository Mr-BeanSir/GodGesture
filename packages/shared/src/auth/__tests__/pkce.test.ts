import { describe, expect, it } from "vitest";
import {
  encodeBase64Url,
  oauthChallengeFromSha256Digest,
  oauthVerifierFromRandomBytes,
} from "../pkce.js";

describe("OAuth PKCE pure helpers", () => {
  it("encodes base64url without padding", () => {
    expect(encodeBase64Url(new Uint8Array([]))).toBe("");
    expect(encodeBase64Url(new Uint8Array([0xff]))).toBe("_w");
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff, 0xff]))).toBe("-___");
  });

  it("turns exactly 32 random bytes into a 43-character verifier", () => {
    expect(oauthVerifierFromRandomBytes(new Uint8Array(32))).toBe(
      "A".repeat(43),
    );
    expect(() => oauthVerifierFromRandomBytes(new Uint8Array(31))).toThrow(
      RangeError,
    );
  });

  it("matches the RFC 7636 S256 example challenge", () => {
    const digest = new Uint8Array([
      19, 211, 30, 150, 26, 26, 216, 236, 47, 22, 177, 12, 76, 152, 46,
      8, 118, 168, 120, 173, 109, 241, 68, 86, 110, 225, 137, 74, 203,
      112, 249, 195,
    ]);
    expect(oauthChallengeFromSha256Digest(digest)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(() => oauthChallengeFromSha256Digest(new Uint8Array(20))).toThrow(
      RangeError,
    );
  });
});

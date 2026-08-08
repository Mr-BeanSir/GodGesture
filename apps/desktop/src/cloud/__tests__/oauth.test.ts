import { describe, expect, it } from "vitest";
import { createOAuthPkceAttempt, parseOAuthLoopbackResult } from "../oauth";

describe("desktop OAuth helpers", () => {
  it("creates bounded PKCE and state values from independent random bytes", async () => {
    let call = 0;
    const cryptoApi = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        call += 1;
        const bytes = array as Uint8Array;
        bytes.fill(call === 1 ? 1 : 2);
        return array;
      },
      subtle: crypto.subtle,
    } as Crypto;

    const attempt = await createOAuthPkceAttempt(cryptoApi);

    expect(attempt.verifier).toHaveLength(43);
    expect(attempt.challenge).toHaveLength(43);
    expect(attempt.state).toHaveLength(43);
    expect(attempt.state).not.toBe(attempt.verifier);
    expect(attempt.challenge).not.toBe(attempt.verifier);
  });

  it("accepts exactly one code, pending binding, or normalized callback error", () => {
    expect(
      parseOAuthLoopbackResult({ code: "one-time-code", pendingOAuth: null, error: null }),
    ).toEqual({
      code: "one-time-code",
      pendingOAuth: null,
      error: null,
    });
    expect(
      parseOAuthLoopbackResult({ code: null, pendingOAuth: null, error: "oauth_access_denied" }),
    ).toEqual({ code: null, pendingOAuth: null, error: "oauth_access_denied" });
    expect(
      parseOAuthLoopbackResult({ code: null, pendingOAuth: "binding-id", error: null }),
    ).toEqual({ code: null, pendingOAuth: "binding-id", error: null });
    expect(() =>
      parseOAuthLoopbackResult({
        code: "code",
        pendingOAuth: null,
        error: "oauth_callback_failed",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_oauth_callback" }));
    expect(() =>
      parseOAuthLoopbackResult({ code: null, pendingOAuth: null, error: "provider_raw_error" }),
    ).toThrow();
  });
});

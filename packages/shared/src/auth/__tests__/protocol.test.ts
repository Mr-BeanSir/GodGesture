import { describe, expect, it } from "vitest";
import {
  LoginRequest,
  OAuthEmailConflictResponse,
  OAuthExchangeRequest,
  RateLimitedResponse,
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

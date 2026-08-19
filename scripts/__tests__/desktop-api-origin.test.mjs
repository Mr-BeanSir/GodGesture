import assert from "node:assert/strict";
import test from "node:test";
import { validateDesktopApiOrigin } from "../desktop-api-origin.mjs";

test("normalizes valid HTTPS origins", () => {
  assert.equal(
    validateDesktopApiOrigin("  https://api.example.com  "),
    "https://api.example.com",
  );
  assert.equal(
    validateDesktopApiOrigin("https://api.example.com/"),
    "https://api.example.com",
  );
});

test("rejects missing or malformed API origins", () => {
  for (const value of [
    undefined,
    "",
    "   ",
    "api.example.com",
    "https://",
    "http://api.example.com",
    "ftp://api.example.com",
    "https://user:password@api.example.com",
    "https://api.example.com/v1",
    "https://api.example.com?region=cn",
    "https://api.example.com#section",
    "https://api.example.com?",
    "https://api.example.com#",
  ]) {
    assert.throws(
      () => validateDesktopApiOrigin(value),
      /GODGESTURE_API must be a valid HTTPS origin/,
      `expected ${String(value)} to be rejected`,
    );
  }
});

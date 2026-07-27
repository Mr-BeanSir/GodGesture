import { z } from "zod";

/** RFC 7636 PKCE verifier:43-128 个 unreserved ASCII 字符。 */
export const OAuthCodeVerifier = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);
export type OAuthCodeVerifier = z.infer<typeof OAuthCodeVerifier>;

/** SHA-256 的 32 字节 base64url(无 padding)固定为 43 字符。 */
export const OAuthCodeChallenge = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/);
export type OAuthCodeChallenge = z.infer<typeof OAuthCodeChallenge>;

export const OAuthCodeChallengeMethod = z.literal("S256");
export type OAuthCodeChallengeMethod = z.infer<
  typeof OAuthCodeChallengeMethod
>;

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 环境无关的 base64url 编码(无 padding),供浏览器与协议测试共用。 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i] ?? 0;
    const hasSecond = i + 1 < bytes.length;
    const hasThird = i + 2 < bytes.length;
    const second = bytes[i + 1] ?? 0;
    const third = bytes[i + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64URL[(value >>> 18) & 0x3f];
    encoded += BASE64URL[(value >>> 12) & 0x3f];
    if (hasSecond) encoded += BASE64URL[(value >>> 6) & 0x3f];
    if (hasThird) encoded += BASE64URL[value & 0x3f];
  }
  return encoded;
}

/** 32 随机字节编码后恰为 RFC 7636 最短的 43 字符 verifier。 */
export function oauthVerifierFromRandomBytes(
  randomBytes: Uint8Array,
): OAuthCodeVerifier {
  if (randomBytes.length !== 32) {
    throw new RangeError("OAuth PKCE verifier requires exactly 32 random bytes");
  }
  return OAuthCodeVerifier.parse(encodeBase64Url(randomBytes));
}

/** SHA-256 的 32 字节 digest → RFC 7636 S256 challenge。 */
export function oauthChallengeFromSha256Digest(
  digest: Uint8Array,
): OAuthCodeChallenge {
  if (digest.length !== 32) {
    throw new RangeError("OAuth PKCE S256 challenge requires a SHA-256 digest");
  }
  return OAuthCodeChallenge.parse(encodeBase64Url(digest));
}

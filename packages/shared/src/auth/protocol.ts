/**
 * 认证与设备协议 —— 邮箱+密码 + JWT 双令牌(设备级可撤销)+ OAuth(ADR/共识)。
 */
import { z } from "zod";
import { OAuthCodeVerifier } from "./pkce.js";
export * from "./pkce.js";

export const OAuthProvider = z.enum(["github", "google", "wechat", "qq"]);
export type OAuthProvider = z.infer<typeof OAuthProvider>;

/** GET /auth/oauth/providers:仅暴露服务端当前实际启用的 provider。 */
export const OAuthProvidersResponse = z.object({
  providers: z.array(OAuthProvider),
});
export type OAuthProvidersResponse = z.infer<typeof OAuthProvidersResponse>;

/** provider callback 安全回跳客户端时允许携带的规范化错误码。 */
export const OAuthCallbackErrorCode = z.enum([
  "oauth_access_denied",
  "oauth_provider_unavailable",
  "oauth_email_conflict",
  "oauth_callback_failed",
]);
export type OAuthCallbackErrorCode = z.infer<typeof OAuthCallbackErrorCode>;

/** 客户端平台标识 */
export const DevicePlatform = z.enum(["windows", "macos", "web"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

const DeviceName = z.string().trim().min(1).max(64);

export const RegisterRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device: z.object({
    name: DeviceName,
    platform: DevicePlatform,
  }),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const TokenPairResponse = z.object({
  accessToken: z.string(),
  /** 不透明随机串,服务端持久化哈希,可按设备撤销 */
  refreshToken: z.string(),
  accessTokenExpiresIn: z.number().int().positive(),
});
export type TokenPairResponse = z.infer<typeof TokenPairResponse>;

export const RefreshRequest = z.object({
  refreshToken: z.string(),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** 合法并发 refresh rotation 的 loser 可安全重试，不得清理会话。 */
export const RefreshRotationRaceResponse = z.object({
  error: z.literal("refresh_rotation_race"),
});
export type RefreshRotationRaceResponse = z.infer<
  typeof RefreshRotationRaceResponse
>;

export const DeviceInfo = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: DevicePlatform,
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  /** 是否为当前请求所用设备 */
  current: z.boolean(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const ListDevicesResponse = z.object({
  devices: z.array(DeviceInfo),
});
export type ListDevicesResponse = z.infer<typeof ListDevicesResponse>;

export const RenameDeviceRequest = z.object({
  name: DeviceName,
});
export type RenameDeviceRequest = z.infer<typeof RenameDeviceRequest>;

/**
 * POST /auth/oauth/exchange 请求:用回调阶段发放的一次性授权码换取令牌对,
 * 同时登记设备(桌面回环 RFC 8252 / Web 控制台共用)。
 */
export const OAuthExchangeRequest = z.object({
  /** 一次性授权码(5 分钟内有效,用后即焚) */
  code: z.string().min(1),
  /** 与 authorize 阶段 code_challenge 匹配的 RFC 7636 verifier。 */
  codeVerifier: OAuthCodeVerifier,
  device: z.object({
    name: DeviceName,
    platform: DevicePlatform,
  }),
});
export type OAuthExchangeRequest = z.infer<typeof OAuthExchangeRequest>;

/** OAuth 邮箱撞上未验证密码账户时的 409 响应。禁止按邮箱自动关联。 */
export const OAuthEmailConflictResponse = z.object({
  error: z.literal("oauth_email_conflict"),
});
export type OAuthEmailConflictResponse = z.infer<
  typeof OAuthEmailConflictResponse
>;

/** 请求频率超过服务端窗口额度时的 429 响应。 */
export const RateLimitedResponse = z.object({
  error: z.literal("rate_limited"),
});
export type RateLimitedResponse = z.infer<typeof RateLimitedResponse>;

export const MeResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  createdAt: z.string().datetime(),
  linkedProviders: z.array(OAuthProvider),
});
export type MeResponse = z.infer<typeof MeResponse>;

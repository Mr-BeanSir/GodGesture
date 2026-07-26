/**
 * 认证与设备协议 —— 邮箱+密码 + JWT 双令牌(设备级可撤销)+ OAuth(ADR/共识)。
 */
import { z } from "zod";

export const OAuthProvider = z.enum(["github", "google", "wechat", "qq"]);
export type OAuthProvider = z.infer<typeof OAuthProvider>;

/** 客户端平台标识 */
export const DevicePlatform = z.enum(["windows", "macos", "web"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const RegisterRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device: z.object({
    name: z.string().max(64),
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
  name: z.string().min(1).max(64),
});
export type RenameDeviceRequest = z.infer<typeof RenameDeviceRequest>;

export const MeResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  createdAt: z.string().datetime(),
  linkedProviders: z.array(OAuthProvider),
});
export type MeResponse = z.infer<typeof MeResponse>;

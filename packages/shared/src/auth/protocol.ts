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
/** 客户端安装实例生成并持久化的稳定标识,仅与 userId 组合用于设备去重。 */
export const DeviceKey = z.string().uuid();
export type DeviceKey = z.infer<typeof DeviceKey>;

const DeviceRegistration = z.object({
  name: DeviceName,
  platform: DevicePlatform,
  deviceKey: DeviceKey,
});

export const UserRole = z.enum(["user", "admin"]);
export type UserRole = z.infer<typeof UserRole>;

export const EmailCodePurpose = z.enum(["register", "resetPassword"]);
export type EmailCodePurpose = z.infer<typeof EmailCodePurpose>;

const EmailAddress = z.string().trim().email().transform((value) => value.toLowerCase());

export const RequestEmailCodeRequest = z.object({
  email: EmailAddress,
  purpose: EmailCodePurpose,
});
export type RequestEmailCodeRequest = z.infer<typeof RequestEmailCodeRequest>;

export const RequestEmailCodeResponse = z.object({
  accepted: z.literal(true),
  expiresInSec: z.number().int().positive(),
  retryAfterSec: z.number().int().positive(),
});
export type RequestEmailCodeResponse = z.infer<typeof RequestEmailCodeResponse>;

export const RegisterRequest = z.object({
  email: EmailAddress,
  password: z.string().min(8).max(128),
  verificationCode: z.string().regex(/^\d{6}$/).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const PasswordResetRequest = z.object({
  email: EmailAddress,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

export const PasswordResetConfirmRequest = z.object({
  email: EmailAddress,
  verificationCode: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequest>;

export const LoginRequest = z.object({
  email: EmailAddress,
  password: z.string().min(1),
  device: DeviceRegistration,
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
  device: DeviceRegistration,
});
export type OAuthExchangeRequest = z.infer<typeof OAuthExchangeRequest>;

/** First-time OAuth identities must prove control of a GodGesture email before binding. */
export const OAuthPendingBindingEmailCodeRequest = z.object({
  email: EmailAddress,
}).strict();
export type OAuthPendingBindingEmailCodeRequest = z.infer<
  typeof OAuthPendingBindingEmailCodeRequest
>;

export const OAuthPendingBindingCompleteRequest = z.object({
  email: EmailAddress,
  verificationCode: z.string().regex(/^\d{6}$/),
  codeVerifier: OAuthCodeVerifier,
  device: DeviceRegistration,
}).strict();
export type OAuthPendingBindingCompleteRequest = z.infer<
  typeof OAuthPendingBindingCompleteRequest
>;

/** OAuth 邮箱撞上密码账户时的结构化错误载荷。禁止按邮箱自动关联。 */
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
  displayName: z.string(),
  createdAt: z.string().datetime(),
  linkedProviders: z.array(OAuthProvider),
  role: UserRole,
  emailVerified: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const AdminUser = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  displayName: z.string().max(64),
  role: UserRole,
  emailVerified: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
  lastUseAt: z.string().datetime().nullable(),
  deviceCount: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserListQuery = z.object({
  email: z.string().trim().max(254).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

export const AdminUserListResponse = z.object({
  users: z.array(AdminUser),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().positive(),
});
export type AdminUserListResponse = z.infer<typeof AdminUserListResponse>;

export const AdminUserUpdateRequest = z.object({
  displayName: z.string().trim().max(64).optional(),
  password: z.string().min(8).max(128).optional(),
  dailySubmissionLimit: z.number().int().nonnegative().nullable().optional(),
  pendingVersionLimit: z.number().int().nonnegative().nullable().optional(),
  publishedTemplateLimit: z.number().int().nonnegative().nullable().optional(),
  maxPackageBytes: z.number().int().nonnegative().nullable().optional(),
}).strict();
export type AdminUserUpdateRequest = z.infer<typeof AdminUserUpdateRequest>;

export const AdminAccountStateRequest = z.object({
  disabled: z.boolean(),
});
export type AdminAccountStateRequest = z.infer<typeof AdminAccountStateRequest>;

export const AdminRoleRequest = z.object({
  role: UserRole,
});
export type AdminRoleRequest = z.infer<typeof AdminRoleRequest>;

export const TemplatePolicyLimits = z.object({
  dailySubmissionLimit: z.number().int().min(0),
  pendingVersionLimit: z.number().int().min(0),
  publishedTemplateLimit: z.number().int().min(0),
  maxPackageBytes: z.number().int().min(0),
});
export type TemplatePolicyLimits = z.infer<typeof TemplatePolicyLimits>;
export const TemplatePolicyResponse = TemplatePolicyLimits.extend({
  hardDailySubmissionMax: z.number().int().positive(),
  hardPendingVersionMax: z.number().int().positive(),
  hardPublishedMax: z.number().int().positive(),
  hardPackageBytesMax: z.number().int().positive(),
});
export type TemplatePolicyResponse = z.infer<typeof TemplatePolicyResponse>;
export const TemplatePolicyUpdateRequest = TemplatePolicyLimits.partial().strict();
export type TemplatePolicyUpdateRequest = z.infer<typeof TemplatePolicyUpdateRequest>;

const adminPolicyUserId = z.string().uuid();
export const TemplateUserPolicyResponse = TemplatePolicyLimits.extend({
  userId: adminPolicyUserId,
  overrides: TemplatePolicyLimits.partial().strict(),
}).strict();
export type TemplateUserPolicyResponse = z.infer<typeof TemplateUserPolicyResponse>;
export const TemplateUserPolicyUpdateRequest = z.object({
  dailySubmissionLimit: z.number().int().nonnegative().nullable().optional(),
  pendingVersionLimit: z.number().int().nonnegative().nullable().optional(),
  publishedTemplateLimit: z.number().int().nonnegative().nullable().optional(),
  maxPackageBytes: z.number().int().nonnegative().nullable().optional(),
}).strict();
export type TemplateUserPolicyUpdateRequest = z.infer<typeof TemplateUserPolicyUpdateRequest>;

export const AdminUserDetail = AdminUser.extend({
  passwordSet: z.boolean(),
  linkedProviders: z.array(OAuthProvider),
  templatePolicy: TemplateUserPolicyResponse,
}).strict();
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

const RustFsBucket = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);
export const RustFsConfigResponse = z.object({
  endpoint: z.string().url(),
  region: z.string().min(1),
  bucket: RustFsBucket,
  publicDownloadTtlSec: z.number().int().min(1).max(900),
  accessKeyConfigured: z.boolean(),
  secretKeyConfigured: z.boolean(),
}).strict();
export type RustFsConfigResponse = z.infer<typeof RustFsConfigResponse>;

export const RustFsConfigUpdateRequest = z.object({
  endpoint: z.string().url().optional(),
  region: z.string().trim().min(1).max(64).optional(),
  bucket: RustFsBucket.optional(),
  publicDownloadTtlSec: z.number().int().min(1).max(900).optional(),
  /** 空字符串表示保留当前已加密凭证。 */
  accessKey: z.string().max(256).optional(),
  secretKey: z.string().max(256).optional(),
}).strict();
export type RustFsConfigUpdateRequest = z.infer<typeof RustFsConfigUpdateRequest>;

export const AdminSystemConfigResponse = z.object({
  templatePolicy: TemplatePolicyResponse,
  rustfs: RustFsConfigResponse,
  updatedAt: z.string().datetime(),
}).strict();
export type AdminSystemConfigResponse = z.infer<typeof AdminSystemConfigResponse>;

export const AdminSystemConfigUpdateRequest = z.object({
  templatePolicy: TemplatePolicyUpdateRequest.optional(),
  rustfs: RustFsConfigUpdateRequest.optional(),
}).strict();
export type AdminSystemConfigUpdateRequest = z.infer<typeof AdminSystemConfigUpdateRequest>;

export const SystemConfigRustFsTestRequest = z.object({
  rustfs: RustFsConfigUpdateRequest.optional(),
}).strict();
export type SystemConfigRustFsTestRequest = z.infer<typeof SystemConfigRustFsTestRequest>;

export const SystemConfigRustFsTestResponse = z.object({
  ok: z.literal(true),
}).strict();
export type SystemConfigRustFsTestResponse = z.infer<typeof SystemConfigRustFsTestResponse>;

export const TemplateModerationStatus = z.enum([
  "pending_review",
  "published",
  "rejected",
  "withdrawn",
  "suspended",
]);
export type TemplateModerationStatus = z.infer<typeof TemplateModerationStatus>;

export const AdminTemplateModerationStatus = z.union([
  z.literal("all"),
  TemplateModerationStatus,
]);
export type AdminTemplateModerationStatus = z.infer<typeof AdminTemplateModerationStatus>;

export const TemplateModerationListQuery = z.object({
  status: AdminTemplateModerationStatus.default("pending_review"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type TemplateModerationListQuery = z.infer<typeof TemplateModerationListQuery>;

export const TemplateModerationTemplate = z.object({
  versionId: z.string().uuid(),
  templateId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  status: TemplateModerationStatus,
  risks: z.array(z.string()),
  submittedAt: z.string().datetime({ offset: true }),
  author: z.string(),
}).strict();
export type TemplateModerationTemplate = z.infer<typeof TemplateModerationTemplate>;

export const TemplateModerationListResponse = z.object({
  templates: z.array(TemplateModerationTemplate),
  nextCursor: z.string().uuid().nullable(),
  count: z.number().int().nonnegative(),
}).strict();
export type TemplateModerationListResponse = z.infer<typeof TemplateModerationListResponse>;

const moderationText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value), 'contains unsafe control text');
export const TemplateModerationReportStatus = z.enum(['open', 'resolved', 'dismissed']);
export type TemplateModerationReportStatus = z.infer<typeof TemplateModerationReportStatus>;
export const TemplateModerationReportListQuery = z.object({
  status: TemplateModerationReportStatus.default('open'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type TemplateModerationReportListQuery = z.infer<typeof TemplateModerationReportListQuery>;
export const TemplateModerationReport = z.object({
  id: z.string().uuid(), templateId: z.string().uuid(), versionId: z.string().uuid(),
  title: z.string(), reason: z.string(), status: TemplateModerationReportStatus,
  resolution: z.string().nullable(), createdAt: z.string().datetime({ offset: true }), resolvedAt: z.string().datetime({ offset: true }).nullable(),
  author: z.string(), reporter: z.string(),
}).strict();
export type TemplateModerationReport = z.infer<typeof TemplateModerationReport>;
export const TemplateModerationReportListResponse = z.object({
  reports: z.array(TemplateModerationReport),
  nextCursor: z.string().uuid().nullable(),
  count: z.number().int().nonnegative(),
}).strict();
export type TemplateModerationReportListResponse = z.infer<typeof TemplateModerationReportListResponse>;
export const TemplateReportResolutionRequest = z.object({ resolution: moderationText(2000) }).strict();
export type TemplateReportResolutionRequest = z.infer<typeof TemplateReportResolutionRequest>;

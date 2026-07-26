/**
 * 环境变量 Schema(zod 校验)。所有外部凭证一律走环境变量,.env.example 有逐项说明。
 */
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** PostgreSQL 连接串 */
  DATABASE_URL: z.string().min(1),

  /** JWT 签名密钥(HS256),生产环境务必使用长随机串 */
  JWT_SECRET: z.string().min(16),
  /** 访问令牌有效期(秒),默认 15 分钟 */
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  /** 刷新令牌有效期(天),默认 30 天 */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** 服务对外基址(1Panel 反代后的 https 域名),用于拼 OAuth 回调地址 */
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  /** Web 控制台源(CORS 与 OAuth redirect_uri 白名单) */
  WEB_CONSOLE_ORIGIN: z.string().url().optional(),
  /** 额外 CORS 源,逗号分隔(可选) */
  CORS_ORIGINS: z.string().optional(),

  // ---- OAuth:GitHub / Google 先行 ----
  OAUTH_GITHUB_CLIENT_ID: z.string().optional(),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ---- OAuth:微信 / QQ 留配置位,默认停用 ----
  OAUTH_WECHAT_ENABLED: bool,
  OAUTH_WECHAT_APP_ID: z.string().optional(),
  OAUTH_WECHAT_APP_SECRET: z.string().optional(),
  OAUTH_QQ_ENABLED: bool,
  OAUTH_QQ_APP_ID: z.string().optional(),
  OAUTH_QQ_APP_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** @nestjs/config 的 validate 钩子 */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`环境变量校验失败 — ${issues}`);
  }
  return parsed.data;
}

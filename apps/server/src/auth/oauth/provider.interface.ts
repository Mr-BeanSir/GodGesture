import type { OAuthProvider } from '@godgesture/shared';

/** 提供方返回的最小身份信息 */
export interface OAuthIdentity {
  /** 提供方侧的稳定用户标识(微信优先 unionid) */
  providerUserId: string;
  /** 可信邮箱(github/google 有;wechat/qq 无) */
  email: string | null;
}

/**
 * 可插拔 OAuth 提供方(授权码模式)。
 * 新增提供方 = 实现本接口 + 在 OAuthProviderRegistry 注册。
 */
export interface OAuthProviderPlugin {
  readonly name: OAuthProvider;
  /** 未配置凭证 / 未开启开关时返回 false,端点回 501 */
  isEnabled(): boolean;
  /** 拼装跳转到提供方的授权页 URL */
  buildAuthorizeUrl(callbackUrl: string, state: string): string;
  /** 用授权码换取身份(code → token → userinfo) */
  fetchIdentity(code: string, callbackUrl: string): Promise<OAuthIdentity>;
}

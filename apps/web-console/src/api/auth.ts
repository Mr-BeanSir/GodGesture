import {
  LoginRequest,
  MeResponse,
  OAuthExchangeRequest,
  OAuthProvidersResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterRequest,
  RequestEmailCodeResponse,
  TokenPairResponse,
} from "@godgesture/shared";
import {
  apiRequest,
  apiRequestVoid,
  clearSession,
  setTokenPair,
} from "./client";

export type LogoutOutcome = "revoked" | "local_only";

export function registerAccount(input: RegisterRequest): Promise<MeResponse> {
  return apiRequest(MeResponse, "/auth/register", {
    method: "POST",
    body: input,
    auth: false,
  });
}

export function requestRegistrationCode(
  email: string,
): Promise<RequestEmailCodeResponse> {
  return apiRequest(RequestEmailCodeResponse, "/auth/email-verification/request", {
    method: "POST",
    body: { email, purpose: "register" },
    auth: false,
  });
}

export function requestPasswordResetCode(
  input: PasswordResetRequest,
): Promise<RequestEmailCodeResponse> {
  return apiRequest(RequestEmailCodeResponse, "/auth/password-reset/request", {
    method: "POST",
    body: input,
    auth: false,
  });
}

export function confirmPasswordReset(
  input: PasswordResetConfirmRequest,
): Promise<void> {
  return apiRequestVoid("/auth/password-reset/confirm", {
    method: "POST",
    body: input,
    auth: false,
  });
}

export async function login(input: LoginRequest): Promise<void> {
  const pair = await apiRequest(TokenPairResponse, "/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
  setTokenPair(pair);
}

export async function exchangeOAuthCode(
  input: OAuthExchangeRequest,
): Promise<void> {
  const pair = await apiRequest(TokenPairResponse, "/auth/oauth/exchange", {
    method: "POST",
    body: input,
    auth: false,
  });
  setTokenPair(pair);
}

export function fetchOAuthProviders(): Promise<OAuthProvidersResponse> {
  return apiRequest(OAuthProvidersResponse, "/auth/oauth/providers", {
    auth: false,
  });
}

export function fetchMe(): Promise<MeResponse> {
  return apiRequest(MeResponse, "/auth/me");
}

/** 登出:撤销当前设备刷新令牌 + 清理本地 token */
export async function logout(): Promise<LogoutOutcome> {
  let outcome: LogoutOutcome = "revoked";
  try {
    await apiRequestVoid("/auth/logout", { method: "POST" });
  } catch {
    outcome = "local_only";
  } finally {
    clearSession();
  }
  return outcome;
}

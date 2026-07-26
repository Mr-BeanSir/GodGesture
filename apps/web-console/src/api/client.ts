/**
 * fetch 封装:自动携带 Bearer access token;401 时用 refresh token 轮换重试
 * (并发去重);refresh 失效则触发会话过期回调(跳登录)。
 * 响应体一律用 @godgesture/shared 的 zod Schema 解析。
 *
 * token 存储策略:access token 仅存内存;refresh token 存 localStorage。
 */
import type { z } from "zod";
import { TokenPairResponse } from "@godgesture/shared";

/** 后端源(VITE_API_BASE_URL 留空 = 同源,走代理的 /api) */
const API_ORIGIN = import.meta.env.VITE_API_BASE_URL ?? "";
const API_BASE = `${API_ORIGIN}/api/v1`;
const REFRESH_TOKEN_KEY = "godgesture.refreshToken";

/** 构造后端 API URL(供整页跳转的 OAuth authorize 等非 fetch 场景) */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

export function setTokenPair(pair: TokenPairResponse): void {
  accessToken = pair.accessToken;
  localStorage.setItem(REFRESH_TOKEN_KEY, pair.refreshToken);
}

export function clearSession(): void {
  accessToken = null;
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/** 本浏览器是否持有可尝试恢复的会话(refresh token) */
export function hasStoredSession(): boolean {
  return localStorage.getItem(REFRESH_TOKEN_KEY) !== null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown = null,
  ) {
    super(code ?? `http_${status}`);
    this.name = "ApiError";
  }
}

function extractErrorCode(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === "string") return code;
  }
  return null;
}

// --- refresh 轮换(并发去重:同一时刻只发一次 /auth/refresh) ---

let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // 网络异常不作废本地会话,下次再试
    return false;
  }
  if (!res.ok) {
    clearSession();
    return false;
  }
  setTokenPair(TokenPairResponse.parse(await res.json()));
  return true;
}

// --- 请求主体 ---

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 默认 true:携带 Bearer 并走 401→refresh→重试流程 */
  auth?: boolean;
}

async function rawRequest(
  path: string,
  options: RequestOptions,
): Promise<Response> {
  const auth = options.auth ?? true;
  const exec = (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };

  // 页面刷新后 access token 仅存内存已丢失:先用 refresh token 恢复
  if (auth && !accessToken && hasStoredSession()) {
    await refreshSession();
  }

  let res: Response;
  try {
    res = await exec();
  } catch {
    throw new ApiError(0, "network");
  }

  if (res.status === 401 && auth) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        res = await exec();
      } catch {
        throw new ApiError(0, "network");
      }
    }
    if (res.status === 401) {
      clearSession();
      sessionExpiredHandler?.();
      throw new ApiError(401, "session_expired");
    }
  }
  return res;
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 非 JSON 错误体,忽略
  }
  throw new ApiError(res.status, extractErrorCode(body), body);
}

/** 请求并用 zod Schema 解析 JSON 响应体 */
export async function apiRequest<S extends z.ZodTypeAny>(
  schema: S,
  path: string,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  const res = await rawRequest(path, options);
  await ensureOk(res);
  return schema.parse(await res.json()) as z.infer<S>;
}

/** 请求无响应体的端点(204) */
export async function apiRequestVoid(
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  const res = await rawRequest(path, options);
  await ensureOk(res);
}

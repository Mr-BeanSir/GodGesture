/**
 * fetch 封装:自动携带 Bearer access token;401 时用 refresh token 轮换重试
 * (并发去重);refresh 失效则触发会话过期回调(跳登录)。
 * 响应体一律用 @godgesture/shared 的 zod Schema 解析。
 *
 * token 存储策略:access token 仅存内存;refresh token 存 localStorage。
 */
import type { z } from "zod";
import { TokenPairResponse } from "@godgesture/shared";
import {
  RefreshCoordinator,
  classifyRefreshFailure,
  removeStorageValueIfCurrent,
  replaceStorageValueIfCurrent,
} from "./refresh-coordinator";

/** 后端源(GODGESTURE_API 留空 = 同源,走代理的 /api) */
const API_ORIGIN = import.meta.env.GODGESTURE_API ?? import.meta.env.VITE_API_BASE_URL ?? "";
const API_BASE = `${API_ORIGIN}/api/v1`;
const REFRESH_TOKEN_KEY = "godgesture.refreshToken";
const REFRESH_LEASE_KEY = "godgesture.refreshLease";
const SESSION_EVENT_KEY = "godgesture.sessionEvent";
const REFRESH_TIMEOUT_MS = 15_000;

const refreshCoordinator = new RefreshCoordinator(localStorage, {
  lockName: "godgesture.refresh",
  leaseKey: REFRESH_LEASE_KEY,
  channelName: "godgesture.session",
  watchedStorageKeys: [REFRESH_TOKEN_KEY, SESSION_EVENT_KEY],
});

/** 构造后端 API URL(供整页跳转的 OAuth authorize 等非 fetch 场景) */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

let accessToken: string | null = null;
let accessTokenRefreshToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;
let sessionLogoutHandler: (() => void) | null = null;
let sessionExpiredLatched = false;
let sessionLogoutLatched = false;

export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
  if (sessionExpiredLatched) handler();
}

export function setSessionLogoutHandler(handler: () => void): void {
  sessionLogoutHandler = handler;
  if (sessionLogoutLatched) handler();
}

export function setTokenPair(pair: TokenPairResponse): void {
  applyTokenPair(pair);
}

function applyTokenPair(pair: TokenPairResponse): void {
  accessToken = pair.accessToken;
  accessTokenRefreshToken = pair.refreshToken;
  localStorage.setItem(REFRESH_TOKEN_KEY, pair.refreshToken);
  sessionExpiredLatched = false;
  sessionLogoutLatched = false;
}

export function clearSession(): void {
  const refreshToken =
    localStorage.getItem(REFRESH_TOKEN_KEY) ?? accessTokenRefreshToken;
  accessToken = null;
  accessTokenRefreshToken = null;
  const message: SessionLogoutMessage | null =
    refreshToken === null
      ? null
      : {
          type: "session-logout",
          refreshToken,
          eventId: crypto.randomUUID(),
        };
  if (message !== null) {
    try {
      // Store the intent before removing the token so peer tabs do not mistake
      // the subsequent storage event for an involuntary session expiry.
      localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify(message));
    } catch {
      // BroadcastChannel remains available when storage is temporarily full.
    }
  }
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } finally {
    if (message !== null) refreshCoordinator.publish(message);
  }
}

function notifySessionExpired(): void {
  if (sessionExpiredLatched) return;
  sessionExpiredLatched = true;
  sessionExpiredHandler?.();
}

function notifySessionLogout(): void {
  if (sessionLogoutLatched) return;
  sessionLogoutLatched = true;
  sessionLogoutHandler?.();
}

/** 本浏览器是否持有可尝试恢复的会话(refresh token) */
export function hasStoredSession(): boolean {
  return localStorage.getItem(REFRESH_TOKEN_KEY) !== null;
}

export type ApiResponseContext = "default" | "config_document";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown = null,
    readonly endpoint: string | null = null,
    readonly responseContext: ApiResponseContext = "default",
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

// --- refresh 轮换(单标签 Promise 去重 + 跨标签互斥) ---

type RefreshResult =
  | { kind: "success" }
  | { kind: "invalid"; code: string }
  | {
      kind: "transient";
      status: number;
      code: string;
      body?: unknown;
    };

interface RefreshSuccessMessage {
  type: "refresh-success";
  attemptedToken: string;
  pair: unknown;
}

interface SessionInvalidMessage {
  type: "session-invalid";
  attemptedToken: string;
}

interface SessionLogoutMessage {
  type: "session-logout";
  refreshToken: string;
  eventId: string;
}

let refreshInFlight: Promise<RefreshResult> | null = null;

function refreshSession(
  previousAccessToken: string | null,
): Promise<RefreshResult> {
  refreshInFlight ??= refreshCoordinator
    .runExclusive(async () => {
      // Another tab may have completed while this tab waited for the lock.
      if (accessToken !== null && accessToken !== previousAccessToken) {
        return { kind: "success" } as const;
      }
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        accessToken = null;
        accessTokenRefreshToken = null;
        return { kind: "invalid", code: "missing_refresh_token" } as const;
      }
      return doRefresh(refreshToken);
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function doRefresh(refreshToken: string): Promise<RefreshResult> {
  let res: Response;
  const abort = new AbortController();
  const timeout = window.setTimeout(() => abort.abort(), REFRESH_TIMEOUT_MS);
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: abort.signal,
    });
  } catch {
    return { kind: "transient", status: 0, code: "network" };
  } finally {
    window.clearTimeout(timeout);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return {
      kind: "transient",
      status: res.status,
      code: "invalid_server_response",
    };
  }

  if (res.ok) {
    const parsed = TokenPairResponse.safeParse(body);
    if (!parsed.success) {
      return {
        kind: "transient",
        status: res.status,
        code: "invalid_server_response",
        body,
      };
    }
    if (
      !replaceStorageValueIfCurrent(
        localStorage,
        REFRESH_TOKEN_KEY,
        refreshToken,
        parsed.data.refreshToken,
      )
    ) {
      // A newer winner already replaced this request's token. Never overwrite it.
      return {
        kind: "transient",
        status: 409,
        code: "refresh_rotation_race",
      };
    }
    applyTokenPair(parsed.data);
    refreshCoordinator.publish({
      type: "refresh-success",
      attemptedToken: refreshToken,
      pair: parsed.data,
    } satisfies RefreshSuccessMessage);
    return { kind: "success" };
  }

  const code = extractErrorCode(body);
  if (classifyRefreshFailure(res.status, code) === "invalid") {
    if (
      !removeStorageValueIfCurrent(
        localStorage,
        REFRESH_TOKEN_KEY,
        refreshToken,
      )
    ) {
      // This is a late loser response for an older token. The winner stays intact.
      return {
        kind: "transient",
        status: 409,
        code: "refresh_rotation_race",
        body,
      };
    }
    accessToken = null;
    accessTokenRefreshToken = null;
    refreshCoordinator.publish({
      type: "session-invalid",
      attemptedToken: refreshToken,
    } satisfies SessionInvalidMessage);
    return { kind: "invalid", code: code! };
  }

  return {
    kind: "transient",
    status: res.status,
    code: code ?? "refresh_failed",
    body,
  };
}

refreshCoordinator.subscribe((message) => {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return;
  }
  if ((message as { type: unknown }).type === "refresh-success") {
    const candidate = message as Partial<RefreshSuccessMessage>;
    if (typeof candidate.attemptedToken !== "string") return;
    const parsed = TokenPairResponse.safeParse(candidate.pair);
    if (!parsed.success) return;
    const current = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (
      current !== candidate.attemptedToken &&
      current !== parsed.data.refreshToken
    ) {
      return;
    }
    applyTokenPair(parsed.data);
    return;
  }
  if ((message as { type: unknown }).type === "session-invalid") {
    const candidate = message as Partial<SessionInvalidMessage>;
    if (typeof candidate.attemptedToken !== "string") return;
    const removed = removeStorageValueIfCurrent(
      localStorage,
      REFRESH_TOKEN_KEY,
      candidate.attemptedToken,
    );
    if (
      removed ||
      (localStorage.getItem(REFRESH_TOKEN_KEY) === null &&
        accessTokenRefreshToken === candidate.attemptedToken)
    ) {
      accessToken = null;
      accessTokenRefreshToken = null;
      notifySessionExpired();
    }
    return;
  }
  if ((message as { type: unknown }).type === "session-logout") {
    applySessionLogoutMessage(message as Partial<SessionLogoutMessage>);
  }
});

function applySessionLogoutMessage(
  candidate: Partial<SessionLogoutMessage>,
): void {
  if (
    typeof candidate.refreshToken !== "string" ||
    typeof candidate.eventId !== "string"
  ) {
    return;
  }
  const current = localStorage.getItem(REFRESH_TOKEN_KEY);
  const matchesCurrent = current === candidate.refreshToken;
  const matchesOrphanedMemory =
    current === null && accessTokenRefreshToken === candidate.refreshToken;
  if (!matchesCurrent && !matchesOrphanedMemory) {
    return;
  }
  if (matchesCurrent) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
  accessToken = null;
  accessTokenRefreshToken = null;
  notifySessionLogout();
}

window.addEventListener("storage", (event) => {
  if (event.key === SESSION_EVENT_KEY && event.newValue !== null) {
    try {
      const message = JSON.parse(
        event.newValue,
      ) as Partial<SessionLogoutMessage>;
      if (message.type === "session-logout") {
        applySessionLogoutMessage(message);
      }
    } catch {
      // Ignore malformed same-origin storage data.
    }
    return;
  }
  if (
    event.key === REFRESH_TOKEN_KEY &&
    event.newValue === null &&
    event.oldValue !== null &&
    event.oldValue === accessTokenRefreshToken
  ) {
    accessToken = null;
    accessTokenRefreshToken = null;
    notifySessionExpired();
  }
});

function requireRefreshSuccess(result: RefreshResult): void {
  if (result.kind === "success") return;
  if (result.kind === "invalid") {
    accessToken = null;
    accessTokenRefreshToken = null;
    notifySessionExpired();
    throw new ApiError(401, "session_expired", { cause: result.code });
  }
  throw new ApiError(
    result.status,
    result.code,
    result.body,
    result.code === "invalid_server_response" ? "/auth/refresh" : null,
  );
}

async function responseError(
  response: Response,
): Promise<{ code: string | null; body: unknown }> {
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // Keep an unparseable error response available to the normal caller.
  }
  return { code: extractErrorCode(body), body };
}

function expireAccessSession(expectedRefreshToken: string | null): boolean {
  if (expectedRefreshToken === null) {
    if (hasStoredSession()) return false;
  } else if (
    !removeStorageValueIfCurrent(
      localStorage,
      REFRESH_TOKEN_KEY,
      expectedRefreshToken,
    )
  ) {
    return false;
  }
  accessToken = null;
  accessTokenRefreshToken = null;
  if (expectedRefreshToken !== null) {
    refreshCoordinator.publish({
      type: "session-invalid",
      attemptedToken: expectedRefreshToken,
    } satisfies SessionInvalidMessage);
  }
  notifySessionExpired();
  return true;
}

// --- 请求主体 ---

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** 默认 true:携带 Bearer 并走 401→refresh→重试流程 */
  auth?: boolean;
}

function requestPath(
  path: string,
  query: RequestOptions["query"],
): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const encoded = search.toString();
  if (!encoded) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${encoded}`;
}

async function rawRequest(
  path: string,
  options: RequestOptions,
): Promise<Response> {
  const auth = options.auth ?? true;
  const exec = async (): Promise<{
    response: Response;
    accessTokenUsed: string | null;
    refreshTokenUsed: string | null;
  }> => {
    const accessTokenUsed = auth ? accessToken : null;
    const refreshTokenUsed = auth ? accessTokenRefreshToken : null;
    const headers: Record<string, string> = {};
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (accessTokenUsed) headers.Authorization = `Bearer ${accessTokenUsed}`;
    const response = await fetch(`${API_BASE}${requestPath(path, options.query)}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    return { response, accessTokenUsed, refreshTokenUsed };
  };

  // 页面刷新后 access token 仅存内存已丢失:先用 refresh token 恢复
  if (auth && !accessToken && hasStoredSession()) {
    requireRefreshSuccess(await refreshSession(null));
  }

  let executed: Awaited<ReturnType<typeof exec>>;
  try {
    executed = await exec();
  } catch {
    throw new ApiError(0, "network");
  }

  if (executed.response.status === 401 && auth) {
    requireRefreshSuccess(await refreshSession(executed.accessTokenUsed));
    try {
      executed = await exec();
    } catch {
      throw new ApiError(0, "network");
    }

    if (executed.response.status === 401) {
      const error = await responseError(executed.response);
      if (
        error.code === "invalid_access_token" ||
        error.code === "missing_access_token"
      ) {
        if (expireAccessSession(executed.refreshTokenUsed)) {
          throw new ApiError(401, "session_expired", error.body);
        }
        // The request used an older access/refresh pair and another tab has
        // already advanced storage. Preserve the winner and retry later.
        throw new ApiError(409, "refresh_rotation_race", error.body);
      }
    }
  }
  return executed.response;
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
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "invalid_server_response", null, path);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const responseContext: ApiResponseContext =
      path === "/sync/config" &&
      (options.method ?? "GET") === "GET" &&
      parsed.error.issues.some((issue) => issue.path[0] === "document")
        ? "config_document"
        : "default";
    throw new ApiError(
      res.status,
      "invalid_server_response",
      { response: body, issues: parsed.error.issues },
      path,
      responseContext,
    );
  }
  return parsed.data as z.infer<S>;
}

/** 请求无响应体的端点(204) */
export async function apiRequestVoid(
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  const res = await rawRequest(path, options);
  await ensureOk(res);
}

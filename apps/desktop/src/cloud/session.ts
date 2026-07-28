import {
  TokenPairResponse,
  createGodGestureApiClient,
  type GodGestureApiClient,
  type TokenPairResponse as TokenPair,
} from "@godgesture/shared";
import type { Backend } from "../api/backend";
import {
  CloudError,
  INVALID_REFRESH_CODES,
  normalizeCloudError,
} from "./errors";
import { apiData, responseErrorCode } from "./transport";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

type SessionBackend = Pick<
  Backend,
  "accountCredentialGet" | "accountCredentialSet" | "accountCredentialDelete"
>;

export interface CloudSessionOptions {
  apiOrigin: string;
  backend: SessionBackend;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export function resolveApiOrigin(
  configured = import.meta.env.VITE_API_BASE_URL,
  development = import.meta.env.DEV,
): string | null {
  const candidate =
    configured?.trim() || (development ? "http://127.0.0.1:3000" : "");
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localHttp) return null;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return null;
  return url.origin;
}

export class CloudSession {
  readonly apiOrigin: string;
  readonly apiBase: string;
  readonly publicClient: GodGestureApiClient;
  readonly authenticatedFetch: typeof globalThis.fetch;

  private readonly backend: SessionBackend;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;
  private accessToken: string | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private expiredHandler: (() => void) | null = null;

  constructor(options: CloudSessionOptions) {
    const normalized = resolveApiOrigin(options.apiOrigin, false);
    if (!normalized) throw new CloudError(0, "server_not_configured");
    this.apiOrigin = normalized;
    this.apiBase = `${normalized}/api/v1`;
    this.backend = options.backend;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.authenticatedFetch = (input, init) =>
      this.fetchAuthenticated(input, init);
    this.publicClient = createGodGestureApiClient({
      baseUrl: this.apiBase,
      fetch: (request) => this.fetchWithTimeout(request),
    });
  }

  setExpiredHandler(handler: () => void): void {
    this.expiredHandler = handler;
  }

  async hasStoredCredential(): Promise<boolean> {
    try {
      return (await this.backend.accountCredentialGet(this.apiOrigin)) !== null;
    } catch (error) {
      throw normalizeCloudError(error);
    }
  }

  async restore(): Promise<boolean> {
    const token = await this.readCredential();
    if (!token) return false;
    await this.refreshFromToken(token);
    return true;
  }

  async installTokenPair(input: TokenPair): Promise<void> {
    const pair = TokenPairResponse.parse(input);
    try {
      await this.backend.accountCredentialSet(
        this.apiOrigin,
        pair.refreshToken,
      );
    } catch (error) {
      await this.revokeAccessToken(pair.accessToken);
      throw normalizeCloudError(error);
    }
    this.accessToken = pair.accessToken;
  }

  async clearLocal(): Promise<void> {
    try {
      await this.backend.accountCredentialDelete(this.apiOrigin);
    } catch (error) {
      throw normalizeCloudError(error);
    }
    this.accessToken = null;
  }

  private async readCredential(): Promise<string | null> {
    try {
      return await this.backend.accountCredentialGet(this.apiOrigin);
    } catch (error) {
      throw normalizeCloudError(error);
    }
  }

  private refreshSession(previousAccessToken: string | null): Promise<void> {
    this.refreshInFlight ??= this.doRefresh(previousAccessToken).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(previousAccessToken: string | null): Promise<void> {
    if (this.accessToken !== null && this.accessToken !== previousAccessToken)
      return;
    const refreshToken = await this.readCredential();
    if (!refreshToken) {
      this.accessToken = null;
      throw new CloudError(401, "session_expired");
    }
    await this.refreshFromToken(refreshToken);
  }

  private async refreshFromToken(refreshToken: string): Promise<void> {
    let pair: TokenPair;
    try {
      pair = await apiData(
        TokenPairResponse,
        this.publicClient.POST("/auth/refresh", { body: { refreshToken } }),
        "/auth/refresh",
      );
    } catch (error) {
      const normalized = normalizeCloudError(error, "/auth/refresh");
      if (
        normalized.status === 401 &&
        INVALID_REFRESH_CODES.has(normalized.code)
      ) {
        await this.expireSession();
        throw new CloudError(401, "session_expired", {
          cause: normalized.code,
        });
      }
      throw normalized;
    }
    try {
      await this.backend.accountCredentialSet(
        this.apiOrigin,
        pair.refreshToken,
      );
    } catch (error) {
      this.accessToken = null;
      await this.revokeAccessToken(pair.accessToken);
      try {
        await this.backend.accountCredentialDelete(this.apiOrigin);
      } catch {
        // Preserve the primary credential-write failure.
      }
      throw normalizeCloudError(error);
    }
    this.accessToken = pair.accessToken;
  }

  private async fetchAuthenticated(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const baseRequest = new Request(input, init);
    if (!this.accessToken) await this.refreshSession(null);

    const accessTokenUsed = this.accessToken;
    let response = await this.fetchWithTimeout(
      this.withBearer(baseRequest.clone()),
    );
    if (response.status !== 401) return response;

    await this.refreshSession(accessTokenUsed);
    response = await this.fetchWithTimeout(
      this.withBearer(baseRequest.clone()),
    );
    if (response.status === 401) {
      const code = await responseErrorCode(response);
      if (code === "invalid_access_token" || code === "missing_access_token") {
        await this.expireSession();
      }
    }
    return response;
  }

  private withBearer(request: Request): Request {
    if (!this.accessToken) throw new CloudError(401, "session_expired");
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    return new Request(request, { headers });
  }

  private async expireSession(): Promise<void> {
    this.accessToken = null;
    try {
      await this.backend.accountCredentialDelete(this.apiOrigin);
    } catch (error) {
      this.expiredHandler?.();
      throw normalizeCloudError(error);
    }
    this.expiredHandler?.();
  }

  private async revokeAccessToken(accessToken: string): Promise<void> {
    try {
      await this.fetchWithTimeout(
        new Request(`${this.apiBase}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
    } catch {
      // This is best-effort cleanup after local credential persistence failed.
    }
  }

  private async fetchWithTimeout(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );
    try {
      return await this.fetchImpl(
        new Request(request, { signal: controller.signal }),
      );
    } catch (error) {
      throw normalizeCloudError(error);
    } finally {
      globalThis.clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    }
  }
}

export class CloudError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown = null,
    public readonly endpoint: string | null = null,
    public readonly cause?: unknown,
  ) {
    super(code);
    this.name = "CloudError";
  }

  get retryable(): boolean {
    return (
      this.status === 0 ||
      this.status === 408 ||
      this.status === 429 ||
      this.status >= 500 ||
      this.code === "refresh_rotation_race"
    );
  }
}

/** Convert an unknown transport failure to a log-safe string without payloads/tokens. */
export function describeCloudCause(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return String(error);
}

export function extractCloudErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body))
    return null;
  const code = (body as { error: unknown }).error;
  return typeof code === "string" ? code : null;
}

export function normalizeCloudError(
  error: unknown,
  endpoint: string | null = null,
): CloudError {
  if (error instanceof CloudError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new CloudError(0, "request_timeout", null, endpoint, error);
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") {
      return new CloudError(0, code, null, endpoint, error);
    }
  }
  return new CloudError(0, "network", null, endpoint, error);
}

export const INVALID_REFRESH_CODES = new Set([
  "invalid_refresh_token",
  "refresh_token_expired",
  "refresh_token_reused",
]);

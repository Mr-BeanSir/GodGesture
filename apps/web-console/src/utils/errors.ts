import { ApiError, type ApiResponseContext } from "../api/client";

/** 已提供 i18n 文案的服务端错误码 */
const KNOWN_CODES = new Set([
  "network",
  "invalid_credentials",
  "email_taken",
  "oauth_email_conflict",
  "rate_limited",
  "refresh_rotation_race",
  "validation_failed",
  "device_not_found",
  "snapshot_not_found",
  "version_conflict",
  "config_too_large",
  "session_expired",
  "invalid_server_response",
]);

export function invalidResponseMessageKey(context: ApiResponseContext): string {
  return context === "config_document"
    ? "config.parseError"
    : "errors.invalid_server_response";
}

/** 把异常映射为 i18n key,供 t() 显示友好错误 */
export function errorMessageKey(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_server_response") {
    return invalidResponseMessageKey(err.responseContext);
  }
  if (err instanceof ApiError && err.code && KNOWN_CODES.has(err.code)) {
    return `errors.${err.code}`;
  }
  return "errors.generic";
}

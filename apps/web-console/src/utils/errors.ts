import { ZodError } from "zod";
import { ApiError } from "../api/client";

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
]);

/** 把异常映射为 i18n key,供 t() 显示友好错误 */
export function errorMessageKey(err: unknown): string {
  if (err instanceof ApiError && err.code && KNOWN_CODES.has(err.code)) {
    return `errors.${err.code}`;
  }
  if (err instanceof ZodError) {
    return "config.parseError";
  }
  return "errors.generic";
}

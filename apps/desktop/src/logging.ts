import { useBackend, type Backend, type LogEntryLevel } from "./api/backend";

/** WebView 日志入口:桌面端写入 Rust 日志中心,浏览器预览写入内存 mock。 */
let backend: Backend | null = null;

function getBackend(): Backend | null {
  if (backend) return backend;
  try {
    backend = useBackend();
    return backend;
  } catch {
    return null;
  }
}

function sanitize(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(
      /(["']?(?:refresh[_-]?token|access[_-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^,"'\s}]+/gi,
      "$1[redacted]",
    )
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted]");
}

function formatMessage(message: unknown): string {
  if (typeof message === "string") return sanitize(message);
  if (message instanceof Error) {
    return sanitize(
      `${message.name}: ${message.message}${message.stack ? `\n${message.stack}` : ""}`,
    );
  }
  try {
    return sanitize(JSON.stringify(message));
  } catch {
    return sanitize(String(message));
  }
}

export function writeLog(level: LogEntryLevel, target: string, message: unknown): void {
  const text = formatMessage(message);
  const currentBackend = getBackend();
  if (!currentBackend || typeof currentBackend.logWrite !== "function") return;
  try {
    void currentBackend.logWrite(level, target, text).catch(() => undefined);
  } catch {
    // Logging must never break the operation that produced the diagnostic.
  }
}

export const appLog = {
  debug(target: string, message: unknown) { writeLog("debug", target, message); },
  info(target: string, message: unknown) { writeLog("info", target, message); },
  warn(target: string, message: unknown) { writeLog("warn", target, message); },
  error(target: string, message: unknown) { writeLog("error", target, message); },
};

import type { Backend, LogEntryLevel } from "./api/backend";

const MAX_MESSAGE_LENGTH = 1200;
const CONSOLE_METHODS = ["debug", "info", "warn", "error", "log"] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

export type BackendDiagnosticWriter = (
  level: LogEntryLevel,
  target: string,
  message: string,
) => void;

let diagnosticWriter: BackendDiagnosticWriter | null = null;
let activeCleanup: (() => void) | null = null;

export function setBackendDiagnosticWriter(
  writer: BackendDiagnosticWriter | null,
): () => void {
  const previous = diagnosticWriter;
  diagnosticWriter = writer;
  return () => {
    if (diagnosticWriter === writer) diagnosticWriter = previous;
  };
}

function sanitizeText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(
      /(["']?(?:refresh[_-]?token|access[_-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^,"'\s}]+/gi,
      "$1[redacted]",
    )
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted]")
    .slice(0, MAX_MESSAGE_LENGTH);
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return sanitizeText(value);
  if (value instanceof Error) {
    return sanitizeText(
      `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`,
    );
  }
  try {
    const serialized = JSON.stringify(value);
    return sanitizeText(serialized === undefined ? String(value) : serialized);
  } catch {
    return sanitizeText(String(value));
  }
}

function requestErrorCategory(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof Error) return error.name || "error";
  return "unknown";
}

function safeLog(
  backend: Backend,
  level: LogEntryLevel,
  target: string,
  message: string,
): void {
  try {
    void Promise.resolve(backend.logWrite(level, target, sanitizeText(message))).catch(
      () => undefined,
    );
  } catch {
    // Instrumentation must never alter the operation it observes.
  }
}

function logThroughBackend(
  backend: Backend,
  level: LogEntryLevel,
  target: string,
  message: string,
): void {
  safeLog(backend, level, target, message);
}

function safeUrl(input: RequestInfo | URL): string {
  let raw: string;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = input.url;
  try {
    const url = new URL(raw, window.location.href);
    return `${url.protocol}//${url.host}${url.pathname || "/"}`;
  } catch {
    return sanitizeText(raw.split(/[?#]/, 1)[0]);
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function responseContentLength(response: Response): string | null {
  try {
    return response.headers?.get("content-length") ?? null;
  } catch {
    return null;
  }
}

function installFetchDiagnostics(backend: Backend): () => void {
  const originalFetch = globalThis.fetch;
  const wrappedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const method = requestMethod(input, init);
    const url = safeUrl(input);
    const startedAt = Date.now();
    logThroughBackend(backend, "debug", "http.fetch", `start method=${method} url=${url}`);
    try {
      const response = await originalFetch(input, init);
      const level: LogEntryLevel = response.status >= 400 ? "warn" : "info";
      const contentLength = responseContentLength(response);
      logThroughBackend(
        backend,
        level,
        "http.fetch",
        `complete method=${method} url=${url} status=${response.status} durationMs=${Date.now() - startedAt}${contentLength === null ? "" : ` contentLength=${contentLength}`}`,
      );
      return response;
    } catch (error) {
      logThroughBackend(
        backend,
        "error",
        "http.fetch",
        `failed method=${method} url=${url} durationMs=${Date.now() - startedAt} category=${requestErrorCategory(error)}`,
      );
      throw error;
    }
  };
  globalThis.fetch = wrappedFetch as typeof globalThis.fetch;
  return () => {
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
  };
}

function installConsoleDiagnostics(backend: Backend): () => void {
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  const wrappers = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  for (const method of CONSOLE_METHODS) {
    const original = console[method] as (...args: unknown[]) => void;
    originals.set(method, original);
    const wrapper = (...args: unknown[]): void => {
      try {
        original.apply(console, args);
      } finally {
        const level: LogEntryLevel = method === "warn"
          ? "warn"
          : method === "error"
            ? "error"
            : method === "info"
              ? "info"
              : "debug";
        logThroughBackend(
          backend,
          level,
          "console",
          args.map(formatUnknown).join(" "),
        );
      }
    };
    wrappers.set(method, wrapper);
    console[method] = wrapper as Console[typeof method];
  }
  return () => {
    for (const method of CONSOLE_METHODS) {
      const original = originals.get(method);
      const wrapper = wrappers.get(method);
      if (original && wrapper && console[method] === wrapper) {
        console[method] = original as Console[typeof method];
      }
    }
  };
}

function controlIdentifier(element: Element): string {
  for (const attribute of ["data-testid", "aria-label", "name", "id"]) {
    const value = element.getAttribute(attribute);
    if (value) return sanitizeText(value);
  }
  return element.tagName.toLowerCase();
}

function controlForEvent(target: EventTarget | null, selector: string): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(selector);
}

function installUiDiagnostics(backend: Backend): () => void {
  const onClick = (event: MouseEvent): void => {
    const element = controlForEvent(event.target, "button,a");
    if (!element) return;
    logThroughBackend(
      backend,
      "debug",
      "ui.action",
      `event=click element=${element.tagName.toLowerCase()} control=${controlIdentifier(element)}`,
    );
  };
  const onChange = (event: Event): void => {
    const element = controlForEvent(event.target, "select,input[type=checkbox],input[type=radio]");
    if (!element) return;
    logThroughBackend(
      backend,
      "debug",
      "ui.action",
      `event=change element=${element.tagName.toLowerCase()} control=${controlIdentifier(element)}`,
    );
  };
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  return () => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("change", onChange);
  };
}

function installGlobalErrorDiagnostics(backend: Backend): () => void {
  const onError = (event: ErrorEvent): void => {
    logThroughBackend(backend, "error", "runtime", `uncaught=${formatUnknown(event.error ?? event.message)}`);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    logThroughBackend(backend, "error", "runtime", `unhandledRejection=${formatUnknown(event.reason)}`);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export function installRuntimeDiagnostics(backend: Backend): () => void {
  if (activeCleanup) return activeCleanup;

  const cleanups = [
    installFetchDiagnostics(backend),
    installConsoleDiagnostics(backend),
    installUiDiagnostics(backend),
    installGlobalErrorDiagnostics(backend),
  ];
  let disposed = false;
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    for (const dispose of cleanups.reverse()) dispose();
    if (activeCleanup === cleanup) activeCleanup = null;
  };
  activeCleanup = cleanup;
  return cleanup;
}

export function writeBackendDiagnostic(
  level: LogEntryLevel,
  target: string,
  message: string,
): void {
  diagnosticWriter?.(level, target, message);
}

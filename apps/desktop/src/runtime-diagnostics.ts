import type { Backend, LogEntryLevel, LogLevel } from "./api/backend";

const MAX_MESSAGE_LENGTH = 1200;
const MAX_PENDING_WRITES = 256;
const CONSOLE_METHODS = ["debug", "info", "warn", "error", "log"] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export type BackendDiagnosticWriter = (
  level: LogEntryLevel,
  target: string,
  message: string,
) => void;

let diagnosticWriter: BackendDiagnosticWriter | null = null;
let activeCleanup: (() => void) | null = null;
let diagnosticLevel: LogLevel = "off";

export function setBackendDiagnosticLevel(level: LogLevel): void {
  diagnosticLevel = level;
}

function acceptsDiagnosticLevel(level: LogEntryLevel): boolean {
  return diagnosticLevel !== "off" && LOG_LEVEL_RANK[diagnosticLevel] >= LOG_LEVEL_RANK[level];
}

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

interface DiagnosticSink {
  write(level: LogEntryLevel, target: string, message: string): void;
  dispose(): void;
}

function createDiagnosticSink(backend: Backend): DiagnosticSink {
  type PendingWrite = [LogEntryLevel, string, string];
  const pending: PendingWrite[] = [];
  let draining = false;
  let disposed = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (!disposed && pending.length > 0) {
        const next = pending.shift();
        if (!next || !acceptsDiagnosticLevel(next[0])) continue;
        try {
          await backend.logWrite(next[0], next[1], sanitizeText(next[2]));
        } catch {
          // Instrumentation must never alter the operation it observes.
        }
      }
    } finally {
      draining = false;
      if (!disposed && pending.length > 0) void drain();
    }
  }

  return {
    write(level, target, message) {
      if (disposed || !acceptsDiagnosticLevel(level)) return;
      if (pending.length >= MAX_PENDING_WRITES) pending.shift();
      pending.push([level, target, message]);
      void drain();
    },
    dispose() {
      disposed = true;
      pending.length = 0;
    },
  };
}

function logThroughBackend(
  sink: DiagnosticSink,
  level: LogEntryLevel,
  target: string,
  message: string,
): void {
  sink.write(level, target, message);
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

function isInternalTauriIpc(input: RequestInfo | URL): boolean {
  try {
    return new URL(safeUrl(input)).hostname === "ipc.localhost";
  } catch {
    return false;
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

function installFetchDiagnostics(sink: DiagnosticSink): () => void {
  const originalFetch = globalThis.fetch;
  const wrappedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (isInternalTauriIpc(input)) return originalFetch(input, init);
    const method = requestMethod(input, init);
    const url = safeUrl(input);
    const startedAt = Date.now();
    logThroughBackend(sink, "debug", "http.fetch", `start method=${method} url=${url}`);
    try {
      const response = await originalFetch(input, init);
      const level: LogEntryLevel = response.status >= 400 ? "warn" : "info";
      const contentLength = responseContentLength(response);
      logThroughBackend(
        sink,
        level,
        "http.fetch",
        `complete method=${method} url=${url} status=${response.status} durationMs=${Date.now() - startedAt}${contentLength === null ? "" : ` contentLength=${contentLength}`}`,
      );
      return response;
    } catch (error) {
      logThroughBackend(
        sink,
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

function installConsoleDiagnostics(sink: DiagnosticSink): () => void {
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
        const message = args.map(formatUnknown).join(" ");
        if (/\[TAURI\]\s*Couldn't find callback id\b/i.test(message)) return;
        logThroughBackend(sink, level, "console", message);
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

function installUiDiagnostics(sink: DiagnosticSink): () => void {
  const onClick = (event: MouseEvent): void => {
    const element = controlForEvent(event.target, "button,a");
    if (!element) return;
    logThroughBackend(
      sink,
      "debug",
      "ui.action",
      `event=click element=${element.tagName.toLowerCase()} control=${controlIdentifier(element)}`,
    );
  };
  const onChange = (event: Event): void => {
    const element = controlForEvent(event.target, "select,input[type=checkbox],input[type=radio]");
    if (!element) return;
    logThroughBackend(
      sink,
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

function installGlobalErrorDiagnostics(sink: DiagnosticSink): () => void {
  const onError = (event: ErrorEvent): void => {
    logThroughBackend(sink, "error", "runtime", `uncaught=${formatUnknown(event.error ?? event.message)}`);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    logThroughBackend(sink, "error", "runtime", `unhandledRejection=${formatUnknown(event.reason)}`);
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

  const sink = createDiagnosticSink(backend);
  const cleanups = [
    installFetchDiagnostics(sink),
    installConsoleDiagnostics(sink),
    installUiDiagnostics(sink),
    installGlobalErrorDiagnostics(sink),
  ];
  let disposed = false;
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    for (const dispose of cleanups.reverse()) dispose();
    sink.dispose();
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
  if (acceptsDiagnosticLevel(level)) diagnosticWriter?.(level, target, message);
}

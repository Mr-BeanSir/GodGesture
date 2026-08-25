import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend, LogEntryLevel } from "./api/backend";
import {
  installRuntimeDiagnostics,
  setBackendDiagnosticLevel,
} from "./runtime-diagnostics";

type LogCall = [LogEntryLevel, string, string];

const backend = {
  logWrite: vi.fn(async (..._args: LogCall) => undefined),
} as unknown as Backend;

const originalFetch = globalThis.fetch;
const originalConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  log: console.log,
};

let cleanup: (() => void) | undefined;

beforeEach(() => {
  setBackendDiagnosticLevel("debug");
});

function messages(): string[] {
  return vi.mocked(backend.logWrite).mock.calls.map((call) => call[2]);
}

function levels(): LogEntryLevel[] {
  return vi.mocked(backend.logWrite).mock.calls.map((call) => call[0]);
}

async function flushDiagnosticWrites(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  globalThis.fetch = originalFetch;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
  document.body.innerHTML = "";
  vi.mocked(backend.logWrite)
    .mockReset()
    .mockImplementation(async (..._args: LogCall) => undefined);
  setBackendDiagnosticLevel("off");
});

describe("runtime diagnostics", () => {
  it("records fetch start and successful response without URL query or body", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 204,
      headers: { get: (name: string) => (name === "content-length" ? "0" : null) },
    })) as unknown as typeof fetch;
    cleanup = installRuntimeDiagnostics(backend);

    await fetch("https://user:password@example.test/api/config?access_token=secret#fragment", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: "password=secret",
    });
    await flushDiagnosticWrites();

    expect(levels()).toEqual(["debug", "info"]);
    expect(messages().join("\n")).toContain("url=https://example.test/api/config");
    expect(messages().join("\n")).toContain("status=204");
    expect(messages().join("\n")).not.toContain("password");
    expect(messages().join("\n")).not.toContain("secret");
    expect(messages().join("\n")).not.toContain("token");
    expect(messages().join("\n")).not.toContain("access_token");
  });

  it("does not record internal Tauri IPC fetches", async () => {
    const nativeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
    })) as unknown as typeof fetch;
    globalThis.fetch = nativeFetch;
    cleanup = installRuntimeDiagnostics(backend);

    await fetch("http://ipc.localhost/log_write");
    await flushDiagnosticWrites();

    expect(vi.mocked(backend.logWrite)).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it("classifies HTTP failures and network errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => null },
      })
      .mockRejectedValueOnce(new Error("network offline")) as unknown as typeof fetch;
    cleanup = installRuntimeDiagnostics(backend);

    await fetch("https://example.test/api?secret=hidden");
    await expect(fetch("https://example.test/api?secret=hidden")).rejects.toThrow("network offline");
    await flushDiagnosticWrites();

    expect(levels()).toEqual(["debug", "warn", "debug", "error"]);
    expect(messages().join("\n")).toContain("status=503");
    expect(messages().join("\n")).not.toContain("hidden");
  });

  it("preserves console methods while recording sanitized output", async () => {
    const nativeWarn = vi.fn();
    console.warn = nativeWarn;
    cleanup = installRuntimeDiagnostics(backend);

    console.warn("Authorization: Bearer very-secret-token");
    await flushDiagnosticWrites();

    expect(nativeWarn).toHaveBeenCalledWith("Authorization: Bearer very-secret-token");
    expect(levels()).toEqual(["warn"]);
    expect(messages()[0]).not.toContain("very-secret-token");
  });

  it("does not create IPC work while local collection is disabled", async () => {
    setBackendDiagnosticLevel("off");
    const nativeWarn = vi.fn();
    console.warn = nativeWarn;
    cleanup = installRuntimeDiagnostics(backend);

    console.warn("this must stay local");
    await flushDiagnosticWrites();

    expect(nativeWarn).toHaveBeenCalledWith("this must stay local");
    expect(vi.mocked(backend.logWrite)).not.toHaveBeenCalled();
  });

  it("does not feed Tauri callback warnings back into the diagnostic IPC path", async () => {
    const nativeError = vi.fn();
    console.error = nativeError;
    cleanup = installRuntimeDiagnostics(backend);

    console.error("[TAURI] Couldn't find callback id 2547625492");
    await flushDiagnosticWrites();

    expect(nativeError).toHaveBeenCalledWith("[TAURI] Couldn't find callback id 2547625492");
    expect(vi.mocked(backend.logWrite)).not.toHaveBeenCalled();
  });

  it("serializes a console burst instead of leaving every IPC callback in flight", async () => {
    const nativeDebug = vi.fn();
    console.debug = nativeDebug;
    const resolvers: Array<() => void> = [];
    vi.mocked(backend.logWrite).mockImplementation(
      async () => await new Promise<void>((resolve) => resolvers.push(resolve)),
    );
    cleanup = installRuntimeDiagnostics(backend);

    console.debug("first");
    console.debug("second");
    console.debug("third");

    expect(vi.mocked(backend.logWrite)).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await flushDiagnosticWrites();
    expect(vi.mocked(backend.logWrite)).toHaveBeenCalledTimes(2);
    resolvers.shift()?.();
    await flushDiagnosticWrites();
    expect(vi.mocked(backend.logWrite)).toHaveBeenCalledTimes(3);
    resolvers.shift()?.();
  });

  it("records uncaught errors and rejected promises without serializing event data", async () => {
    cleanup = installRuntimeDiagnostics(backend);
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("render failed"),
      message: "render failed",
    }));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      value: { message: "promise failed", accessToken: "secret-token" },
    });
    window.dispatchEvent(rejection);
    await flushDiagnosticWrites();

    expect(levels()).toEqual(["error", "error"]);
    expect(messages().join("\n")).toContain("render failed");
    expect(messages().join("\n")).toContain("promise failed");
    expect(messages().join("\n")).not.toContain("secret-token");
  });

  it("records stable UI identifiers without visible text or input values", async () => {
    const button = document.createElement("button");
    button.dataset.testid = "save-config";
    button.textContent = "secret visible label";
    document.body.append(button);
    const select = document.createElement("select");
    select.setAttribute("aria-label", "locale-selector");
    const option = document.createElement("option");
    option.value = "secret-input-value";
    select.append(option);
    document.body.append(select);
    cleanup = installRuntimeDiagnostics(backend);

    button.click();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushDiagnosticWrites();

    expect(levels()).toEqual(["debug", "debug"]);
    expect(messages().join("\n")).toContain("save-config");
    expect(messages().join("\n")).toContain("locale-selector");
    expect(messages().join("\n")).not.toContain("secret visible label");
    expect(messages().join("\n")).not.toContain("secret-input-value");
  });

  it("installs once and restores all wrapped globals on cleanup", async () => {
    const nativeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
    }));
    globalThis.fetch = nativeFetch as unknown as typeof fetch;
    const firstCleanup = installRuntimeDiagnostics(backend);
    const secondCleanup = installRuntimeDiagnostics(backend);

    expect(secondCleanup).toBe(firstCleanup);
    await fetch("https://example.test/once");
    await flushDiagnosticWrites();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backend.logWrite)).toHaveBeenCalledTimes(2);

    firstCleanup();
    await fetch("https://example.test/after-cleanup");
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(backend.logWrite)).toHaveBeenCalledTimes(2);
  });
});

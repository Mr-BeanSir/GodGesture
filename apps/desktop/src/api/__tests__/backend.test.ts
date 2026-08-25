import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invokeCommand,
  setBackendDiagnosticWriter,
} from "../backend";
import { setBackendDiagnosticLevel } from "../../runtime-diagnostics";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("Tauri invoke diagnostics", () => {
  let restoreWriter: (() => void) | undefined;

  beforeEach(() => {
    invoke.mockReset();
    setBackendDiagnosticLevel("debug");
  });

  afterEach(() => {
    restoreWriter?.();
    restoreWriter = undefined;
    setBackendDiagnosticLevel("off");
  });

  it("records command timing without arguments or result", async () => {
    const writer = vi.fn();
    restoreWriter = setBackendDiagnosticWriter(writer);
    invoke.mockResolvedValue({ ok: true });

    await expect(
      invokeCommand("config_set", { document: { accessToken: "secret-token" } }),
    ).resolves.toEqual({ ok: true });

    expect(invoke).toHaveBeenCalledWith("config_set", {
      document: { accessToken: "secret-token" },
    });
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer.mock.calls[0]).toEqual(["debug", "ipc", "start command=config_set"]);
    expect(writer.mock.calls[1][0]).toBe("debug");
    expect(writer.mock.calls[1][1]).toBe("ipc");
    expect(writer.mock.calls[1][2]).toMatch(/^success command=config_set durationMs=\d+$/);
    expect(writer.mock.calls.map((call) => call[2]).join("\n")).not.toContain("secret-token");
  });

  it("records a failed command and preserves the original error", async () => {
    const writer = vi.fn();
    restoreWriter = setBackendDiagnosticWriter(writer);
    const failure = new Error("permission denied");
    invoke.mockRejectedValue(failure);

    await expect(invokeCommand("machine_set", { settings: { token: "secret" } })).rejects.toBe(failure);

    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer.mock.calls[0]).toEqual(["debug", "ipc", "start command=machine_set"]);
    expect(writer.mock.calls[1][0]).toBe("error");
    expect(writer.mock.calls[1][1]).toBe("ipc");
    expect(writer.mock.calls[1][2]).toMatch(/^failed command=machine_set durationMs=\d+$/);
    expect(writer.mock.calls.map((call) => call[2]).join("\n")).not.toContain("secret");
  });
});

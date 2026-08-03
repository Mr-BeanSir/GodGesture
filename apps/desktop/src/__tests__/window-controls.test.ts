import { describe, expect, it, vi } from "vitest";
import {
  closeSettingsWindow,
  minimizeSettingsWindow,
  type SettingsWindowControls,
} from "../window-controls";

function windowStub(): SettingsWindowControls {
  return {
    minimize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("settings window controls", () => {
  it("minimizes without requesting close", async () => {
    const target = windowStub();

    await minimizeSettingsWindow(target);

    expect(target.minimize).toHaveBeenCalledOnce();
    expect(target.close).not.toHaveBeenCalled();
  });

  it("requests close so Rust can preserve close-to-tray behavior", async () => {
    const target = windowStub();

    await closeSettingsWindow(target);

    expect(target.close).toHaveBeenCalledOnce();
    expect(target.minimize).not.toHaveBeenCalled();
  });
});

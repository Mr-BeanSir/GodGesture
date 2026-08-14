import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  it("keeps the native title bar aligned with the fixed Desktop header", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/WindowControls.vue"), "utf8");

    expect(source).toMatch(/\.window-controls\s*\{[\s\S]*?height:\s*48px;/);
    expect(source).toMatch(/\.window-controls__button\s*\{[\s\S]*?height:\s*48px;/);
  });

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

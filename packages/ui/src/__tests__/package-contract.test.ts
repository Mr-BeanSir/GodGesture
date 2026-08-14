import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as ui from "../index";

describe("shared UI package contract", () => {
  it("exports the shared primitive entry points", () => {
    expect(ui).toHaveProperty("AppButton");
    expect(ui).toHaveProperty("AppBadge");
    expect(ui).toHaveProperty("AppAlert");
    expect(ui).toHaveProperty("AppDialog");
    expect(ui).toHaveProperty("AppCollapsiblePanel");
    expect(ui).toHaveProperty("AppEmptyState");
    expect(ui).toHaveProperty("AppSpinner");
    expect(ui).toHaveProperty("AppTabs");
    expect(ui).toHaveProperty("AppSkeleton");
    expect(ui).toHaveProperty("ToastViewport");
    expect(ui).toHaveProperty("pushToast");
    expect(ui).toHaveProperty("useConfirmDialog");
  });

  it("defines the console token and base style contract", async () => {
    const stylesheet = await readFile(join(process.cwd(), "src", "styles.css"), "utf8");

    expect(stylesheet).toContain("--gg-canvas");
    expect(stylesheet).toContain("--gg-surface");
    expect(stylesheet).toContain("--gg-primary");
    expect(stylesheet).toContain("--gg-ring");
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesheet).toContain(".gg-input");
    expect(stylesheet).toContain(".gg-table");
    expect(stylesheet).toMatch(/\.gg-tabs__list\s*\{[^}]*overflow-y:\s*hidden/s);
    expect(stylesheet).toMatch(/\.gg-tabs__list::-webkit-scrollbar\s*\{[^}]*display:\s*none/s);
    expect(stylesheet).toContain(".gg-toast-viewport--top-right");
  });
});

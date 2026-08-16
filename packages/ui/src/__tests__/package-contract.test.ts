import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as ui from "../index";

describe("shared UI package contract", () => {
  it("exports the shared primitive entry points", () => {
    expect(ui).toHaveProperty("AppButton");
    expect(ui).toHaveProperty("AppBadge");
    expect(ui).toHaveProperty("AppAlert");
    expect(ui).toHaveProperty("AppMessage");
    expect(ui).toHaveProperty("AppMessageViewport");
    expect(ui).toHaveProperty("AppDialog");
    expect(ui).toHaveProperty("AppCollapsiblePanel");
    expect(ui).toHaveProperty("AppEmptyState");
    expect(ui).toHaveProperty("AppSpinner");
    expect(ui).toHaveProperty("AppTabs");
    expect(ui).toHaveProperty("AppSkeleton");
    expect(ui).toHaveProperty("ToastViewport");
    expect(ui).toHaveProperty("pushToast");
    expect(ui).toHaveProperty("pushMessage");
    expect(ui).toHaveProperty("useMessages");
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
    expect(stylesheet).toMatch(/\.gg-message\s*\{[^}]*position:\s*fixed/s);
    expect(stylesheet).toContain("top: calc(60px + var(--gg-message-offset, 0px))");
    expect(stylesheet).toContain("transition: opacity 220ms ease-out, transform 220ms ease-out");
    expect(stylesheet).toContain("transition: opacity 150ms ease-in, transform 150ms ease-in");
    expect(stylesheet).toContain("transform: translate(-50%, -12px)");
    expect(stylesheet).toContain("transform: translate(-50%, -8px)");
  });
});

import { describe, expect, it } from "vitest";
import {
  GestureTemplateCatalog,
  GestureTemplatePackage,
  GestureTemplateProtocolError,
  MAX_GESTURE_TEMPLATE_CATALOG_BYTES,
  gestureTemplatePackageRisks,
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  verifyGestureTemplatePackage,
} from "../../index.js";

const packageValue = () =>
  GestureTemplatePackage.parse({
    formatVersion: 1,
    slug: "browser-navigation",
    version: "1.2.0",
    target: {
      scope: "app",
      name: "Browser",
      windows: { exeName: "browser.exe" },
      mac: { bundleId: "com.example.browser" },
      intents: [
        {
          name: "Back",
          gesture: {
            trigger: "right",
            strokes: ["left"],
            modifier: "none",
          },
          command: { type: "hotKey", modifiers: ["alt"], keys: ["left"] },
          executeOnModifier: false,
        },
      ],
    },
  });

const entryValue = () => ({
  slug: "browser-navigation",
  version: "1.2.0",
  title: { "zh-CN": "浏览器导航", en: "Browser navigation" },
  summary: { "zh-CN": "浏览器前进后退", en: "Browser history navigation" },
  author: "GodGesture",
  tags: ["browser", "navigation"],
  target: {
    scope: "app" as const,
    name: "Browser",
    windows: { exeName: "browser.exe", matchByExactPath: false },
    mac: { bundleId: "com.example.browser" },
  },
  risks: [],
  packageUrl:
    "https://github.com/godgesture/gesture-templates/releases/download/v1/browser-navigation.json",
});

describe("gesture template protocol", () => {
  it("parses and cross-checks a valid catalog and package", () => {
    const catalog = parseGestureTemplateCatalog(
      JSON.stringify({
        formatVersion: 1,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [entryValue()],
      }),
    );
    const templatePackage = parseGestureTemplatePackage(
      JSON.stringify(packageValue()),
    );

    expect(catalog.entries).toHaveLength(1);
    expect(
      verifyGestureTemplatePackage(catalog.entries[0]!, templatePackage),
    ).toEqual(templatePackage);
  });

  it("rejects malformed, oversized, non-HTTPS, and unknown data", () => {
    expectProtocolCode(() => parseGestureTemplateCatalog("{"), "invalid_json");
    expectProtocolCode(
      () =>
        parseGestureTemplateCatalog(
          "x".repeat(MAX_GESTURE_TEMPLATE_CATALOG_BYTES + 1),
        ),
      "catalog_too_large",
    );
    expect(() =>
      GestureTemplateCatalog.parse({
        formatVersion: 1,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [{ ...entryValue(), packageUrl: "http://example.com/a.json" }],
      }),
    ).toThrow();
    expect(() =>
      GestureTemplateCatalog.parse({
        formatVersion: 1,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [{ ...entryValue(), unexpected: true }],
      }),
    ).toThrow();
  });

  it("requires unique catalog identities and package gestures", () => {
    expect(() =>
      GestureTemplateCatalog.parse({
        formatVersion: 1,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [entryValue(), entryValue()],
      }),
    ).toThrow();
    const value = packageValue();
    expect(() =>
      GestureTemplatePackage.parse({
        ...value,
        target: {
          ...value.target,
          intents: [value.target.intents[0], value.target.intents[0]],
        },
      }),
    ).toThrow();
  });

  it("derives executable command risks and rejects catalog drift", () => {
    const templatePackage = GestureTemplatePackage.parse({
      formatVersion: 1,
      slug: "risky-tools",
      version: "1.0.0",
      target: {
        scope: "global",
        intents: [
          intent("Script", { type: "script", script: "ReportStatus('ok')" }),
          intent("Shell", { type: "cmd", code: "echo ok" }),
          intent("File", { type: "openFile", path: "tool.exe" }),
          intent("URL", { type: "gotoUrl", url: "https://example.com" }),
        ],
      },
    });
    expect(gestureTemplatePackageRisks(templatePackage)).toEqual([
      "script",
      "commandLine",
      "fileOrProgram",
      "externalUrl",
    ]);

    const entry = GestureTemplateCatalog.parse({
      formatVersion: 1,
      generatedAt: "2026-07-28T12:00:00Z",
      entries: [
        {
          ...entryValue(),
          slug: "risky-tools",
          version: "1.0.0",
          target: { scope: "global" },
          risks: [],
        },
      ],
    }).entries[0]!;
    expectProtocolCode(
      () => verifyGestureTemplatePackage(entry, templatePackage),
      "risk_mismatch",
    );
  });

  it("rejects package identity and target drift", () => {
    const templatePackage = packageValue();
    expectProtocolCode(
      () =>
        verifyGestureTemplatePackage(
          { ...entryValue(), slug: "different" },
          templatePackage,
        ),
      "identity_mismatch",
    );
    expectProtocolCode(
      () =>
        verifyGestureTemplatePackage(
          { ...entryValue(), target: { scope: "global" } },
          templatePackage,
        ),
      "target_mismatch",
    );
  });
});

function intent(name: string, command: Record<string, unknown>) {
  return {
    name,
    gesture: {
      trigger: "right",
      strokes: [name === "Script" ? "up" : name === "Shell" ? "right" : name === "File" ? "down" : "left"],
      modifier: "none",
    },
    command,
    executeOnModifier: false,
  };
}

function expectProtocolCode(operation: () => unknown, code: string) {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GestureTemplateProtocolError);
    expect((error as GestureTemplateProtocolError).code).toBe(code);
  }
}

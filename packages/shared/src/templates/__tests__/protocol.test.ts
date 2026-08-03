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

  it("uses the recorded input order for gesture identity", () => {
    const value = packageValue();
    const first = value.target.intents[0]!;
    const second = {
      ...first,
      name: "Forward after middle button",
      gesture: {
        ...first.gesture,
        strokes: ["right"],
        inputs: [
          { type: "button" as const, button: "middle" as const },
          { type: "stroke" as const, direction: "right" as const },
        ],
      },
    };
    expect(() => GestureTemplatePackage.parse({
      ...value,
      target: { ...value.target, intents: [first, second] },
    })).not.toThrow();

    const reverse = {
      ...second,
      name: "Forward before middle button",
      gesture: {
        ...second.gesture,
        inputs: [
          { type: "stroke" as const, direction: "right" as const },
          { type: "button" as const, button: "middle" as const },
        ],
      },
    };
    expect(() => GestureTemplatePackage.parse({
      ...value,
      target: { ...value.target, intents: [second, reverse] },
    })).not.toThrow();

    const repeated = {
      ...first,
      name: "Back on wheel",
      gesture: { ...first.gesture, modifier: "wheelBackward" as const },
    };
    expect(() => GestureTemplatePackage.parse({
      ...value,
      target: { ...value.target, intents: [first, repeated] },
    })).not.toThrow();
  });

  it("derives executable command risks and rejects catalog drift", () => {
    const templatePackage = GestureTemplatePackage.parse({
      formatVersion: 1,
      slug: "risky-tools",
      version: "1.0.0",
      target: {
        scope: "global",
        intents: [
          intent("Node plugin", { type: "nodePlugin", pluginId: "00000000-0000-4000-8000-000000000001", exportName: "execute" }),
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
      strokes: [name === "Node plugin" ? "up" : name === "Shell" ? "right" : name === "File" ? "down" : "left"],
      modifier: "none",
    },
    command,
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

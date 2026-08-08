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
    formatVersion: 2,
    slug: "browser-navigation",
    version: "1.2.0",
    author: "GodGesture",
    targets: [{
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
    }],
  });

const entryValue = () => ({
  slug: "browser-navigation",
  version: "1.2.0",
  title: { "zh-CN": "浏览器导航", en: "Browser navigation" },
  summary: { "zh-CN": "浏览器前进后退", en: "Browser history navigation" },
  author: "GodGesture",
  tags: ["browser", "navigation"],
  targets: [{
    scope: "app" as const,
    name: "Browser",
    windows: { exeName: "browser.exe", matchByExactPath: false },
    mac: { bundleId: "com.example.browser" },
  }],
  risks: [],
  packageUrl:
    "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/packages/browser-navigation.json",
});

describe("gesture template protocol", () => {
  it("parses and cross-checks a valid catalog and package", () => {
    const catalog = parseGestureTemplateCatalog(
      JSON.stringify({
        formatVersion: 2,
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

  it("normalizes legacy single-target payloads at the download boundary", () => {
    const { targets: catalogTargets, ...legacyEntry } = entryValue();
    const legacyCatalog = parseGestureTemplateCatalog(
      JSON.stringify({
        formatVersion: 1,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [{ ...legacyEntry, target: catalogTargets[0] }],
      }),
    );
    expect(legacyCatalog.formatVersion).toBe(2);
    expect(legacyCatalog.entries[0]?.targets).toEqual([catalogTargets[0]]);

    const { targets: packageTargets, ...legacyPackage } = packageValue();
    const normalizedPackage = parseGestureTemplatePackage(
      JSON.stringify({
        ...legacyPackage,
        formatVersion: 1,
        target: packageTargets[0],
      }),
    );
    expect(normalizedPackage.formatVersion).toBe(2);
    expect(normalizedPackage.targets).toEqual([packageTargets[0]]);
  });

  it("fills legacy release metadata and removes obsolete modifier execution flags", () => {
    const normalizedPackage = parseGestureTemplatePackage(
      JSON.stringify({
        formatVersion: 1,
        slug: "global-window-basics",
        version: "1.0.0",
        target: {
          scope: "global",
          intents: [{
            name: "Maximize window",
            gesture: {
              trigger: "right",
              strokes: ["up"],
              modifier: "none",
            },
            command: {
              type: "windowControl",
              operation: "maximizeRestore",
            },
            executeOnModifier: false,
          }],
        },
      }),
      {
        author: "GodGesture",
        title: { "zh-CN": "全局窗口基础手势", en: "Global window basics" },
        summary: { "zh-CN": "窗口基础操作", en: "Basic window controls" },
        tags: ["window", "global"],
      },
    );

    expect(normalizedPackage).toMatchObject({
      formatVersion: 2,
      author: "GodGesture",
      title: { "zh-CN": "全局窗口基础手势" },
      summary: { en: "Basic window controls" },
      tags: ["window", "global"],
      targets: [{ scope: "global" }],
    });
    expect(normalizedPackage.targets[0]?.intents[0]).not.toHaveProperty(
      "executeOnModifier",
    );
  });

  it("accepts a package containing global and multiple app targets", () => {
    const value = packageValue();
    const sampleIntent = value.targets[0]!.intents[0]!;
    const multiTarget = parseGestureTemplatePackage(
      JSON.stringify({
        ...value,
        targets: [
          {
            scope: "global",
            intents: [{ ...sampleIntent, name: "Global back" }],
          },
          ...value.targets,
          {
            scope: "app",
            name: "Second Browser",
            windows: { exeName: "second-browser.exe" },
            intents: [{ ...sampleIntent, name: "Second browser back" }],
          },
        ],
      }),
    );
    expect(multiTarget.targets).toHaveLength(3);
    expect(multiTarget.targets.map((target) => target.scope)).toEqual([
      "global",
      "app",
      "app",
    ]);
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
        formatVersion: 2,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [{ ...entryValue(), packageUrl: "http://example.com/a.json" }],
      }),
    ).toThrow();
    expect(() =>
      GestureTemplateCatalog.parse({
        formatVersion: 2,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [{ ...entryValue(), unexpected: true }],
      }),
    ).toThrow();
  });

  it("requires an author in every template package", () => {
    expect(() =>
      GestureTemplatePackage.parse({ ...packageValue(), author: undefined }),
    ).toThrow();
  });

  it("requires unique catalog identities and package gestures", () => {
    expect(() =>
      GestureTemplateCatalog.parse({
        formatVersion: 2,
        generatedAt: "2026-07-28T12:00:00Z",
        entries: [entryValue(), entryValue()],
      }),
    ).toThrow();
    const value = packageValue();
    expect(() =>
      GestureTemplatePackage.parse({
        ...value,
        targets: [{
          ...value.targets[0],
          intents: [value.targets[0]!.intents[0], value.targets[0]!.intents[0]],
        }],
      }),
    ).toThrow();
  });

  it("uses the recorded input order for gesture identity", () => {
    const value = packageValue();
    const first = value.targets[0]!.intents[0]!;
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
      targets: [{ ...value.targets[0], intents: [first, second] }],
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
      targets: [{ ...value.targets[0], intents: [second, reverse] }],
    })).not.toThrow();

    const repeated = {
      ...first,
      name: "Back on wheel",
      gesture: { ...first.gesture, modifier: "wheelBackward" as const },
    };
    expect(() => GestureTemplatePackage.parse({
      ...value,
      targets: [{ ...value.targets[0], intents: [first, repeated] }],
    })).not.toThrow();
  });

  it("derives executable command risks and rejects catalog drift", () => {
    const templatePackage = GestureTemplatePackage.parse({
      formatVersion: 2,
      slug: "risky-tools",
      version: "1.0.0",
      author: "GodGesture",
      plugins: [
        {
          pluginId: "00000000-0000-4000-8000-000000000001",
          repositoryUrl: "https://github.com/Mr-BeanSir/GodGesture-Plugins",
          ref: "main",
          subdirectory: "gesture-demo",
        },
      ],
      targets: [{
        scope: "global",
        intents: [
          intent("Node plugin", { type: "nodePlugin", pluginId: "00000000-0000-4000-8000-000000000001" }),
          intent("Shell", { type: "cmd", code: "echo ok" }),
          intent("PowerShell", { type: "powershell", code: "Write-Output ok" }),
          intent("File", { type: "openFile", path: "tool.exe" }),
          intent("URL", { type: "gotoUrl", url: "https://example.com" }),
        ],
      }],
    });
    expect(gestureTemplatePackageRisks(templatePackage)).toEqual([
      "script",
      "commandLine",
      "fileOrProgram",
      "externalUrl",
    ]);

    const entry = GestureTemplateCatalog.parse({
      formatVersion: 2,
      generatedAt: "2026-07-28T12:00:00Z",
      entries: [
        {
          ...entryValue(),
          slug: "risky-tools",
          version: "1.0.0",
          targets: [{ scope: "global" }],
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
          { ...entryValue(), targets: [{ scope: "global" }] },
          templatePackage,
        ),
      "target_mismatch",
    );
  });

  it("requires template plugin sources and Node plugin commands to map to each other", () => {
    expect(() =>
      GestureTemplatePackage.parse({
        formatVersion: 2,
        slug: "plugin-command",
        version: "1.0.0",
        author: "GodGesture",
        targets: [{
          scope: "global",
          intents: [
            intent("Node plugin", {
              type: "nodePlugin",
              pluginId: "00000000-0000-4000-8000-000000000001",
            }),
          ],
        }],
      }),
    ).toThrow();

    expect(() =>
      GestureTemplatePackage.parse({
        formatVersion: 2,
        slug: "plugin-command",
        version: "1.0.0",
        author: "GodGesture",
        plugins: [
          {
            pluginId: "00000000-0000-4000-8000-000000000001",
            repositoryUrl: "https://github.com/owner/repository",
            ref: "main",
            subdirectory: "plugin",
          },
        ],
        targets: [{
          scope: "global",
          intents: [
            intent("Node plugin", {
              type: "nodePlugin",
              pluginId: "00000000-0000-4000-8000-000000000001",
            }),
          ],
        }],
      }),
    ).not.toThrow();

    expect(() =>
      GestureTemplatePackage.parse({
        formatVersion: 2,
        slug: "plugin-command",
        version: "1.0.0",
        author: "GodGesture",
        plugins: [
          {
            pluginId: "00000000-0000-4000-8000-000000000001",
            repositoryUrl: "https://github.com/owner/repository",
            ref: "main",
            subdirectory: "plugin",
          },
          {
            pluginId: "00000000-0000-4000-8000-000000000002",
            repositoryUrl: "https://github.com/owner/unused-plugin",
            ref: "main",
            subdirectory: "plugin",
          },
        ],
        targets: [{
          scope: "global",
          intents: [
            intent("Node plugin", {
              type: "nodePlugin",
              pluginId: "00000000-0000-4000-8000-000000000001",
            }),
          ],
        }],
      }),
    ).toThrow();
  });
});

function intent(name: string, command: Record<string, unknown>) {
  return {
    name,
    gesture: {
      trigger: "right",
      strokes: [name === "Node plugin" ? "up" : name === "Shell" ? "right" : name === "PowerShell" ? "rightUp" : name === "File" ? "down" : "left"],
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

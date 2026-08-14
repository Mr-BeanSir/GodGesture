import { describe, expect, it } from "vitest";
import {
  GestureTemplateCatalog,
  GestureTemplatePackage,
  gestureTemplatePackagePlatforms,
  gestureTemplateTargetSummaries,
  MAX_GESTURE_TEMPLATE_PACKAGE_BYTES,
  OwnedTemplateListResponse,
  parseGestureTemplatePackage,
} from "../../index.js";

const globalTarget = {
  scope: "global" as const,
  intents: [{
    name: "Maximize",
    gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
    command: { type: "windowControl", operation: "maximizeRestore" },
  }],
};

const validPackage = () => ({
  formatVersion: 2,
  author: "-",
  title: "Window basics",
  summary: "Three window gestures.",
  tags: ["window"],
  plugins: [],
  targets: [globalTarget],
});

const validEntry = () => ({
  id: "10000000-0000-4000-8000-000000000001",
  versionNumber: 1,
  title: "Window basics",
  summary: "Three window gestures.",
  author: "GodGesture",
  tags: ["window"],
  targets: [{ scope: "global" as const }],
  risks: [],
  downloadCount: 0,
  publishedAt: "2026-08-08T00:00:00Z",
  updatedAt: "2026-08-08T00:00:00Z",
});

describe("gesture template protocol", () => {
  it("derives public target summaries and supported platforms", () => {
    const value = GestureTemplatePackage.parse({
      ...validPackage(),
      targets: [
        globalTarget,
        {
          scope: "app",
          name: "Finder",
          mac: { bundleId: "com.apple.finder" },
          intents: globalTarget.intents,
        },
      ],
    });
    expect(gestureTemplateTargetSummaries(value)).toEqual([
      { scope: "global" },
      { scope: "app", name: "Finder", mac: { bundleId: "com.apple.finder" } },
    ]);
    expect(gestureTemplatePackagePlatforms(value)).toEqual(["windows", "macos"]);
  });
  it("uses single plain-text title and summary without a slug", () => {
    const templatePackage = GestureTemplatePackage.parse(validPackage());
    expect(templatePackage).toMatchObject({
      title: "Window basics",
      summary: "Three window gestures.",
      author: "-",
    });
    expect(templatePackage).not.toHaveProperty("slug");
    expect(() => GestureTemplatePackage.parse({
      ...validPackage(),
      title: { "zh-CN": "窗口", en: "Window" },
    })).toThrow();
    expect(() => GestureTemplatePackage.parse({ ...validPackage(), slug: "legacy-slug" })).toThrow();
    expect(() => GestureTemplatePackage.parse({ ...validPackage(), version: "1.0.0" })).toThrow();
  });

  it("uses UUID and immutable positive versionNumber public identity while allowing duplicate titles", () => {
    const catalog = GestureTemplateCatalog.parse({
      formatVersion: 2,
      generatedAt: "2026-08-08T00:00:00Z",
      entries: [validEntry(), { ...validEntry(), id: "10000000-0000-4000-8000-000000000002", versionNumber: 3 }],
    });
    expect(catalog.entries).toHaveLength(2);
    expect(catalog.entries[0]).not.toHaveProperty("slug");
    expect(() => GestureTemplateCatalog.parse({
      formatVersion: 2,
      generatedAt: "2026-08-08T00:00:00Z",
      entries: [{ ...validEntry(), id: "not-a-uuid" }],
    })).toThrow();
    expect(() => GestureTemplateCatalog.parse({
      formatVersion: 2,
      generatedAt: "2026-08-08T00:00:00Z",
      entries: [{ ...validEntry(), versionNumber: 0 }],
    })).toThrow();
  });

  it("normalizes user text to NFC and rejects controls or bidi overrides", () => {
    expect(GestureTemplatePackage.parse({
      ...validPackage(),
      title: "Cafe\u0301 <script> SELECT & 'quoted'",
    }).title).toBe("Caf\u00e9 <script> SELECT & 'quoted'");
    for (const unsafe of ["bad\u0000text", "bad\u0085text", "bad\u202Etext", "bad\u2067text"]) {
      expect(() => GestureTemplatePackage.parse({ ...validPackage(), title: unsafe })).toThrow();
    }
  });

  it("enforces 120/512 character text limits and rejects duplicate tags or gestures", () => {
    expect(() => GestureTemplatePackage.parse({ ...validPackage(), title: "x".repeat(121) })).toThrow();
    expect(() => GestureTemplatePackage.parse({ ...validPackage(), summary: "x".repeat(513) })).toThrow();
    expect(() => GestureTemplatePackage.parse({ ...validPackage(), tags: ["Window", "window"] })).toThrow();
    expect(() => GestureTemplatePackage.parse({
      ...validPackage(),
      targets: [{ ...globalTarget, intents: [...globalTarget.intents, { ...globalTarget.intents[0], name: "Duplicate" }] }],
    })).toThrow();
  });

  it("keeps only plugin IDs in packages and rejects oversized JSON", () => {
    const pluginId = "20000000-0000-4000-8000-000000000001";
    expect(GestureTemplatePackage.parse({
      ...validPackage(),
      plugins: [pluginId],
      targets: [{ ...globalTarget, intents: [{ ...globalTarget.intents[0], command: { type: "nodePlugin", pluginId } }] }],
    }).plugins).toEqual([pluginId]);
    expect(() => GestureTemplatePackage.parse({
      ...validPackage(),
      plugins: [{ pluginId: "20000000-0000-4000-8000-000000000001", repositoryUrl: "https://example.com" }],
    })).toThrow();
    expect(() => parseGestureTemplatePackage(" ".repeat(MAX_GESTURE_TEMPLATE_PACKAGE_BYTES + 1))).toThrow();
  });

  it("parses an owned template family with immutable version summaries", () => {
    const response = OwnedTemplateListResponse.parse({
      templates: [{
        id: "10000000-0000-4000-8000-000000000001",
        status: "rejected",
        versions: [{
          id: "20000000-0000-4000-8000-000000000001",
          versionNumber: 2,
          title: "Window controls",
          summary: "Safe controls.",
          status: "rejected",
          submittedAt: "2026-08-14T08:00:00.000Z",
          publishedAt: null,
        }],
      }],
    });

    expect(response.templates[0]?.versions[0]?.versionNumber).toBe(2);
  });

  it("rejects invalid owned template status and version metadata", () => {
    const version = {
      id: "20000000-0000-4000-8000-000000000001",
      versionNumber: 1,
      title: "Window controls",
      summary: "Safe controls.",
      status: "withdrawn",
      submittedAt: "2026-08-14T08:00:00.000Z",
      publishedAt: null,
    };
    expect(() => OwnedTemplateListResponse.parse({
      templates: [{
        id: "10000000-0000-4000-8000-000000000001",
        status: "unknown",
        versions: [version],
      }],
    })).toThrow();
    expect(() => OwnedTemplateListResponse.parse({
      templates: [{
        id: "10000000-0000-4000-8000-000000000001",
        status: "withdrawn",
        versions: [{ ...version, versionNumber: 0 }],
      }],
    })).toThrow();
  });
});

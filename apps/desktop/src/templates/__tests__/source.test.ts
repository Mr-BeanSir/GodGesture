import { describe, expect, it, vi } from "vitest";
import {
  GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
} from "@godgesture/shared";
import { BackendError } from "../../api/backend";
import {
  TemplateSourceError,
  DEFAULT_GESTURE_TEMPLATE_CATALOG_URL,
  createFixtureGestureTemplateSource,
  createRemoteGestureTemplateSource,
  type TemplateTextTransport,
} from "../source";

describe("gesture template source", () => {
  it("loads the validated browser catalog and both packages", async () => {
    const source = createFixtureGestureTemplateSource();
    const catalog = await source.loadCatalog();

    expect(catalog.entries.map((entry) => entry.slug)).toEqual([
      "global-window-basics",
      "browser-window-basics",
    ]);
    await expect(source.loadPackage(catalog.entries[0]!)).resolves.toMatchObject({
      slug: "global-window-basics",
      targets: [{ scope: "global" }],
    });
    await expect(source.loadPackage(catalog.entries[1]!)).resolves.toMatchObject({
      slug: "browser-window-basics",
      targets: [{ scope: "app" }],
    });
  });

  it("rejects invalid configured URLs before calling native transport", () => {
    const transport = vi.fn<TemplateTextTransport>();
    expect(() =>
      createRemoteGestureTemplateSource(
        "http://example.com/catalog.json",
        transport,
      ),
    ).toThrowError(expect.objectContaining({ code: "template_url_invalid" }));
    expect(transport).not.toHaveBeenCalled();
  });

  it("passes closed catalog and package resource kinds to native transport", async () => {
    const entry = catalogEntry();
    const transport = vi.fn<TemplateTextTransport>(async (_url, kind) => {
      if (kind === "catalog") return JSON.stringify(catalogWithEntry(entry));
      return JSON.stringify(packageFor(entry));
    });
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      transport,
    );

    await source.loadCatalog();
    await source.loadPackage(entry);

    expect(transport).toHaveBeenNthCalledWith(
      1,
      "https://example.com/catalog.json",
      "catalog",
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      entry.packageUrl,
      "package",
    );
  });

  it("uses a valid AppData catalog cache and refreshes it on demand", async () => {
    const entry = catalogEntry();
    const text = JSON.stringify(catalogWithEntry(entry));
    const transport = vi.fn<TemplateTextTransport>(async () => text);
    const cache = {
      catalogCacheGet: vi.fn(async () => text),
      catalogCacheSet: vi.fn(async () => undefined),
    };
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      transport,
      cache,
    );

    await expect(source.loadCatalog()).resolves.toMatchObject({
      entries: [{ slug: entry.slug }],
    });
    expect(transport).not.toHaveBeenCalled();

    await source.loadCatalog(true);
    expect(transport).toHaveBeenCalledOnce();
    expect(cache.catalogCacheSet).toHaveBeenCalledWith("templates", text);
  });

  it("keeps the last valid catalog when a forced refresh fails", async () => {
    const entry = catalogEntry();
    const cachedText = JSON.stringify(catalogWithEntry(entry));
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => {
        throw new BackendError("template_network", "offline");
      }),
      {
        catalogCacheGet: vi.fn(async () => cachedText),
        catalogCacheSet: vi.fn(async () => undefined),
      },
    );

    await expect(source.loadCatalog(true)).resolves.toMatchObject({
      entries: [{ slug: entry.slug }],
    });
  });

  it("falls back to jsDelivr for official raw catalog and package URLs", async () => {
    const entry = {
      ...catalogEntry(),
      packageUrl:
        "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/packages/expected-package.json",
    };
    const transport = vi.fn<TemplateTextTransport>(async (url, kind) => {
      if (url.includes("raw.githubusercontent.com")) {
        throw new BackendError("template_http", "native 404");
      }
      return kind === "catalog"
        ? JSON.stringify(catalogWithEntry(entry))
        : JSON.stringify(packageFor(entry));
    });
    const source = createRemoteGestureTemplateSource(
      DEFAULT_GESTURE_TEMPLATE_CATALOG_URL,
      transport,
    );

    const catalog = await source.loadCatalog();
    await source.loadPackage(catalog.entries[0]!);

    expect(transport).toHaveBeenNthCalledWith(
      1,
      DEFAULT_GESTURE_TEMPLATE_CATALOG_URL,
      "catalog",
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      "https://cdn.jsdelivr.net/gh/Mr-BeanSir/GodGesture-Templates@main/catalog.min.json",
      "catalog",
    );
    expect(transport).toHaveBeenNthCalledWith(
      3,
      entry.packageUrl,
      "package",
    );
    expect(transport).toHaveBeenNthCalledWith(
      4,
      "https://cdn.jsdelivr.net/gh/Mr-BeanSir/GodGesture-Templates@main/packages/expected-package.json",
      "package",
    );
  });

  it("migrates stale official release catalog URLs to catalog.min.json", async () => {
    const entry = catalogEntry();
    const legacyUrl =
      "https://github.com/Mr-BeanSir/GodGesture-Templates/releases/latest/download/catalog.json";
    const migratedUrl = DEFAULT_GESTURE_TEMPLATE_CATALOG_URL;
    const transport = vi.fn<TemplateTextTransport>(async (url) => {
      if (url === legacyUrl) throw new BackendError("template_http", "native 404");
      expect(url).toBe(migratedUrl);
      return JSON.stringify(catalogWithEntry(entry));
    });
    const source = createRemoteGestureTemplateSource(legacyUrl, transport);

    await expect(source.loadCatalog()).resolves.toMatchObject({
      entries: [{ slug: entry.slug }],
    });
    expect(transport).toHaveBeenNthCalledWith(1, legacyUrl, "catalog");
    expect(transport).toHaveBeenNthCalledWith(2, migratedUrl, "catalog");
  });

  it("migrates stale official release URLs and normalizes their v1 package payloads", async () => {
    const entry = {
      ...catalogEntry(),
      packageUrl:
        "https://github.com/Mr-BeanSir/gesture-templates/releases/latest/download/expected-package.json",
    };
    const transport = vi.fn<TemplateTextTransport>(async (url, kind) => {
      expect(kind).toBe("package");
      if (url === entry.packageUrl) {
        throw new BackendError("template_http", "native 404");
      }
      expect(url).toBe(
        "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/packages/expected-package.json",
      );
      return JSON.stringify({
        formatVersion: 1,
        slug: entry.slug,
        version: entry.version,
        target: {
          scope: "global",
          intents: [{
            name: "One",
            gesture: {
              trigger: "right",
              strokes: ["up"],
              modifier: "none",
            },
            command: { type: "doNothing" },
            executeOnModifier: false,
          }],
        },
      });
    });
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      transport,
    );

    const templatePackage = await source.loadPackage(entry);

    expect(templatePackage).toMatchObject({
      formatVersion: 2,
      author: "GodGesture",
      title: { "zh-CN": "测试", en: "Test" },
      summary: { "zh-CN": "测试", en: "Test" },
      tags: [],
      targets: [{ scope: "global" }],
    });
    expect(templatePackage.targets[0]?.intents[0]).not.toHaveProperty(
      "executeOnModifier",
    );
    expect(transport).toHaveBeenNthCalledWith(1, entry.packageUrl, "package");
    expect(transport).toHaveBeenNthCalledWith(
      2,
      "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/packages/expected-package.json",
      "package",
    );
  });

  it.each([
    "template_http",
    "template_redirect_insecure",
    "template_timeout",
    "catalog_too_large",
  ] as const)("preserves native %s errors", async (code) => {
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => {
        throw new BackendError(code, `native ${code}`);
      }),
    );
    await expectSourceCode(source.loadCatalog(), code);
  });

  it("maps unknown transport failures to template_network", async () => {
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => {
        throw new Error("transport unavailable");
      }),
    );
    await expectSourceCode(source.loadCatalog(), "template_network");
  });

  it("maps malformed catalog responses to protocol errors", async () => {
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => "{}"),
    );
    await expectSourceCode(source.loadCatalog(), "invalid_catalog");
  });

  it("cross-checks downloaded package identity against the catalog", async () => {
    const entry = catalogEntry();
    const mismatched = packageFor(entry);
    mismatched.slug = "different-package";
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => JSON.stringify(mismatched)),
    );
    await expectSourceCode(source.loadPackage(entry), "identity_mismatch");
  });
});

function catalogEntry(): GestureTemplateCatalogEntry {
  return GestureTemplateCatalog.parse({
    formatVersion: 2,
    generatedAt: "2026-07-28T15:00:00Z",
    entries: [
      {
        slug: "expected-package",
        version: "1.0.0",
        title: { "zh-CN": "测试", en: "Test" },
        summary: { "zh-CN": "测试", en: "Test" },
        author: "GodGesture",
        tags: [],
        targets: [{ scope: "global" }],
        risks: [],
        packageUrl: "https://example.com/expected-package.json",
      },
    ],
  }).entries[0]!;
}

function catalogWithEntry(entry: GestureTemplateCatalogEntry) {
  return {
    formatVersion: 2,
    generatedAt: "2026-07-28T15:00:00Z",
    entries: [entry],
  };
}

function packageFor(entry: GestureTemplateCatalogEntry) {
  return {
    formatVersion: 2 as const,
    slug: entry.slug,
    version: entry.version,
    author: "GodGesture",
    targets: [{
      scope: "global" as const,
      intents: [
        {
          name: "One",
          gesture: {
            trigger: "right",
            strokes: ["up"],
            modifier: "none",
          },
          command: { type: "doNothing" },
        },
      ],
    }],
  };
}

async function expectSourceCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("expected source request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateSourceError);
    expect((error as TemplateSourceError).code).toBe(code);
  }
}

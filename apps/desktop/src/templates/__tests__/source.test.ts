import { describe, expect, it, vi } from "vitest";
import {
  GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
} from "@godgesture/shared";
import { BackendError } from "../../api/backend";
import {
  TemplateSourceError,
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
      target: { scope: "global" },
    });
    await expect(source.loadPackage(catalog.entries[1]!)).resolves.toMatchObject({
      slug: "browser-window-basics",
      target: { scope: "app" },
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
    formatVersion: 1,
    generatedAt: "2026-07-28T15:00:00Z",
    entries: [
      {
        slug: "expected-package",
        version: "1.0.0",
        title: { "zh-CN": "测试", en: "Test" },
        summary: { "zh-CN": "测试", en: "Test" },
        author: "GodGesture",
        tags: [],
        target: { scope: "global" },
        risks: [],
        packageUrl: "https://example.com/expected-package.json",
      },
    ],
  }).entries[0]!;
}

function catalogWithEntry(entry: GestureTemplateCatalogEntry) {
  return {
    formatVersion: 1,
    generatedAt: "2026-07-28T15:00:00Z",
    entries: [entry],
  };
}

function packageFor(entry: GestureTemplateCatalogEntry) {
  return {
    formatVersion: 1 as const,
    slug: entry.slug,
    version: entry.version,
    author: "GodGesture",
    target: {
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
    },
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

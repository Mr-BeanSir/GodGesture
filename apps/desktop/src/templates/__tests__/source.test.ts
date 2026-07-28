import { describe, expect, it, vi } from "vitest";
import {
  GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
} from "@godgesture/shared";
import {
  TemplateSourceError,
  createFixtureGestureTemplateSource,
  createRemoteGestureTemplateSource,
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

  it("rejects invalid configured URLs before making a request", () => {
    expect(() =>
      createRemoteGestureTemplateSource("http://example.com/catalog.json"),
    ).toThrowError(expect.objectContaining({ code: "template_url_invalid" }));
  });

  it("maps HTTP and malformed catalog responses to stable codes", async () => {
    const httpSource = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    await expectSourceCode(httpSource.loadCatalog(), "template_http");

    const invalidSource = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await expectSourceCode(invalidSource.loadCatalog(), "invalid_catalog");
  });

  it("rejects redirects that leave HTTPS with a dedicated error", async () => {
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          url: "http://downloads.example.com/catalog.json",
          headers: new Headers(),
          text: async () => "{}",
        }) as Response,
      ),
    );

    await expectSourceCode(source.loadCatalog(), "template_redirect_insecure");
  });

  it("cross-checks downloaded package identity against the catalog", async () => {
    const entry = catalogEntry();
    const source = createRemoteGestureTemplateSource(
      "https://example.com/catalog.json",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            formatVersion: 1,
            slug: "different-package",
            version: "1.0.0",
            target: {
              scope: "global",
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
          }),
          { status: 200 },
        ),
      ),
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

async function expectSourceCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("expected source request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateSourceError);
    expect((error as TemplateSourceError).code).toBe(code);
  }
}

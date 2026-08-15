import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialApiGestureTemplateSource, createFixtureGestureTemplateSource, type GestureTemplateSource } from "../source";

const id = "10000000-0000-4000-8000-000000000001";
const entry = { id, versionNumber: 1, title: "Window basics", summary: "Window commands", author: "Bean", tags: ["window"], risks: [], downloadCount: 3, publishedAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" };
const pkg = { formatVersion: 2, author: "-", title: entry.title, summary: entry.summary, tags: entry.tags, plugins: [], targets: [{ scope: "global" as const, intents: [{ name: "No-op", gesture: { trigger: "right", strokes: ["up"], modifier: "none" }, command: { type: "doNothing" as const } }] }] };

describe("official template source", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the anonymous paginated catalog and follows the presigned package URL", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [entry], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://rustfs.example/object" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pkg), { status: 200 }));
    const source = createOfficialApiGestureTemplateSource("https://api.example", fetch);
    const catalog = await source.loadCatalog();
    expect(catalog.entries[0]).toMatchObject({ id, versionNumber: 1, title: "Window basics" });
    expect(catalog.entries[0]).not.toHaveProperty("targets");
    await expect(source.loadPackage(catalog.entries[0]!)).resolves.toMatchObject({ title: "Window basics" });
    expect(fetch).toHaveBeenNthCalledWith(1, "https://api.example/api/v1/public/templates?limit=50&sort=newest", expect.anything());
  });

  it("uses the package transport for the presigned RustFS URL", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [entry], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "http://127.0.0.1:19000/signed-package" }), { status: 200 }));
    const packageTransport = vi.fn(async () => JSON.stringify(pkg));
    const source = createOfficialApiGestureTemplateSource("https://api.example", fetch, packageTransport);
    const catalog = await source.loadCatalog();

    await expect(source.loadPackage(catalog.entries[0]!)).resolves.toMatchObject({ title: "Window basics" });
    expect(packageTransport).toHaveBeenCalledWith("http://127.0.0.1:19000/signed-package");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the configured GODGESTURE_API origin by default", async () => {
    vi.stubEnv("GODGESTURE_API", "http://127.0.0.1:3000");
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entries: [entry], nextCursor: null }), { status: 200 }),
    );
    const source = createOfficialApiGestureTemplateSource(undefined, fetch);
    await source.loadCatalog();
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/v1/public/templates?limit=50&sort=newest",
      expect.anything(),
    );
  });

  it("keeps browser preview local and fixture-backed", async () => {
    const source: GestureTemplateSource = createFixtureGestureTemplateSource();
    const catalog = await source.loadCatalog();
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(catalog.entries[0]).toHaveProperty("id");
  });
});

import {
  GestureTemplateProtocolError,
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  type GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
  type GestureTemplatePackage,
} from "@godgesture/shared";
import { isTauriRuntime, useBackend } from "../api/backend";
import { gestureTemplateCatalogFixture, gestureTemplatePackageFixtures } from "./fixtures";
import { resolveApiOrigin } from "../cloud/origin";

export type TemplateSourceErrorCode = "template_network" | "template_http" | "invalid_catalog" | "invalid_package" | "template_fixture_missing";
export class TemplateSourceError extends Error {
  constructor(public readonly code: TemplateSourceErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "TemplateSourceError"; }
}
export interface GestureTemplateSource {
  loadCatalog(force?: boolean): Promise<GestureTemplateCatalog>;
  loadPackage(entry: GestureTemplateCatalogEntry): Promise<GestureTemplatePackage>;
}
export type TemplatePackageTextTransport = (url: string) => Promise<string>;

function protocolError(error: unknown): never {
  if (error instanceof GestureTemplateProtocolError) throw new TemplateSourceError(error.code === "invalid_catalog" ? "invalid_catalog" : "invalid_package", error.message, error);
  throw error;
}

async function fetchPackageText(
  url: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new TemplateSourceError("template_network", "Template package download failed", error);
  }
  if (!response.ok) {
    throw new TemplateSourceError("template_http", `Template package download failed (${response.status})`);
  }
  return response.text();
}

export function createFixtureGestureTemplateSource(): GestureTemplateSource {
  const catalog = parseGestureTemplateCatalog(JSON.stringify(gestureTemplateCatalogFixture));
  return {
    async loadCatalog() { return structuredClone(catalog); },
    async loadPackage(entry) {
      const fixture = gestureTemplatePackageFixtures[entry.id as keyof typeof gestureTemplatePackageFixtures];
      if (!fixture) throw new TemplateSourceError("template_fixture_missing", `No browser fixture exists for ${entry.id}`);
      try { return parseGestureTemplatePackage(JSON.stringify(fixture)); } catch (error) { return protocolError(error); }
    },
  };
}

/** The official service is deliberately independent from any sync endpoint. */
export function createOfficialApiGestureTemplateSource(
  apiOrigin: string | null = resolveApiOrigin(),
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  packageTransport: TemplatePackageTextTransport = (url) =>
    isTauriRuntime()
      ? useBackend().downloadTemplateText(url, "package")
      : fetchPackageText(url, fetchImpl),
): GestureTemplateSource {
  const configuredOrigin = apiOrigin;
  const base = configuredOrigin
    ? `${configuredOrigin.replace(/\/$/, "")}/api/v1/public/templates`
    : null;
  const packageEndpoints = new Map<string, string>();
  const etags = new Map<string, string>();
  const cachedPages = new Map<string, { entries: unknown[]; nextCursor: string | null }>();
  const keyFor = (entry: GestureTemplateCatalogEntry) => `${entry.id}@${entry.versionNumber}`;
  return {
    async loadCatalog() {
      if (!base) throw new TemplateSourceError("template_network", "Official template service is not configured");
      let url = `${base}?limit=50&sort=newest`;
      const entries: unknown[] = [];
      // Request enough pages for the desktop view while preserving server-side pagination.
      for (let page = 0; page < 6 && url; page += 1) {
        let response: Response;
        const headers = new Headers({ Accept: "application/json" });
        const cachedEtag = etags.get(url);
        if (cachedEtag) headers.set("If-None-Match", cachedEtag);
        try { response = await fetchImpl(url, { headers }); } catch (error) { throw new TemplateSourceError("template_network", "Template catalog request failed", error); }
        if (response.status === 304) {
          const cached = cachedPages.get(url);
          if (!cached) throw new TemplateSourceError("template_network", "Template catalog cache is unavailable");
          entries.push(...cached.entries);
          url = cached.nextCursor ? `${base}?limit=50&sort=newest&cursor=${encodeURIComponent(cached.nextCursor)}` : "";
          continue;
        }
        if (!response.ok) throw new TemplateSourceError("template_http", `Template catalog request failed (${response.status})`);
        const payload = await response.json() as { entries?: unknown[]; nextCursor?: string | null };
        const pageEntries = payload.entries ?? [];
        const nextCursor = payload.nextCursor ?? null;
        const pageUrl = url;
        entries.push(...pageEntries);
        const etag = response.headers.get("ETag");
        if (etag) etags.set(pageUrl, etag);
        cachedPages.set(pageUrl, { entries: pageEntries, nextCursor });
        url = nextCursor ? `${base}?limit=50&sort=newest&cursor=${encodeURIComponent(nextCursor)}` : "";
      }
      try {
        const catalog = parseGestureTemplateCatalog(JSON.stringify({ formatVersion: 2, generatedAt: new Date().toISOString(), entries }));
        catalog.entries.forEach((entry) => packageEndpoints.set(keyFor(entry), `${base}/${entry.id}/versions/${entry.versionNumber}/package`));
        return catalog;
      } catch (error) { return protocolError(error); }
    },
    async loadPackage(entry) {
      if (!base) throw new TemplateSourceError("template_network", "Official template service is not configured");
      const endpoint = packageEndpoints.get(keyFor(entry)) ?? `${base}/${entry.id}/versions/${entry.versionNumber}/package`;
      let signed: { url?: string };
      try {
        const response = await fetchImpl(endpoint, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new TemplateSourceError("template_http", `Template package request failed (${response.status})`);
        signed = await response.json() as { url?: string };
      } catch (error) { if (error instanceof TemplateSourceError) throw error; throw new TemplateSourceError("template_network", "Template package request failed", error); }
      if (!signed.url) throw new TemplateSourceError("invalid_package", "Template package URL is missing");
      let packageText: string;
      try {
        packageText = await packageTransport(signed.url);
      } catch (error) { if (error instanceof TemplateSourceError) throw error; return protocolError(error); }
      try { return parseGestureTemplatePackage(packageText); } catch (error) { return protocolError(error); }
    },
  };
}

export function createGestureTemplateSource(browserPreview: boolean): GestureTemplateSource {
  return browserPreview ? createFixtureGestureTemplateSource() : createOfficialApiGestureTemplateSource();
}

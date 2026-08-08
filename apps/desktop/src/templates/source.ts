import {
  GestureTemplateProtocolError,
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  type GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
  type GestureTemplatePackage,
} from "@godgesture/shared";
import { gestureTemplateCatalogFixture, gestureTemplatePackageFixtures } from "./fixtures";

export const DEFAULT_OFFICIAL_TEMPLATE_API_ORIGIN = "https://api.godgesture.com";

export type TemplateSourceErrorCode = "template_network" | "template_http" | "invalid_catalog" | "invalid_package" | "template_fixture_missing";
export class TemplateSourceError extends Error {
  constructor(public readonly code: TemplateSourceErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "TemplateSourceError"; }
}
export interface GestureTemplateSource {
  loadCatalog(force?: boolean): Promise<GestureTemplateCatalog>;
  loadPackage(entry: GestureTemplateCatalogEntry): Promise<GestureTemplatePackage>;
}

function protocolError(error: unknown): never {
  if (error instanceof GestureTemplateProtocolError) throw new TemplateSourceError(error.code === "invalid_catalog" ? "invalid_catalog" : "invalid_package", error.message, error);
  throw error;
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
  apiOrigin = import.meta.env.GODGESTURE_API ?? import.meta.env.VITE_API_BASE_URL ?? DEFAULT_OFFICIAL_TEMPLATE_API_ORIGIN,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): GestureTemplateSource {
  const base = `${apiOrigin.replace(/\/$/, "")}/api/v1/public/templates`;
  const packageEndpoints = new Map<string, string>();
  const keyFor = (entry: GestureTemplateCatalogEntry) => `${entry.id}@${entry.versionNumber}`;
  return {
    async loadCatalog() {
      let url = `${base}?limit=50&sort=newest`;
      const entries: unknown[] = [];
      // Request enough pages for the desktop view while preserving server-side pagination.
      for (let page = 0; page < 6 && url; page += 1) {
        let response: Response;
        try { response = await fetchImpl(url, { headers: { Accept: "application/json" } }); } catch (error) { throw new TemplateSourceError("template_network", "Template catalog request failed", error); }
        if (!response.ok) throw new TemplateSourceError("template_http", `Template catalog request failed (${response.status})`);
        const payload = await response.json() as { entries?: unknown[]; nextCursor?: string | null };
        entries.push(...(payload.entries ?? []));
        url = payload.nextCursor ? `${base}?limit=50&sort=newest&cursor=${encodeURIComponent(payload.nextCursor)}` : "";
      }
      try {
        const catalog = parseGestureTemplateCatalog(JSON.stringify({ formatVersion: 2, generatedAt: new Date().toISOString(), entries }));
        catalog.entries.forEach((entry) => packageEndpoints.set(keyFor(entry), `${base}/${entry.id}/versions/${entry.versionNumber}/package`));
        return catalog;
      } catch (error) { return protocolError(error); }
    },
    async loadPackage(entry) {
      const endpoint = packageEndpoints.get(keyFor(entry)) ?? `${base}/${entry.id}/versions/${entry.versionNumber}/package`;
      let signed: { url?: string };
      try {
        const response = await fetchImpl(endpoint, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new TemplateSourceError("template_http", `Template package request failed (${response.status})`);
        signed = await response.json() as { url?: string };
      } catch (error) { if (error instanceof TemplateSourceError) throw error; throw new TemplateSourceError("template_network", "Template package request failed", error); }
      if (!signed.url) throw new TemplateSourceError("invalid_package", "Template package URL is missing");
      try {
        const response = await fetchImpl(signed.url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new TemplateSourceError("template_http", `Template package download failed (${response.status})`);
        return parseGestureTemplatePackage(await response.text());
      } catch (error) { if (error instanceof TemplateSourceError) throw error; return protocolError(error); }
    },
  };
}

export function createGestureTemplateSource(browserPreview: boolean): GestureTemplateSource {
  return browserPreview ? createFixtureGestureTemplateSource() : createOfficialApiGestureTemplateSource();
}

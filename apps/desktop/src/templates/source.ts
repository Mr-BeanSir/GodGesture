import {
  GestureTemplateProtocolError,
  MAX_GESTURE_TEMPLATE_CATALOG_BYTES,
  MAX_GESTURE_TEMPLATE_PACKAGE_BYTES,
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  verifyGestureTemplatePackage,
  type GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
  type GestureTemplatePackage,
} from "@godgesture/shared";
import catalogFixture from "../../../../distribution/gesture-templates/catalog.json";
import browserFixture from "../../../../distribution/gesture-templates/packages/browser-window-basics.json";
import globalFixture from "../../../../distribution/gesture-templates/packages/global-window-basics.json";

export const DEFAULT_GESTURE_TEMPLATE_CATALOG_URL =
  "https://github.com/godgesture/gesture-templates/releases/latest/download/catalog.json";
const REQUEST_TIMEOUT_MS = 15_000;

export type TemplateSourceErrorCode =
  | "template_url_invalid"
  | "template_network"
  | "template_timeout"
  | "template_http"
  | "template_redirect_insecure"
  | "catalog_too_large"
  | "package_too_large"
  | "invalid_json"
  | "invalid_catalog"
  | "invalid_package"
  | "identity_mismatch"
  | "target_mismatch"
  | "risk_mismatch"
  | "template_fixture_missing";

export class TemplateSourceError extends Error {
  constructor(
    public readonly code: TemplateSourceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TemplateSourceError";
  }
}

export interface GestureTemplateSource {
  loadCatalog(): Promise<GestureTemplateCatalog>;
  loadPackage(
    entry: GestureTemplateCatalogEntry,
  ): Promise<GestureTemplatePackage>;
}

type Fetch = typeof fetch;

function validatedHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TemplateSourceError(
      "template_url_invalid",
      "Template URL is invalid",
      error,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.hostname
  ) {
    throw new TemplateSourceError(
      "template_url_invalid",
      "Template URL must use HTTPS without credentials",
    );
  }
  return url;
}

async function fetchBoundedText(
  inputUrl: string,
  maximumBytes: number,
  fetchImpl: Fetch,
): Promise<string> {
  const url = validatedHttpsUrl(inputUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "AbortError";
    throw new TemplateSourceError(
      timedOut ? "template_timeout" : "template_network",
      timedOut ? "Template request timed out" : "Template request failed",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new TemplateSourceError(
      "template_http",
      `Template request failed with status ${response.status}`,
    );
  }
  const finalUrl = response.url || url.href;
  let redirectedUrl: URL;
  try {
    redirectedUrl = new URL(finalUrl);
  } catch (error) {
    throw new TemplateSourceError(
      "template_redirect_insecure",
      "Template request returned an invalid redirect URL",
      error,
    );
  }
  if (
    redirectedUrl.protocol !== "https:" ||
    redirectedUrl.username !== "" ||
    redirectedUrl.password !== "" ||
    !redirectedUrl.hostname
  ) {
    throw new TemplateSourceError(
      "template_redirect_insecure",
      "Template request redirected to an insecure URL",
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new TemplateSourceError(
      maximumBytes === MAX_GESTURE_TEMPLATE_CATALOG_BYTES
        ? "catalog_too_large"
        : "package_too_large",
      `Template response exceeds ${maximumBytes} bytes`,
    );
  }
  return response.text();
}

function normalizeProtocolError(error: unknown): never {
  if (error instanceof GestureTemplateProtocolError) {
    throw new TemplateSourceError(error.code, error.message, error);
  }
  throw error;
}

export function createRemoteGestureTemplateSource(
  catalogUrl =
    import.meta.env.VITE_GESTURE_TEMPLATE_CATALOG_URL?.trim() ||
    DEFAULT_GESTURE_TEMPLATE_CATALOG_URL,
  fetchImpl: Fetch = fetch,
): GestureTemplateSource {
  const validatedCatalogUrl = validatedHttpsUrl(catalogUrl).href;
  return {
    async loadCatalog() {
      const text = await fetchBoundedText(
        validatedCatalogUrl,
        MAX_GESTURE_TEMPLATE_CATALOG_BYTES,
        fetchImpl,
      );
      try {
        return parseGestureTemplateCatalog(text);
      } catch (error) {
        return normalizeProtocolError(error);
      }
    },
    async loadPackage(entry) {
      const text = await fetchBoundedText(
        entry.packageUrl,
        MAX_GESTURE_TEMPLATE_PACKAGE_BYTES,
        fetchImpl,
      );
      try {
        return verifyGestureTemplatePackage(
          entry,
          parseGestureTemplatePackage(text),
        );
      } catch (error) {
        return normalizeProtocolError(error);
      }
    },
  };
}

const fixturePackages: Record<string, unknown> = {
  "global-window-basics": globalFixture,
  "browser-window-basics": browserFixture,
};

export function createFixtureGestureTemplateSource(): GestureTemplateSource {
  const catalog = parseGestureTemplateCatalog(JSON.stringify(catalogFixture));
  return {
    async loadCatalog() {
      return structuredClone(catalog);
    },
    async loadPackage(entry) {
      const fixture = fixturePackages[entry.slug];
      if (!fixture) {
        throw new TemplateSourceError(
          "template_fixture_missing",
          `No browser fixture exists for ${entry.slug}`,
        );
      }
      try {
        return verifyGestureTemplatePackage(
          entry,
          parseGestureTemplatePackage(JSON.stringify(fixture)),
        );
      } catch (error) {
        return normalizeProtocolError(error);
      }
    },
  };
}

export function createGestureTemplateSource(
  browserPreview: boolean,
): GestureTemplateSource {
  return browserPreview
    ? createFixtureGestureTemplateSource()
    : createRemoteGestureTemplateSource();
}

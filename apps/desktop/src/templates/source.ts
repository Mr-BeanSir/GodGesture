import {
  GestureTemplateProtocolError,
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  verifyGestureTemplatePackage,
  type GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
  type GestureTemplatePackage,
} from "@godgesture/shared";
import {
  BackendError,
  useBackend,
  type CatalogCacheKind,
  type TemplateResourceKind,
} from "../api/backend";
import {
  gestureTemplateCatalogFixture,
  gestureTemplatePackageFixtures,
} from "./fixtures";

export const DEFAULT_GESTURE_TEMPLATE_CATALOG_URL =
  "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Templates/main/catalog.min.json";

const TEMPLATE_REPOSITORY_OWNER = "Mr-BeanSir";
const TEMPLATE_REPOSITORY_NAME = "GodGesture-Templates";
const LEGACY_TEMPLATE_REPOSITORY_NAME = "gesture-templates";
const TEMPLATE_RAW_HOST = "raw.githubusercontent.com";
const TEMPLATE_MIRROR_HOST = "cdn.jsdelivr.net";

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
  | "metadata_mismatch"
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
  loadCatalog(force?: boolean): Promise<GestureTemplateCatalog>;
  loadPackage(
    entry: GestureTemplateCatalogEntry,
  ): Promise<GestureTemplatePackage>;
}

export type TemplateTextTransport = (
  url: string,
  resourceKind: TemplateResourceKind,
) => Promise<string>;

export interface CatalogCache {
  catalogCacheGet(kind: CatalogCacheKind): Promise<string | null>;
  catalogCacheSet(kind: CatalogCacheKind, contents: string): Promise<void>;
}

const NOOP_CATALOG_CACHE: CatalogCache = {
  async catalogCacheGet() {
    return null;
  },
  async catalogCacheSet() {
    // Direct source tests and non-desktop callers can opt out of persistence.
  },
};

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

async function loadRemoteText(
  inputUrl: string,
  resourceKind: TemplateResourceKind,
  transport: TemplateTextTransport,
): Promise<string> {
  const url = validatedHttpsUrl(inputUrl).href;
  try {
    return await transport(url, resourceKind);
  } catch (error) {
    let sourceError = normalizeTransportError(error);
    const fallbackUrls = templateFallbackUrls(url, resourceKind);
    for (const fallbackUrl of fallbackUrls) {
      if (!isFallbackError(sourceError.code)) break;
      try {
        return await transport(fallbackUrl, resourceKind);
      } catch (fallbackError) {
        sourceError = normalizeTransportError(fallbackError);
      }
    }
    throw sourceError;
  }
}

function normalizeTransportError(error: unknown): TemplateSourceError {
  if (error instanceof TemplateSourceError) return error;
  if (error instanceof BackendError && isTemplateSourceErrorCode(error.code)) {
    return new TemplateSourceError(error.code, error.message, error);
  }
  return new TemplateSourceError(
    "template_network",
    "Template request failed",
    error,
  );
}

function isFallbackError(code: TemplateSourceErrorCode): boolean {
  return code === "template_http" || code === "template_network" || code === "template_timeout";
}

/**
 * Keep the mirror narrowly scoped to the official raw GitHub repository. A
 * user-configured third-party URL must never be silently rewritten.
 */
function templateMirrorUrl(inputUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    return null;
  }
  if (
    url.hostname !== TEMPLATE_RAW_HOST ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length < 4 ||
    segments[0] !== TEMPLATE_REPOSITORY_OWNER ||
    segments[1] !== TEMPLATE_REPOSITORY_NAME
  ) {
    return null;
  }
  const ref = segments[2];
  const path = segments.slice(3).join("/");
  if (!ref || !path) return null;
  return `https://${TEMPLATE_MIRROR_HOST}/gh/${TEMPLATE_REPOSITORY_OWNER}/${TEMPLATE_REPOSITORY_NAME}@${ref}/${path}`;
}

/**
 * The first published catalog used release assets from the old repository
 * name. Keep a narrowly scoped migration path for stale catalogs while all
 * new catalog entries continue to use the raw package URL.
 */
function legacyTemplatePackageUrl(inputUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    return null;
  }
  if (
    url.hostname !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 6 ||
    segments[0] !== TEMPLATE_REPOSITORY_OWNER ||
    segments[1] !== LEGACY_TEMPLATE_REPOSITORY_NAME ||
    segments[2] !== "releases" ||
    segments[3] !== "latest" ||
    segments[4] !== "download"
  ) {
    return null;
  }
  const fileName = segments[5];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(fileName)) return null;
  return `https://${TEMPLATE_RAW_HOST}/${TEMPLATE_REPOSITORY_OWNER}/${TEMPLATE_REPOSITORY_NAME}/main/packages/${fileName}`;
}

/**
 * Migrate the short-lived release-asset catalog URL used by early builds.
 * Only the official repositories and catalog filenames are accepted here;
 * arbitrary user-configured URLs are never rewritten.
 */
function legacyTemplateCatalogUrl(inputUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    return null;
  }
  if (
    url.hostname !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 6 ||
    segments[0] !== TEMPLATE_REPOSITORY_OWNER ||
    ![TEMPLATE_REPOSITORY_NAME, LEGACY_TEMPLATE_REPOSITORY_NAME].includes(segments[1]) ||
    segments[2] !== "releases" ||
    segments[3] !== "latest" ||
    segments[4] !== "download" ||
    !["catalog.json", "catalog.min.json"].includes(segments[5])
  ) {
    return null;
  }
  return `https://${TEMPLATE_RAW_HOST}/${TEMPLATE_REPOSITORY_OWNER}/${TEMPLATE_REPOSITORY_NAME}/main/catalog.min.json`;
}

function templateFallbackUrls(
  inputUrl: string,
  resourceKind: TemplateResourceKind,
): string[] {
  const urls: string[] = [];
  const legacyCatalogUrl =
    resourceKind === "catalog" ? legacyTemplateCatalogUrl(inputUrl) : null;
  if (legacyCatalogUrl) {
    urls.push(legacyCatalogUrl);
    const mirrorUrl = templateMirrorUrl(legacyCatalogUrl);
    if (mirrorUrl) urls.push(mirrorUrl);
    return urls;
  }
  const legacyUrl =
    resourceKind === "package" ? legacyTemplatePackageUrl(inputUrl) : null;
  if (legacyUrl) {
    urls.push(legacyUrl);
    const mirrorUrl = templateMirrorUrl(legacyUrl);
    if (mirrorUrl) urls.push(mirrorUrl);
    return urls;
  }
  const mirrorUrl = templateMirrorUrl(inputUrl);
  if (mirrorUrl) urls.push(mirrorUrl);
  return urls;
}

function isTemplateSourceErrorCode(code: string): code is TemplateSourceErrorCode {
  return [
    "template_url_invalid",
    "template_network",
    "template_timeout",
    "template_http",
    "template_redirect_insecure",
    "catalog_too_large",
    "package_too_large",
    "invalid_json",
  ].includes(code);
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
  transport: TemplateTextTransport = (url, resourceKind) =>
    useBackend().downloadTemplateText(url, resourceKind),
  cache: CatalogCache = NOOP_CATALOG_CACHE,
): GestureTemplateSource {
  const validatedCatalogUrl = validatedHttpsUrl(catalogUrl).href;
  return {
    async loadCatalog(force = false) {
      const cached = await readCachedCatalog(cache);
      if (!force && cached) return cached;
      try {
        const text = await loadRemoteText(validatedCatalogUrl, "catalog", transport);
        const catalog = parseCatalog(text);
        await writeCachedCatalog(cache, text);
        return catalog;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    },
    async loadPackage(entry) {
      const text = await loadRemoteText(entry.packageUrl, "package", transport);
      try {
        return verifyGestureTemplatePackage(
          entry,
          parseGestureTemplatePackage(text, entry),
        );
      } catch (error) {
        return normalizeProtocolError(error);
      }
    },
  };
}

export function createFixtureGestureTemplateSource(): GestureTemplateSource {
  const catalog = parseGestureTemplateCatalog(
    JSON.stringify(gestureTemplateCatalogFixture),
  );
  return {
    async loadCatalog() {
      return structuredClone(catalog);
    },
    async loadPackage(entry) {
      const fixture = gestureTemplatePackageFixtures[entry.slug as keyof typeof gestureTemplatePackageFixtures];
      if (!fixture) {
        throw new TemplateSourceError(
          "template_fixture_missing",
          `No browser fixture exists for ${entry.slug}`,
        );
      }
      try {
        return verifyGestureTemplatePackage(
          entry,
          parseGestureTemplatePackage(JSON.stringify(fixture), entry),
        );
      } catch (error) {
        return normalizeProtocolError(error);
      }
    },
  };
}

function parseCatalog(text: string): GestureTemplateCatalog {
  try {
    return parseGestureTemplateCatalog(text);
  } catch (error) {
    return normalizeProtocolError(error);
  }
}

async function readCachedCatalog(
  cache: CatalogCache,
): Promise<GestureTemplateCatalog | null> {
  try {
    const text = await cache.catalogCacheGet("templates");
    return text ? parseCatalog(text) : null;
  } catch {
    return null;
  }
}

async function writeCachedCatalog(
  cache: CatalogCache,
  text: string,
): Promise<void> {
  try {
    await cache.catalogCacheSet("templates", text);
  } catch {
    // A cache write must never hide a successfully downloaded catalog.
  }
}

export function createGestureTemplateSource(
  browserPreview: boolean,
): GestureTemplateSource {
  return browserPreview
    ? createFixtureGestureTemplateSource()
    : createRemoteGestureTemplateSource(undefined, undefined, useBackend());
}

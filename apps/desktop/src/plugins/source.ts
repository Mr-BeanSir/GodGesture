import {
  OnlinePluginCatalogProtocolError,
  parseOnlinePluginCatalog,
  type OnlinePluginCatalog,
  type OnlinePluginCatalogEntry,
} from "@godgesture/shared";
import {
  BackendError,
  useBackend,
  type CatalogCacheKind,
  type TemplateResourceKind,
} from "../api/backend";
import { onlinePluginCatalogFixture } from "./fixtures";

export const DEFAULT_ONLINE_PLUGIN_CATALOG_URL =
  "https://raw.githubusercontent.com/Mr-BeanSir/GodGesture-Plugins/main/catalog.min.json";

export type OnlinePluginSourceErrorCode =
  | "template_url_invalid"
  | "template_network"
  | "template_timeout"
  | "template_http"
  | "template_redirect_insecure"
  | "catalog_too_large"
  | "invalid_json"
  | "invalid_catalog"
  | "plugin_fixture_missing";

export class OnlinePluginSourceError extends Error {
  constructor(
    public readonly code: OnlinePluginSourceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OnlinePluginSourceError";
  }
}

export interface OnlinePluginSource {
  loadCatalog(force?: boolean): Promise<OnlinePluginCatalog>;
}

export type PluginCatalogTextTransport = (
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

function validatedHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new OnlinePluginSourceError(
      "template_url_invalid",
      "Online plugin catalog URL is invalid",
      error,
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new OnlinePluginSourceError(
      "template_url_invalid",
      "Online plugin catalog URL must use HTTPS without credentials",
    );
  }
  return url.href;
}

function normalizeProtocolError(error: unknown): never {
  if (error instanceof OnlinePluginCatalogProtocolError) {
    throw new OnlinePluginSourceError(error.code, error.message, error);
  }
  throw error;
}

function isSourceErrorCode(code: string): code is OnlinePluginSourceErrorCode {
  return [
    "template_url_invalid",
    "template_network",
    "template_timeout",
    "template_http",
    "template_redirect_insecure",
    "catalog_too_large",
    "invalid_json",
  ].includes(code);
}

async function loadRemoteText(
  url: string,
  transport: PluginCatalogTextTransport,
): Promise<string> {
  try {
    return await transport(url, "pluginCatalog");
  } catch (error) {
    if (error instanceof OnlinePluginSourceError) throw error;
    if (error instanceof BackendError && isSourceErrorCode(error.code)) {
      throw new OnlinePluginSourceError(error.code, error.message, error);
    }
    throw new OnlinePluginSourceError(
      "template_network",
      "Online plugin catalog request failed",
      error,
    );
  }
}

export function createRemoteOnlinePluginSource(
  catalogUrl =
    import.meta.env.VITE_GODGESTURE_PLUGIN_CATALOG_URL?.trim() ||
    DEFAULT_ONLINE_PLUGIN_CATALOG_URL,
  transport: PluginCatalogTextTransport = (url, resourceKind) =>
    useBackend().downloadTemplateText(url, resourceKind),
  cache: CatalogCache = NOOP_CATALOG_CACHE,
): OnlinePluginSource {
  const validatedUrl = validatedHttpsUrl(catalogUrl);
  return {
    async loadCatalog(force = false) {
      const cached = await readCachedCatalog(cache);
      if (!force && cached) return cached;
      try {
        const text = await loadRemoteText(validatedUrl, transport);
        const catalog = parseCatalog(text);
        await writeCachedCatalog(cache, text);
        return catalog;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    },
  };
}

export function createFixtureOnlinePluginSource(): OnlinePluginSource {
  return {
    async loadCatalog() {
      try {
        return parseOnlinePluginCatalog(JSON.stringify(onlinePluginCatalogFixture));
      } catch (error) {
        if (error instanceof OnlinePluginCatalogProtocolError) {
          return normalizeProtocolError(error);
        }
        throw new OnlinePluginSourceError(
          "plugin_fixture_missing",
          "No browser plugin catalog fixture exists",
          error,
        );
      }
    },
  };
}

export function createOnlinePluginSource(browserPreview: boolean): OnlinePluginSource {
  return browserPreview
    ? createFixtureOnlinePluginSource()
    : createRemoteOnlinePluginSource(undefined, undefined, useBackend());
}

function parseCatalog(text: string): OnlinePluginCatalog {
  try {
    return parseOnlinePluginCatalog(text);
  } catch (error) {
    return normalizeProtocolError(error);
  }
}

async function readCachedCatalog(
  cache: CatalogCache,
): Promise<OnlinePluginCatalog | null> {
  try {
    const text = await cache.catalogCacheGet("plugins");
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
    await cache.catalogCacheSet("plugins", text);
  } catch {
    // A cache write must never hide a successfully downloaded catalog.
  }
}

export function localizedPluginText(
  value: OnlinePluginCatalogEntry["title"],
  locale: string,
) {
  return locale === "zh-CN" ? value["zh-CN"] : value.en;
}

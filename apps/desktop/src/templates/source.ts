import {
  GestureTemplateProtocolError,
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  verifyGestureTemplatePackage,
  type GestureTemplateCatalog,
  type GestureTemplateCatalogEntry,
  type GestureTemplatePackage,
} from "@godgesture/shared";
import { BackendError, useBackend, type TemplateResourceKind } from "../api/backend";
import catalogFixture from "../../../../distribution/gesture-templates/catalog.json";
import browserFixture from "../../../../distribution/gesture-templates/packages/browser-window-basics.json";
import globalFixture from "../../../../distribution/gesture-templates/packages/global-window-basics.json";

export const DEFAULT_GESTURE_TEMPLATE_CATALOG_URL =
  "https://github.com/Mr-BeanSir/gesture-templates/releases/latest/download/catalog.json";

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

export type TemplateTextTransport = (
  url: string,
  resourceKind: TemplateResourceKind,
) => Promise<string>;

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
    if (error instanceof TemplateSourceError) throw error;
    if (error instanceof BackendError && isTemplateSourceErrorCode(error.code)) {
      throw new TemplateSourceError(error.code, error.message, error);
    }
    throw new TemplateSourceError(
      "template_network",
      "Template request failed",
      error,
    );
  }
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
): GestureTemplateSource {
  const validatedCatalogUrl = validatedHttpsUrl(catalogUrl).href;
  return {
    async loadCatalog() {
      const text = await loadRemoteText(validatedCatalogUrl, "catalog", transport);
      try {
        return parseGestureTemplateCatalog(text);
      } catch (error) {
        return normalizeProtocolError(error);
      }
    },
    async loadPackage(entry) {
      const text = await loadRemoteText(entry.packageUrl, "package", transport);
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

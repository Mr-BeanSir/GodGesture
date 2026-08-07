import { z } from "zod";
import { MAX_URL_LENGTH, utf8SizeBytes } from "../config/limits.js";

export const ONLINE_PLUGIN_CATALOG_FORMAT_VERSION = 1;
export const MAX_ONLINE_PLUGIN_CATALOG_BYTES = 512 * 1024;
export const MAX_ONLINE_PLUGIN_CATALOG_ENTRIES = 256;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const semanticVersion = z
  .string()
  .max(64)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

const localizedText = z
  .object({
    "zh-CN": z.string().trim().min(1).max(512),
    en: z.string().trim().min(1).max(512),
  })
  .strict();

function isGithubRepository(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    !["github.com", "www.github.com"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return false;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return false;
  return segments[1]!.replace(/\.git$/i, "").length > 0;
}

export const GithubRepositoryUrl = z
  .string()
  .max(MAX_URL_LENGTH)
  .url()
  .refine(isGithubRepository, "URL must be an HTTPS GitHub repository");

const gitRef = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (value) => utf8SizeBytes(value) <= 128,
    "Git ref must be at most 128 UTF-8 bytes",
  )
  .refine(
    (value) =>
      !value.startsWith("-") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !/[\\\u0000-\u001f\u007f ~^:?*[\]]/.test(value),
    "Git ref contains unsupported characters",
  );

function isPortableRelativePath(value: string): boolean {
  if (!value) return true;
  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !/[<>:\"|?*\u0000-\u001f]/.test(segment) &&
        !/[. ]$/.test(segment) &&
        !isWindowsReservedName(segment),
    )
  );
}

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CLOCK$",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function isWindowsReservedName(segment: string): boolean {
  return WINDOWS_RESERVED_NAMES.has(segment.split(".", 1)[0]!.toUpperCase());
}

export const OnlinePluginSource = z
  .object({
    pluginId: z.string().uuid(),
    repositoryUrl: GithubRepositoryUrl,
    ref: gitRef.default("main"),
    subdirectory: z
      .string()
      .max(256)
      .refine(
        (value) => utf8SizeBytes(value) <= 256,
        "Plugin subdirectory must be at most 256 UTF-8 bytes",
      )
      .refine(isPortableRelativePath, "Plugin subdirectory must be portable")
      .default(""),
  })
  .strict();
export type OnlinePluginSource = z.infer<typeof OnlinePluginSource>;

export const OnlinePluginCatalogEntry = OnlinePluginSource.extend({
  slug,
  version: semanticVersion,
  title: localizedText,
  summary: localizedText,
}).strict();
export type OnlinePluginCatalogEntry = z.infer<typeof OnlinePluginCatalogEntry>;

export const OnlinePluginCatalog = z
  .object({
    formatVersion: z.literal(ONLINE_PLUGIN_CATALOG_FORMAT_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    entries: z
      .array(OnlinePluginCatalogEntry)
      .max(MAX_ONLINE_PLUGIN_CATALOG_ENTRIES),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const identities = new Set<string>();
    const pluginIds = new Set<string>();
    catalog.entries.forEach((entry, index) => {
      const identity = `${entry.slug}@${entry.version}`;
      if (identities.has(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "slug"],
          message: "Online plugin catalog entry identities must be unique",
        });
      }
      identities.add(identity);
      if (pluginIds.has(entry.pluginId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "pluginId"],
          message: "Online plugin ids must be unique",
        });
      }
      pluginIds.add(entry.pluginId);
    });
  });
export type OnlinePluginCatalog = z.infer<typeof OnlinePluginCatalog>;

export type OnlinePluginCatalogProtocolErrorCode =
  | "catalog_too_large"
  | "invalid_json"
  | "invalid_catalog";

export class OnlinePluginCatalogProtocolError extends Error {
  constructor(
    public readonly code: OnlinePluginCatalogProtocolErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OnlinePluginCatalogProtocolError";
  }
}

export function parseOnlinePluginCatalog(text: string): OnlinePluginCatalog {
  if (utf8SizeBytes(text) > MAX_ONLINE_PLUGIN_CATALOG_BYTES) {
    throw new OnlinePluginCatalogProtocolError(
      "catalog_too_large",
      `Online plugin catalog exceeds ${MAX_ONLINE_PLUGIN_CATALOG_BYTES} bytes`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OnlinePluginCatalogProtocolError(
      "invalid_json",
      "Online plugin catalog is not valid JSON",
      error,
    );
  }
  const result = OnlinePluginCatalog.safeParse(value);
  if (!result.success) {
    throw new OnlinePluginCatalogProtocolError(
      "invalid_catalog",
      "Online plugin catalog does not match the supported format",
      result.error,
    );
  }
  return result.data;
}

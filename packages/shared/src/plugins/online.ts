import { z } from "zod";

export const ONLINE_PLUGIN_CATALOG_FORMAT_VERSION = 1;
export const MAX_ONLINE_PLUGIN_CATALOG_BYTES = 512 * 1024;
export const MAX_ONLINE_PLUGIN_CATALOG_ENTRIES = 256;
export const OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL = "https://github.com/Mr-BeanSir/GodGesture-Plugins";
export const OFFICIAL_ONLINE_PLUGIN_REF = "main";

const unsafeText = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
function text(maximumCharacters: number, label: string) {
  return z.string().transform((value) => value.trim().normalize("NFC")).superRefine((value, ctx) => {
    if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required` });
    if (Array.from(value).length > maximumCharacters) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be at most ${maximumCharacters} characters` });
    if (unsafeText.test(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} contains control or bidirectional text` });
  });
}
const WINDOWS_RESERVED_NAMES = new Set(["CON", "PRN", "AUX", "NUL", "CLOCK$", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]);
function isPortableSubdirectory(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.includes("\\") && value.split("/").every((segment) => segment && segment !== "." && segment !== ".." && !/[<>:"|?*]/.test(segment) && !unsafeText.test(segment) && !/[. ]$/.test(segment) && !WINDOWS_RESERVED_NAMES.has(segment.split(".", 1)[0]!.toUpperCase()));
}

export const OnlinePluginSource = z.object({
  pluginId: z.string().uuid(),
  repositoryUrl: z.literal(OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL),
  ref: z.literal(OFFICIAL_ONLINE_PLUGIN_REF),
  subdirectory: z.string().max(256).refine((value) => value === "" || isPortableSubdirectory(value), "Plugin subdirectory must be portable"),
}).strict();
export type OnlinePluginSource = z.infer<typeof OnlinePluginSource>;
export function officialOnlinePluginSource(entry: Pick<OnlinePluginCatalogEntry, "pluginId" | "subdirectory">): OnlinePluginSource {
  return OnlinePluginSource.parse({ pluginId: entry.pluginId, repositoryUrl: OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL, ref: OFFICIAL_ONLINE_PLUGIN_REF, subdirectory: entry.subdirectory });
}

export const OnlinePluginCatalogEntry = z.object({
  pluginId: z.string().uuid(),
  subdirectory: z.string().max(256).refine(isPortableSubdirectory, "Plugin subdirectory must be portable"),
  title: text(120, "Plugin title"),
  summary: text(512, "Plugin summary"),
  disabled: z.boolean(),
}).strict();
type PlainTextCompat = any;
export type OnlinePluginCatalogEntry = Omit<z.infer<typeof OnlinePluginCatalogEntry>, "disabled"> & {
  /** @deprecated catalog entries no longer publish package versions or authors. */
  slug?: string;
  version?: string;
  author?: string;
  repositoryUrl?: string;
  ref?: string;
  disabled?: boolean;
  title: PlainTextCompat;
  summary: PlainTextCompat;
};
export const OnlinePluginCatalog = z.object({
  formatVersion: z.literal(ONLINE_PLUGIN_CATALOG_FORMAT_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  entries: z.array(OnlinePluginCatalogEntry).max(MAX_ONLINE_PLUGIN_CATALOG_ENTRIES),
}).strict().superRefine((catalog, ctx) => {
  const pluginIds = new Set<string>();
  catalog.entries.forEach((entry, index) => { if (pluginIds.has(entry.pluginId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "pluginId"], message: "Online plugin ids must be unique" }); pluginIds.add(entry.pluginId); });
});
export type OnlinePluginCatalog = Omit<z.infer<typeof OnlinePluginCatalog>, "entries"> & { entries: OnlinePluginCatalogEntry[] };
export type OnlinePluginCatalogProtocolErrorCode = "catalog_too_large" | "invalid_json" | "invalid_catalog";
export class OnlinePluginCatalogProtocolError extends Error { constructor(public readonly code: OnlinePluginCatalogProtocolErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "OnlinePluginCatalogProtocolError"; } }
export function parseOnlinePluginCatalog(text: string): OnlinePluginCatalog {
  if (new TextEncoder().encode(text).byteLength > MAX_ONLINE_PLUGIN_CATALOG_BYTES) throw new OnlinePluginCatalogProtocolError("catalog_too_large", `Online plugin catalog exceeds ${MAX_ONLINE_PLUGIN_CATALOG_BYTES} bytes`);
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new OnlinePluginCatalogProtocolError("invalid_json", "Online plugin catalog is not valid JSON", error); }
  const result = OnlinePluginCatalog.safeParse(value);
  if (!result.success) throw new OnlinePluginCatalogProtocolError("invalid_catalog", "Online plugin catalog does not match the supported format", result.error);
  return result.data;
}

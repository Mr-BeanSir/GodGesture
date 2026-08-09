import { z } from "zod";
import {
  Command,
  GestureIntent,
  MacBinding,
  WindowsBinding,
  type GestureInput,
  type GestureSpec,
} from "../config/gestures.js";

export const GESTURE_TEMPLATE_FORMAT_VERSION = 2;
export const MAX_GESTURE_TEMPLATE_CATALOG_BYTES = 512 * 1024;
export const MAX_GESTURE_TEMPLATE_PACKAGE_BYTES = 256 * 1024;
export const MAX_GESTURE_TEMPLATE_CATALOG_ENTRIES = 256;
export const MAX_GESTURE_TEMPLATE_TAGS = 8;
export const MAX_GESTURE_TEMPLATE_PLUGINS = 32;
export const MAX_GESTURE_TEMPLATE_TARGETS = 128;

const unsafeText = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function text(maximumCharacters: number, label: string) {
  return z.string().transform((value) => value.trim().normalize("NFC")).superRefine((value, ctx) => {
    if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required` });
    if (Array.from(value).length > maximumCharacters) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be at most ${maximumCharacters} characters` });
    }
    if (unsafeText.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} contains control or bidirectional text` });
    }
  });
}

const templateTitle = text(120, "Template title");
const templateSummary = text(512, "Template summary");
const templateTag = text(32, "Template tag");
const templateAuthor = text(64, "Template author");
const strictWindowsBinding = WindowsBinding.strict();
const strictMacBinding = MacBinding.strict();

export const GestureTemplateRisk = z.enum([
  "script",
  "commandLine",
  "fileOrProgram",
  "externalUrl",
]);
export type GestureTemplateRisk = z.infer<typeof GestureTemplateRisk>;

export const GestureTemplateIntent = GestureIntent.omit({ id: true, order: true }).strict();
export type GestureTemplateIntent = z.infer<typeof GestureTemplateIntent>;

function effectiveGestureInputs(gesture: GestureSpec): GestureInput[] {
  return gesture.inputs ?? gesture.strokes.map((direction) => ({ type: "stroke", direction }));
}

export function gestureIdentityKey(gesture: GestureSpec): string {
  return `${gesture.trigger}:${JSON.stringify(effectiveGestureInputs(gesture))}:${gesture.modifier}`;
}

function requireUniqueIntents(intents: readonly GestureTemplateIntent[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  intents.forEach((intent, index) => {
    const key = gestureIdentityKey(intent.gesture);
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["intents", index, "gesture"], message: "Template gestures must be unique within a target" });
    }
    seen.add(key);
  });
}

const globalTargetSummary = z.object({ scope: z.literal("global") }).strict();
const appIdentityFields = {
  name: text(64, "App name"),
  windows: strictWindowsBinding.optional(),
  mac: strictMacBinding.optional(),
};
const appTargetSummary = z.object({ scope: z.literal("app"), ...appIdentityFields }).strict().superRefine((value, ctx) => {
  if (!value.windows && !value.mac) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scope"], message: "App templates require a Windows or macOS binding" });
});

export const GestureTemplateTargetSummary = z.union([globalTargetSummary, appTargetSummary]);
export type GestureTemplateTargetSummary = z.infer<typeof GestureTemplateTargetSummary>;

const templateTags = z.array(templateTag).max(MAX_GESTURE_TEMPLATE_TAGS).refine(
  (values) => new Set(values.map((value) => value.toLocaleLowerCase("en-US"))).size === values.length,
  "Template tags must be unique",
);

export const GestureTemplateCatalogEntry = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  title: templateTitle,
  summary: templateSummary,
  author: templateAuthor,
  tags: templateTags,
  targets: z.array(GestureTemplateTargetSummary).min(1).max(MAX_GESTURE_TEMPLATE_TARGETS),
  risks: z.array(GestureTemplateRisk).max(GestureTemplateRisk.options.length).refine((values) => new Set(values).size === values.length, "Template risks must be unique"),
  downloadCount: z.number().int().nonnegative(),
  publishedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
type PlainTextCompat = any;
export type GestureTemplateCatalogEntry = z.infer<typeof GestureTemplateCatalogEntry> & {
  /** @deprecated runtime catalog entries no longer contain slug/version/packageUrl. */
  slug?: string;
  version?: string;
  packageUrl?: string;
  title: PlainTextCompat;
  summary: PlainTextCompat;
};

export const GestureTemplateCatalog = z.object({
  formatVersion: z.literal(GESTURE_TEMPLATE_FORMAT_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  entries: z.array(GestureTemplateCatalogEntry).max(MAX_GESTURE_TEMPLATE_CATALOG_ENTRIES),
}).strict().superRefine((catalog, ctx) => {
  const identities = new Set<string>();
  catalog.entries.forEach((entry, index) => {
    const identity = `${entry.id}:${entry.versionNumber}`;
    if (identities.has(identity)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "id"], message: "Catalog version identities must be unique" });
    identities.add(identity);
  });
});
export type GestureTemplateCatalog = Omit<z.infer<typeof GestureTemplateCatalog>, "entries"> & { entries: GestureTemplateCatalogEntry[] };

export const PublicTemplateCatalogPage = z.object({
  entries: z.array(GestureTemplateCatalogEntry),
  nextCursor: z.string().uuid().nullable(),
}).strict();
export type PublicTemplateCatalogPage = z.infer<typeof PublicTemplateCatalogPage>;
export const PublicTemplatePackageDownload = z.object({
  url: z.string().url(), packageHash: z.string().regex(/^[0-9a-f]{64}$/), sizeBytes: z.number().int().nonnegative(),
}).strict();
export type PublicTemplatePackageDownload = z.infer<typeof PublicTemplatePackageDownload>;
export const PublicTemplateSubmissionResponse = z.object({
  id: z.string().uuid(), versionNumber: z.number().int().positive(), status: z.enum(["pending_review", "published", "rejected", "withdrawn", "suspended"]),
}).strict();
export type PublicTemplateSubmissionResponse = z.infer<typeof PublicTemplateSubmissionResponse>;
export const PublicTemplateSubmissionPolicy = z.object({
  usage: z.object({ submissionsToday: z.number().int().nonnegative(), pendingVersions: z.number().int().nonnegative(), publishedTemplates: z.number().int().nonnegative() }).strict(),
  limits: z.object({ dailySubmissionLimit: z.number().int().nonnegative(), pendingVersionLimit: z.number().int().nonnegative(), publishedTemplateLimit: z.number().int().nonnegative(), maxPackageBytes: z.number().int().nonnegative() }).strict(),
}).strict();
export type PublicTemplateSubmissionPolicy = z.infer<typeof PublicTemplateSubmissionPolicy>;

const globalPackageTarget = z.object({
  scope: z.literal("global"),
  intents: z.array(GestureTemplateIntent).min(1).max(256),
}).strict().superRefine((value, ctx) => requireUniqueIntents(value.intents, ctx));
const appPackageTarget = z.object({
  scope: z.literal("app"),
  ...appIdentityFields,
  gesturingEnabled: z.boolean().default(true),
  inheritGlobalGestures: z.boolean().default(true),
  intents: z.array(GestureTemplateIntent).min(1).max(256),
}).strict().superRefine((value, ctx) => {
  if (!value.windows && !value.mac) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scope"], message: "App templates require a Windows or macOS binding" });
  requireUniqueIntents(value.intents, ctx);
});

export const GestureTemplateTarget = z.union([globalPackageTarget, appPackageTarget]);
export type GestureTemplateTarget = z.infer<typeof GestureTemplateTarget>;

const gestureTemplatePackageShape = z.object({
  formatVersion: z.literal(GESTURE_TEMPLATE_FORMAT_VERSION),
  author: templateAuthor,
  title: templateTitle.default("Untitled template"),
  summary: templateSummary.default("No summary provided."),
  tags: templateTags.default([]),
  plugins: z.array(z.string().uuid()).max(MAX_GESTURE_TEMPLATE_PLUGINS).refine((values) => new Set(values).size === values.length, "Template plugin ids must be unique").default([]),
  targets: z.array(GestureTemplateTarget).min(1).max(MAX_GESTURE_TEMPLATE_TARGETS),
}).strict().superRefine((templatePackage, ctx) => {
  const targetIdentities = new Set<string>();
  const declaredPlugins = new Set(templatePackage.plugins);
  const referencedPlugins = new Set<string>();
  templatePackage.targets.forEach((target, targetIndex) => {
    const identity = JSON.stringify(targetSummary(target));
    if (targetIdentities.has(identity)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targets", targetIndex], message: "Template targets must be unique" });
    targetIdentities.add(identity);
    target.intents.forEach((intent, intentIndex) => {
      if (intent.command.type !== "nodePlugin") return;
      referencedPlugins.add(intent.command.pluginId);
      if (!declaredPlugins.has(intent.command.pluginId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targets", targetIndex, "intents", intentIndex, "command", "pluginId"], message: "Template nodePlugin commands must declare their plugin id" });
      }
    });
  });
  templatePackage.plugins.forEach((pluginId, index) => {
    if (!referencedPlugins.has(pluginId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["plugins", index], message: "Template plugin ids must be referenced by a nodePlugin command" });
  });
});
export const GestureTemplatePackage = gestureTemplatePackageShape;
export type GestureTemplatePackage = z.infer<typeof GestureTemplatePackage> & {
  /** @deprecated standalone consumers should use server UUID identity. */
  slug?: string;
  version?: string;
  title: PlainTextCompat;
  summary: PlainTextCompat;
};

export type GestureTemplateProtocolErrorCode = "catalog_too_large" | "package_too_large" | "invalid_json" | "invalid_catalog" | "invalid_package" | "metadata_mismatch" | "target_mismatch" | "risk_mismatch";
export class GestureTemplateProtocolError extends Error {
  constructor(public readonly code: GestureTemplateProtocolErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "GestureTemplateProtocolError"; }
}

function parseJsonText(text: string, maximumBytes: number, tooLargeCode: "catalog_too_large" | "package_too_large"): unknown {
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new GestureTemplateProtocolError(tooLargeCode, `Template payload exceeds ${maximumBytes} bytes`);
  try { return JSON.parse(text); } catch (error) { throw new GestureTemplateProtocolError("invalid_json", "Template payload is not valid JSON", error); }
}

export function parseGestureTemplateCatalog(text: string): GestureTemplateCatalog {
  const result = GestureTemplateCatalog.safeParse(parseJsonText(text, MAX_GESTURE_TEMPLATE_CATALOG_BYTES, "catalog_too_large"));
  if (!result.success) throw new GestureTemplateProtocolError("invalid_catalog", "Template catalog does not match the supported format", result.error);
  return result.data;
}

export function parseGestureTemplatePackage(text: string, _legacyMetadata?: unknown): GestureTemplatePackage {
  const result = GestureTemplatePackage.safeParse(parseJsonText(text, MAX_GESTURE_TEMPLATE_PACKAGE_BYTES, "package_too_large"));
  if (!result.success) throw new GestureTemplateProtocolError("invalid_package", "Template package does not match the supported format", result.error);
  return result.data;
}

export function commandTemplateRisks(command: z.infer<typeof Command>) {
  switch (command.type) {
    case "nodePlugin": return ["script"] as const;
    case "cmd": case "powershell": return ["commandLine"] as const;
    case "openFile": return ["fileOrProgram"] as const;
    case "gotoUrl": case "webSearch": return ["externalUrl"] as const;
    default: return [] as const;
  }
}

export function gestureTemplatePackageRisks(templatePackage: GestureTemplatePackage): GestureTemplateRisk[] {
  const risks = new Set<GestureTemplateRisk>();
  templatePackage.targets.forEach((target) => target.intents.forEach((intent) => commandTemplateRisks(intent.command).forEach((risk) => risks.add(risk))));
  return GestureTemplateRisk.options.filter((risk) => risks.has(risk));
}

function targetSummary(target: GestureTemplateTarget): GestureTemplateTargetSummary {
  if (target.scope === "global") return { scope: "global" };
  return { scope: "app", name: target.name, ...(target.windows ? { windows: target.windows } : {}), ...(target.mac ? { mac: target.mac } : {}) };
}

export function gestureTemplateTargetSummaries(
  templatePackage: GestureTemplatePackage,
): GestureTemplateTargetSummary[] {
  return templatePackage.targets.map(targetSummary);
}

export function gestureTemplatePackagePlatforms(
  templatePackage: GestureTemplatePackage,
): Array<"windows" | "macos"> {
  if (templatePackage.targets.some((target) => target.scope === "global")) {
    return ["windows", "macos"];
  }
  const windows = templatePackage.targets.some(
    (target) => target.scope === "app" && target.windows != null,
  );
  const macos = templatePackage.targets.some(
    (target) => target.scope === "app" && target.mac != null,
  );
  return [...(windows ? ["windows" as const] : []), ...(macos ? ["macos" as const] : [])];
}

export function verifyGestureTemplatePackage(entry: GestureTemplateCatalogEntry, templatePackage: GestureTemplatePackage): GestureTemplatePackage {
  if (entry.title !== templatePackage.title || entry.summary !== templatePackage.summary || JSON.stringify(entry.tags) !== JSON.stringify(templatePackage.tags)) throw new GestureTemplateProtocolError("metadata_mismatch", "Template package metadata does not match its catalog entry");
  if (JSON.stringify(entry.targets) !== JSON.stringify(gestureTemplateTargetSummaries(templatePackage))) throw new GestureTemplateProtocolError("target_mismatch", "Template package target does not match its catalog entry");
  if (JSON.stringify(entry.risks) !== JSON.stringify(gestureTemplatePackageRisks(templatePackage))) throw new GestureTemplateProtocolError("risk_mismatch", "Template package risks do not match its catalog entry");
  return templatePackage;
}

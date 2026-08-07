import { z } from "zod";
import {
  Command,
  GestureIntent,
  MacBinding,
  WindowsBinding,
  type GestureInput,
  type GestureSpec,
} from "../config/gestures.js";
import { MAX_URL_LENGTH } from "../config/limits.js";
import { OnlinePluginSource, type OnlinePluginSource as OnlinePluginSourceValue } from "../plugins/online.js";

export const GESTURE_TEMPLATE_FORMAT_VERSION = 1;
export const MAX_GESTURE_TEMPLATE_CATALOG_BYTES = 512 * 1024;
export const MAX_GESTURE_TEMPLATE_PACKAGE_BYTES = 256 * 1024;
export const MAX_GESTURE_TEMPLATE_CATALOG_ENTRIES = 256;
export const MAX_GESTURE_TEMPLATE_TAGS = 8;
export const MAX_GESTURE_TEMPLATE_PLUGINS = 32;

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

const localizedTitle = z
  .object({
    "zh-CN": z.string().trim().min(1).max(120),
    en: z.string().trim().min(1).max(120),
  })
  .strict();

const localizedSummary = z
  .object({
    "zh-CN": z.string().trim().min(1).max(512),
    en: z.string().trim().min(1).max(512),
  })
  .strict();

const httpsUrl = z
  .string()
  .max(MAX_URL_LENGTH)
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "URL must use HTTPS",
  });

const strictWindowsBinding = WindowsBinding.strict();
const strictMacBinding = MacBinding.strict();

export const GestureTemplateRisk = z.enum([
  "script",
  "commandLine",
  "fileOrProgram",
  "externalUrl",
]);
export type GestureTemplateRisk = z.infer<typeof GestureTemplateRisk>;

export const GestureTemplateIntent = GestureIntent.omit({
  id: true,
  order: true,
}).strict();
export type GestureTemplateIntent = z.infer<typeof GestureTemplateIntent>;

function effectiveGestureInputs(gesture: GestureSpec): GestureInput[] {
  if (gesture.inputs !== undefined) return gesture.inputs;

  return gesture.strokes.map((direction) => ({
    type: "stroke",
    direction,
  }));
}

export function gestureIdentityKey(gesture: GestureSpec): string {
  return `${gesture.trigger}:${JSON.stringify(effectiveGestureInputs(gesture))}:${gesture.modifier}`;
}

function requireUniqueIntents(
  intents: readonly GestureTemplateIntent[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  intents.forEach((intent, index) => {
    const key = gestureIdentityKey(intent.gesture);
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intents", index, "gesture"],
        message: "Template gestures must be unique within a package",
      });
    }
    seen.add(key);
  });
}

const globalTargetSummary = z.object({ scope: z.literal("global") }).strict();

const appIdentityFields = {
  name: z.string().trim().min(1).max(64),
  windows: strictWindowsBinding.optional(),
  mac: strictMacBinding.optional(),
};

const appTargetSummary = z
  .object({ scope: z.literal("app"), ...appIdentityFields })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.windows && !value.mac) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "App templates require a Windows or macOS binding",
      });
    }
  });

export const GestureTemplateTargetSummary = z.union([
  globalTargetSummary,
  appTargetSummary,
]);
export type GestureTemplateTargetSummary = z.infer<
  typeof GestureTemplateTargetSummary
>;

export const GestureTemplateCatalogEntry = z
  .object({
    slug,
    version: semanticVersion,
    title: localizedTitle,
    summary: localizedSummary,
    author: z.string().trim().min(1).max(64),
    tags: z
      .array(z.string().trim().min(1).max(32))
      .max(MAX_GESTURE_TEMPLATE_TAGS)
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLocaleLowerCase())).size ===
          values.length,
        { message: "Template tags must be unique" },
      ),
    target: GestureTemplateTargetSummary,
    risks: z
      .array(GestureTemplateRisk)
      .max(GestureTemplateRisk.options.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "Template risks must be unique",
      }),
    packageUrl: httpsUrl,
  })
  .strict();
export type GestureTemplateCatalogEntry = z.infer<
  typeof GestureTemplateCatalogEntry
>;

export const GestureTemplateCatalog = z
  .object({
    formatVersion: z.literal(GESTURE_TEMPLATE_FORMAT_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    entries: z
      .array(GestureTemplateCatalogEntry)
      .max(MAX_GESTURE_TEMPLATE_CATALOG_ENTRIES),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const identities = new Set<string>();
    catalog.entries.forEach((entry, index) => {
      const identity = `${entry.slug}@${entry.version}`;
      if (identities.has(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "slug"],
          message: "Catalog entry identities must be unique",
        });
      }
      identities.add(identity);
    });
  });
export type GestureTemplateCatalog = z.infer<typeof GestureTemplateCatalog>;

const globalPackageTarget = z
  .object({
    scope: z.literal("global"),
    intents: z.array(GestureTemplateIntent).min(1).max(256),
  })
  .strict()
  .superRefine((value, ctx) => requireUniqueIntents(value.intents, ctx));

const appPackageTarget = z
  .object({
    scope: z.literal("app"),
    ...appIdentityFields,
    gesturingEnabled: z.boolean().default(true),
    inheritGlobalGestures: z.boolean().default(true),
    intents: z.array(GestureTemplateIntent).min(1).max(256),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.windows && !value.mac) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "App templates require a Windows or macOS binding",
      });
    }
    requireUniqueIntents(value.intents, ctx);
  });

export const GestureTemplateTarget = z.union([
  globalPackageTarget,
  appPackageTarget,
]);
export type GestureTemplateTarget = z.infer<typeof GestureTemplateTarget>;

export const GestureTemplatePackage = z
  .object({
    formatVersion: z.literal(GESTURE_TEMPLATE_FORMAT_VERSION),
    slug,
    version: semanticVersion,
    plugins: z.array(OnlinePluginSource).max(MAX_GESTURE_TEMPLATE_PLUGINS).default([]),
    target: GestureTemplateTarget,
  })
  .strict()
  .superRefine((templatePackage, ctx) => {
    const sources = new Map<string, OnlinePluginSourceValue>();
    for (const [index, source] of templatePackage.plugins.entries()) {
      if (sources.has(source.pluginId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plugins", index, "pluginId"],
          message: "Template plugin ids must be unique",
        });
      }
      sources.set(source.pluginId, source);
    }
    const referencedPluginIds = new Set<string>();
    for (const [index, intent] of templatePackage.target.intents.entries()) {
      if (intent.command.type !== "nodePlugin") continue;
      referencedPluginIds.add(intent.command.pluginId);
      if (!sources.has(intent.command.pluginId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["target", "intents", index, "command", "pluginId"],
          message: "Template nodePlugin commands must declare a matching plugin source",
        });
      }
    }
    for (const [index, source] of templatePackage.plugins.entries()) {
      if (!referencedPluginIds.has(source.pluginId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plugins", index, "pluginId"],
          message: "Template plugin sources must be referenced by a nodePlugin command",
        });
      }
    }
  });
export type GestureTemplatePackage = z.infer<typeof GestureTemplatePackage>;

export type GestureTemplateProtocolErrorCode =
  | "catalog_too_large"
  | "package_too_large"
  | "invalid_json"
  | "invalid_catalog"
  | "invalid_package"
  | "identity_mismatch"
  | "target_mismatch"
  | "risk_mismatch";

export class GestureTemplateProtocolError extends Error {
  constructor(
    public readonly code: GestureTemplateProtocolErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GestureTemplateProtocolError";
  }
}

function parseJsonText(
  text: string,
  maximumBytes: number,
  tooLargeCode: GestureTemplateProtocolErrorCode,
): unknown {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maximumBytes) {
    throw new GestureTemplateProtocolError(
      tooLargeCode,
      `Template payload exceeds ${maximumBytes} bytes`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new GestureTemplateProtocolError(
      "invalid_json",
      "Template payload is not valid JSON",
      error,
    );
  }

  return value;
}

export function parseGestureTemplateCatalog(
  text: string,
): GestureTemplateCatalog {
  const value = parseJsonText(
    text,
    MAX_GESTURE_TEMPLATE_CATALOG_BYTES,
    "catalog_too_large",
  );
  const result = GestureTemplateCatalog.safeParse(value);
  if (!result.success) {
    throw new GestureTemplateProtocolError(
      "invalid_catalog",
      "Template catalog does not match the supported format",
      result.error,
    );
  }
  return result.data;
}

export function parseGestureTemplatePackage(
  text: string,
): GestureTemplatePackage {
  const value = parseJsonText(
    text,
    MAX_GESTURE_TEMPLATE_PACKAGE_BYTES,
    "package_too_large",
  );
  const result = GestureTemplatePackage.safeParse(value);
  if (!result.success) {
    throw new GestureTemplateProtocolError(
      "invalid_package",
      "Template package does not match the supported format",
      result.error,
    );
  }
  return result.data;
}

export function commandTemplateRisks(command: z.infer<typeof Command>) {
  switch (command.type) {
    case "nodePlugin":
      return ["script"] as const;
    case "cmd":
    case "powershell":
      return ["commandLine"] as const;
    case "openFile":
      return ["fileOrProgram"] as const;
    case "gotoUrl":
    case "webSearch":
      return ["externalUrl"] as const;
    default:
      return [] as const;
  }
}

export function gestureTemplatePackageRisks(
  templatePackage: GestureTemplatePackage,
): GestureTemplateRisk[] {
  const risks = new Set<GestureTemplateRisk>();
  for (const intent of templatePackage.target.intents) {
    for (const risk of commandTemplateRisks(intent.command)) risks.add(risk);
  }
  return GestureTemplateRisk.options.filter((risk) => risks.has(risk));
}

function targetSummary(templatePackage: GestureTemplatePackage) {
  if (templatePackage.target.scope === "global") return { scope: "global" };
  const { name, windows, mac } = templatePackage.target;
  return {
    scope: "app",
    name,
    ...(windows ? { windows } : {}),
    ...(mac ? { mac } : {}),
  };
}

export function verifyGestureTemplatePackage(
  entry: GestureTemplateCatalogEntry,
  templatePackage: GestureTemplatePackage,
): GestureTemplatePackage {
  if (
    entry.slug !== templatePackage.slug ||
    entry.version !== templatePackage.version
  ) {
    throw new GestureTemplateProtocolError(
      "identity_mismatch",
      "Template package identity does not match its catalog entry",
    );
  }

  if (JSON.stringify(entry.target) !== JSON.stringify(targetSummary(templatePackage))) {
    throw new GestureTemplateProtocolError(
      "target_mismatch",
      "Template package target does not match its catalog entry",
    );
  }

  if (
    JSON.stringify(entry.risks) !==
    JSON.stringify(gestureTemplatePackageRisks(templatePackage))
  ) {
    throw new GestureTemplateProtocolError(
      "risk_mismatch",
      "Template package risks do not match its catalog entry",
    );
  }

  return templatePackage;
}

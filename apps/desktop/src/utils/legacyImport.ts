import {
  ConfigDocument,
  LEGACY_IMPORT_DIAGNOSTIC_CODES,
  MAX_CONFIG_DOCUMENT_BYTES,
  configDocumentSizeBytes,
  importLegacyConfig,
  type LegacyConfigInput,
  type LegacyImportDiagnostic,
  type LegacyImportResult,
} from "@godgesture/shared";

export const MAX_LEGACY_IMPORT_FILE_BYTES = 4 * 1024 * 1024;

export type LegacyImportPreparationErrorCode =
  | "gestures_required"
  | "file_too_large"
  | "read_failed"
  | "parse_failed"
  | "document_too_large";

export class LegacyImportPreparationError extends Error {
  public readonly cause: unknown;

  constructor(
    public readonly code: LegacyImportPreparationErrorCode,
    public readonly source?: "gestures.wg2" | "config.plist",
    cause?: unknown,
  ) {
    super(code);
    this.name = "LegacyImportPreparationError";
    this.cause = cause;
  }
}

export interface LegacyImportPreview {
  globalIntentCount: number;
  appCount: number;
  appIntentCount: number;
  hotCornerCount: number;
  rubEdgeCount: number;
  documentSizeBytes: number;
}

export function assertLegacyImportFileSize(
  size: number,
  source: "gestures.wg2" | "config.plist",
): void {
  if (!Number.isFinite(size) || size < 0 || size > MAX_LEGACY_IMPORT_FILE_BYTES) {
    throw new LegacyImportPreparationError("file_too_large", source);
  }
}

export function createLegacyImportPreview(document: ConfigDocument): LegacyImportPreview {
  return {
    globalIntentCount: document.global.intents.length,
    appCount: document.apps.length,
    appIntentCount: document.apps.reduce((count, app) => count + app.intents.length, 0),
    hotCornerCount: Object.keys(document.hotCorners.commands).length,
    rubEdgeCount: Object.keys(document.rubEdges.commands).length,
    documentSizeBytes: configDocumentSizeBytes(document),
  };
}

export function prepareLegacyImport(input: LegacyConfigInput): {
  result: LegacyImportResult;
  preview: LegacyImportPreview;
} {
  let result: LegacyImportResult;
  try {
    result = importLegacyConfig(input);
  } catch (error) {
    throw new LegacyImportPreparationError("parse_failed", "gestures.wg2", error);
  }

  const parsedDocument = ConfigDocument.parse(result.document);
  const preview = createLegacyImportPreview(parsedDocument);
  if (preview.documentSizeBytes > MAX_CONFIG_DOCUMENT_BYTES) {
    throw new LegacyImportPreparationError("document_too_large");
  }
  return { result: { ...result, document: parsedDocument }, preview };
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

function formatDetails(
  details: LegacyImportDiagnostic["details"],
  t: Translate,
): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  return Object.entries(details)
    .map(([key, value]) => {
      const displayValue =
        typeof value === "boolean" ? t(`options.legacyImport.boolean.${String(value)}`) : String(value);
      return `${key}=${displayValue}`;
    })
    .join(", ");
}

/** Formats a language-neutral shared diagnostic at the desktop i18n boundary. */
export function formatLegacyImportDiagnostic(
  diagnostic: LegacyImportDiagnostic,
  t: Translate,
): string {
  const code = String(diagnostic.code);
  const message = (LEGACY_IMPORT_DIAGNOSTIC_CODES as readonly string[]).includes(code)
    ? t(`options.legacyImport.warning.${code}`)
    : t("options.legacyImport.warning.unknown", { code });
  const location = diagnostic.location;
  const context: string[] = [diagnostic.source];
  if (location) {
    context.push(t(`options.legacyImport.scope.${location.scope}`));
    if (location.appName) context.push(location.appName);
    if (location.intentName) context.push(location.intentName);
    if (location.index !== undefined) {
      context.push(t("options.legacyImport.itemIndex", { index: location.index + 1 }));
    }
    if (location.field) context.push(location.field);
  }
  const details = formatDetails(diagnostic.details, t);
  return details
    ? t("options.legacyImport.diagnosticWithDetails", {
        context: context.join(" · "),
        message,
        details,
      })
    : t("options.legacyImport.diagnostic", { context: context.join(" · "), message });
}

/** Stable, language-neutral diagnostics emitted while importing WGestures data. */
export const LEGACY_IMPORT_DIAGNOSTIC_CODES = [
  "invalid_virtual_key",
  "unknown_virtual_key",
  "invalid_command",
  "invalid_hotkey",
  "unknown_window_operation",
  "unknown_command_type",
  "unknown_trigger_button",
  "invalid_stroke_direction",
  "stroke_limit_exceeded",
  "unknown_modifier",
  "intents_not_array",
  "invalid_intent",
  "unknown_file_version",
  "invalid_app_entry",
  "empty_app_executable",
  "hot_corner_slots_exceeded",
  "hot_corner_commands_not_array",
  "plist_root_not_dictionary",
  "plist_parse_failed",
  "trigger_mask_empty",
  "pause_hotkey_invalid",
  "preference_clamped",
] as const;

export type LegacyImportDiagnosticCode =
  (typeof LEGACY_IMPORT_DIAGNOSTIC_CODES)[number];

export type LegacyImportDiagnosticSource = "gestures.wg2" | "config.plist";

export type LegacyImportDiagnosticScope =
  | "global"
  | "app"
  | "hotCorner"
  | "rubEdge"
  | "preferences";

export interface LegacyImportDiagnosticLocation {
  scope: LegacyImportDiagnosticScope;
  appName?: string;
  intentName?: string;
  /** Zero-based index in the corresponding legacy source collection. */
  index?: number;
  /** Legacy source field name, or the corner/edge identifier for a slot. */
  field?: string;
}

export interface LegacyImportDiagnostic {
  code: LegacyImportDiagnosticCode;
  source: LegacyImportDiagnosticSource;
  location?: LegacyImportDiagnosticLocation;
  details?: Record<string, string | number | boolean>;
}

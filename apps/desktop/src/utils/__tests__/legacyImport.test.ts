import { describe, expect, it } from "vitest";
import { importLegacyConfig } from "@godgesture/shared";
import {
  MAX_LEGACY_IMPORT_FILE_BYTES,
  assertLegacyImportFileSize,
  createLegacyImportPreview,
  formatLegacyImportDiagnostic,
  prepareLegacyImport,
} from "../legacyImport";

const MINIMAL_WG2 = JSON.stringify({
  FileVersion: "3",
  Global: { GestureIntents: [] },
  Apps: {},
  HotCornerCommands: [],
});

describe("legacy import preparation", () => {
  it("enforces the 4 MiB per-file boundary", () => {
    expect(() => assertLegacyImportFileSize(MAX_LEGACY_IMPORT_FILE_BYTES, "gestures.wg2"))
      .not.toThrow();
    expect(() => assertLegacyImportFileSize(MAX_LEGACY_IMPORT_FILE_BYTES + 1, "config.plist"))
      .toThrowError(expect.objectContaining({ code: "file_too_large", source: "config.plist" }));
  });

  it("builds preview counts from the normalized document", () => {
    const imported = importLegacyConfig({
      gesturesWg2: JSON.stringify({
        FileVersion: "3",
        Global: { GestureIntents: [{ Name: "Global", Gesture: {}, Command: {} }] },
        Apps: {
          app: {
            Name: "App",
            ExecutablePath: "C:\\app.exe",
            GestureIntents: [
              { Name: "One", Gesture: {}, Command: {} },
              { Name: "Two", Gesture: {}, Command: {} },
            ],
          },
        },
        HotCornerCommands: [{}, null, null, null, {}],
      }),
    });

    expect(createLegacyImportPreview(imported.document)).toMatchObject({
      globalIntentCount: 1,
      appCount: 1,
      appIntentCount: 2,
      hotCornerCount: 1,
      rubEdgeCount: 1,
    });
  });

  it("maps malformed gestures.wg2 to a stable fatal error", () => {
    expect(() => prepareLegacyImport({ gesturesWg2: "not-json" })).toThrowError(
      expect.objectContaining({ code: "parse_failed", source: "gestures.wg2" }),
    );
  });

  it("blocks converted documents above the current sync limit", () => {
    const commandLength = 16_384;
    const intentCount = 256;
    const intents = Array.from({ length: intentCount }, (_, index) => ({
      Name: `Intent ${index}`,
      Gesture: { Dirs: [0] },
      Command: {
        $type: "WGestures.Core.Commands.Impl.SendTextCommand, WGestures.Core",
        Text: "x".repeat(commandLength),
      },
    }));

    expect(() =>
      prepareLegacyImport({
        gesturesWg2: JSON.stringify({
          FileVersion: "3",
          Global: { GestureIntents: intents },
          Apps: {},
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: "document_too_large" }));
  });

  it("formats structured diagnostics only at the desktop i18n boundary", () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key;
    const text = formatLegacyImportDiagnostic(
      {
        code: "preference_clamped",
        source: "config.plist",
        location: { scope: "preferences", field: "PathTrackerInitialValidMove" },
        details: { value: 99, clamped: 50 },
      },
      t,
    );

    expect(text).toContain("options.legacyImport.warning.preference_clamped");
    expect(text).toContain("options.legacyImport.scope.preferences");
    expect(text).toContain("value=99");

    const future = formatLegacyImportDiagnostic(
      { code: "future_code" as never, source: "gestures.wg2" },
      t,
    );
    expect(future).toContain("options.legacyImport.warning.unknown");
    expect(future).toContain("future_code");
  });

  it("keeps an invalid plist as a non-fatal structured warning", () => {
    const prepared = prepareLegacyImport({
      gesturesWg2: MINIMAL_WG2,
      configPlist: "<invalid",
    });
    expect(prepared.result.warnings).toContainEqual({
      code: "plist_parse_failed",
      source: "config.plist",
      location: { scope: "preferences" },
    });
    expect(prepared.preview.globalIntentCount).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import monacoSource from "../monaco.ts?raw";
import nodeDeclarationsSource from "../node-declarations.ts?raw";
import viteConfigSource from "../../../vite.config.ts?raw";
import scriptEditorSource from "../../components/ScriptEditor.vue?raw";
import nodePluginEditorSource from "../../components/NodePluginEditor.vue?raw";

describe("Monaco configuration", () => {
  it("loads editor contributions and JavaScript language support into one registry", () => {
    expect(monacoSource).toContain('import("monaco-editor/editor/editor.main")');
    expect(monacoSource).toContain(
      'import("monaco-editor/languages/features/typescript/register")',
    );
    expect(monacoSource).toContain(
      'import("monaco-editor/languages/definitions/javascript/register")',
    );
    expect(monacoSource).not.toContain("definitions/lua/register");
    expect(monacoSource).not.toContain("godgesture.d.ts");
    expect(monacoSource).toContain("addExtraLib(");
    expect(monacoSource).toContain('import("./node-declarations")');
    expect(nodeDeclarationsSource).toContain("@types/node/**/*.d.ts");
    expect(nodeDeclarationsSource).toContain("undici-types/**/*.d.ts");
    expect(viteConfigSource).toContain('dedupe: ["monaco-editor"]');
    expect(viteConfigSource).toContain('exclude: ["monaco-editor"]');
  });

  it("routes Monaco markers into the Node plugin Problems panel", () => {
    expect(scriptEditorSource).toContain("onDidChangeMarkers");
    expect(scriptEditorSource).toContain('emit("diagnostics"');
    expect(scriptEditorSource).toContain("diagnosticKey");
    expect(scriptEditorSource).toContain("items:");
    expect(scriptEditorSource).toContain("retainModel");
    expect(scriptEditorSource).toContain("modelPath");
    expect(scriptEditorSource).toContain("fixedOverflowWidgets: true");
    expect(nodePluginEditorSource).toContain('@diagnostics="updateDiagnostics"');
    expect(nodePluginEditorSource).toContain('@diagnostics="updateManifestDiagnostics"');
    expect(nodePluginEditorSource).toContain("diagnostic.line");
    expect(nodePluginEditorSource).toContain("diagnostic.column");
    expect(nodePluginEditorSource).toContain("manifestChanged");
    expect(nodePluginEditorSource).toContain("lockfileStale");
    expect(nodePluginEditorSource).toContain("node-plugin-editor__code-tabs");
  });
});

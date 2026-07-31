import { describe, expect, it } from "vitest";
import monacoSource from "../monaco.ts?raw";
import nodeDeclarationsSource from "../node-declarations.ts?raw";
import viteConfigSource from "../../../vite.config.ts?raw";

describe("Monaco configuration", () => {
  it("loads editor contributions and JavaScript language support into one registry", () => {
    expect(monacoSource).toContain('import("monaco-editor/editor/editor.main")');
    expect(monacoSource).toContain(
      'import("monaco-editor/languages/features/typescript/register")',
    );
    expect(monacoSource).toContain(
      'import("monaco-editor/languages/definitions/javascript/register")',
    );
    expect(monacoSource).toContain("addExtraLib(");
    expect(monacoSource).toContain('import("./node-declarations")');
    expect(nodeDeclarationsSource).toContain("@types/node/**/*.d.ts");
    expect(nodeDeclarationsSource).toContain("undici-types/**/*.d.ts");
    expect(viteConfigSource).toContain('dedupe: ["monaco-editor"]');
    expect(viteConfigSource).toContain('exclude: ["monaco-editor"]');
  });
});

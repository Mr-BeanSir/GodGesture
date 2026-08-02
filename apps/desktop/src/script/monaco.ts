import type * as Monaco from "monaco-editor/editor/editor.api";
import sdkDeclarations from "../../script-api/godgesture-sdk.d.ts?raw";

type MonacoApi = typeof Monaco;

let monacoPromise: Promise<MonacoApi> | undefined;

export function loadMonaco(): Promise<MonacoApi> {
  monacoPromise ??= initializeMonaco();
  return monacoPromise;
}

async function initializeMonaco(): Promise<MonacoApi> {
  const [EditorWorker, TypeScriptWorker] = await Promise.all([
    import("monaco-editor/editor/editor.worker?worker"),
    import("monaco-editor/language/typescript/ts.worker?worker"),
  ]);

  const workerGlobal = self as typeof self & {
    MonacoEnvironment: { getWorker(moduleId: string, label: string): Worker };
  };
  workerGlobal.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === "javascript" || label === "typescript") {
        return new TypeScriptWorker.default();
      }
      return new EditorWorker.default();
    },
  };

  const [monaco, typescript, , { nodeDeclarationFiles }] = await Promise.all([
    // editor.api exposes the data surface but does not register visible contributions
    // such as the suggestion widget, parameter hints, or hover UI.
    import("monaco-editor/editor/editor.main"),
    import("monaco-editor/languages/features/typescript/register"),
    import("monaco-editor/languages/definitions/javascript/register"),
    import("./node-declarations"),
  ]);

  typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    lib: ["es2020"],
    noEmit: true,
    target: typescript.ScriptTarget.ES2020,
  });
  typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  typescript.javascriptDefaults.setEagerModelSync(true);
  typescript.javascriptDefaults.addExtraLib(
    sdkDeclarations,
    "inmemory://godgesture/script-api/godgesture-sdk.d.ts",
  );
  for (const [path, declaration] of Object.entries(nodeDeclarationFiles).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const relative = path.replace(/^\.\.\/\.\.\/node_modules\//, "");
    typescript.javascriptDefaults.addExtraLib(
      declaration,
      `inmemory://godgesture/node_modules/${relative}`,
    );
  }
  return monaco;
}

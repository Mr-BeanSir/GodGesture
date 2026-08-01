import { describe, expect, it } from "vitest";
import apiDeclarations from "../../../script-api/godgesture.d.ts?raw";
import sdkDeclarations from "../../../script-api/godgesture-sdk.d.ts?raw";
import scriptingGuide from "../../../../../docs/SCRIPTING.md?raw";

describe("GodGesture script API declarations", () => {
  it("documents every runtime host surface", () => {
    for (const symbol of [
      "declare const Input",
      "keyCombo(",
      "sendText(",
      "mouseClick(",
      "mouseDown(",
      "mouseUp(",
      "movePointer(",
      "wheel(",
      "declare const Context",
      "activateTargetWindow(",
      "declare const Window",
      "perform(",
      "declare const Clipboard",
      "readText(",
      "writeText(",
      "selectedText(",
      "declare function ReportStatus(",
    ]) {
      expect(apiDeclarations).toContain(symbol);
    }
  });

  it("keeps lifecycle and window-operation literals complete", () => {
    for (const literal of [
      "init",
      "execute",
      "gestureRecognized",
      "modifierTriggered",
      "gestureEnded",
      "maximizeRestore",
      "minimize",
      "close",
      "toggleTopmost",
      "dockLeft",
      "dockRight",
    ]) {
      expect(apiDeclarations).toContain(`\"${literal}\"`);
    }
  });

  it("exposes the Node SDK module to the editor", () => {
    expect(sdkDeclarations).toContain('declare module "@godgesture/sdk"');
    expect(sdkDeclarations).toContain("PluginContext");
    expect(sdkDeclarations).toContain("defineHandler");
  });

  it("keeps the public scripting guide aligned with the Node SDK contract", () => {
    for (const symbol of [
      "@godgesture/sdk",
      "PluginContext",
      "init",
      "execute",
      "gestureRecognized",
      "modifierTriggered",
      "gestureEnded",
      "keyCombo",
      "sendText",
      "mouseClick",
      "mouseDown",
      "mouseUp",
      "movePointer",
      "wheel",
      "activateTarget",
      "perform",
      "readText",
      "writeText",
      "selectedText",
      "status.report",
      "maximizeRestore",
      "toggleTopmost",
      "dockLeft",
      "dockRight",
    ]) {
      expect(scriptingGuide).toContain(symbol);
    }
    for (const limit of ["32", "64", "256 KiB", "1 MiB", "512 KiB", "4 MiB"]) {
      expect(scriptingGuide).toContain(limit);
    }
    expect(scriptingGuide).toContain("QuickJS");
    expect(scriptingGuide).toContain("迁移兼容路径");
  });
});

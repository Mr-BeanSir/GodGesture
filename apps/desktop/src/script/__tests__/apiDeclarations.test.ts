import { describe, expect, it } from "vitest";
import sdkDeclarations from "../../../script-api/godgesture-sdk.d.ts?raw";
import scriptingGuide from "../../../../../docs/SCRIPTING.md?raw";

describe("GodGesture Node plugin API declarations", () => {
  it("documents every runtime host surface", () => {
    for (const symbol of [
      "keyCombo(",
      "sendText(",
      "mouseClick(",
      "mouseDown(",
      "mouseUp(",
      "movePointer(",
      "wheel(",
      "activateTarget(",
      "perform(",
      "readText(",
      "writeText(",
      "selectedText(",
      "report(",
    ]) {
      expect(sdkDeclarations).toContain(symbol);
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
      expect(sdkDeclarations).toContain(`\"${literal}\"`);
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
    expect(scriptingGuide).toContain("Node.js");
    expect(scriptingGuide).toContain("唯一脚本运行时");
  });
});

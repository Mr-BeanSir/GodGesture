import { describe, expect, it } from "vitest";
import apiDeclarations from "../../../script-api/godgesture.d.ts?raw";
import sdkDeclarations from "../../../script-api/godgesture-sdk.d.ts?raw";

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
});

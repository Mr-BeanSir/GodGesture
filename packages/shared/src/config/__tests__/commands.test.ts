import { describe, expect, it } from "vitest";
import { Command } from "../gestures.js";
import { parseSendTextDsl } from "../send-text-dsl.js";

describe("audio volume command", () => {
  it("accepts signed steps and reserves zero for mute", () => {
    expect(Command.parse({ type: "audioVolume", delta: -20 })).toEqual({
      type: "audioVolume",
      delta: -20,
    });
    expect(Command.parse({ type: "audioVolume", delta: 0 })).toEqual({
      type: "audioVolume",
      delta: 0,
    });
    expect(Command.parse({ type: "audioVolume", delta: 20 })).toEqual({
      type: "audioVolume",
      delta: 20,
    });
  });

  it("rejects values outside the bounded range", () => {
    expect(() => Command.parse({ type: "audioVolume", delta: -21 })).toThrow();
    expect(() => Command.parse({ type: "audioVolume", delta: 21 })).toThrow();
  });
});

describe("command line commands", () => {
  it("keeps cmd and PowerShell as distinct command types", () => {
    expect(Command.parse({ type: "cmd", code: "echo cmd" })).toEqual({
      type: "cmd",
      code: "echo cmd",
      showWindow: true,
      autoSetWorkingDir: true,
    });
    expect(Command.parse({ type: "powershell", code: "Write-Output ps" })).toEqual({
      type: "powershell",
      code: "Write-Output ps",
      showWindow: true,
      autoSetWorkingDir: true,
    });
  });
});

describe("send text command DSL", () => {
  it("accepts text, key, hotkey and sleep statements in order", () => {
    const text = [
      'text "site:"',
      "key enter",
      "hotkey ctrl+shift+p",
      "sleep 250",
    ].join("\n");
    expect(Command.parse({
      type: "sendText",
      text,
    })).toEqual({
      type: "sendText",
      text,
    });
    expect(parseSendTextDsl(text)).toEqual([
      { type: "text", text: "site:" },
      { type: "key", key: "enter" },
      { type: "hotkey", modifiers: ["ctrl", "shift"], key: "p" },
      { type: "sleep", milliseconds: 250 },
    ]);
  });

  it("rejects malformed statements with a line number", () => {
    expect(() => Command.parse({ type: "sendText", text: "sleep nope" }))
      .toThrow(/Line 1/);
  });

  it("rejects the removed structured step payload", () => {
    expect(() => Command.parse({
      type: "sendText",
      steps: [{ type: "text", text: "legacy" }],
    })).toThrow();
  });
});

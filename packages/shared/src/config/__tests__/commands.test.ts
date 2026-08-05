import { describe, expect, it } from "vitest";
import { Command } from "../gestures.js";

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

describe("send text command steps", () => {
  it("accepts ordered text and key operations", () => {
    expect(Command.parse({
      type: "sendText",
      steps: [
        { type: "text", text: "site:" },
        { type: "key", modifiers: ["ctrl"], key: "l" },
      ],
    })).toEqual({
      type: "sendText",
      steps: [
        { type: "text", text: "site:" },
        { type: "key", modifiers: ["ctrl"], key: "l" },
      ],
    });
  });

  it("continues to accept the legacy text form while it is migrated", () => {
    expect(Command.parse({ type: "sendText", text: "legacy" })).toEqual({
      type: "sendText",
      text: "legacy",
    });
  });
});

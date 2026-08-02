import { describe, expect, it } from "vitest";
import {
  createHotkeyRecording,
  hotkeyRecordingDraft,
  recordHotkeyKeydown,
  recordHotkeyKeyup,
} from "../hotkey-recorder";

describe("hotkey recorder", () => {
  it("captures and completes a modifier-only chord", () => {
    const recording = createHotkeyRecording();
    expect(recordHotkeyKeydown(recording, { code: "ControlLeft", ctrlKey: true })).toBe(
      "accepted",
    );
    expect(hotkeyRecordingDraft(recording)).toEqual({ modifiers: ["ctrl"], keys: [] });
    expect(recordHotkeyKeyup(recording, { code: "ControlLeft" })).toEqual({
      modifiers: ["ctrl"],
      keys: [],
    });
  });

  it("collects modifiers and main keys until the entire chord is released", () => {
    const recording = createHotkeyRecording();
    recordHotkeyKeydown(recording, { code: "MetaLeft", metaKey: true });
    recordHotkeyKeydown(recording, { code: "AltLeft", metaKey: true, altKey: true });
    recordHotkeyKeydown(recording, {
      code: "KeyB",
      metaKey: true,
      altKey: true,
    });
    expect(recordHotkeyKeyup(recording, { code: "KeyB" })).toBeNull();
    expect(recordHotkeyKeyup(recording, { code: "AltLeft" })).toBeNull();
    expect(recordHotkeyKeyup(recording, { code: "MetaLeft" })).toEqual({
      modifiers: ["alt", "meta"],
      keys: ["b"],
    });
  });

  it("keeps Ctrl when recording Ctrl+W through release", () => {
    const recording = createHotkeyRecording();
    recordHotkeyKeydown(recording, { code: "ControlLeft", ctrlKey: true });
    recordHotkeyKeydown(recording, { code: "KeyW", ctrlKey: true });

    expect(recordHotkeyKeyup(recording, { code: "KeyW" })).toBeNull();
    expect(recordHotkeyKeyup(recording, { code: "ControlLeft" })).toEqual({
      modifiers: ["ctrl"],
      keys: ["w"],
    });
  });

  it("deduplicates repeats and supports multiple main keys in one chord", () => {
    const recording = createHotkeyRecording();
    recordHotkeyKeydown(recording, { code: "ControlLeft", ctrlKey: true });
    recordHotkeyKeydown(recording, { code: "KeyK", ctrlKey: true });
    recordHotkeyKeydown(recording, { code: "KeyK", ctrlKey: true, repeat: true });
    recordHotkeyKeyup(recording, { code: "KeyK" });
    recordHotkeyKeydown(recording, { code: "KeyC", ctrlKey: true });
    recordHotkeyKeyup(recording, { code: "KeyC" });
    expect(recordHotkeyKeyup(recording, { code: "ControlLeft" })).toEqual({
      modifiers: ["ctrl"],
      keys: ["k", "c"],
    });
  });

  it("rejects unsupported physical keys without creating a chord", () => {
    const recording = createHotkeyRecording();
    expect(recordHotkeyKeydown(recording, { code: "Unidentified" })).toBe("unsupported");
    expect(recordHotkeyKeyup(recording, { code: "Unidentified" })).toBeNull();
  });
});

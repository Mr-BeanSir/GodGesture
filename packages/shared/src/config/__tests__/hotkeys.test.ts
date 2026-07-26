import { describe, expect, it } from "vitest";
import {
  HOTKEY_KEY_NAMES,
  HOTKEY_MODIFIERS,
  HotkeyKeyName,
  HotkeyModifier,
  hotkeyKeyNameFromKeyboardCode,
  normalizeHotkeyKeyName,
  normalizeHotkeyModifier,
} from "../hotkeys.js";
import { HotKeyCommand } from "../gestures.js";
import { PauseHotkey } from "../preferences.js";

describe("canonical hotkey names", () => {
  it("exports the canonical modifier and key tables", () => {
    expect(HOTKEY_MODIFIERS).toEqual(["ctrl", "shift", "alt", "meta"]);
    expect(HOTKEY_KEY_NAMES).toContain("numpadDivide");
    expect(HOTKEY_KEY_NAMES).toContain("contextMenu");
    expect(HOTKEY_KEY_NAMES).toContain("browserBack");
    expect(HOTKEY_KEY_NAMES).toContain("mediaPlayPause");
  });

  it("maps KeyboardEvent.code instead of layout-dependent key characters", () => {
    expect(hotkeyKeyNameFromKeyboardCode("Digit2")).toBe("2");
    expect(hotkeyKeyNameFromKeyboardCode("Numpad2")).toBe("numpad2");
    expect(hotkeyKeyNameFromKeyboardCode("NumpadAdd")).toBe("numpadAdd");
    expect(hotkeyKeyNameFromKeyboardCode("BracketLeft")).toBe("bracketLeft");
    expect(hotkeyKeyNameFromKeyboardCode("Backquote")).toBe("backquote");
    expect(hotkeyKeyNameFromKeyboardCode("ContextMenu")).toBe("contextMenu");
    expect(hotkeyKeyNameFromKeyboardCode("BrowserFavorites")).toBe("browserFavorites");
    expect(hotkeyKeyNameFromKeyboardCode("MediaTrackPrevious")).toBe("mediaPrevTrack");
    expect(hotkeyKeyNameFromKeyboardCode("AudioVolumeMute")).toBe("volumeMute");
    expect(hotkeyKeyNameFromKeyboardCode("NotARealCode")).toBeUndefined();
  });

  it("normalizes legacy modifier, Rust, numpad, and symbol aliases", () => {
    expect(normalizeHotkeyModifier("WIN")).toBe("meta");
    expect(normalizeHotkeyModifier("super")).toBe("meta");
    expect(normalizeHotkeyKeyName("pageup")).toBe("pageUp");
    expect(normalizeHotkeyKeyName("pgdn")).toBe("pageDown");
    expect(normalizeHotkeyKeyName("num7")).toBe("numpad7");
    expect(normalizeHotkeyKeyName("nummul")).toBe("numpadMultiply");
    expect(normalizeHotkeyKeyName("leftbracket")).toBe("bracketLeft");
    expect(normalizeHotkeyKeyName("@")).toBe("2");
    expect(normalizeHotkeyKeyName("+")).toBe("equals");
  });

  it("parses legacy HotKeyCommand values into canonical persisted names", () => {
    expect(HotKeyCommand.parse({
      type: "hotKey",
      modifiers: ["control", "shift", "WIN"],
      keys: ["@", "pageup", "num1", "menu_key", "medianext", "["],
    })).toEqual({
      type: "hotKey",
      modifiers: ["ctrl", "shift", "meta"],
      keys: ["2", "pageUp", "numpad1", "contextMenu", "mediaNextTrack", "bracketLeft"],
    });
  });

  it("parses PauseHotkey aliases and rejects genuinely unknown values", () => {
    expect(PauseHotkey.parse({ modifiers: ["super", "CONTROL"], key: "escape" })).toEqual({
      modifiers: ["meta", "ctrl"],
      key: "esc",
    });
    expect(() => HotkeyModifier.parse("hyper")).toThrow();
    expect(() => HotkeyKeyName.parse("definitely-not-a-key")).toThrow();
    expect(() => HotKeyCommand.parse({ type: "hotKey", modifiers: [], keys: ["ctrl"] })).toThrow();
    expect(() => PauseHotkey.parse({ modifiers: [], key: "definitely-not-a-key" })).toThrow();
    expect(PauseHotkey.parse({ modifiers: [], key: "" }).key).toBe("");
  });
});

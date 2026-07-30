import {
  HOTKEY_MODIFIERS,
  hotkeyKeyNameFromKeyboardCode,
  type HotkeyKeyName,
  type HotkeyModifier,
} from "@godgesture/shared";

export interface HotkeyChord {
  modifiers: HotkeyModifier[];
  keys: HotkeyKeyName[];
}

export interface HotkeyKeyEvent {
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

export interface HotkeyRecording {
  pressedCodes: Set<string>;
  modifiers: Set<HotkeyModifier>;
  keys: HotkeyKeyName[];
}

const MODIFIER_BY_CODE: Readonly<Record<string, HotkeyModifier>> = {
  ControlLeft: "ctrl",
  ControlRight: "ctrl",
  ShiftLeft: "shift",
  ShiftRight: "shift",
  AltLeft: "alt",
  AltRight: "alt",
  MetaLeft: "meta",
  MetaRight: "meta",
};

export function createHotkeyRecording(): HotkeyRecording {
  return {
    pressedCodes: new Set(),
    modifiers: new Set(),
    keys: [],
  };
}

function addEventModifiers(recording: HotkeyRecording, event: HotkeyKeyEvent) {
  if (event.ctrlKey) recording.modifiers.add("ctrl");
  if (event.shiftKey) recording.modifiers.add("shift");
  if (event.altKey) recording.modifiers.add("alt");
  if (event.metaKey) recording.modifiers.add("meta");
}

export function recordHotkeyKeydown(
  recording: HotkeyRecording,
  event: HotkeyKeyEvent,
): "accepted" | "unsupported" {
  addEventModifiers(recording, event);
  const modifier = MODIFIER_BY_CODE[event.code];
  if (modifier) {
    recording.modifiers.add(modifier);
    recording.pressedCodes.add(event.code);
    return "accepted";
  }

  const key = hotkeyKeyNameFromKeyboardCode(event.code);
  if (!key) return "unsupported";
  recording.pressedCodes.add(event.code);
  if (!event.repeat && !recording.keys.includes(key)) recording.keys.push(key);
  return "accepted";
}

export function recordHotkeyKeyup(
  recording: HotkeyRecording,
  event: HotkeyKeyEvent,
): HotkeyChord | null {
  recording.pressedCodes.delete(event.code);
  if (recording.pressedCodes.size > 0) return null;
  if (recording.modifiers.size === 0 && recording.keys.length === 0) return null;
  return {
    modifiers: HOTKEY_MODIFIERS.filter((modifier) => recording.modifiers.has(modifier)),
    keys: [...recording.keys],
  };
}

export function hotkeyRecordingDraft(recording: HotkeyRecording): HotkeyChord {
  return {
    modifiers: HOTKEY_MODIFIERS.filter((modifier) => recording.modifiers.has(modifier)),
    keys: [...recording.keys],
  };
}

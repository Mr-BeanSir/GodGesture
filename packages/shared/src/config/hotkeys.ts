import { z } from "zod";

/** Canonical modifier names persisted in synced configuration. */
export const HOTKEY_MODIFIERS = ["ctrl", "shift", "alt", "meta"] as const;

const hotkeyModifierAliases: Readonly<Record<string, (typeof HOTKEY_MODIFIERS)[number]>> = {
  control: "ctrl",
  ctl: "ctrl",
  option: "alt",
  menu: "alt",
  win: "meta",
  windows: "meta",
  super: "meta",
  command: "meta",
  cmd: "meta",
};

/**
 * Normalize modifier spellings written by older GodGesture versions, Rust's
 * compatibility mapper, and WGestures. Unknown values are preserved so the
 * schema can reject them instead of silently dropping a key.
 */
export function normalizeHotkeyModifier(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return hotkeyModifierAliases[lower] ??
    HOTKEY_MODIFIERS.find((modifier) => modifier === lower) ??
    trimmed;
}

export const HotkeyModifier = z.preprocess(
  normalizeHotkeyModifier,
  z.enum(HOTKEY_MODIFIERS),
);
export type HotkeyModifier = z.infer<typeof HotkeyModifier>;

/**
 * Canonical, layout-independent key names persisted in synced configuration.
 * Letter and top-row digit names describe physical KeyboardEvent.code keys;
 * text/characters belong in SendText rather than hot-key commands.
 */
export const HOTKEY_KEY_NAMES = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
  "f13", "f14", "f15", "f16", "f17", "f18", "f19", "f20", "f21", "f22", "f23", "f24",
  "backspace", "tab", "clear", "enter", "pauseBreak", "capsLock", "esc", "space",
  "pageUp", "pageDown", "end", "home", "left", "up", "right", "down",
  "printScreen", "insert", "delete", "contextMenu", "sleep",
  "numpad0", "numpad1", "numpad2", "numpad3", "numpad4",
  "numpad5", "numpad6", "numpad7", "numpad8", "numpad9",
  "numpadMultiply", "numpadAdd", "numpadSeparator", "numpadSubtract",
  "numpadDecimal", "numpadDivide", "numpadEnter", "numpadEqual",
  "numLock", "scrollLock",
  "browserBack", "browserForward", "browserRefresh", "browserStop",
  "browserSearch", "browserFavorites", "browserHome",
  "volumeMute", "volumeDown", "volumeUp",
  "mediaNextTrack", "mediaPrevTrack", "mediaStop", "mediaPlayPause",
  "launchMail", "launchMediaSelect", "launchApp1", "launchApp2",
  "semicolon", "equals", "comma", "minus", "period", "slash", "backquote",
  "bracketLeft", "backslash", "bracketRight", "quote", "intlBackslash",
] as const;

type CanonicalHotkeyKeyName = (typeof HOTKEY_KEY_NAMES)[number];

const canonicalKeyNamesByLowerCase = new Map<string, CanonicalHotkeyKeyName>(
  HOTKEY_KEY_NAMES.map((name) => [name.toLowerCase(), name]),
);

const hotkeyKeyAliases: Readonly<Record<string, CanonicalHotkeyKeyName>> = {
  return: "enter",
  escape: "esc",
  back: "backspace",
  del: "delete",
  ins: "insert",
  pageup: "pageUp",
  pgup: "pageUp",
  prior: "pageUp",
  pagedown: "pageDown",
  pgdn: "pageDown",
  next: "pageDown",
  capslock: "capsLock",
  printscreen: "printScreen",
  prtsc: "printScreen",
  snapshot: "printScreen",
  pause: "pauseBreak",
  apps: "contextMenu",
  app: "contextMenu",
  menu_key: "contextMenu",
  contextmenu: "contextMenu",
  leftbracket: "bracketLeft",
  rightbracket: "bracketRight",
  grave: "backquote",
  volumeup: "volumeUp",
  volumedown: "volumeDown",
  volumemute: "volumeMute",
  medianext: "mediaNextTrack",
  medianexttrack: "mediaNextTrack",
  mediaprev: "mediaPrevTrack",
  mediaprevious: "mediaPrevTrack",
  mediaprevioustrack: "mediaPrevTrack",
  mediaplay: "mediaPlayPause",
  mediaplaypause: "mediaPlayPause",
  mediastop: "mediaStop",
  numadd: "numpadAdd",
  numsub: "numpadSubtract",
  numsubtract: "numpadSubtract",
  nummul: "numpadMultiply",
  nummultiply: "numpadMultiply",
  numdiv: "numpadDivide",
  numdivide: "numpadDivide",
  numdecimal: "numpadDecimal",
  numseparator: "numpadSeparator",
  numenter: "numpadEnter",
  numequal: "numpadEqual",
  "-": "minus",
  "_": "minus",
  "=": "equals",
  "+": "equals",
  ",": "comma",
  "<": "comma",
  ".": "period",
  ">": "period",
  "/": "slash",
  "?": "slash",
  ";": "semicolon",
  ":": "semicolon",
  "'": "quote",
  "\"": "quote",
  "[": "bracketLeft",
  "{": "bracketLeft",
  "]": "bracketRight",
  "}": "bracketRight",
  "\\": "backslash",
  "|": "backslash",
  "`": "backquote",
  "~": "backquote",
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

for (let digit = 0; digit <= 9; digit++) {
  (hotkeyKeyAliases as Record<string, CanonicalHotkeyKeyName>)[`num${digit}`] =
    `numpad${digit}` as CanonicalHotkeyKeyName;
}

/** Normalize legacy names while leaving truly unknown values rejectable. */
export function normalizeHotkeyKeyName(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return hotkeyKeyAliases[lower] ?? canonicalKeyNamesByLowerCase.get(lower) ?? trimmed;
}

export const HotkeyKeyName = z.preprocess(
  normalizeHotkeyKeyName,
  z.enum(HOTKEY_KEY_NAMES),
);
export type HotkeyKeyName = z.infer<typeof HotkeyKeyName>;

/** KeyboardEvent.code to canonical physical key name. */
export const KEYBOARD_CODE_TO_HOTKEY_KEY_NAME: Readonly<Record<string, HotkeyKeyName>> = {
  Backspace: "backspace",
  Tab: "tab",
  Enter: "enter",
  NumpadEnter: "numpadEnter",
  Pause: "pauseBreak",
  CapsLock: "capsLock",
  Escape: "esc",
  Space: "space",
  PageUp: "pageUp",
  PageDown: "pageDown",
  End: "end",
  Home: "home",
  ArrowLeft: "left",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  PrintScreen: "printScreen",
  Insert: "insert",
  Delete: "delete",
  ContextMenu: "contextMenu",
  Sleep: "sleep",
  NumLock: "numLock",
  ScrollLock: "scrollLock",
  NumpadMultiply: "numpadMultiply",
  NumpadAdd: "numpadAdd",
  NumpadComma: "numpadSeparator",
  NumpadSubtract: "numpadSubtract",
  NumpadDecimal: "numpadDecimal",
  NumpadDivide: "numpadDivide",
  NumpadEqual: "numpadEqual",
  BrowserBack: "browserBack",
  BrowserForward: "browserForward",
  BrowserRefresh: "browserRefresh",
  BrowserStop: "browserStop",
  BrowserSearch: "browserSearch",
  BrowserFavorites: "browserFavorites",
  BrowserHome: "browserHome",
  AudioVolumeMute: "volumeMute",
  AudioVolumeDown: "volumeDown",
  AudioVolumeUp: "volumeUp",
  MediaTrackNext: "mediaNextTrack",
  MediaTrackPrevious: "mediaPrevTrack",
  MediaStop: "mediaStop",
  MediaPlayPause: "mediaPlayPause",
  LaunchMail: "launchMail",
  LaunchMediaPlayer: "launchMediaSelect",
  LaunchApplication1: "launchApp1",
  LaunchApplication2: "launchApp2",
  Semicolon: "semicolon",
  Equal: "equals",
  Comma: "comma",
  Minus: "minus",
  Period: "period",
  Slash: "slash",
  Backquote: "backquote",
  BracketLeft: "bracketLeft",
  Backslash: "backslash",
  BracketRight: "bracketRight",
  Quote: "quote",
  IntlBackslash: "intlBackslash",
};

for (let code = 65; code <= 90; code++) {
  const letter = String.fromCharCode(code).toLowerCase() as HotkeyKeyName;
  (KEYBOARD_CODE_TO_HOTKEY_KEY_NAME as Record<string, HotkeyKeyName>)[`Key${String.fromCharCode(code)}`] = letter;
}
for (let digit = 0; digit <= 9; digit++) {
  (KEYBOARD_CODE_TO_HOTKEY_KEY_NAME as Record<string, HotkeyKeyName>)[`Digit${digit}`] = `${digit}` as HotkeyKeyName;
  (KEYBOARD_CODE_TO_HOTKEY_KEY_NAME as Record<string, HotkeyKeyName>)[`Numpad${digit}`] =
    `numpad${digit}` as HotkeyKeyName;
}
for (let number = 1; number <= 24; number++) {
  (KEYBOARD_CODE_TO_HOTKEY_KEY_NAME as Record<string, HotkeyKeyName>)[`F${number}`] =
    `f${number}` as HotkeyKeyName;
}

export function hotkeyKeyNameFromKeyboardCode(code: string): HotkeyKeyName | undefined {
  return KEYBOARD_CODE_TO_HOTKEY_KEY_NAME[code];
}

/**
 * Windows Virtual-Key(VK)数值 → 跨平台键名字符串。
 * 数值表来源:WGestures 参考克隆 WindowsInput/Native/VirtualKeyCode.cs。
 */
import { HotkeyKeyName, HotkeyModifier } from "../config/hotkeys.js";

export type VkHotkeyName = HotkeyModifier | HotkeyKeyName;

const VK_NAMES = new Map<number, VkHotkeyName>([
  [0x08, "backspace"],
  [0x09, "tab"],
  [0x0c, "clear"],
  [0x0d, "enter"],
  [0x10, "shift"],
  [0x11, "ctrl"],
  [0x12, "alt"],
  [0x13, "pauseBreak"],
  [0x14, "capsLock"],
  [0x1b, "esc"],
  [0x20, "space"],
  [0x21, "pageUp"], // PRIOR
  [0x22, "pageDown"], // NEXT
  [0x23, "end"],
  [0x24, "home"],
  [0x25, "left"],
  [0x26, "up"],
  [0x27, "right"],
  [0x28, "down"],
  [0x2c, "printScreen"], // SNAPSHOT
  [0x2d, "insert"],
  [0x2e, "delete"],
  [0x5b, "meta"], // LWIN
  [0x5c, "meta"], // RWIN
  [0x5d, "contextMenu"], // APPS
  [0x5f, "sleep"],
  [0x6a, "numpadMultiply"],
  [0x6b, "numpadAdd"],
  [0x6c, "numpadSeparator"],
  [0x6d, "numpadSubtract"],
  [0x6e, "numpadDecimal"],
  [0x6f, "numpadDivide"],
  [0x90, "numLock"],
  [0x91, "scrollLock"],
  [0xa0, "shift"], // LSHIFT
  [0xa1, "shift"], // RSHIFT
  [0xa2, "ctrl"], // LCONTROL
  [0xa3, "ctrl"], // RCONTROL
  [0xa4, "alt"], // LMENU
  [0xa5, "alt"], // RMENU
  [0xa6, "browserBack"],
  [0xa7, "browserForward"],
  [0xa8, "browserRefresh"],
  [0xa9, "browserStop"],
  [0xaa, "browserSearch"],
  [0xab, "browserFavorites"],
  [0xac, "browserHome"],
  [0xad, "volumeMute"],
  [0xae, "volumeDown"],
  [0xaf, "volumeUp"],
  [0xb0, "mediaNextTrack"],
  [0xb1, "mediaPrevTrack"],
  [0xb2, "mediaStop"],
  [0xb3, "mediaPlayPause"],
  [0xb4, "launchMail"],
  [0xb5, "launchMediaSelect"],
  [0xb6, "launchApp1"],
  [0xb7, "launchApp2"],
  [0xba, "semicolon"], // OEM_1 ';:'
  [0xbb, "equals"], // OEM_PLUS '=+'
  [0xbc, "comma"],
  [0xbd, "minus"],
  [0xbe, "period"],
  [0xbf, "slash"], // OEM_2 '/?'
  [0xc0, "backquote"], // OEM_3 '`~'
  [0xdb, "bracketLeft"], // OEM_4 '[{'
  [0xdc, "backslash"], // OEM_5 '\\|'
  [0xdd, "bracketRight"], // OEM_6 ']}'
  [0xde, "quote"], // OEM_7 '\'"'
  [0xe2, "intlBackslash"], // OEM_102
]);

// 0-9
for (let vk = 0x30; vk <= 0x39; vk++) VK_NAMES.set(vk, String.fromCharCode(vk) as HotkeyKeyName);
// a-z(小写)
for (let vk = 0x41; vk <= 0x5a; vk++) VK_NAMES.set(vk, String.fromCharCode(vk + 0x20) as HotkeyKeyName);
// numpad0-numpad9
for (let vk = 0x60; vk <= 0x69; vk++) VK_NAMES.set(vk, `numpad${vk - 0x60}` as HotkeyKeyName);
// f1-f24
for (let vk = 0x70; vk <= 0x87; vk++) VK_NAMES.set(vk, `f${vk - 0x70 + 1}` as HotkeyKeyName);

/** VK 数值 → 键名;未知数值返回 undefined */
export function vkToKeyName(vk: number): VkHotkeyName | undefined {
  return VK_NAMES.get(vk);
}

/** 解码后的全局快捷键组合(暂停/继续热键即用此结构) */
export interface HotKeyCombo {
  /** 规范化修饰键名,顺序固定为 ctrl→shift→alt→meta */
  modifiers: HotkeyModifier[];
  /** 主键名;仅有修饰键或数值非法时为 undefined */
  key?: HotkeyKeyName;
}

/**
 * ModifierKeys 位 → 键名。
 * 来源:WGestures GlobalHotKeyManager —— System.Windows.Input.ModifierKeys
 * (Alt=1, Control=2, Shift=4, Windows=8)。顺序刻意选为 ctrl,shift,alt,meta,
 * 使默认暂停热键 7 解出 ["ctrl","shift","alt"],与 PauseHotkey 默认序一致。
 */
const HOTKEY_MODIFIER_BITS: ReadonlyArray<readonly [number, HotkeyModifier]> = [
  [2, "ctrl"],
  [4, "shift"],
  [1, "alt"],
  [8, "meta"],
];

/**
 * 解码 WGestures 暂停/继续热键的 8 字节小端表示。
 *
 * 编码来源:GlobalHotKeyManager.HotKey.ToBytes() =
 *   BitConverter.GetBytes(((ulong)key) | (((ulong)modifiers) << 32))
 * 即低 32 位为 VK 主键、高 32 位为 ModifierKeys 位掩码,小端序。
 *
 * 少于 8 字节视为非法,返回 undefined。
 */
export function decodeHotKeyCombo(bytes: Uint8Array): HotKeyCombo | undefined {
  if (bytes.length < 8) return undefined;
  const keyCode = ((bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16)) | (bytes[3]! << 24)) >>> 0;
  const modBits = ((bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16)) | (bytes[7]! << 24)) >>> 0;
  const modifiers: HotkeyModifier[] = [];
  for (const [bit, name] of HOTKEY_MODIFIER_BITS) {
    if ((modBits & bit) !== 0) modifiers.push(name);
  }
  if (keyCode === 0) return { modifiers };
  if (keyCode > 0xffff) return undefined;
  const vk = keyCode;
  const key = vkToKeyName(vk);
  // A modifier VK is not a valid main key, and an unknown VK must not degrade
  // into a modifiers-only shortcut. Only the explicit VK=0 encoding has no key.
  if (key === undefined || HotkeyModifier.safeParse(key).success) return undefined;
  return { modifiers, key: key as HotkeyKeyName };
}

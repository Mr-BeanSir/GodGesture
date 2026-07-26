import { describe, expect, it } from "vitest";
import { decodeBase64 } from "../plist.js";
import { decodeHotKeyCombo, vkToKeyName } from "../vk.js";

describe("vkToKeyName", () => {
  it("映射字母/数字/功能键/OEM 键", () => {
    expect(vkToKeyName(0x57)).toBe("w");
    expect(vkToKeyName(0x43)).toBe("c");
    expect(vkToKeyName(0x30)).toBe("0");
    expect(vkToKeyName(0x70)).toBe("f1");
    expect(vkToKeyName(0x87)).toBe("f24");
    expect(vkToKeyName(0x60)).toBe("numpad0");
    expect(vkToKeyName(0xa2)).toBe("ctrl"); // LCONTROL
    expect(vkToKeyName(0x5b)).toBe("win"); // LWIN
    expect(vkToKeyName(0xbc)).toBe("comma");
  });

  it("未知 VK 返回 undefined", () => {
    expect(vkToKeyName(0x07)).toBeUndefined();
    expect(vkToKeyName(0xffff)).toBeUndefined();
  });
});

describe("decodeHotKeyCombo", () => {
  it("基线:base64 VwAAAAcAAAA= 解码为 Ctrl+Shift+Alt+W", () => {
    const bytes = decodeBase64("VwAAAAcAAAA=");
    expect(Array.from(bytes)).toEqual([0x57, 0, 0, 0, 0x07, 0, 0, 0]);
    const combo = decodeHotKeyCombo(bytes);
    expect(combo).toEqual({ modifiers: ["ctrl", "shift", "alt"], key: "w" });
  });

  it("单修饰键 + 主键", () => {
    // key = 0x73 (F4), modifiers = 1 (Alt) → Alt+F4
    const bytes = new Uint8Array([0x73, 0, 0, 0, 0x01, 0, 0, 0]);
    expect(decodeHotKeyCombo(bytes)).toEqual({ modifiers: ["alt"], key: "f4" });
  });

  it("仅修饰键(无主键)时 key 省略", () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0x08, 0, 0, 0]);
    expect(decodeHotKeyCombo(bytes)).toEqual({ modifiers: ["win"] });
  });

  it("不足 8 字节返回 undefined", () => {
    expect(decodeHotKeyCombo(new Uint8Array([0x57, 0, 0, 0]))).toBeUndefined();
  });
});

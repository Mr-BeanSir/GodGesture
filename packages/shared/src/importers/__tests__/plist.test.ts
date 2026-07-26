import { describe, expect, it } from "vitest";
import { PlistDict, PlistParseError, parsePlist } from "../plist.js";
import { CONFIG_PLIST } from "./fixtures.js";

describe("parsePlist", () => {
  it("解析 WGestures config.plist 的全部取值类型", () => {
    const root = parsePlist(CONFIG_PLIST) as PlistDict;
    expect(typeof root).toBe("object");

    // string / integer(含负值)/ bool
    expect(root["$$FileVersion"]).toBe("1");
    expect(root["PathTrackerTriggerButton"]).toBe(15);
    expect(root["GestureViewMainPathColor"]).toBe(-14165512);
    expect(root["GestureViewXBtnPathColor"]).toBe(-32704);
    expect(root["IsFirstRun"]).toBe(true);
    expect(root["PathTrackerStayTimeout"]).toBe(false);
    expect(root["GestureParserDisableInFullScreenMode"]).toBe(false);

    // 自闭合 <true /> 带空格
    expect(root["AutoStart"]).toBe(true);
    expect(root["TrayIconVisible"]).toBe(true);

    // data → Uint8Array(8 字节热键)
    const hk = root["PauseResumeHotKey"];
    expect(hk).toBeInstanceOf(Uint8Array);
    expect(Array.from(hk as Uint8Array)).toEqual([0x57, 0, 0, 0, 0x07, 0, 0, 0]);
  });

  it("覆盖到全部预期键", () => {
    const root = parsePlist(CONFIG_PLIST) as PlistDict;
    for (const key of [
      "AutoCheckForUpdate",
      "PathTrackerInitialStayTimoutMillis",
      "GestureViewMiddleBtnMainColor",
      "GestureViewAlternativePathColor",
      "GestureViewShowPath",
      "GestureViewFadeOut",
      "GestureViewShowCommandName",
      "GestureParserEnableHotCorners",
      "GestureParserEnableRubEdges",
      "PathTrackerPreferCursorWindow",
      "PathTrackerInitialStayTimeout",
    ]) {
      expect(root[key], key).toBeDefined();
    }
  });

  it("非法 plist 抛 PlistParseError", () => {
    expect(() => parsePlist("<plist><dict><key>x</key></dict></plist>")).toThrow(PlistParseError);
  });
});

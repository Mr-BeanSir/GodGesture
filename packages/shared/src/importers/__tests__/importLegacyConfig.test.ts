import { describe, expect, it } from "vitest";
import { ConfigDocument } from "../../config/document.js";
import { SyncedPreferences } from "../../config/preferences.js";
import { importLegacyConfig } from "../index.js";
import { CONFIG_PLIST, GESTURES_WG2 } from "./fixtures.js";

describe("importLegacyConfig(wg2 + config.plist)", () => {
  const { document, machineLocal, warnings: allWarnings } = importLegacyConfig({
    gesturesWg2: GESTURES_WG2,
    configPlist: CONFIG_PLIST,
  });
  const warnings = allWarnings.filter((warning) => warning.code !== "unknown_command_type");

  it("产出合法 ConfigDocument", () => {
    expect(document.formatVersion).toBe(7);
    expect(document).not.toHaveProperty("nodePlugins");
    expect(() => ConfigDocument.parse(document)).not.toThrow();
  });

  it("手势库(global/apps/角/边)贯通", () => {
    expect(document.global.intents).toHaveLength(2);
    expect(document.apps).toHaveLength(1);
    expect(document.boundaryIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: { kind: "hotCorner", corner: "leftBottom" },
          sequence: [],
          command: { type: "taskSwitcher" },
        }),
        expect.objectContaining({
          origin: { kind: "rubEdge", edge: "left" },
          sequence: [],
          command: { type: "hotKey", modifiers: ["meta"], keys: ["d"] },
        }),
      ]),
    );
  });

  it("PathTracker 偏好映射", () => {
    const pt = document.preferences.pathTracker;
    expect(pt.triggerButtons).toEqual(["right", "middle", "x1", "x2"]); // 掩码 15
    expect(pt.preferCursorWindow).toBe(true);
    expect(pt.disableInFullscreen).toBe(false);
    expect(pt.initialStayTimeout).toBe(false);
    expect(pt.stayTimeout).toBe(false);
    expect(pt.initialStayTimeoutMs).toBe(200);
  });

  it("GestureView 颜色(有符号 ARGB int → #AARRGGBB)", () => {
    const gv = document.preferences.gestureView;
    expect(gv.rightButtonPathColor).toBe("#FF27D9F8"); // MainPathColor -14165512
    expect(gv.xButtonPathColor).toBe("#FFFF8040"); // XBtnPathColor -32704
    expect(gv.showPath).toBe(true);
    expect(gv.fadeOut).toBe(true);
  });

  it("暂停热键与开关映射", () => {
    expect(document.preferences.pauseHotkey).toEqual({ modifiers: ["ctrl", "shift", "alt"], key: "w" });
    expect(document.preferences.autoCheckForUpdate).toBe(true);
    expect(document.hotCorners.enabled).toBe(true);
    expect(document.rubEdges.enabled).toBe(true);
  });

  it("本机专属设置从 plist 提取(不进同步文档)", () => {
    expect(machineLocal.autoStart).toBe(true);
    expect(machineLocal.trayIconVisible).toBe(true);
    expect(machineLocal.runAsAdmin).toBe(false); // 老版无对应键
  });

  it("默认样本无降级告警", () => {
    expect(warnings).toEqual([]);
  });
});

describe("importLegacyConfig 边界", () => {
  it("缺 config.plist 时:手势库照常导入,偏好取 schema 默认", () => {
    const { document, machineLocal } = importLegacyConfig({ gesturesWg2: GESTURES_WG2 });
    expect(document.global.intents).toHaveLength(2);
    expect(document.apps).toHaveLength(1);
    expect(document.preferences).toEqual(SyncedPreferences.parse({}));
    expect(machineLocal).toEqual({ autoStart: false, runAsAdmin: false, trayIconVisible: true });
  });

  it("config.plist 非法时:不抛异常,记录告警并退回默认偏好", () => {
    const { document, warnings } = importLegacyConfig({
      gesturesWg2: GESTURES_WG2,
      configPlist: "<not a plist",
    });
    expect(document.preferences).toEqual(SyncedPreferences.parse({}));
    expect(warnings).toContainEqual({
      code: "plist_parse_failed",
      source: "config.plist",
      location: { scope: "preferences" },
    });
  });

  it("config.plist 根节点不是字典时返回结构化诊断", () => {
    const { document, warnings: allWarnings } = importLegacyConfig({
      gesturesWg2: GESTURES_WG2,
      configPlist: "<plist><array /></plist>",
    });
    const warnings = allWarnings.filter((warning) => warning.code !== "unknown_command_type");

    expect(document.preferences).toEqual(SyncedPreferences.parse({}));
    expect(warnings).toEqual([{
      code: "plist_root_not_dictionary",
      source: "config.plist",
      location: { scope: "preferences" },
    }]);
  });

  it("偏好降级携带稳定字段位置和原始数值参数", () => {
    const { document, warnings: allWarnings } = importLegacyConfig({
      gesturesWg2: GESTURES_WG2,
      configPlist: `
        <plist><dict>
          <key>PathTrackerTriggerButton</key><integer>0</integer>
          <key>PathTrackerInitialValidMove</key><integer>99</integer>
          <key>PauseResumeHotKey</key><data>AA==</data>
        </dict></plist>
      `,
    });
    const warnings = allWarnings.filter((warning) => warning.code !== "unknown_command_type");

    expect(document.preferences.pathTracker.initialValidMovePx).toBe(50);
    expect(warnings).toEqual([
      {
        code: "trigger_mask_empty",
        source: "config.plist",
        location: { scope: "preferences", field: "PathTrackerTriggerButton" },
        details: { value: 0 },
      },
      {
        code: "preference_clamped",
        source: "config.plist",
        location: { scope: "preferences", field: "PathTrackerInitialValidMove" },
        details: { value: 99, min: 1, max: 50, clamped: 50 },
      },
      {
        code: "pause_hotkey_invalid",
        source: "config.plist",
        location: { scope: "preferences", field: "PauseResumeHotKey" },
        details: { byteLength: 1 },
      },
    ]);
  });
});

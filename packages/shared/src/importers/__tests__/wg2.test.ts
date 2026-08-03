import { describe, expect, it } from "vitest";
import { deterministicUuid, importWg2 } from "../wg2.js";
import { GESTURES_WG2, GESTURES_WG2_V2 } from "./fixtures.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("importWg2", () => {
  const result = importWg2(GESTURES_WG2);

  it("全局意图:右键「上→右」→ Ctrl+C(手势往返)", () => {
    expect(result.global.gesturingEnabled).toBe(true);
    const intent = result.global.intents[0]!;
    expect(intent.name).toBe("复制");
    expect(UUID_RE.test(intent.id)).toBe(true);
    expect(intent.order).toBe(0);
    expect(intent.gesture).toEqual({
      trigger: "right",
      strokes: ["up", "right"],
      modifier: "none",
      inputs: [
        { type: "stroke", direction: "up" },
        { type: "stroke", direction: "right" },
      ],
    });
    expect(intent.command).toEqual({ type: "hotKey", modifiers: ["ctrl"], keys: ["c"] });
  });

  it("旧 ScriptCommand 不再进入 Node-only 配置", () => {
    const intent = result.global.intents[1]!;
    expect(intent.command).toEqual({ type: "doNothing" });
  });

  it("旧立即执行修饰符迁移为独立可重复修饰符", () => {
    const imported = importWg2(JSON.stringify({
      FileVersion: "3",
      Global: {
        GestureIntents: [{
          Name: "滚轮音量",
          Gesture: { GestureButton: 1, Dirs: [2], Modifier: 2 },
          ExecuteOnModifier: true,
          Command: {
            $type: "WGestures.Core.Commands.Impl.ChangeAudioVolumeCommand, WGestures.Core",
            Delta: -1,
          },
        }],
      },
      Apps: {},
      HotCornerCommands: [],
    }));

    expect(imported.global.intents[0]!.gesture).toMatchObject({
      modifier: "wheelBackward",
      inputs: [{ type: "stroke", direction: "right" }],
    });
  });

  it("应用条目:notepad.exe → SendText", () => {
    expect(result.apps).toHaveLength(1);
    const app = result.apps[0]!;
    expect(app.name).toBe("记事本");
    expect(app.windows?.exeName).toBe("notepad.exe");
    expect(app.windows?.exactPath).toBe("C:\\Windows\\System32\\notepad.exe");
    expect(app.inheritGlobalGestures).toBe(true);
    const intent = app.intents[0]!;
    expect(intent.gesture.strokes).toEqual(["left"]);
    expect(intent.command).toEqual({ type: "sendText", text: "hello" });
  });

  it("触发角槽 0 = leftBottom 任务切换;摩擦边槽 4 = left → Win+D", () => {
    expect(result.hotCorners.enabled).toBe(true); // wg2 不含开关,取 schema 默认
    expect(result.hotCorners.commands.leftBottom).toEqual({ type: "taskSwitcher" });
    expect(result.rubEdges.commands.left).toEqual({ type: "hotKey", modifiers: ["meta"], keys: ["d"] });
  });

  it("旧脚本导入会产生不支持告警", () => {
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "unknown_command_type" }),
    ]);
  });

  it("FileVersion 2:GestureButton 数值 +1 还原触发键", () => {
    const v2 = importWg2(GESTURES_WG2_V2);
    expect(v2.global.intents[0]!.gesture.trigger).toBe("right");
  });

  it("保留音量命令的负数调整量", () => {
    const imported = importWg2(JSON.stringify({
      FileVersion: "3",
      Global: {
        GestureIntents: [{
          Name: "降低音量",
          Gesture: { GestureButton: 1, Dirs: [0], Modifier: 0 },
          Command: {
            $type: "WGestures.Core.Commands.Impl.ChangeAudioVolumeCommand, WGestures.Core",
            Delta: -1,
          },
        }],
      },
      Apps: {},
      HotCornerCommands: [],
    }));

    expect(imported.global.intents[0]!.command).toEqual({
      type: "audioVolume",
      delta: -1,
    });
  });

  it("FileVersion 1:解包 Key/Value 意图且同名应用不会碰撞 intent id", () => {
    const pair = (name: string, dirs: number[]) => ({
      Key: { GestureButton: 0, Dirs: [7], Modifier: 0 },
      Value: {
        Name: name,
        Gesture: { GestureButton: 0, Dirs: dirs, Modifier: 0 },
        Command: {
          $type: "WGestures.Core.Commands.Impl.DoNothingCommand, WGestures.Core",
        },
      },
    });
    const imported = importWg2(JSON.stringify({
      FileVersion: "1",
      Global: { GestureIntents: [pair("全局旧格式", [2])] },
      Apps: {
        first: {
          Name: "同名应用",
          ExecutablePath: "C:\\One\\same.exe",
          GestureIntents: [pair("同名意图", [0])],
        },
        second: {
          Name: "同名应用",
          ExecutablePath: "D:\\Two\\same.exe",
          GestureIntents: [pair("同名意图", [0])],
        },
      },
      HotCornerCommands: [],
    }));

    expect(imported.global.intents[0]!.name).toBe("全局旧格式");
    expect(imported.global.intents[0]!.gesture).toMatchObject({
      trigger: "right",
      strokes: ["right"],
    });
    expect(imported.apps).toHaveLength(2);
    expect(imported.apps[0]!.intents[0]!.id).not.toBe(
      imported.apps[1]!.intents[0]!.id,
    );
  });

  it("未知 VK 禁用整条快捷键命令而不是部分执行", () => {
    const imported = importWg2(JSON.stringify({
      FileVersion: "3",
      Global: {
        GestureIntents: [{
          Name: "坏快捷键",
          Gesture: { GestureButton: 1, Dirs: [0], Modifier: 0 },
          Command: {
            $type: "WGestures.Core.Commands.Impl.HotKeyCommand, WGestures.Core",
            Modifiers: [0x11],
            Keys: [0x43, 0x07],
          },
        }],
      },
      Apps: {},
      HotCornerCommands: [],
    }));

    expect(imported.global.intents[0]!.command).toEqual({ type: "doNothing" });
    expect(imported.warnings).toContainEqual({
      code: "unknown_virtual_key",
      source: "gestures.wg2",
      location: {
        scope: "global",
        intentName: "坏快捷键",
        index: 0,
        field: "Keys",
      },
      details: { value: 7, index: 1 },
    });
    expect(imported.warnings).toContainEqual({
      code: "invalid_hotkey",
      source: "gestures.wg2",
      location: {
        scope: "global",
        intentName: "坏快捷键",
        index: 0,
        field: "Command",
      },
    });
  });

  it("以稳定代码、来源、位置和参数覆盖 gestures.wg2 的全部降级点", () => {
    const malformed = importWg2(JSON.stringify({
      FileVersion: "99",
      Global: { GestureIntents: "not-an-array" },
      Apps: {
        broken: false,
        empty: { Name: "空路径", ExecutablePath: "/", GestureIntents: [] },
        valid: {
          Name: "诊断应用",
          ExecutablePath: "C:\\diagnostic.exe",
          GestureIntents: [
            null,
            {
              Name: "坏手势与热键",
              Gesture: {
                GestureButton: 99,
                Dirs: [99, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4],
                Modifier: 999,
              },
              Command: {
                $type: "WGestures.Core.Commands.Impl.HotKeyCommand, WGestures.Core",
                Modifiers: ["bad"],
                Keys: [7],
              },
            },
            { Name: "坏命令", Gesture: {}, Command: 42 },
          ],
        },
      },
      HotCornerCommands: [
        42,
        {
          $type: "WGestures.Core.Commands.Impl.WindowControlCommand, WGestures.Core",
          ChangeWindowStateTo: 999,
        },
        { $type: "MysteryCommand" },
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    }));
    const nonArrayCorners = importWg2(JSON.stringify({
      FileVersion: "3",
      Global: {},
      Apps: {},
      HotCornerCommands: {},
    }));

    const codes = new Set(
      [...malformed.warnings, ...nonArrayCorners.warnings].map(({ code }) => code),
    );
    expect(codes).toEqual(new Set([
      "invalid_virtual_key",
      "unknown_virtual_key",
      "invalid_command",
      "invalid_hotkey",
      "unknown_window_operation",
      "unknown_command_type",
      "unknown_trigger_button",
      "invalid_stroke_direction",
      "stroke_limit_exceeded",
      "unknown_modifier",
      "intents_not_array",
      "invalid_intent",
      "unknown_file_version",
      "invalid_app_entry",
      "empty_app_executable",
      "hot_corner_slots_exceeded",
      "hot_corner_commands_not_array",
    ]));
    expect(malformed.warnings).toContainEqual({
      code: "invalid_virtual_key",
      source: "gestures.wg2",
      location: {
        scope: "app",
        appName: "诊断应用",
        intentName: "坏手势与热键",
        index: 1,
        field: "Modifiers",
      },
      details: { value: "bad", index: 0 },
    });
    expect(malformed.warnings).toContainEqual({
      code: "stroke_limit_exceeded",
      source: "gestures.wg2",
      location: {
        scope: "app",
        appName: "诊断应用",
        intentName: "坏手势与热键",
        index: 1,
        field: "Dirs",
      },
      details: { count: 13, limit: 12 },
    });
    expect(malformed.warnings).toContainEqual({
      code: "unknown_window_operation",
      source: "gestures.wg2",
      location: { scope: "hotCorner", index: 1, field: "ChangeWindowStateTo" },
      details: { value: 999 },
    });
    expect(malformed.warnings.every((warning) => typeof warning !== "string")).toBe(true);
  });
});

describe("deterministicUuid", () => {
  it("同种子稳定、异种子不同、形如 v4", () => {
    const a = deterministicUuid("seed-a");
    expect(deterministicUuid("seed-a")).toBe(a);
    expect(deterministicUuid("seed-b")).not.toBe(a);
    expect(UUID_RE.test(a)).toBe(true);
  });
});

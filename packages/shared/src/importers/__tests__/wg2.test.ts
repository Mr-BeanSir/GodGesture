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
    expect(intent.executeOnModifier).toBe(false);
    expect(intent.order).toBe(0);
    expect(intent.gesture).toEqual({ trigger: "right", strokes: ["up", "right"], modifier: "none" });
    expect(intent.command).toEqual({ type: "hotKey", modifiers: ["ctrl"], keys: ["c"] });
  });

  it("Lua ScriptCommand:原文保留并标 language:\"lua\"", () => {
    const intent = result.global.intents[1]!;
    expect(intent.command).toMatchObject({
      type: "script",
      language: "lua",
      script: "os.execute('calc.exe')",
      initScript: "-- init",
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

  it("无未知类型告警", () => {
    expect(result.warnings).toEqual([]);
  });

  it("FileVersion 2:GestureButton 数值 +1 还原触发键", () => {
    const v2 = importWg2(GESTURES_WG2_V2);
    expect(v2.global.intents[0]!.gesture.trigger).toBe("right");
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
    expect(imported.warnings.some((warning) => warning.includes("未知 VK 数值 7"))).toBe(true);
    expect(imported.warnings.some((warning) => warning.includes("替换为“什么也不做”"))).toBe(true);
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

/**
 * 导入器测试夹具(内联,零 I/O)。
 *
 * config.plist 直接取自参考克隆 WGestures.App/defaults/config.plist(逐字);
 * gestures.wg2 为手搓的最小代表样本,覆盖热键/文本/脚本(Lua)/窗口切换等命令,
 * 以及全局意图、应用条目、触发角与摩擦边槽位。
 */

/** WGestures 1.8.5 出厂 config.plist(原样) */
export const CONFIG_PLIST = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>$$FileVersion</key>
    <string>1</string>
    <key>IsFirstRun</key>
    <true />
    <key>AutoCheckForUpdate</key>
    <true />
    <key>AutoStart</key>
    <true />
    <key>PathTrackerTriggerButton</key>
    <integer>15</integer>
    <key>PathTrackerStayTimeout</key>
    <false />
    <key>PathTrackerInitialStayTimoutMillis</key>
    <integer>200</integer>
    <key>GestureViewMainPathColor</key>
    <integer>-14165512</integer>
    <key>GestureViewMiddleBtnMainColor</key>
    <integer>-13771520</integer>
    <key>GestureViewAlternativePathColor</key>
    <integer>-10061415</integer>
    <key>GestureViewShowPath</key>
    <true />
    <key>GestureViewFadeOut</key>
    <true />
    <key>GestureViewShowCommandName</key>
    <true />
    <key>TrayIconVisible</key>
    <true />
    <key>GestureParserEnableHotCorners</key>
    <true />
    <key>PathTrackerPreferCursorWindow</key>
    <true />
    <key>GestureParserDisableInFullScreenMode</key>
    <false />
    <key>PauseResumeHotKey</key>
    <data>VwAAAAcAAAA=</data>
    <key>PathTrackerInitialStayTimeout</key>
    <false />
    <key>GestureViewXBtnPathColor</key>
    <integer>-32704</integer>
    <key>GestureParserEnableRubEdges</key>
    <true />
  </dict>
</plist>`;

/**
 * 最小 gestures.wg2(FileVersion "3")。
 * - 全局意图 1:右键「上→右」→ Ctrl+C(HotKeyCommand,Modifiers 162 / Keys 67)
 * - 全局意图 2:右键「下」→ Lua ScriptCommand(原文保留)
 * - 应用 notepad.exe:右键「左」→ SendText
 * - 触发角槽 0(leftBottom)= TaskSwitcher;摩擦边槽 4(left)= Win+D
 */
const GESTURES_WG2_OBJ: Record<string, unknown> = {
  $type: "WGestures.App.Gui.Model.JsonGestureIntentStore+SerializeWrapper, WGestures",
  FileVersion: "3",
  Global: {
    $type: "WGestures.Core.GestureIntentStore+GlobalGestureApp, WGestures.Core",
    IsGesturingEnabled: true,
    GestureIntents: [
      {
        $type: "WGestures.App.Gui.Model.OrderableIntent, WGestures",
        Order: 0,
        Gesture: {
          $type: "WGestures.Core.Gesture, WGestures.Core",
          GestureButton: 1,
          Dirs: [0, 2],
          Modifier: 0,
        },
        Command: {
          $type: "WGestures.Core.Commands.Impl.HotKeyCommand, WGestures.Core",
          Modifiers: [162],
          Keys: [67],
        },
        ExecuteOnModifier: false,
        Name: "复制",
      },
      {
        $type: "WGestures.App.Gui.Model.OrderableIntent, WGestures",
        Order: 1,
        Gesture: {
          $type: "WGestures.Core.Gesture, WGestures.Core",
          GestureButton: 1,
          Dirs: [4],
          Modifier: 0,
        },
        Command: {
          $type: "WGestures.Core.Commands.Impl.ScriptCommand, WGestures.Core",
          Script: "os.execute('calc.exe')",
          InitScript: "-- init",
          HandleModifiers: false,
        },
        ExecuteOnModifier: false,
        Name: "Lua脚本",
      },
    ],
  },
  Apps: {
    "c:\\windows\\system32\\notepad.exe": {
      $type: "WGestures.App.Gui.Model.OrderableExeApp, WGestures",
      Order: 0,
      Exists: true,
      InheritGlobalGestures: true,
      ExecutablePath: "C:\\Windows\\System32\\notepad.exe",
      Name: "记事本",
      IsGesturingEnabled: true,
      GestureIntents: [
        {
          $type: "WGestures.App.Gui.Model.OrderableIntent, WGestures",
          Order: 0,
          Gesture: {
            $type: "WGestures.Core.Gesture, WGestures.Core",
            GestureButton: 1,
            Dirs: [6],
            Modifier: 0,
          },
          Command: {
            $type: "WGestures.Core.Commands.Impl.SendTextCommand, WGestures.Core",
            Text: "hello",
          },
          ExecuteOnModifier: false,
          Name: "输入问候",
        },
      ],
    },
  },
  HotCornerCommands: [
    { $type: "WGestures.Core.Commands.Impl.TaskSwitcherCommand, WGestures.Core" },
    null,
    null,
    null,
    {
      $type: "WGestures.Core.Commands.Impl.HotKeyCommand, WGestures.Core",
      Modifiers: [91],
      Keys: [68],
    },
    null,
    null,
    null,
  ],
};

export const GESTURES_WG2 = JSON.stringify(GESTURES_WG2_OBJ);

/**
 * FileVersion "2" 最小样本:GestureButton 数值整体 -1,读取时应 +1。
 * 此处 GestureButton=0 → 应还原为 "right"。
 */
const GESTURES_WG2_V2_OBJ: Record<string, unknown> = {
  FileVersion: "2",
  Global: {
    IsGesturingEnabled: true,
    GestureIntents: [
      {
        Order: 0,
        Gesture: { GestureButton: 0, Dirs: [4], Modifier: 0 },
        Command: { $type: "WGestures.Core.Commands.Impl.DoNothingCommand, WGestures.Core" },
        ExecuteOnModifier: false,
        Name: "版本2触发键",
      },
    ],
  },
  Apps: {},
  HotCornerCommands: [],
};

export const GESTURES_WG2_V2 = JSON.stringify(GESTURES_WG2_V2_OBJ);

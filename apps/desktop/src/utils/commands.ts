/**
 * 命令(Command)相关工具:命令类型清单与默认值工厂。
 * 单一事实源为 @godgesture/shared 的 zod Schema。
 */
import type { Command } from "@godgesture/shared";

export type CommandType = Command["type"];

/** 提取某一类命令的具体类型 */
export type CommandOfType<T extends CommandType> = Extract<Command, { type: T }>;

/** 当前工作台可直接新建的命令,顺序即下拉框展示顺序。 */
export const COMMAND_TYPES: CommandType[] = [
  "doNothing",
  "hotKey",
  "webSearch",
  "windowControl",
  "taskSwitcher",
  "openFile",
  "sendText",
  "gotoUrl",
  "cmd",
  "nodePlugin",
  "audioVolume",
];

export const WINDOW_OPERATIONS = [
  "maximizeRestore",
  "minimize",
  "close",
  "toggleTopmost",
  "dockLeft",
  "dockRight",
] as const;

/** 切换命令类型时生成该类型的默认命令 */
export function createDefaultCommand(type: CommandType): Command {
  switch (type) {
    case "doNothing":
      return { type: "doNothing" };
    case "hotKey":
      return { type: "hotKey", modifiers: [], keys: [] };
    case "webSearch":
      return {
        type: "webSearch",
        engineName: "Google",
        engineUrl: "https://www.google.com/search?q={0}",
        browser: null,
      };
    case "windowControl":
      return { type: "windowControl", operation: "maximizeRestore" };
    case "taskSwitcher":
      return { type: "taskSwitcher" };
    case "openFile":
      return { type: "openFile", path: "" };
    case "sendText":
      return { type: "sendText", steps: [] };
    case "gotoUrl":
      return { type: "gotoUrl", url: "" };
    case "cmd":
      return { type: "cmd", code: "", showWindow: true, autoSetWorkingDir: true };
    case "nodePlugin":
      throw new Error("Node plugin commands require an existing plugin selection");
    case "audioVolume":
      return { type: "audioVolume", delta: 1 };
  }
  throw new Error(`Unsupported command type: ${type}`);
}

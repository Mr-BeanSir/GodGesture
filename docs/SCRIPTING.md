# GodGesture 插件开发指南

本文面向使用 VS Code、WebStorm 等外部 IDE 编写、调试和分发 GodGesture Node.js
插件的用户。GodGesture App 只负责发现、加载和展示插件状态,不包含源码编辑器。

## 运行时与开发工具

GodGesture 使用随应用分发的 Node.js LTS 作为唯一脚本运行时。插件使用 ESM,可以调用
完整 Node API、全局 `fetch`、npm 依赖和 `@godgesture/sdk`。应用不再包含 QuickJS、旧
`script` 命令或旧脚本转换工具。

开发插件时需要在本机安装 Node.js/npm,以便安装 IDE 类型依赖和生成锁文件;
GodGesture 正式执行插件时不依赖用户安装的 Node、npm 或 pnpm。唯一需要安装的开发包是
`@godgesture/sdk`,它提供 `PluginContext`、生命周期类型和 `defineHandler` 的编辑器提示。
仓库中的 `plugins/gesture-demo` 是开发起点,不提供独立的脚手架或项目校验 CLI。

插件项目把 `@godgesture/sdk` 放在 `devDependencies`。App 准备运行副本时会在隔离缓存中
注入随应用分发的匹配版 SDK,因此手势执行不依赖 npm 上的 SDK,也不会直接执行开发目录
`node_modules` 中的 SDK。

## 插件工作区

App 只扫描系统应用配置目录下的 `plugins`。首次启动发现该目录为空时会创建
`gesture-demo`;也可以从侧边栏“插件”页打开根目录或单个项目目录。

| 平台 | 插件根目录 |
| --- | --- |
| Windows | `%APPDATA%\com.godgesture.app\plugins` |
| macOS | `~/Library/Application Support/com.godgesture.desktop/plugins` |

每个直接子目录是一个插件项目。不能把任意外部目录注册到 App,也不要把插件放进
Windows 程序安装目录或 macOS `.app` bundle:前者通常不可写,后者会破坏签名和升级边界。
需要版本管理时,可直接把插件项目目录作为独立 Git 仓库。

## 从 demo 开始

先在“插件”页打开插件根目录,把仓库中的 `plugins/gesture-demo` 复制为新的直接子目录,
再在新项目目录中执行:

```powershell
Copy-Item -Recurse plugins/gesture-demo my-plugin
cd my-plugin
npm install --save-dev @godgesture/sdk
```

demo 已包含全部五个 `onXxxx` 生命周期和 `package.json` manifest。安装 SDK 后,
VS Code/WebStorm 可以获得类型、补全、悬停和参数提示。若插件加入生产依赖,使用 Corepack
安装 pnpm 并提交精确 `pnpm-lock.yaml`,因为 App 的生产依赖准备使用 frozen pnpm lockfile。

仓库内的 [gesture-demo](../plugins/gesture-demo/README.md) 与首次启动生成的同名项目可
作为最小参考。保存文件后无需在 App 中再次保存;文件扫描会自动触发热更新。“重新扫描”
按钮用于立即刷新目录状态。

## package.json manifest

`package.json` 同时是 npm manifest。GodGesture 专用字段全部放在顶层 `godgesture` 中,
不使用额外的 `godgesture.plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "godgesture": {
    "id": "3c91c342-cf95-4de5-a990-d3e4dc39cc20",
    "apiVersion": 1,
    "entry": "src/index.mjs",
    "actions": [
      { "id": "default", "name": "执行", "export": "onExecute" }
    ]
  },
  "devDependencies": {
    "@godgesture/sdk": "^0.1.0"
  }
}
```

上面的最小 manifest 只公开默认的 `onExecute` 动作；若需要从手势命令直接调用其他生命周期
导出,按 `plugins/gesture-demo/package.json` 添加对应的稳定 `actionId` 和 `export` 映射。生命周期
函数本身仍由宿主按生命周期阶段调用,不要求每个插件都把五个阶段全部暴露为动作。

- `godgesture.id`:插件的稳定 UUID。发布新版本时不得改变,否则现有命令会视为另一个插件;
- `apiVersion`:当前必须为 `1`;
- `entry`:插件根目录内的可移植相对 ESM 入口路径;
- `actions`:插件公开给手势选择的动作。`id` 是稳定 `actionId`,`export` 是入口模块导出名;
- `allowLifecycleScripts`:可选,默认 `false`;只有信任全部依赖时才设为 `true`。

动作改名或重构导出时应保留原 `id`,这样同步配置中的 `pluginId`/`actionId` 引用仍然
有效。动作 `id` 在同一插件内必须唯一,导出名必须是合法 JavaScript 标识符。

典型目录结构:

```text
my-plugin/
├─ src/
│  └─ index.mjs
├─ .gitignore
├─ package.json
└─ pnpm-lock.yaml
```

TypeScript 项目应先编译为 manifest `entry` 指向的 ESM 文件。插件目录只应包含 UTF-8
文本源码和项目配置;符号链接不受支持。扫描会忽略 `node_modules`、`.git`、
`.godgesture` 和 `target` 目录。

## 动作与生命周期

手势命令保存 `pluginId` 与 `actionId`;运行时根据 manifest 把动作映射到入口模块的
导出函数。支持以下五个生命周期,`PluginContext.phase` 使用完全相同的名称:

| 导出 | 触发时机 | 是否可选 |
| --- | --- | --- |
| `onInit` | 插件 Worker 加载或重建后 | 是 |
| `onExecute` | 手势识别并释放后的主处理 | 否(默认动作) |
| `onGestureRecognized` | 手势已识别但触发键尚未释放 | 是 |
| `onModifierTriggered` | 已配置的独立修饰符每次触发时 | 是 |
| `onEnd` | 手势生命周期结束或取消 | 是 |

没有配置独立修饰符时,普通命令在触发键释放后调用动作导出。配置独立修饰符后,基础输入
匹配会调用 `onGestureRecognized`,每次修饰符触发调用 `onModifierTriggered`,并持续监听到
触发键释放。每个插件的调用按顺序排队,输入钩子不会等待插件代码。

```js
// @ts-check
import { defineHandler } from "@godgesture/sdk";

export const onInit = defineHandler(async (context) => {
  await context.status.report("插件已加载");
});

export const onExecute = defineHandler(async (context) => {
  await context.status.report(`执行阶段: ${context.phase}`);
});

export const onGestureRecognized = defineHandler(async (context) => {
  await context.status.report(`起点: ${context.origin.x}, ${context.origin.y}`);
});

export const onModifierTriggered = defineHandler(async (context) => {
  await context.status.report(`修饰符: ${context.modifier}`);
});

export const onEnd = defineHandler(async (context) => {
  await context.status.report("手势已结束");
});
```

`onInit` 不对应某次具体手势,其 `phase` 是 `onInit`;Worker 因更新、崩溃或超时重建后
会再次调用它。

## PluginContext API

```ts
interface PluginContext {
  readonly origin: { readonly x: number; readonly y: number };
  readonly endpoint: { readonly x: number; readonly y: number };
  readonly triggerButton: "right" | "middle" | "x1" | "x2" | null;
  readonly modifier:
    | "none" | "wheelForward" | "wheelBackward"
    | "leftButtonDown" | "middleButtonDown" | "rightButtonDown"
    | "x1Down" | "x2Down";
  readonly phase:
    | "onInit" | "onExecute" | "onGestureRecognized"
    | "onModifierTriggered" | "onEnd";
  readonly targetWindowAvailable: boolean;
}
```

### 输入、窗口、剪贴板和状态

```js
await context.input.keyCombo(["ctrl"], ["c"]);
await context.input.sendText("text");
await context.input.mouseClick("left");
await context.input.mouseDown("left");
await context.input.mouseUp("left");
await context.input.movePointer(10, -5);
await context.input.wheel(120);

if (context.targetWindowAvailable) {
  await context.window.activateTarget();
  await context.window.perform("maximizeRestore");
}

const selected = await context.clipboard.selectedText();
if (selected) await context.clipboard.writeText(selected.toUpperCase());
const clipboardText = await context.clipboard.readText();
await context.status.report("done");
```

窗口操作值为 `maximizeRestore`、`minimize`、`close`、`toggleTopmost`、`dockLeft` 和
`dockRight`。macOS 不支持 topmost 时返回稳定错误。插件不会获得 HWND、Rust 指针、
Objective-C 对象或其他通用原生句柄。

## Node API 与 npm 依赖

插件可以使用 Node 内置模块、ESM 相对导入、`process`、`child_process` 和全局 `fetch`:

```js
import { readFile } from "node:fs/promises";

export async function onExecute(context) {
  const response = await fetch("https://example.com/data.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const local = await readFile(new URL("./message.txt", import.meta.url), "utf8");
  await context.status.report(local.trim());
}
```

生产 `dependencies` 或 `optionalDependencies` 非空时必须提交精确 `pnpm-lock.yaml`。App
检测到新 revision 后使用内置 pnpm 在 OS/CPU/插件 revision 隔离的缓存中执行
`pnpm install --frozen-lockfile --prod`;默认禁止依赖生命周期脚本。安装和模块准备均不在
手势触发路径发生。原生 addon 需要 npm 提供当前系统与架构的预编译产物。

插件不是安全沙箱。Node API、网络、文件和子进程按用户进程权限运行;公开源码也不代表
依赖经过安全审计。不要把 token、密码、refresh token、私钥或机器专属绝对路径提交到
插件项目。

## 热更新与故障恢复

GodGesture 每 500 ms 递归扫描插件工作区的文件快照。源码、manifest 或锁文件变化后,
它会验证项目并准备新的 revision;准备成功后重启 Node 宿主并加载新版本。候选版本的
manifest/入口验证、依赖准备或缓存写入失败时,保留该插件最后一份可用版本,同时在插件
状态和日志中报告错误。

Node supervisor 常驻运行,每个插件使用独立 Worker。插件超时或 Worker 崩溃时,当前调用
返回有界错误并终止该 Worker;下次调用重新加载并运行 `onInit`。supervisor 退出不会阻塞
原生鼠标钩子,后续调用会重启宿主。宿主调用和插件事件使用有界队列,插件不应依赖每个
事件都必达来维持不可恢复的外部状态。

## 本机边界与同步

插件源码、`package.json`、`pnpm-lock.yaml`、`node_modules` 和运行缓存都不参与
GodGesture 云同步。同步配置只保存命令的 `pluginId` 与 `actionId`;另一台设备缺少对应
项目时,命令引用仍保留但不会执行。请使用 Git 或自行复制项目,并确保每台 Windows/macOS
设备上的 manifest 保持相同插件 ID 和动作 ID。

插件页不允许注册工作区以外的目录。分发插件时应提供完整项目、精确 lockfile、GodGesture
版本和平台要求,并说明网络、文件、子进程与依赖生命周期脚本风险。

## 限制与平台验收

| 项目 | 限制 |
| --- | ---: |
| Node 插件数量 | 32 |
| 每个插件文件数量 | 64 |
| 单个文件 | 256 KiB |
| 单插件文件合计 | 1 MiB |
| `package.json` | 64 KiB |
| `pnpm-lock.yaml` | 512 KiB |

Windows release 性能、顺序、Worker 恢复和随包工具链已有验证;macOS CI runner 已通过
同一 release 性能门槛。物理 Mac 上的插件工作区路径、文件扫描热更新、Node/fetch/SDK、
依赖重建、Worker/supervisor 恢复及原生桌面交互仍须按
[macOS 真机 smoke 清单](qa/M4_MACOS_SMOKE.md) 验收,不能把 CI 结果解释成真机通过。

## 相关文档

- [gesture-demo 示例插件](../plugins/gesture-demo/README.md)
- [用户指南](USER_GUIDE.md)
- [当前项目状态](PROJECT_STATUS.md)
- [Node-only 架构决策](adr/0012-node-only-script-runtime.md)
- [macOS 真机 smoke 清单](qa/M4_MACOS_SMOKE.md)

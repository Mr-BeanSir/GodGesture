# GodGesture 脚本开发指南

本文面向希望编写、调试、分发 GodGesture 脚本的用户和模板维护者。

## 当前运行时状态

GodGesture 使用随应用分发的 Node.js LTS 作为唯一脚本运行时。脚本以 Node 插件
（`nodePlugin` 命令）保存和执行,支持 ESM、完整 Node API、全局 `fetch`、npm 依赖
和 `@godgesture/sdk`。应用不再包含 QuickJS、旧 `script` 命令或旧脚本转换工具。

Node 插件源码、`package.json` 和精确 `pnpm-lock.yaml` 属于用户配置，会参与整库
同步；安装后的 `node_modules` 和 pnpm store 是本机缓存，不会同步。缓存路径按插件
revision、操作系统和 CPU 架构隔离；生命周期脚本批准状态也参与 revision，切换批准
状态会重新准备本机依赖。

## 快速开始

1. 打开“手势”页，将命令类型设为“Node.js 插件”。
2. 创建插件，保留默认的 `index.mjs` 和 `execute` 导出，或选择已有插件。
3. 在 Monaco 编辑器中编写代码。编辑器提供 Node、undici/fetch 和 GodGesture SDK
   类型、补全、诊断、悬停和参数提示。
4. 点击“测试处理函数”运行无副作用 dry-run。输入、窗口、剪贴板和状态调用会被
   记录到 Output，不会真的发送按键、修改窗口或写入系统剪贴板。
5. 没有依赖时可以直接测试。有外部依赖时先添加依赖并点击“生成锁文件并准备”，
   再测试处理函数。

## 插件项目结构

```text
my-plugin/
├─ index.mjs          # package.json 的 type=module 入口
├─ helper.mjs         # 可选的相对导入文件
├─ package.json       # 插件 manifest
└─ pnpm-lock.yaml     # 有外部依赖时必须存在的精确锁文件
```

界面会把源文件保存到插件的 `files` 字段，把 manifest 保存到 `packageJson`，把
锁文件保存到 `lockfile`。`node_modules` 不得放进源码文件，也不会进入同步文档。

### 大小和数量限制

| 项目 | 限制 |
| --- | ---: |
| Node 插件数量 | 32 |
| 每个插件源文件数量 | 64 |
| 单个源文件 | 256 KiB |
| 单插件源文件合计 | 1 MiB |
| `package.json` | 64 KiB |
| `pnpm-lock.yaml` | 512 KiB |
| 源文件路径长度 | 256 个字符 |
| 整份同步配置 | 4 MiB UTF-8 |

路径必须是跨 Windows/macOS 的相对路径，不能包含 `..`、反斜杠、控制字符、
`node_modules`、`package.json` 或 `pnpm-lock.yaml`。入口文件必须存在于源文件树中。

## 处理函数和生命周期

插件导出名由手势命令选择。支持以下五个生命周期：

独立修饰符与基础输入步骤分开配置。基础输入匹配后,每次配置的独立修饰符触发都会
调用 `modifierTriggered`,并继续监听后续修饰符；监听持续到触发键释放。没有配置独立
修饰符时,普通命令在触发键释放后执行 `execute`。

| 导出 | 触发时机 | 是否可选 |
| --- | --- | --- |
| `init` | 插件 Worker 加载后；每次 Worker 重建后重新运行 | 是 |
| `execute` | 手势识别并释放后执行的主处理函数 | 否（普通命令） |
| `gestureRecognized` | 手势已识别但尚未结束 | 是 |
| `modifierTriggered` | 基础输入匹配后,配置的独立修饰符每次触发时 | 是 |
| `gestureEnded` | 手势生命周期结束 | 是 |

每个处理函数接收一个 `PluginContext`，可以同步返回，也可以返回 Promise。每个插件
的调用按顺序排队，输入钩子不会等待插件代码。

```js
import { defineHandler } from "@godgesture/sdk";

export const execute = defineHandler(async (context) => {
  await context.status.report(`trigger: ${context.triggerButton ?? "none"}`);
  await context.input.sendText("Hello from GodGesture");
});

export async function gestureRecognized(context) {
  await context.status.report(`phase: ${context.phase}`);
}

export async function gestureEnded(context) {
  await context.status.report("gesture ended");
}
```

`init` 不会收到一次具体的用户手势；其 `phase` 是 `init`。Worker 加载时会运行可选
`init`，Worker 因崩溃或超时重建后会再次运行。

## PluginContext API

### 上下文只读字段

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
    | "init" | "execute" | "gestureRecognized"
    | "modifierTriggered" | "gestureEnded";
  readonly targetWindowAvailable: boolean;
}
```

### 输入

```js
await context.input.keyCombo(["ctrl"], ["c"]);
await context.input.sendText("text");
await context.input.mouseClick("left");
await context.input.mouseDown("left");
await context.input.mouseUp("left");
await context.input.movePointer(10, -5);
await context.input.wheel(120); // 标准滚轮一格为 120
```

`keyCombo` 的修饰键和普通键使用字符串名称，具体键名受当前平台输入实现支持范围
约束。脚本不会获得 HWND、Rust 指针、Objective-C 对象或其他通用原生句柄。

### 窗口

```js
if (context.targetWindowAvailable) {
  await context.window.activateTarget();
  await context.window.perform("maximizeRestore");
}
```

操作值为 `maximizeRestore`、`minimize`、`close`、`toggleTopmost`、`dockLeft` 和
`dockRight`。macOS 不支持 topmost 时会返回稳定错误，不会暴露原生窗口对象。

### 剪贴板和状态

```js
const selected = await context.clipboard.selectedText();
if (selected) await context.clipboard.writeText(selected.toUpperCase());

const current = await context.clipboard.readText();
await context.status.report(`clipboard: ${current ?? "empty"}`);
```

剪贴板读取可能返回 `null`。宿主会限制状态消息长度。

## Node.js 和 fetch

Node 插件运行在随应用分发的 Node.js LTS 中，不依赖用户安装 Node、npm 或 pnpm。
可以使用 Node 内置模块、ESM 相对导入、`process`、`child_process` 和全局 `fetch`：

```js
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function execute(context) {
  const response = await fetch("https://example.com/data.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const fileName = path.basename("one/two.txt");
  const local = await readFile(new URL("./message.txt", import.meta.url), "utf8");
  await context.status.report(`${fileName}: ${data.name}; ${local.trim()}`);
}
```

插件不是安全沙箱。Node API、网络、文件和子进程按用户的普通进程权限运行；公开
源码也不代表依赖经过安全审计。

## npm 依赖管理

依赖区可以搜索 npm 官方 registry，也可以直接输入包名和版本。GodGesture 的原生
registry 网关固定 npm 官方 HTTPS origin，禁止重定向，并限制超时、响应大小和结果数。
它只查询 metadata，不在手势触发路径访问网络。

点击“生成锁文件并准备”时，应用使用内置 pnpm：

1. 根据 manifest 解析精确 `pnpm-lock.yaml`；
2. 使用应用数据目录中的独立 pnpm store 安装生产依赖；
3. 写入内置 `@godgesture/sdk` 运行时；
4. 导入入口模块做 smoke check；
5. 全部成功后才把插件标记为 ready。

测试已有 lockfile 的插件时只执行离线 frozen install，不会重新解析版本或修改依赖。
manifest 改动、依赖增删和版本更新都会清空旧 lockfile，必须重新准备。

生命周期脚本默认关闭。只有信任插件及其依赖时才开启“允许包生命周期脚本”。原生
addon 需要 npm 提供当前 OS/架构的预编译产物；应用不会在手势触发路径运行编译器。
应用包同时携带固定版本的 TypeScript 编译器、Node/undici 类型和 GodGesture SDK 声明，
用户点击“检查类型”时才在临时项目中执行有界的 `tsc` 检查。

## 测试、诊断和输出

“测试处理函数”使用真实 Node 加载入口和处理函数，但把宿主动作替换成 dry-run
记录器。Output 会显示处理结果、宿主调用和 console 日志；Problems 会显示 manifest、
lockfile、registry、pnpm、入口 import 和处理函数错误。单独的“检查类型”会调用随包
TypeScript 编译器；其结构化文件、行、列诊断进入 Problems，完整 `tsc` 输出进入 Output。

dry-run 不会真实发送按键、操作窗口或写剪贴板，也不能替代 Windows/macOS 真机权限、
窗口层级和输入注入 smoke。

## 崩溃、超时和恢复

Node supervisor 常驻运行，每个插件使用独立 Worker。插件超时或 Worker 崩溃时，
当前调用返回有界错误；该 Worker 被终止；下次调用重新加载并运行 `init`。supervisor
退出时原生鼠标钩子不会等待它，后续调用会重启宿主。

宿主调用和插件事件使用有界队列；队列满时会丢弃新的插件事件并记录错误，避免输入
钩子无限积压。插件不应依赖每个事件都必达来维护不可恢复的外部状态。

## 分发和信任

插件同步和分发的是明文源码、manifest 和锁文件，不是安装缓存。发布插件时应提供：

- 入口与所有相对导入文件；
- `package.json` 和精确锁文件；
- GodGesture 版本和平台要求；
- 网络、文件、子进程和生命周期脚本说明；
- 可重复的测试处理函数和预期 Output。

不要把 token、密码、refresh token、私钥或机器专属绝对路径写进插件。未经用户明确
知情，不要上传配置、剪贴板内容或本地文件。

## 平台验收状态

Windows release 性能、顺序、Worker 恢复和随包工具链已完成验证;macOS CI runner
也已通过同一 release 性能门槛。物理 Mac 上的首手势、Node/fetch/SDK、精确 lockfile
离线重建、Worker/supervisor 恢复及原生桌面交互仍待设备验收。维护者已授权这些项目
延期,不会阻塞 Node-only;未完成项与记录要求集中在
[macOS 真机 smoke 清单](qa/M4_MACOS_SMOKE.md),不能把 CI 结果解释成真机通过。

## 相关文档

- [用户指南](USER_GUIDE.md)
- [当前项目状态](PROJECT_STATUS.md)
- [Node-only 架构决策](adr/0012-node-only-script-runtime.md)
- [macOS 真机 smoke 清单](qa/M4_MACOS_SMOKE.md)

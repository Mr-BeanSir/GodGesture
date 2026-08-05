# gesture-demo

这是 GodGesture Node.js 插件的最小生命周期示例。`index.mjs` 使用中文注释展示五个
现役处理函数：

| 导出名 | `context.phase` | 用途 |
| --- | --- | --- |
| `onInit` | `onInit` | Worker 加载或重建后的初始化 |
| `onExecute` | `onExecute` | 手势识别并释放后的主处理 |
| `onGestureRecognized` | `onGestureRecognized` | 手势刚被识别 |
| `onModifierTriggered` | `onModifierTriggered` | 独立修饰符每次触发 |
| `onEnd` | `onEnd` | 手势生命周期结束或取消 |

`package.json` 的 `godgesture.actions` 为这个 demo 的五个导出分别声明了可调用入口。
其中 `id` 是稳定的 `actionId`，会和插件 UUID 一起保存到手势命令；`export` 是入口模块中
实际导出的函数名。重命名函数时应保留 `id`，只在 manifest 中同步修改 `export`。

## 在外部 IDE 中开发

`@godgesture/sdk` 是插件开发包，作为 `devDependencies` 安装后，VS Code、WebStorm 等 IDE
会直接提供 `PluginContext`、生命周期和宿主 API 的类型提示。复制本目录为新的插件项目后，
执行：

```powershell
npm install --save-dev @godgesture/sdk
```

GodGesture 运行插件时仍会注入与应用版本匹配的内置 SDK，不会在手势执行期间从 npm 下载
SDK，也不要求用户另行安装 Node.js。

仓库中的对应来源：

- 类型和辅助函数源码：`packages/sdk/src/index.ts`；
- 插件运行时：`apps/desktop/node-host/sdk.mjs`；
- 发布给外部 IDE 的声明：`packages/sdk/dist/index.d.ts`；
- 物化逻辑：`apps/desktop/src-tauri/src/engine/node_packages.rs`。

示例除开发期 SDK 外没有第三方运行依赖，因此不需要 `pnpm-lock.yaml`。实际插件加入生产依赖后，
应使用 Corepack pnpm 安装依赖并在项目目录中保存精确 `pnpm-lock.yaml`，GodGesture 会按该锁文件
准备生产依赖。

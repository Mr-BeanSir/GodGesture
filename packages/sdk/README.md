# @godgesture/sdk

GodGesture Node.js 插件的可公开发布 TypeScript 契约和运行时无关辅助函数。正式发布到 npm
后，插件作者把它作为开发依赖安装，VS Code、WebStorm 等 IDE 可以为生命周期 `context` 和
宿主 API 提供类型提示。

```powershell
npm install --save-dev @godgesture/sdk
```

```js
// @ts-check
import { defineHandler } from "@godgesture/sdk";

export const onExecute = defineHandler(async (context) => {
  await context.status.report(`执行阶段：${context.phase}`);
});
```

现役生命周期为 `onInit`、`onExecute`、`onGestureRecognized`、
`onModifierTriggered` 和 `onEnd`，`context.phase` 使用相同名称，不提供旧名称别名。

插件实际运行时由 GodGesture 注入与应用版本匹配的内置 SDK，不会在手势执行路径访问 npm。

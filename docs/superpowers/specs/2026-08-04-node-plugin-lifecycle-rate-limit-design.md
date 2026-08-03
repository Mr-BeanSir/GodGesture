# Node 插件 onXxx 生命周期与邮件频控设计

状态：已由维护者确认方向，待实施前审阅本文。

## 目标

- 将 Node 插件生命周期导出名和 `PluginContext.phase` 统一为 `onXxx` 风格。
- 不保留旧导出名，不做旧插件配置自动迁移；这是一次明确的协议升级。
- 在仓库新增可直接参考的 `plugins/gesture-demo`，注释使用中文。
- 邮箱注册验证码和密码找回验证码请求改为同一 IP 3 分钟最多 5 次。
- 暂不继续扩展桌面内置插件编辑器的界面功能；仅更新其默认模板和协议引用，避免生成失效插件。

## 生命周期协议

生命周期及上下文阶段统一使用以下值：

| 触发时机 | 导出名 | `context.phase` |
| --- | --- | --- |
| Worker 加载或重建 | `onInit` | `onInit` |
| 手势识别并释放后的主处理 | `onExecute` | `onExecute` |
| 手势刚被识别 | `onGestureRecognized` | `onGestureRecognized` |
| 独立修饰符每次触发 | `onModifierTriggered` | `onModifierTriggered` |
| 手势生命周期结束（含取消） | `onEnd` | `onEnd` |

`PluginLifecycle`、宿主的生命周期槽、Rust 调用点、默认命令 `exportName`、编辑器默认
模板、SDK 声明、文档和测试全部使用新名称。旧名称不再作为内置生命周期被声明、生成或
自动调用，也不提供迁移或 fallback。

`NodePluginCommand.exportName` 继续接受任意合法的 JavaScript 导出标识符，这是插件选择
自定义主处理函数的现役能力，不增加旧名称黑名单。系统默认值改为 `onExecute`；某个旧插件
若仍通过显式 `exportName` 指向同名自定义导出，只属于通用导出调用，不构成生命周期兼容层。

## 示例插件

新增目录：

```text
plugins/
└─ gesture-demo/
   ├─ index.mjs
   ├─ package.json
   └─ README.md
```

示例无第三方依赖，入口从 `@godgesture/sdk` 导入 `defineHandler`。该包不是普通 npm
依赖，而是应用准备插件项目时写入 `node_modules/@godgesture/sdk` 的内置运行时；类型
来源为 `packages/sdk` 和随应用分发的 SDK 声明。`index.mjs` 实现并导出五个 `onXxx`
处理函数，每个处理函数都包含中文注释和最小、无副作用的状态报告示例。

## 邮件请求频控

仅调整发送验证码的两个接口：

- `POST /auth/email-verification/request`：5 次 / 3 分钟 / IP；
- `POST /auth/password-reset/request`：5 次 / 3 分钟 / IP。

注册提交、密码重置确认和登录频控保持现有策略。响应继续使用统一的 `rate_limited` 和
`Retry-After`，不改变 SMTP 错误处理或账户枚举防护。

## 实施与验证

- 更新 `packages/sdk`、`packages/shared`、Desktop Rust Node 宿主、默认模板和脚本指南；
  同步更新生成式 API/测试中受影响的默认源码文本。
- 新增示例插件静态检查，确认入口导出和中文注释存在；运行 Node 语法检查。
- Server 增加控制器元数据回归测试，确认两个邮件请求路由为 5/180000ms。
- 运行 shared、SDK、Server 定向测试与 typecheck，Desktop Rust 定向测试、`cargo check`、
  `pnpm check:api` 和 `git diff --check`。

## 非目标

- 不重新设计 `NodePluginEditor.vue`；
- 不修改 SMTP 主机、凭据或邮件内容；
- 不添加旧生命周期名称的兼容别名、迁移器或 fallback。

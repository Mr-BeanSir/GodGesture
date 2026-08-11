# Web Console 源码纳入私有 Server 子模块

## 状态

已采纳（2026-08-09）；取代 ADR-0015 中“`apps/web-console` 作为独立私有 Git
子模块”的结论。ADR-0015 关于 Server 仍为私有子模块、继续使用根工作区的
`@godgesture/shared`、以根目录作为 Docker 构建上下文的结论保持有效。

## 背景

Web Console 与 NestJS Server 始终以同一 REST/OpenAPI 协议、同一部署端点和同一
用户账户模型协作。独立前端子模块增加了递归检出、版本协调、开发启动与生产部署的
维护边界，且不利于让管理界面的设计系统、静态产物与 API 服务作为一个可验证交付物
演进。

维护者要求取消 Web Console 子模块，并在不扩大 Web Console 权限的前提下，把其源码
与构建职责物理迁入私有 Server 仓库。

## 决策

- 根仓库移除 `apps/web-console` gitlink 与 `.gitmodules` 条目；其历史保留在原私有
  仓库，不再是运行时、CI 或部署检出的必需子模块。
- `apps/server/web-console/` 是由 Server 包拥有的 Vue 3 + Vite SPA。它仍以
  `workspace:*` 消费根工作区的 `@godgesture/shared`。Web Console 固定使用 `zh-CN`，
  但继续保留 vue-i18n 文案 key 层，避免组件直接硬编码文案并为未来扩展保留边界。
- 它仍是单独编译的前端；NestJS 继续拥有 REST、认证、授权、Prisma、RustFS 和 OpenAPI，
  不把 Vue 源码合入 Nest 模块。
- 开发环境由 Vite 提供 SPA 并代理 `/api`；生产环境仅由 Nest 托管构建后的 SPA，且
  `/api/v1` 合同保持不变。
- 本决策不引入 Next.js。
- Server 的 `package.json` 统一提供后端和 Web Console 的开发、类型检查、测试与生产
  构建入口；根目录 `pnpm dev:server` 只启动这个 Server 包拥有的两项进程。
- 生产 Docker 构建在 Server 包中生成 Web Console 静态产物。Nest/Express 在
  `/api/v1` 之外托管该 SPA，并对非 API 的前端深链接提供 `index.html` 回退；Desktop
  仍可通过 REST API 使用同一 Server，不依赖该静态页面。
- 此迁移不改变 API 前缀、认证令牌存储、账户/设备/快照/模板审核权限或 OpenAPI 合同。
  API 协议变更仍须协调 Shared、Desktop 与所有消费者并运行 `pnpm check:api`。

## 2026-08-11 语言策略修订

维护者确认 Web Console 暂不需要多语言兼容，因此本修订取代本 ADR 早期关于 Console
同时保留 `zh-CN/en` locale 的约束。Console 仅注册并加载 `zh-CN`，删除英文 locale、
浏览器语言检测、locale 持久化和顶部语言选择器；Desktop 继续保留 `zh-CN/en`。上述调整
不改变 Server-owned 边界、API 合同或鉴权权限模型。

## 后果

生产部署只需递归检出 Server 私有子模块，不再需要 Web Console 的私有读取权限。Server
镜像同时包含 API 和审核控制台静态产物，1Panel 继续只反向代理一个回环端口。前端代码的
提交先发生在 Server 私有仓库，再由根仓库提交 Server gitlink 更新以及子模块删除。

未来若再次将 Web Console 拆为独立发布单元，必须以新的 ADR 明确其版本、鉴权、构建和
部署边界，不能仅恢复一个子模块路径。

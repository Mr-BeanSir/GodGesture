# GodGesture 历史记录（按需读取）

> 这是历史与发布审计资料，不是现役开发入口。AI 普通接手任务不要默认读取本文件；只有需要追溯版本形成过程、历史验证证据或已取代决策时按需读取。现役事实以 [`CONTEXT.md`](../CONTEXT.md)、[`docs/PROJECT_STATUS.md`](PROJECT_STATUS.md) 和 [`docs/adr/README.md`](adr/README.md) 为准。

## Stable v0.1.0

以下是首个正式版本的压缩里程碑，保留原路线图的索引价值：

| 里程碑 | 历史结果 |
| --- | --- |
| M0 | pnpm monorepo、Tauri/Vue Desktop、NestJS Server、Shared 协议和三端构建基线建立。 |
| M1 | Windows 全局输入、手势匹配、原生轨迹/命令提示覆盖层、托盘和暂停能力落地。 |
| M2 | 12 类命令、应用级配置、触发角/摩擦边、双语深浅主题设置界面落地；WGestures 仅作为导入能力。 |
| M3 | Node.js 插件运行时逐步取代旧脚本链，生命周期和宿主 API 固化，详见 ADR-0012。 |
| M4 | macOS 引擎代码与 CI 完成；真实设备的 TCC、输入、覆盖层、多屏、AX、Keychain 和升级验收持续 pending。 |
| M5 | PostgreSQL/Prisma 后端、账户、设备、OAuth 配置位、邮件验证码、OpenAPI 和 Docker/1Panel 交付链落地。 |
| M6 | 整库 v8 同步、乐观并发、后写胜出、快照、离线优先和可选账户落地。 |
| M7 | Web Console 初版、设备/快照/安全界面、GitHub updater 和双平台发布流水线落地。 |
| M8 | `v0.1.0` Windows x64 NSIS 与 macOS universal ad-hoc DMG/Updater 发布并完成历史发布验收；完整证据移至 [`history/M8_RELEASE_ACCEPTANCE.md`](history/M8_RELEASE_ACCEPTANCE.md)。 |

## Official Template Service

2026-08-08 至 2026-08-11，公共模板从 GitHub 运行时 seed 迁移为官方 Server 服务：

- PostgreSQL 保存模板元数据、不可变版本、审核、举报、配额和匿名聚合指标；RustFS 保存不可变包对象。
- 匿名用户可从固定官方 Server origin 浏览、搜索、预览、下载和采纳；投稿需要官方端点登录且邮箱已验证。
- 模板使用 Server UUID，版本状态是公开性事实来源；父模板状态只是带固定优先级的数据库投影。
- 模板只保存官方插件目录中的 `pluginId`；GitHub 模板 seed、`distribution/templates` 子模块和 `validate:templates` 运行时入口已退役。
- RustFS 上传补偿、并发提交/审核、TemplatePolicy 单例约束、HMAC 密钥隔离和 `_test` 数据库 guard 已纳入 Server 提交与验证。

架构边界见 [`ADR-0014`](adr/0014-server-managed-public-template-catalog.md)，当前行为见
[`PROJECT_STATUS.md`](PROJECT_STATUS.md)。

## Server-Owned Web Console

2026-08-09 至 2026-08-11，Web Console 从独立子模块迁入 Server 私有子模块：

- 源码位于 `apps/server/web-console/`，仍是独立 Vue 3 + Vite SPA；NestJS 继续拥有 REST、认证、授权、Prisma、RustFS 和 OpenAPI。
- Element Plus 从 Server Console 移除，改为 Tailwind v4、项目内 Vue 原语和 Lucide；所有路由共用持久化设计系统 `design-system/godgesture-web-console/MASTER.md`。
- 浅色为默认主题，深色为完整主题；桌面主断点为 `1024px`，窄屏保留紧凑导航和可达路由。
- 生产镜像由 Nest Server 同时托管 API 与 Console 静态资源，非 API 深链接使用 SPA fallback；`/api/v1` 合同保持不变。
- 根仓最终 gitlink 为 Server `8ef5a22`，根仓集成提交为 `7bc4946`；两者已进入各自远端 `main`。

架构边界见 [`ADR-0015`](adr/0015-private-server-and-web-console-submodules.md) 和
[`ADR-0016`](adr/0016-web-console-owned-by-server.md)。

## Condensed Verification History

- 2026-08-11：Server Jest `20 suites / 171 passed / 13 skipped`；模板集成 runner 先应用 8 个迁移，再以 `_test` 数据库运行父状态并发套件 `13/13`；Server typecheck、OpenAPI check 和 Console/Server 收尾证据完成。Windows checkout 的 `check:api` 差异是 `openapi.json` 的 CRLF/LF 行尾，不是 OpenAPI 语义漂移。
- 2026-08-11：Console `19 files / 141 tests`、Server Jest `18 suites / 129 tests`、E2E `1 suite / 4 tests`、生产 build、Docker smoke 和合成 API 浏览器验收完成；真实 macOS、live OAuth/SMTP、1Panel/生产部署仍 pending。
- 2026-08-10：Server-owned Console 的完整构建、API isolation、SPA deep-link、RustFS 隔离环境和浅色/深色多视口验收完成。
- 2026-08-09：官方模板服务、Console 迁移、共享协议、Desktop、Rust 和发布合同完成首轮全量验证。

详细历史过程曾记录在实施计划和 UI spec 中；这些一次性文件已删除，避免 AI 将旧任务步骤、旧技术栈或旧子模块边界误认为现役要求。完整 M8 发布证据仍保留在 `docs/history/` 供发布审计按需读取。

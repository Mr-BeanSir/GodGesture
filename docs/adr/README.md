# ADR 索引

ADR 记录仍然有效、且不能仅从代码推断的架构决策。进入具体任务时只读取下表中
与受影响领域相关的 ADR,不需要在每次会话通读全部文件。若维护者的新需求改变
既有决策,应新增 ADR 或明确修订/取代原 ADR。

其他产品不属于 ADR 的需求来源,不得用来推导 GodGesture 的新需求或预期行为。

| 任务领域 | 必读 ADR | 当前约束 |
| --- | --- | --- |
| 跨平台功能或平台抽象 | [0001](0001-dual-platform-simultaneous-release.md) | Windows 与 macOS 同版本交付,或明确标注单平台能力 |
| 仓库结构、共享协议或技术栈 | [0002](0002-pnpm-monorepo.md), [0003](0003-initial-tech-stack.md), [0015](0015-private-server-and-web-console-submodules.md), [0016](0016-web-console-owned-by-server.md) | pnpm 根工作区，私有 Server 子模块内置 Web Console，Tauri/Vue/NestJS/Prisma/REST + OpenAPI |
| Server 部署或生产网络边界 | [0004](0004-deployment-on-self-hosted-1panel.md), [0014](0014-server-managed-public-template-catalog.md) | 自有 Ubuntu + 1Panel 手动部署、docker-compose；公共模板使用 PostgreSQL + RustFS |
| JavaScript 脚本能力或在线插件 | [0012](0012-node-only-script-runtime.md) | 常驻 Node.js 插件宿主是唯一脚本运行时；GitHub 插件下载与依赖安装须经用户确认，配置只同步 `pluginId` |
| 手势输入、边角序列或修饰符重构 | [0013](0013-unified-gesture-capture-session.md) | 普通手势与边角序列共用统一捕获会话;区域准入和候选配置保持适配器边界 |
| 手势轨迹或命令提示 | [0006](0006-native-overlay-rendering.md) | 原生自绘覆盖层,不用 WebView |
| Windows 提权、启动或签名 | [0007](0007-admin-run-option-no-uiaccess.md), [0011](0011-free-adhoc-macos-distribution.md) | 不使用 uiAccess;macOS 发布结论以 `0011` 为准 |
| 后端职责、更新、模板或插件分发 | [0008](0008-backend-owns-only-user-data.md), [0014](0014-server-managed-public-template-catalog.md) | Server 管理官方公共模板；更新和官方插件目录仍通过 GitHub 分发 |
| 配置同步、冲突或快照 | [0009](0009-whole-doc-versioning-lww-snapshots.md), [0010](0010-local-first-optional-account.md) | 整库版本 + LWW + 快照,本地优先且账户可选 |
| macOS 安装包或发布 | [0011](0011-free-adhoc-macos-distribution.md) | 免费 ad-hoc DMG,不使用 Developer ID 或公证 |

## 状态

- `0001`~`0004`、`0006`、`0008`~`0012`、`0014`、`0015`、`0016`:有效；`0014` 取代 `0008` 中 GitHub 运行时分发公共模板的部分；`0015` 保留 Server 私有子模块结论；`0016` 取代 `0015` 中 Web Console 独立子模块结论，并于 2026-08-11 修订 Console 固定使用 `zh-CN`、保留 vue-i18n key 层的语言策略。
- `0013`:已采纳,共享捕获基础设施和阶段 1-5 已实现;Windows/macOS 真实设备验收仍 pending。
- `0005`:已由 `0012` 完全取代,仅保留为历史决策记录。
- `0007`:Windows 决策有效;其中旧 macOS 签名结论已由 `0011` 取代。

# ADR 索引

ADR 记录仍然有效、且不能仅从代码推断的架构决策。进入具体任务时只读取下表中
与受影响领域相关的 ADR,不需要在每次会话通读全部文件。若维护者的新需求改变
既有决策,应新增 ADR 或明确修订/取代原 ADR。

WGestures 不属于 ADR 的需求来源,不得用来推导 GodGesture 的新需求或预期行为。
WGestures 配置导入仍是独立保留的兼容迁移能力。

| 任务领域 | 必读 ADR | 当前约束 |
| --- | --- | --- |
| 跨平台功能或平台抽象 | [0001](0001-dual-platform-simultaneous-release.md) | Windows 与 macOS 同版本交付,或明确标注单平台能力 |
| 仓库结构、共享协议或技术栈 | [0002](0002-pnpm-monorepo.md), [0003](0003-initial-tech-stack.md) | pnpm monorepo、Tauri/Vue/NestJS/Prisma/REST + OpenAPI |
| Server 部署或生产网络边界 | [0004](0004-deployment-on-self-hosted-1panel.md) | 自有 Ubuntu + 1Panel 手动部署、docker-compose |
| JavaScript 脚本能力 | [0005](0005-js-scripting-via-quickjs.md) | rquickjs/QuickJS,单 Runtime、多隔离 Context |
| 手势轨迹或命令提示 | [0006](0006-native-overlay-rendering.md) | 原生自绘覆盖层,不用 WebView |
| Windows 提权、启动或签名 | [0007](0007-admin-run-option-no-uiaccess.md), [0011](0011-free-adhoc-macos-distribution.md) | 不使用 uiAccess;macOS 发布结论以 `0011` 为准 |
| 后端职责、更新或模板分发 | [0008](0008-backend-owns-only-user-data.md) | Server 只存用户数据,公开内容通过 GitHub 分发 |
| 配置同步、冲突或快照 | [0009](0009-whole-doc-versioning-lww-snapshots.md), [0010](0010-local-first-optional-account.md) | 整库版本 + LWW + 快照,本地优先且账户可选 |
| macOS 安装包或发布 | [0011](0011-free-adhoc-macos-distribution.md) | 免费 ad-hoc DMG,不使用 Developer ID 或公证 |

## 状态

- `0001`~`0006`、`0008`~`0011`:有效。
- `0007`:Windows 决策有效;其中旧 macOS 签名结论已由 `0011` 取代。

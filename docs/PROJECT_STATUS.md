# GodGesture 当前项目状态

最后核对：2026-08-07。本文是当前实际实现的唯一状态入口；术语以 [`CONTEXT.md`](../CONTEXT.md) 为准，
协作规则以 [`AGENTS.md`](../AGENTS.md) 为准，架构理由按 [`docs/adr/README.md`](adr/README.md) 路由。
`docs/ROADMAP.md` 只记录 stable `v0.1.0` 的历史里程碑。本文不记录逐日开发流水，历史过程以 Git
提交和保留的 ADR/QA 证据为准。

## 当前结论

| 领域 | 状态 | 边界 |
| --- | --- | --- |
| M0 仓库奠基 | 已完成 | 独立项目从 stable `v0.1.0` 起演进，不以 WGestures 行为作为产品基准 |
| M1 Windows 手势引擎 | Windows 主体已完成 | Windows 实机已有输入/覆盖层 smoke；macOS 真实设备仍按 M4 清单验收 |
| M2 Windows 命令与设置 | 已完成 | 任务切换等 Windows 专属能力显式标注，脚本能力归 Node 插件运行时 |
| M3 脚本引擎 | 已完成 | ADR-0012 的常驻 Node.js supervisor/Worker 是唯一生产脚本链 |
| M4 macOS 引擎 | 代码与 CI 已完成，平台验收 pending | TCC、全局输入、覆盖层、多屏、AX、Keychain、插件和安装升级需真实 Mac 证据 |
| M5 后端与账户 | 已完成 | OAuth/SMTP 凭证由部署环境提供；Server 只存用户数据 |
| M6 云同步 | 已完成 | 整库 v8 文档、乐观并发、后写胜出、快照和离线优先 |
| M7 Web Console 与分发 | 已完成 | 只读控制台、模板与在线插件 GitHub 目录、Updater 和 OpenAPI 已接入 |
| M8 打磨与发布 | stable 基线已完成 | 当前工作区含 stable 之后的本地改动，未因此宣称已有新发布物 |

## 部件地图

| 部件 | 当前职责 | 入口 |
| --- | --- | --- |
| Desktop Rust | Tauri 生命周期、跨平台手势引擎、原生输入/命令/覆盖层、本地配置 | `apps/desktop/src-tauri/src/lib.rs`、`engine/`、`platform/` |
| Desktop Vue | 设置工作台、账户、模板、插件、同步和本地日志界面；浏览器运行时使用 mock | `apps/desktop/src/App.vue`、`src/views/`、`src/stores/` |
| Shared | v8 配置、认证、同步/快照分页、模板、在线插件目录、DSL 与 OpenAPI 生成客户端 | `packages/shared/src/` |
| Server | NestJS REST、Prisma/PostgreSQL、认证、设备、同步和快照 | `apps/server/src/`、`apps/server/prisma/` |
| Web Console | 只读配置、设备、快照、安全和管理员区域 | `apps/web-console/src/` |
| SDK / demo | `@godgesture/sdk` 开发类型与 `distribution/plugins/plugins/gesture-demo` 五生命周期示例 | `packages/sdk/`、`distribution/plugins/` |
| 发布与部署 | GitHub Actions、Windows NSIS、macOS universal ad-hoc DMG、1Panel Compose | `.github/workflows/`、`docs/*_RELEASE.md`、`apps/server/README-DEPLOY.md` |

## 现役实现

### 输入与覆盖层

- 普通手势和边角序列共用 `engine/capture.rs` 的输入账本、有序匹配、消费记录和主释放键语义；
  架构决策见 [`ADR-0013`](adr/0013-unified-gesture-capture-session.md)。`PathTracker` 只负责普通准入、阈值和点击/拖拽透传，`BoundaryMatcher` 只负责边角候选适配和来源状态。
- 普通手势支持方向、鼠标按钮、滚轮和键盘 `KeyboardEvent.code` 的有序输入；独立修饰符在没有更长有序前缀时才触发，可重复且不追加基础序列。
- 边角非空序列不会因光标移动自动武装；首个匹配按钮/滚轮在边缘带或近角区域准入。精确角点保留给空序列立即动作；匹配完成后等待主释放键，后续按钮抬起只吞掉。
- 轨迹与命令名称由 Windows/macOS 原生覆盖层绘制，不能迁移到 WebView；边角和普通手势复用既有覆盖层消息协议。
- Windows 使用低级鼠标/键盘钩子与 Raw Input 兜底，macOS 使用 CGEventTap；平台差异留在输入来源、合成、屏幕查询和窗口层。

### 配置、同步与命令

- 现行配置格式为 v8，`groups`、默认应用组、`AppEntry.groupId`、有序 `inputs`、`boundaryIntents` 和 `nodePlugin.pluginId` 是现役结构；读取边界不迁移旧格式。
- `sendText` 只接受 [`SEND_TEXT_DSL.md`](SEND_TEXT_DSL.md) 定义的 `text`、`key`、`hotkey`、`sleep` 语句。
- 命令行分为 `cmd` 与 `powershell` 两类；Windows 分别调用系统 cmd/PowerShell，macOS 的 PowerShell
  分支要求本机可执行 `pwsh`，缺失时不回退到 zsh。
- Node 插件使用 `app_config_dir/plugins` 下的直接子项目；`package.json.godgesture.lifecycles` 声明 `onInit`、`onExecute`、`onGestureRecognized`、`onModifierTriggered`、`onEnd`。插件页可在用户确认后从 GitHub 在线目录下载指定 ref/子目录，校验 manifest ID 并安装生产依赖；模板采纳也会先安装其声明的插件。源码、依赖和锁文件不进入云同步，命令只同步 `pluginId`。
- Desktop 自动同步使用 30 秒尾随防抖、启动/定时拉取和手动立即同步；refresh token 只进 Windows Credential Manager/macOS Keychain，不进 WebView。
- Server API 前缀为 `/api/v1`。快照列表使用 `page/pageSize` 服务端分页，默认 10、单次最多 50，列表不读取正文；恢复使用版本 CAS。
- Web Console 首屏读取分组/应用索引，选中应用后按需读取手势；全局应用置顶，分组和应用按同步顺序展示。
- 插件示例与公开模板分别由 `distribution/plugins` 和 `distribution/templates` Git submodule 管理；插件仓库的
  项目统一位于 `plugins/<slug>/`，根目录只保留目录、文档、Workflow 和复用脚本。两者都从对应仓库
  `main/catalog.min.json` 读取，模板包和插件 manifest 均要求 `author`。两个
  仓库的 PR Workflow 校验 JSON、协议和目录内容；合并后自动生成格式化 `catalog.json` 与压缩版
  `catalog.min.json`，Desktop 的模板/插件目录不再依赖公开 Releases 资产。
- Desktop 与 Web Console 共用 [`packages/shared/src/assets/mnemonic.svg`](../packages/shared/src/assets/mnemonic.svg)，shared 不依赖 Vue。

### 本地日志与发布

- Desktop 日志落在 `app_log_dir()` 的脱敏 JSONL，级别为 `off/error/warn/info/debug`，不上传、不参与同步；日志页支持最新优先、trace 折叠、筛选、导出、清理和可关闭的自动跟随。
- stable `v0.1.0` 已有 Windows x64 NSIS 与 macOS universal ad-hoc DMG/Updater。当前分发模型不提供 Authenticode、Developer ID、公证或 staple。
- Server 生产部署由维护者使用 1Panel 手动完成，交付物为 docker-compose；更新、模板和在线插件目录通过 GitHub 分发，Server 不代理公开内容。

## 已知边界

以下项目是明确的 pending，不得在文档或发布说明中写成已验收：

- 真实 Mac：TCC 授权/拒绝、全局输入吞噬、点击透传、X1/X2、Retina 多屏、Spaces/全屏覆盖层、AX 命令、Bundle ID/图标、Keychain、插件热更新/依赖恢复和已安装升级。逐项记录在 [`docs/qa/M4_MACOS_SMOKE.md`](qa/M4_MACOS_SMOKE.md)。
- Windows 安装/卸载后遗留 Task Scheduler 任务的自动清理仍未纳入安装器；移动或删除可执行文件会使旧任务失效。
- GitHub/Google OAuth 的真实客户端凭证、SMTP 和生产 Prisma 迁移需部署环境验证；本地契约测试不等于 live OAuth/SMTP 通过。
- 本地日志真实目录权限、轮转、重启恢复、Node 崩溃回退和跨平台文件行为仍需平台观察；自动化日志测试只证明代码契约。
- 当前 Windows 开发实例仍可能锁定默认 `target/debug/godgesture.exe`；需要做 Tauri 构建时可使用独立 `CARGO_TARGET_DIR`，不要强杀现有实例。

## 已有验证基线

以下为 2026-08-07 工作区的最新验证结果；在线插件目录、模板插件源、npm/pnpm 锁文件和安装事务恢复
均已纳入本轮检查。真实 macOS 设备验收仍按上方 M4 清单保持 pending，不能由 Windows 或自动化结果替代：

- `pnpm test`：Shared `86/86`、SDK `1/1`、Desktop `140/140`、Server `97/97`；Web Console 当前无测试，脚本正常退出。
- `pnpm typecheck`：Shared、SDK、Desktop、Server、Web Console 全部通过；`pnpm --filter @godgesture/desktop build` 的 `vue-tsc` 与 Vite 生产构建通过。
- `pnpm check:api`：OpenAPI 生成检查与 `packages/shared` 产物一致。
- `pnpm validate:templates`、`pnpm validate:plugins`、`pnpm validate:plugin-demo`、`pnpm validate:release`：分别验证 2 个模板、插件目录与 5 个插件生命周期和 10 个发布合同测试通过；两个子模块的 `scripts/validate-content.mjs` 同时校验 `catalog.json` 与 `catalog.min.json`。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`：`251 passed, 3 ignored`；忽略项为性能、Task Scheduler 和实时 GitHub smoke，未将其计入自动化通过数。
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib -- -D warnings`、`cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`、`git diff --check`：通过。
- Vite 构建仅保留既有 VueUse 注释、较大 chunk 和 Tauri identifier 建议警告；未出现新的编译错误。

## 文档路由

- 新会话先读 [`AGENTS.md`](../AGENTS.md)、本文和 [`CONTEXT.md`](../CONTEXT.md)。
- 架构决策只通过 [`docs/adr/README.md`](adr/README.md) 按领域选择；当前输入/覆盖层/Node 重点看 ADR-0013、ADR-0006、ADR-0012。
- 用户操作看 [`docs/USER_GUIDE.md`](USER_GUIDE.md)；插件看 [`docs/SCRIPTING.md`](SCRIPTING.md)；按键/文字 DSL 看 [`docs/SEND_TEXT_DSL.md`](SEND_TEXT_DSL.md)。
- 发布看 [`docs/DESKTOP_RELEASE.md`](DESKTOP_RELEASE.md)、[`docs/MACOS_RELEASE.md`](MACOS_RELEASE.md) 和 [`apps/server/README-DEPLOY.md`](../apps/server/README-DEPLOY.md)；物理平台验收看 `docs/qa/`。

## 接手要求

保护工作区已有改动；协议变更同时更新 Shared 和全部消费者；界面文案走 zh-CN/en；跨平台能力不得把 Windows 自动化结果写成 macOS 已完成；显式 `git add <path>`，不使用 `git add -A`，默认不 push。详细规则只保留在 [`AGENTS.md`](../AGENTS.md)。

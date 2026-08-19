# GodGesture 当前项目状态

## 官方模板、Web Console 与共享 UI（2026-08-19）

Desktop 公共投稿现在会在提交前展示作者、目标、手势数量和插件摘要并要求确认。
Desktop 设置工作台与 Server-owned Web Console 现通过根 `@godgesture/ui` 共享无业务 Vue
原语、`--gg-*` token、焦点/确认/Toast 契约；Desktop 已移除 Element Plus 和其图标包，改用
原生语义控件与 Lucide，同时保留 zh-CN/en locale。Web Console 固定使用 zh-CN，保留
vue-i18n 文案 key 层但只注册中文 locale，移除浏览器语言检测、locale 持久化和顶部语言选择器。
左侧导航分为用户功能与管理员功能，管理员区仅对管理员显示。配置查看中的应用分组使用树形
连接线呈现应用层级，中间项和末项分别保持连续分支与收口分支。

最后核对：2026-08-19。本文是当前实际实现的唯一状态入口；术语以 [`CONTEXT.md`](../CONTEXT.md) 为准，
协作规则以 [`AGENTS.md`](../AGENTS.md) 为准，架构理由按 [`docs/adr/README.md`](adr/README.md) 路由。
本文不记录逐日开发流水；历史里程碑和发布审计资料按需读取 [`docs/CHANGELOG.md`](CHANGELOG.md)
与 [`docs/history/`](history/)。

## 当前结论

官方模板服务、Desktop 投稿复核、共享 UI 迁移和 Web Console 审核详情均已实现；管理员系统配置、账户
搜索/编辑、模板审核标签页和作者模板管理页已接入当前工作区。管理员控制台本轮五项界面与设备登录问题已
完成代码和定向验证。`/admin/system` 现在使用共享、可访问且不持久化展开状态的折叠 panel：模板策略默认
展开，RustFS 默认收起且凭证状态徽章持续可见；折叠不会清空未保存字段。真实 Windows/macOS 原生窗口与
输入验收、live OAuth/SMTP 和生产部署仍按下方边界保持 pending。模板父级暂停/恢复不会写入版本审核记录，
而是写入 `AdminAuditLog` 并在审核详情的“发布治理记录”区展示操作人、时间、原因和操作时版本。

| 领域 | 状态 | 边界 |
| --- | --- | --- |
| M0 仓库奠基 | 已完成 | 独立项目从 stable `v0.1.0` 起演进，不以 WGestures 行为作为产品基准 |
| M1 Windows 手势引擎 | Windows 主体已完成，覆盖层现场复现 pending | Windows 实机已有输入/覆盖层 smoke；当前轨迹不可见问题尚未完成无重启复现；macOS 真实设备仍按 M4 清单验收 |
| M2 Windows 命令与设置 | 已完成 | 任务切换等 Windows 专属能力显式标注，Desktop 设置 UI 已迁移到共享原语；原生窗口验收不由浏览器预览替代 |
| M3 脚本引擎 | 已完成 | ADR-0012 的常驻 Node.js supervisor/Worker 是唯一生产脚本链 |
| M4 macOS 引擎 | 代码与 CI 已完成，平台验收 pending | TCC、全局输入、覆盖层、多屏、AX、Keychain、插件和安装升级需真实 Mac 证据 |
| M5 后端与账户 | 已完成 | 私有 Server 子模块；OAuth/SMTP 凭证由部署环境提供；公共模板服务使用 PostgreSQL + RustFS |
| M6 云同步 | 已完成 | 整库 v8 文档、乐观并发、后写胜出、快照和离线优先 |
| M7 Web Console 与分发 | 已完成 | Server-owned Vue/Vite Console 已接入；官方公共模板运行时、审核、举报、配额管理、系统配置、账户编辑、作者模板管理与 RustFS 动态配置已实现 |
| M8 打磨与发布 | stable 基线已完成 | 当前工作区含 stable 之后的本地改动，未因此宣称已有新发布物 |

## 部件地图

| 部件 | 当前职责 | 入口 |
| --- | --- | --- |
| Desktop Rust | Tauri 生命周期、跨平台手势引擎、原生输入/命令/覆盖层、本地配置 | `apps/desktop/src-tauri/src/lib.rs`、`engine/`、`platform/` |
| Desktop Vue | 设置工作台、账户、模板、插件、同步和本地日志界面；消费共享 UI、保留 store/Tauri/vue-i18n 绑定，浏览器运行时使用 mock | `apps/desktop/src/App.vue`、`src/views/`、`src/stores/` |
| Shared | v8 配置、认证、同步/快照分页、模板、在线插件目录、DSL 与 OpenAPI 生成客户端 | `packages/shared/src/` |
| Shared UI | 无业务 Vue 原语、`--gg-*` token、Dialog/确认/Toast 与基础状态组件 | `packages/ui/src/` |
| Server | 私有子模块：NestJS REST、Prisma/PostgreSQL、认证、设备、同步和快照 | `apps/server/src/`、`apps/server/prisma/` |
| Web Console | Server-owned Vue/Vite SPA：只读配置、设备、快照、安全、作者模板和管理员区域；以薄适配层消费共享 UI | `apps/server/web-console/src/` |
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
- Windows 轨迹不可见现场：旧日志曾显示轨迹点增长、栅格化和提交统计均完成，但用户未看到轨迹。当前 `platform/windows/overlay.rs` 已恢复 `WS_POPUP` 与 `ShowWindow` 的覆盖层可见性语义，并为 `UpdateLayeredWindow` 局部/完整提交增加错误日志；覆盖层 focused 测试 `16/16`、Rust 格式检查均通过。原始复现进程在修改后二进制完成现场验证前已退出，因此运行态修复仍为 pending；下次必须先接管并监控当前实例，再允许编译或重启。
- Desktop 手势页支持导出 Gesture Template v2 多目标 JSON；可填写统一的标题和摘要，按全局或应用目标多选手势，并在分组中展开、收起和搜索。桌面端导出使用原生保存面板选择路径，浏览器预览回退到下载。模板详情弹窗沿用手势页的应用左栏、手势表格和选中手势预览区，详情工作区与风险/采纳复核分别位于两个外层标签页；复核表格显示类型、名称、新版 SVG 助记符、命令类型及与本地配置的冲突状态，高风险确认复选框位于共享 dialog footer 左侧且仍是采纳前置条件。

### 共享 UI 与设置工作台

- 根 `packages/ui` 以 `@godgesture/ui` 提供无业务 Vue 原语、`--gg-*` token、`AppDialog`、`AppCollapsiblePanel`、确认 Promise、Toast、全局 Message 队列与基础加载/空状态；它不读取应用 router、store、API client 或 i18n，`packages/shared` 仍只承载协议和领域类型。
- Desktop 已从 Element Plus 迁移到共享原语、Lucide 和原生语义表单/表格/菜单控件。不可逆操作通过 `UiConfirmHost` 与共享确认服务处理；异步 busy 时 Escape、遮罩、关闭图标和取消不能绕过进行中的操作。
- Web Console 源码和路由继续由私有 Server 子模块拥有，其 `src/ui` 以本地薄适配层保留 Console 文案与测试选择器，同时复用共享原语；它没有迁入根包，也没有改变协议或 Server 业务边界。

### 配置、同步与命令

- 现行配置格式为 v8，`groups`、默认应用组、`AppEntry.groupId`、有序 `inputs`、`boundaryIntents` 和 `nodePlugin.pluginId` 是现役结构；读取边界不迁移旧格式。
- 首笔手势笔画固定使用 8 方向识别，后续笔画按现有规则使用 4 方向；该规则不属于用户配置，设置页和同步协议均不再提供可开关字段。旧配置中的 `enable8Directions` 会被读取时忽略，并在规范化保存时移除。
- `全屏时自动禁用手势` 仍是可配置项，但新配置默认开启；已有配置中的显式关闭值继续保留。
- `sendText` 只接受 [`SEND_TEXT_DSL.md`](SEND_TEXT_DSL.md) 定义的 `text`、`key`、`hotkey`、`sleep` 语句。
- 命令行分为 `cmd` 与 `powershell` 两类；Windows 分别调用系统 cmd/PowerShell，macOS 的 PowerShell
  分支要求本机可执行 `pwsh`，缺失时不回退到 zsh。
- Node 插件使用 `app_config_dir/plugins` 下的直接子项目；`package.json.godgesture.lifecycles` 声明 `onInit`、`onExecute`、`onGestureRecognized`、`onModifierTriggered`、`onEnd`。插件页可在用户确认后从固定官方仓库 `Mr-BeanSir/GodGesture-Plugins` 的 `main` 目录按 `pluginId`/`subdirectory` 下载，校验 manifest ID 并安装生产依赖；模板采纳也会先安装其声明的插件。源码、依赖和锁文件不进入云同步，命令只同步 `pluginId`。
- Desktop 自动同步使用 30 秒尾随防抖、启动/定时拉取和手动立即同步；refresh token 只进 Windows Credential Manager/macOS Keychain，不进 WebView。
- Server API 前缀为 `/api/v1`。快照列表使用 `page/pageSize` 服务端分页，默认 10、单次最多 50，列表不读取正文；恢复使用版本 CAS。
- OAuth 已绑定身份继续使用一次性授权码 + PKCE 登录；首次出现的第三方身份不会依据提供方邮箱自动创建或关联账户，必须先通过 GodGesture 邮箱验证码完成绑定。Desktop 与 Web Console 均支持该 pending OAuth 流程。
- Web Console 在已保存会话因瞬时网络、限流或无效响应而恢复失败时保留本地凭证，并在登录页提供原受保护路由的重试入口；只有服务端明确判定会话失效时才清理凭证。
- Web Console 首屏读取分组/应用索引，选中应用后按需读取手势；全局应用置顶，分组和应用按同步顺序展示。
- `distribution/plugins` 仍是官方插件仓库 submodule，项目统一位于 `plugins/<subdirectory>/`；Desktop
  固定从 `Mr-BeanSir/GodGesture-Plugins` 的 `main/catalog.min.json` 读取插件目录并在校验后缓存。
  模板和配置仅保存 `pluginId`，安装时由目录解析固定仓库、`main` 和子目录。
- 官方公共模板目录已由 Server 的 PostgreSQL 元数据、审核/配额/指标模型和 RustFS 不可变对象实现；
  Desktop 始终从构建时配置的官方 Server origin 分页读取并通过短期签名 URL 下载包，官方端点登录后可投稿。
  匿名用户可浏览和采纳，网络失败时只使用上一份有效分页缓存；自定义端点不提供目录或投稿。
  公开作者读取当前 `User.displayName.trim() || User.email`，不保存作者快照；下载次数使用匿名每日
  聚合和短期去重，不保留用户/设备下载历史。每个模板族的公共目录只展示最高已发布版本；更新版本审核
  期间继续展示旧版本，通过后切换到新版本的标题、标签和摘要。父模板 `publicationSuspendedAt` 暂停时
  整个模板族从目录、详情和下载隐藏，恢复后重新展示最高已发布版本。旧 `distribution/templates` submodule 已从主仓库移除；
  Desktop 不再保留 GitHub 模板运行时或本地 seed 依赖。浏览器预览继续使用源码 fixture。
- 官方模板作者生命周期已接入：Server 以不可变版本处理同一模板族的重新投稿，被驳回或已撤回模板可创建
  新版本；只有包含已发布版本的模板族可以撤回，撤回后从公共目录消失但仍可重新投稿。作者只能删除不含
  `published`、`pending_review` 或 `suspended` 版本的模板族；每个模板族保留最新 50 个版本，并在删除旧
  版本时清理关联审核、举报、下载去重、指标和 RustFS 对象。Web Console 的 `/templates` 提供“我提交的
  模板”、版本时间线、撤回/删除确认和错误重试；Desktop 投稿向导先选择“提交到服务器”或“导出 JSON”，
  再选择新模板或已有模板版本。
- 全局 `TemplatePolicy` 是数据库级单例：迁移确定性保留历史重复记录中最新的一条，并以 `singleton=true` 的唯一键与 CHECK 约束拒绝任何第二条或 `false` 记录；Server 所有策略读取和更新均按该唯一键定位。
- Desktop 与 Web Console 共用 [`packages/shared/src/assets/mnemonic.svg`](../packages/shared/src/assets/mnemonic.svg)，shared 不依赖 Vue。

### 本地日志与发布

- Desktop 日志落在 `app_log_dir()` 的脱敏 JSONL，级别为 `off/error/warn/info/debug`，不上传、不参与同步；日志页支持最新优先、trace 折叠、筛选、导出、清理和可关闭的自动跟随。
- 2026-08-19 Desktop 发布自动化已接入：根 `pnpm release` wrapper 使用 release-it 同步四个 Desktop 版本文件，PR workflow 维护 `type:*` 标签，GitHub 使用 `.github/release.yml` 生成 Release Notes。Windows/macOS 发布 job 现在从 GitHub Actions Repository Variable `GODGESTURE_API` 注入官方 Server origin，并在打包前拒绝缺失或非法的非 HTTPS origin；该值由 Vite 编译进应用，安装包不读取或携带外部 `.env`。发布 workflow 和 macOS CI 已统一使用 Node `24.18.1`，并切换到 Node 24 runtime 的 GitHub Actions major。当前本地验证入口为 `pnpm release patch --dry-run` 和 `pnpm validate:release`；live GitHub API 的生成正文检查，以及真实 Windows/macOS `v0.2.0` 产物验收，仍待维护者执行带 tag 的发布和平台检查，不能由本地验证替代。
- `pnpm dev:server` 会先生成 Prisma Client 并幂等应用已提交迁移，再等待后端健康检查后启动 Web Console；本地 PostgreSQL 与 RustFS 仍由 `apps/server/docker-compose.dev.yml` 提供。
- stable `v0.1.0` 已有 Windows x64 NSIS 与 macOS universal ad-hoc DMG/Updater。当前分发模型不提供 Authenticode、Developer ID、公证或 staple。
- Desktop `release` wrapper 允许透传 release-it 的自定义配置和非发布选项，但最终 invocation 固定追加 `npm=false`、`npm.publish=false` 与 `github.release=false`；直接发布覆盖参数仍在读取版本和 Git 状态前拒绝。
- Server 生产部署由维护者使用 1Panel 手动完成，交付物为 docker-compose；更新和官方在线插件目录通过 GitHub 分发。公共模板目录使用 Server 的 PostgreSQL + RustFS：RustFS 仅在内部 Docker 网络运行，包对象不可变，公开下载使用五分钟签名 URL；数据库与对象存储必须同窗口备份和恢复演练。匿名用户可读取官方目录，投稿仅限已验证邮箱的官方端点登录用户；自定义端点不提供公共目录或投稿。

## 已知边界

以下项目是明确的 pending，不得在文档或发布说明中写成已验收：

- 真实 Mac：TCC 授权/拒绝、全局输入吞噬、点击透传、X1/X2、Retina 多屏、Spaces/全屏覆盖层、AX 命令、Bundle ID/图标、Keychain、插件热更新/依赖恢复和已安装升级。逐项记录在 [`docs/qa/M4_MACOS_SMOKE.md`](qa/M4_MACOS_SMOKE.md)。
- 本轮共享 UI 的浏览器预览只覆盖同一 Vue 构建的视觉、导航、焦点和溢出行为；它不替代 Windows/macOS 原生窗口按钮、拖拽区域、权限、全局输入或覆盖层的真实设备验收。
- Windows 安装/卸载后遗留 Task Scheduler 任务的自动清理仍未纳入安装器；移动或删除可执行文件会使旧任务失效。
- GitHub/Google OAuth 的真实客户端凭证、SMTP 和生产 Prisma 迁移需部署环境验证；本地契约测试不等于 live OAuth/SMTP 通过。
- 2026-08-10 本地 Docker 构建已成功生成包含 Server 与 Console 静态资源的 Linux 镜像；这不替代真实 1Panel 部署、生产数据库迁移、live OAuth/SMTP 或生产 RustFS 验收。
- 本地日志真实目录权限、轮转、重启恢复、Node 崩溃回退和跨平台文件行为仍需平台观察；自动化日志测试只证明代码契约。
- Windows 轨迹不可见问题的无重启复现、屏幕截图证据和用户肉眼验收仍 pending；不得把覆盖层提交日志或 focused 测试单独当作“用户已看到轨迹”的证据。
- 当前 Windows 开发实例仍可能锁定默认 `target/debug/godgesture.exe`；需要做 Tauri 构建时可使用独立 `CARGO_TARGET_DIR`，不要强杀现有实例。

## 已有验证基线

- 2026-08-19 Desktop 发布构建阻断修复验证：`pnpm --filter @godgesture/desktop test` 通过 `50 files / 238 passed / 3 skipped`，`pnpm --filter @godgesture/desktop typecheck` 与 `pnpm --filter @godgesture/desktop build` 均通过，`git diff --check` 通过。修复了投稿复核 props 与 Shared 版本协议的多余 `parentId` 要求、账户会话 mock 的 fetch 参数类型、Vue Test Utils `get()` 的错误存在性断言，以及拖拽 pointer-up 的可空引用；Vite 仅保留动态导入和大 chunk 警告。该验证覆盖 Desktop Vue/Vite，不能替代真实 Windows/macOS Tauri 安装包和原生能力验收。
- 2026-08-13 固定首笔 8 方向规则验证：Desktop 设置页 focused 测试 `5/5`、Shared 配置协议测试 `4/4`、Rust 解析器测试 `7/7`、旧字段 Serde 兼容测试 `1/1`、Web Console focused 配置测试所在套件 `21 files / 150 tests`、Shared/Web Console typecheck 与 `pnpm check:api` 均通过；未执行全量测试。Desktop typecheck 仍受本工作树上一轮 `GesturesView` 改动的 3 个既有 TypeScript 错误阻断，与本次设置项移除无关。
- 2026-08-13 `pnpm dev:server` Windows 启动器修复验证：`scripts/__tests__/dev-server.test.mjs` 通过 `5/5`；Windows 子进程通过系统 PowerShell 解析可用的 `pnpm`/`pnpm.ps1`，不再使用 `pnpm.cmd` + `shell: true`，成功与失败退出码均正确传递，且不再触发 Node `DEP0190`。完整 Server 启动仍需本机 PostgreSQL/RustFS 与允许 Prisma/esbuild 构建脚本的 pnpm 策略。
- 2026-08-12 Desktop 与 Web Console 共享 UI 迁移验证：`pnpm --filter @godgesture/ui test` 通过 `5 files / 12 tests` 且 typecheck 通过；Desktop `test` 通过 `49 files / 206 passed / 3 skipped`，typecheck 与 Vite 生产 build 通过；Server-owned Web Console `web:test` 通过 `21 files / 150 tests`，`web:typecheck` 与 `web:build` 通过；`pnpm test:repository-layout` 为 `8/8`。`apps/desktop`、`packages/ui` 和根 lockfile 的 Element Plus/`--el-` 扫描为空，`git diff --check` 通过。浏览器预览已核对浅色/深色 `980x700` 和 `800x560`：Desktop 始终为 48px 顶栏、168px 常驻左栏、30px 底栏，无导航切换按钮/抽屉；Desktop 常规按钮和表单为 32px，手势动作保留 36px、分组菜单保留 40px，页面级横向溢出为零。Web Console 继续独立验证多尺寸响应式行为；浏览器预览不替代 Windows/macOS 原生窗口按钮、拖拽区域、权限、全局输入或覆盖层的真实设备验收。
- 2026-08-12 Web Console 配置应用树验证：`pnpm --filter @godgesture/server web:test` 通过 `19 files / 146 tests`，`pnpm --filter @godgesture/server web:typecheck` 与 `pnpm --filter @godgesture/server web:build` 均通过；Chrome 登录态下 `http://127.0.0.1:5180/config` 实测三项应用形成两个连续分支和一个末端收口分支，树干与分组文字、横线与图标中心的对齐差值均为 `0px`，浅色/深色主题边框 token 均生效，`1480px` 桌面、`375px` 竖屏和 `812px` 横屏均无横向溢出。
- 2026-08-11 Server-owned Web Console 收尾验证：`pnpm --filter @godgesture/server test` 通过 Server Jest `18 suites / 129 tests` 与 Console Vitest `19 files / 141 tests`，`typecheck`、统一生产 `build`、E2E `1 suite / 4 tests`、仓库布局 `6/6`、开发启动脚本 `1/1`、Server 范围的无 Element Plus 扫描及两个 `pnpm why` 查询均通过。生产 Docker 镜像重新构建后，临时容器的 `/api/v1/health`、`/`、`/devices` 为 `200`，未知 API 与 docs 路径均保持 JSON `404`，容器已清理；合成 API 的浏览器验收覆盖浅色/深色 `375/768/1023/1024/1440px`，断点导航、表格、焦点迁移和页面级横向溢出均符合设计系统。`pnpm check:api` 在 Windows checkout 仅因已检出 `openapi.json` 为 CRLF 而生成文件为 LF 未通过；归一化行尾后内容逐字一致，未发现 OpenAPI 语义漂移。真实 macOS、live OAuth/SMTP、1Panel 与生产部署仍 pending。
- 2026-08-11 Web Console 中文与导航分区验证：`pnpm --filter @godgesture/server web:test` 通过 `19 files / 144 tests`，`pnpm --filter @godgesture/server web:typecheck` 与 `pnpm --filter @godgesture/server web:build` 均通过；固定 zh-CN、顶部语言选择器移除、管理员/用户导航分区、非管理员隐藏及移动端焦点行为均有 focused/回归测试覆盖。
- 2026-08-11 模板策略安全补丁验证：Server Jest `20 suites / 171 passed / 13 skipped`，空 HMAC 回退、生产 HMAC/JWT 分离和集成数据库 guard 均通过；`pnpm test:template-integration` 仅接受数据库名以 `_test` 结尾的 `TEST_DATABASE_URL`，先执行全部迁移再运行父状态并发套件 `13/13`，缺少 URL 会立即失败。临时数据库已清理；开发库迁移状态已核对，未执行集成测试的清空步骤。
- 2026-08-14 管理员控制台五项问题与设备登录去重定向验证：Server 认证 Jest `3 suites / 31 tests`、Web Console `24 files / 165 tests`、Shared 认证/API `2 files / 27 tests`、共享 UI `2 files / 6 tests`、Desktop 账户/云 API `2 files / 16 tests`、Rust 设备标识 `2 tests`均通过；Server 与 Web Console typecheck、UI typecheck、Web Console 生产构建、`pnpm generate:api` 和 `pnpm check:api`均通过。Web Console 正确使用共享 Toast 的右上角适配，Tabs header 隐藏纵向滚动条，用户角色/会话操作位于编辑页，系统配置固定在管理员导航底部，浏览器与 Desktop 登录请求携带稳定安装标识。未运行仓库全量测试；Desktop 全量 typecheck 仍受本工作树既有 `GesturesView` 的 3 个 TypeScript 错误阻断；真实 RustFS、OAuth/SMTP、Windows/macOS 原生能力、1Panel 部署和浏览器手动测试仍 pending，需维护者从 `/admin`、`/admin/system`、`/admin/users/:id/edit`、`/admin/templates`、`/devices` 开始验收。
- 2026-08-14 系统配置折叠 panel 验证：`pnpm --filter @godgesture/ui test` 通过 `7 files / 16 tests`，`pnpm --filter @godgesture/server web:test` 通过 `24 files / 166 tests`；共享 UI 与 Web Console typecheck、Web Console 生产 `web:build` 均通过。登录态浏览器在桌面和 `375x812` 下验证模板策略默认展开、RustFS 默认收起、凭证徽章始终可见、键盘可展开、折叠后字段值保留且页面无横向溢出；未运行仓库全量测试，既有 Desktop `GesturesView` 的 3 个 typecheck 错误保持不变。
- 2026-08-14 官方模板作者生命周期与 Desktop 投稿向导定向验证：Shared 模板协议 `8/8`、Server 作者生命周期/OpenAPI `3 suites / 66 tests`、Desktop 投稿向导与账户 API `3 files / 22 tests`、Web Console 作者页面/API/导航 `4 files / 26 tests` 均通过，OpenAPI check 与 Web Console typecheck 通过。当前实现覆盖驳回后新版本、已发布模板撤回、可删除模板族、最新 50 版本保留、Web `/templates` 作者管理和 Desktop 两步投稿；真实 RustFS、登录态 Web 手动操作、Windows/macOS 原生验收、live OAuth/SMTP、生产部署仍 pending，需维护者手动测试。
- 2026-08-15 Desktop 官方模板端点修复定向验证：模板源不再硬编码生产域名，默认目录和包接口均读取构建环境的 `GODGESTURE_API`，并复用 Desktop 端点安全校验；模板源测试 `3/3`、云会话端点测试 `9/9`、模板 Store/View 回归测试 `5 passed / 3 skipped`通过，生产域名硬编码扫描为空。Desktop typecheck 仍被本工作树既有的 `GestureExportDialog`、`GesturesView` 和测试类型错误阻断，本次新增端点文件未产生类型报错。
- 2026-08-15 模板审核详情定向验证：Server RustFS/模板服务/OpenAPI `3 suites / 74 tests`、Web Console schema/审核视图 `26 files / 180 tests`、Web Console typecheck 与 `pnpm check:api` 均通过；审核详情已按模板包校验结果展示全局/App 手势明细，审核按钮位于语义 action header 并保留合法按钮层级。最大合法 `12 x 32` 字符助记符在 `375px` 下无页面级横向溢出，`1024px` 桌面表格溢出仍只由 `.gg-table-wrap` 承载。未运行仓库全量测试；真实 RustFS、登录态 Web 手动操作、Windows/macOS 原生验收、live OAuth/SMTP、生产部署仍 pending，需维护者手动测试。
- 2026-08-15 模板族版本发布语义定向验证：模板服务/API `60 + 7` tests、Web Console schema/审核视图 `28 tests`、Server/Web Console typecheck、Prisma Client 生成、`pnpm generate:api` 与 `pnpm check:api` 均通过。公共目录按父 `templateId` 只选择最高已发布版本；更新版本审核期间旧版本仍可下载，通过后切换新元数据；父模板暂停不改变版本状态且暂停期间公共读取隐藏，恢复重新展示最高已发布版本。未运行仓库全量测试；真实数据库迁移、RustFS、登录态 Web 手动操作、Windows/macOS 原生验收、live OAuth/SMTP、生产部署仍 pending，需维护者手动测试。
- 2026-08-15 模板发布治理记录定向验证：模板服务/OpenAPI `2 suites / 67 tests`、共享协议 `89 tests`、Web Console schema/审核视图 `29 tests`、Server/Web Console typecheck、`pnpm generate:api` 与 `pnpm check:api` 均通过。暂停/恢复从 `AdminAuditLog` 按父 `templateId` 读取，版本审核记录保持只记录通过/驳回；审核详情新增独立发布治理记录区，并对旧格式元数据安全显示未知版本。未运行仓库全量测试；真实数据库、RustFS、登录态 Web 手动操作、Windows/macOS 原生验收、live OAuth/SMTP、生产部署仍 pending，需维护者手动测试。
- 2026-08-15 公共模板目录契约与本地 RustFS 下载定向验证：Rust `template_download` `4/4`、Shared 模板协议 `8/8`、Desktop 模板源/Store/View `8 passed / 3 skipped`、Server 模板服务/OpenAPI `67/67`、Web Console 审核视图 `26/26`、Shared/Server typecheck、`pnpm generate:api` 与 `pnpm check:api` 均通过。Desktop 仅允许 HTTPS 或 loopback HTTP 下载签名包；公共目录 entry 已移除 `targets`，App 目标筛选和列表 badge 随之删除，下载后的模板包详情仍展示 targets；all 审核工作区队列 header 已移除且保留可访问名称。Desktop 全量 typecheck 仍受本工作树既有 `GestureExportDialog`、账户测试和 `GesturesView` 错误阻断；未运行仓库全量测试，真实 RustFS、登录态手动操作、Windows/macOS 原生验收、live OAuth/SMTP、生产部署仍 pending。
- 2026-08-15 Desktop 官方模板端点与 RustFS 包下载回归验证：模板目录默认读取构建环境 `GODGESTURE_API`，签名 RustFS 包在 Tauri 运行时改由 `download_template_text` 原生命令读取，避免 WebView 直连 RustFS 的 CORS 拦截；Desktop 受影响套件 `21 passed / 3 skipped`，Rust 下载器 `4/4`。Desktop 全量 typecheck 仍仅受上述既有 `GestureExportDialog`、账户测试和 `GesturesView` 错误阻断。
- 2026-08-16 Desktop 模板详情复核布局定向验证：高风险确认 `label` 仅从 review 内容移至共享 `AppDialog` footer 左侧直接子元素，保留原有复选框状态和采纳禁用逻辑，未移动 adoption 父容器；`TemplatesView` 套件 `8/8`、Desktop 全量测试 `50 files / 234 passed / 3 skipped`、`git diff --check` 均通过。Desktop typecheck 仍被既有 `GestureExportDialog`、账户测试和 `GesturesView` 错误阻断，本次未新增 `TemplatesView` 类型错误；该变更已合并到本地 `main`，尚未部署或进行 live 验证。
- 2026-08-16 Desktop 手势页全局 Message 队列定向验证：`@godgesture/ui` 全部 `9 files / 24 tests`、Desktop 受影响的 `AppShell` 与 `GesturesView` `2 files / 32 tests`均通过；UI typecheck 通过。应用切换时每次缺失平台绑定提示生成独立消息并在 body 顶部纵向堆叠，各自默认 3 秒后消失；Desktop typecheck 仍仅受既有 `GestureExportDialog`、账户测试和 `GesturesView` 错误阻断，未运行仓库全量测试，尚未进行 Windows/macOS 原生验收。

更早的逐轮验证、稳定版发布证据和已退役链路不在现役入口重复保存：按需读取 [`docs/CHANGELOG.md`](CHANGELOG.md)
及 [`docs/history/M8_RELEASE_ACCEPTANCE.md`](history/M8_RELEASE_ACCEPTANCE.md)。

## 当前工作区备注

- 官方公共模板服务已接入 PostgreSQL + RustFS 的 UUID 版本对象、分页目录、七日趋势排序、平台筛选、审核举报处理和全局/用户级可调配额；管理员控制台提供审核备注、举报处理说明和用户配额覆盖入口。Web Console 源码、构建脚本与生产静态产物由私有 Server 子模块统一维护。
- Desktop 与 Web Console 已共同使用根 `@godgesture/ui` 的无业务原语和 Lucide；Desktop 不再声明或打包 Element Plus。Web Console 继续使用 Tailwind v4 与其本地薄适配层；全局设计真源为 `design-system/godgesture-web-console/MASTER.md`，模板审核例外记录在其 `pages/template-moderation.md`。新增或重大调整路由必须先读取持久化设计系统并执行对应 `ui-ux-pro-max` Vue/UX 查询。
- 模板审核转换在交互式事务内以版本 ID 与来源状态执行条件更新；失去竞争时返回既有 `invalid_template_moderation_action_state`，且不会再写模板状态、审核记录或管理员审计。管理员、模板审核/举报、设备、快照、安全和会话退出确认均把进行中状态传给共享对话框，忙碌时不能经 Escape、遮罩或图标关闭绕过确认。
- 管理员控制台提供 `/admin/system` 系统配置页、`/admin/users/:id/edit` 用户编辑页和 `/admin/templates` 三标签审核工作区。系统配置页以共享折叠 panel 承载：模板策略初始展开，RustFS 和后续 panel 初始收起，状态只保留在当前页面；RustFS 徽章保持在可见标题区。RustFS Endpoint、Region、Bucket、公开下载 TTL 与凭证从数据库 `SystemConfig` 单例读取并动态生效；凭证只保存加密密文，OAuth、SMTP、JWT 与模板下载指标 HMAC 仍由部署环境管理。账户列表支持邮箱搜索与服务端分页，用户详情提供最后登录/使用时间、密码二次确认和模板配额覆盖。

- `distribution/plugins` 子模块工作树干净，目录校验通过。
- `apps/server` 是私有 Git 子模块；开发、CI 与 1Panel 检出必须运行 `git submodule update --init --recursive` 并具备该私有仓库的只读权限。Web Console 位于 `apps/server/web-console/`，通过根工作区消费 `@godgesture/shared` 协议包和 `@godgesture/ui` 原语包；协议、OpenAPI 与 Docker 构建边界不独立化，理由见 ADR-0015、ADR-0016、ADR-0017。
- 旧 `distribution/templates` submodule 已按维护者确认从主仓库移除；历史 GitHub 仓库不再参与
  Desktop 运行时、发布校验或主仓库递归检出。

## 文档路由

- 新会话先读 [`AGENTS.md`](../AGENTS.md)、本文和 [`CONTEXT.md`](../CONTEXT.md)。
- 架构决策只通过 [`docs/adr/README.md`](adr/README.md) 按领域选择；当前输入/覆盖层/Node 重点看 ADR-0013、ADR-0006、ADR-0012。
- 用户操作看 [`docs/USER_GUIDE.md`](USER_GUIDE.md)；插件看 [`docs/SCRIPTING.md`](SCRIPTING.md)；按键/文字 DSL 看 [`docs/SEND_TEXT_DSL.md`](SEND_TEXT_DSL.md)。
- 发布看 [`docs/DESKTOP_RELEASE.md`](DESKTOP_RELEASE.md)、[`docs/MACOS_RELEASE.md`](MACOS_RELEASE.md) 和 [`apps/server/README-DEPLOY.md`](../apps/server/README-DEPLOY.md)；物理平台验收看 `docs/qa/`。
- 历史里程碑和逐轮验证按需看 [`docs/CHANGELOG.md`](CHANGELOG.md)；stable `v0.1.0` 的完整发布验收证据看 [`docs/history/M8_RELEASE_ACCEPTANCE.md`](history/M8_RELEASE_ACCEPTANCE.md)。普通开发任务不要默认读取历史资料。

## 接手要求

保护工作区已有改动；协议变更同时更新 Shared 和全部消费者；界面文案走 zh-CN/en；跨平台能力不得把 Windows 自动化结果写成 macOS 已完成；显式 `git add <path>`，不使用 `git add -A`，默认不 push。详细规则只保留在 [`AGENTS.md`](../AGENTS.md)。

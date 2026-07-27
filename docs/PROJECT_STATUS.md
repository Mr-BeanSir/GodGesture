# GodGesture 当前项目状态

最后核对:2026-07-27。产品代码基线覆盖至 `1233554`;此后的文档提交不改变产品行为。接手时仍须执行 `git status --porcelain=v1` 和 `git log --oneline -12`,不要假定 HEAD 或工作区状态。

本文是“当前实际实现”的权威入口。术语以 `CONTEXT.md` 为准,架构理由以相关 ADR 为准,未来范围以 `docs/ROADMAP.md` 为准。功能状态、入口、已知问题或验证基线改变时必须同步更新本文。

## 当前结论

| 里程碑                | 实际状态                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| M0 仓库奠基           | 已完成                                                                        |
| M1 Windows 手势引擎   | Windows 主体已实现并通过运行时 smoke;因 macOS 未实现,不满足双平台正式完成定义 |
| M2 Windows 命令与设置 | 部分完成;主引擎、主要设置 UI、开机自启和管理员运行可用,仍有明确缺口见下文   |
| M3 QuickJS            | 未开始;Script 模型/编辑器已存在,执行器会记录警告后跳过                        |
| M4 macOS 引擎         | 未开始;只有跨平台数据模型和条件编译占位                                       |
| M5 后端与账户         | 服务端主体已实现;外部 OAuth 凭证仍由部署环境提供                              |
| M6 云同步             | shared 协议和服务端已实现;桌面账户/同步仍是本地 mock,未接后端                 |
| M7 Web 控制台与分发   | Web 控制台主体已实现;Updater 和模板分发未实现                                 |
| M8 打磨与发布         | 未开始;安装、提权启动、公证、引导和正式发布尚未验收                           |

## 部件地图

| 部件                     | 职责与当前状态                                                                       | 关键入口                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/desktop/src-tauri` | Tauri 生命周期、Windows 手势引擎、原生平台能力、本地配置;Windows 可运行,macOS 未实现 | `src/lib.rs`, `src/engine/`, `src/platform/windows/`                                  |
| `apps/desktop/src`       | Vue 设置界面、Pinia、本地/Tauri IPC;主要配置页可用,账户同步是 mock                   | `src/App.vue`, `src/views/`, `src/api/backend.ts`                                     |
| `packages/shared`        | 配置、认证、同步 Zod 协议、容量限制、热键规范化和旧配置导入                          | `src/index.ts`, `src/config/`, `src/auth/`, `src/sync/`, `src/importers/`             |
| `apps/server`            | NestJS REST API、Prisma/PostgreSQL、认证、设备、同步、快照                           | `src/app.module.ts`, `src/auth/`, `src/devices/`, `src/sync/`, `prisma/schema.prisma` |
| `apps/web-console`       | 浏览器账户控制台;只读配置、设备、快照、安全                                          | `src/router/index.ts`, `src/api/`, `src/views/`                                       |
| `apps/server` 部署       | 1Panel 手动部署、PostgreSQL、Docker 构建与迁移                                       | `README-DEPLOY.md`, `Dockerfile`, `docker-compose.*.yml`, `.env.example`              |
| `WGestures/`             | WGestures 1.8.5 行为参考克隆,不属于本仓库产品代码                                    | 只用于行为对照,不要修改或纳入提交                                                     |

## Desktop Rust

- `engine/parser.rs` 和 `engine/tracker.rs`:8 向首笔、后续 4 向、最多 12 笔、阈值/超时、点击透传、修饰和捕获状态机。
- `engine/intents.rs`:全局/应用意图选择、继承、黑名单、exe/精确路径/AUMID 匹配优先级。
- `engine/runtime.rs`:钩子输入到识别、覆盖层、捕获事件、暂停和命令分发的协调层。
- `engine/corners.rs`:多显示器触发角/摩擦边状态机;文件头常量、语义和有意偏差是维护契约。
- `engine/config.rs`:Rust 侧共享配置镜像、默认种子、`config.json` 与本机设置持久化;Windows 使用可覆盖既有目标的原子替换。
- `legacy_import.rs` 与 `lib.rs` 的 `legacy_import_apply`:WGestures 双配置批量应用、写命令互斥与进程内回滚。两个独立文件不保证进程被强制终止时的跨文件崩溃原子性。
- `platform/windows/hook.rs`:低级鼠标钩子、模拟输入标记、同步重入 fail-open、FFI panic 边界。
- `platform/windows/startup.rs`:当前用户 SID 任务身份、Task Scheduler COM 对账/快照/所有权、split-token 校验、`runas` 与早期启动模式。
- `platform/windows/overlay.rs`:原生分层窗口轨迹和命令提示;不得改成 WebView 覆盖层。
- `platform/windows/commands.rs`:除 Script 外的命令执行;窗口命令异步排队,外壳窗口受保护。
- `platform/windows/input.rs`, `keys.rs`, `clipboard.rs`, `window.rs`, `icon.rs`:输入合成、键名、选中文本、窗口信息/AUMID 和图标。
- `lib.rs`:Tauri IPC、托盘、暂停快捷键、单实例、窗口隐藏和引擎启动。

## Desktop Vue

- 页面:`OptionsView`, `GesturesView`, `CornersEdgesView`, `AccountView`, `AboutView`;中文/英文均走 vue-i18n。
- `api/backend.ts` 是唯一 Tauri IPC 网关;浏览器运行时自动使用 `api/mock.ts`。
- `stores/config.ts` 负责加载、可取消防抖、串行保存、导入 barrier 和即时生效;协议变更必须同步核对 Rust `engine/config.rs`。
- 本机设置通过显式串行更新操作保存,可观察 Task Scheduler/UAC pending 与结构化错误;`rollback_incomplete` 会重读后端状态,文档保存不会清除本机错误。
- `LegacyImportDialog.vue` 从 Options 提供 WGestures 文件选择、4 MiB 输入限制、256 KiB 输出限制、结构化诊断预览和整库替换;`runAsAdmin` 在导入时保留。
- 手势录制由 `CaptureDialog.vue` 驱动,开始后持续接收捕获,关闭时显式 `capture_cancel`。
- `stores/account.ts` 与 `AccountView.vue` 是演示 mock,不进行真实登录、令牌保存或同步。

## Shared、Server 与 Web

- `packages/shared` 是 TypeScript 协议单一来源,同时发布 ESM、CommonJS 和类型声明。配置格式当前为 `CONFIG_FORMAT_VERSION = 1`。
- 配置是整库同步文档;本机专属设置不进入同步。容量限制集中在 `config/limits.ts`。
- Server 路由前缀为 `/api/v1`;包含 health、密码注册/登录、刷新/退出、OAuth、设备管理、配置推拉、快照列表/恢复。
- OAuth 已实现 GitHub/Google 可配置提供方和 PKCE;微信/QQ 保留配置位并默认不可用。不得按邮箱把 OAuth 自动关联到未验证密码账户。
- 同步使用整库版本、乐观并发、后写胜出和快照;恢复快照也要求版本 CAS。设备删除会撤销其访问。
- Web Console 使用 shared Schema 校验 API 数据,支持密码/OAuth 登录、跨标签刷新协调、只读配置、设备改名/移除和快照恢复。

## 已知未完成边界

- `Command.type = script` 可配置但不可执行;rquickjs 依赖和宿主 API 均未落地。
- macOS 没有 CGEventTap、原生覆盖层、Bundle ID 解析或命令平台实现。
- 桌面账户与云同步未连接 Server;没有防抖推送、启动/定时拉取或 409 拉取重推。
- 应用窗口选取目前是短时轮询前台窗口,不是完整准星体验;拖放添加应用未实现。
- Windows `autoStart` 和 `runAsAdmin` 已接 Task Scheduler COM 与 `runas`;macOS 登录项/授权仍未实现。安装/卸载阶段尚未自动清理遗留任务,移动或删除可执行文件会使任务失效。
- Updater、手势模板库、安装包验收、快速引导和 macOS 签名公证未完成。

## 不得破坏的语义

- PathEnd 按 `executed_on_modifier` 处理。
- 录制持续到前端显式 `capture_cancel`,不是捕获一次自动停止。
- 保留 `corners.rs` 文件头记录的状态机常量、多显示器语义和有意偏差。
- 鼠标键按下时仍喂角/边状态机,只抑制命令分发。
- 不复现 WGestures Bottom 边绝对/局部坐标 bug。
- 外壳窗口不得执行窗口控制命令。
- Windows `SendInput` 可能同步重入鼠标钩子;当前 TLS handler 临时取出、嵌套事件 fail-open 和 FFI panic 防护不得回退。
- OAuth 不得按未验证密码账户邮箱自动关联。
- Windows 启动任务按当前用户 SID 命名并校验 GodGesture 所有权;不得覆盖同名的非本项目任务,不得改回 `schtasks.exe` 或加入 `uiAccess`。

## 本地开发与运行时 QA

- Node >= 22,pnpm 10,Rust stable;Windows 还需 WebView2。
- 桌面开发固定为 Vite `127.0.0.1:14200`、HMR `14201`、Tauri devUrl `http://127.0.0.1:14200`。旧端口 1420/1421 位于本机排除范围,不得改回。
- 启动 `pnpm dev:desktop` 前先检查 14200 监听者和 GodGesture/Node/Cargo 精确进程树。不要启动第二份会话,不要批量终止 Node/Cargo。
- 开发日志约定:`%TEMP%\godgesture-dev\stdout.log` 和 `%TEMP%\godgesture-dev\stderr.log`。
- 暂停快捷键可能因其他程序占用而出现 `HotKey already registered`;应用仍可启动,但快捷键不可用。
- WebView 曾在窗口关闭命令后记录 `Failed to unregister class Chrome_WidgetWin_0. Error = 1412`;证据不足,先稳定复现再改代码。

## 验证基线

从仓库根目录按受影响领域运行,不要为窄改动机械执行全仓测试:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm --filter @godgesture/server test --runInBand
pnpm --filter @godgesture/server typecheck
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop build
pnpm --filter @godgesture/web-console typecheck
pnpm --filter @godgesture/web-console build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
```

最近结果:shared 72/72 + build;server 80/80 + typecheck;desktop 16/16 + typecheck/build;web-console typecheck/build;Rust 124/124。Windows Task Scheduler COM 已用唯一测试任务通过 least-privilege 创建/读取/删除 smoke,清理后无测试任务遗留;highest/UAC 仍需人工交互验收。clippy 唯一允许的既有警告是 `apps/desktop/src-tauri/src/platform/windows/overlay.rs:202 while_let_loop`。

Server 测试中的 `Unhandled Prisma P2002 (OAuthAccount)` 是未知 constraint 映射为 500 的预期日志。Web 构建的 VueUse PURE 注释和大 chunk 警告是既有警告。不要跑全仓 `cargo fmt`;只格式化实际修改的 Rust 文件。

## 新任务接手流程

1. 依次读 `CLAUDE.md`、`CONTEXT.md`、本文、相关 ADR 和 `ROADMAP.md`,再检查 Git 状态与近期提交。
2. 先判断任务影响 Desktop Rust、Desktop Vue、shared、Server、Web Console 或部署中的哪些领域。协议改动必须更新 shared 和所有消费者。
3. Bug 先从现有日志和稳定复现开始;不要仅凭一次观察修改代码。新行为不得与 ADR 或上面的锁定语义静默冲突。
4. 检查是否已有桌面开发会话,保护用户改动,实施最小范围修改,按风险补测试并运行对应验证。
5. 每个领域选择性 `git add <明确路径>` 并独立提交;commit message 用英文。绝不使用 `git add -A`,绝不自动 push。
6. 若任务改变本文记录的事实,在同一领域提交中更新本文;验证数字只有实际重跑后才能更新。

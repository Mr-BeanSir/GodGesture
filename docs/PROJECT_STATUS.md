# GodGesture 当前项目状态

最后核对:2026-07-28。产品代码与发布配置基线覆盖至 `969afe1`;此后的状态文档提交不改变产品行为。接手时仍须执行 `git status --porcelain=v1` 和 `git log --oneline -12`,不要假定 HEAD 或工作区状态。

本文是“当前实际实现”的权威入口。术语以 `CONTEXT.md` 为准,架构理由以相关 ADR 为准,未来范围以 `docs/ROADMAP.md` 为准。功能状态、入口、已知问题或验证基线改变时必须同步更新本文。

## 当前结论

| 里程碑                | 实际状态                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| M0 仓库奠基           | 已完成                                                                        |
| M1 Windows 手势引擎   | Windows 主体已实现并通过运行时 smoke;macOS 尚待真实设备验收,未满足双平台正式完成定义 |
| M2 Windows 命令与设置 | 已完成(显式 Windows 单平台里程碑);Script 执行按 ADR-0005 归 M3                     |
| M3 QuickJS            | 已完成;QuickJS 运行时、Windows 宿主 API 和 Monaco 编辑器已验收                |
| M4 macOS 引擎         | 原生实现与免费 ad-hoc DMG 流水已落地;待真实 Mac 功能、安装和升级验收后正式完成 |
| M5 后端与账户         | 已完成;外部 OAuth 凭证按设计由部署环境提供                                     |
| M6 云同步             | 已完成;桌面账户、原生凭据边界、整库同步、冲突恢复与快照恢复均已接入 Server    |
| M7 Web 控制台与分发   | Web 控制台主体已实现;Updater 和模板分发未实现                                 |
| M8 打磨与发布         | 未开始;安装、提权启动、引导和正式发布尚未验收                                 |

M4 的已知代码、配置和配套文档实现已经结束;当前没有未记录的预定开发任务。所有需要 GitHub macOS runner 或真实 Mac 的剩余验收集中在 `docs/qa/M4_MACOS_SMOKE.md`,安装与免费 DMG 操作见 `docs/MACOS_RELEASE.md`。验收中发现的缺陷须修复并重跑受影响项;清单全部通过、证据落档并将本表更新为“已完成”后,M4 才正式结束。

## 部件地图

| 部件                     | 职责与当前状态                                                                       | 关键入口                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/desktop/src-tauri` | Tauri 生命周期、双平台手势引擎、原生平台能力和本地配置;macOS 待真实设备验收         | `src/lib.rs`, `src/engine/`, `src/platform/windows/`, `src/platform/macos/`           |
| `apps/desktop/src`       | Vue 设置界面、Pinia、本地/Tauri IPC;主要配置页可用,账户同步是 mock                   | `src/App.vue`, `src/views/`, `src/api/backend.ts`                                     |
| `packages/shared`        | 配置、认证、同步 Zod 协议、生成式 API 客户端、容量限制、热键规范化和旧配置导入          | `src/index.ts`, `src/api/`, `src/config/`, `src/auth/`, `src/sync/`, `src/importers/` |
| `apps/server`            | NestJS REST API、Prisma/PostgreSQL、认证、设备、同步、快照                           | `src/app.module.ts`, `src/auth/`, `src/devices/`, `src/sync/`, `prisma/schema.prisma` |
| `apps/web-console`       | 浏览器账户控制台;只读配置、设备、快照、安全                                          | `src/router/index.ts`, `src/api/`, `src/views/`                                       |
| `apps/server` 部署       | 1Panel 手动部署、PostgreSQL、Docker 构建与迁移                                       | `README-DEPLOY.md`, `Dockerfile`, `docker-compose.*.yml`, `.env.example`              |
| `WGestures/`             | WGestures 1.8.5 行为参考克隆,不属于本仓库产品代码                                    | 只用于行为对照,不要修改或纳入提交                                                     |

## Desktop Rust

- `engine/parser.rs` 和 `engine/tracker.rs`:8 向首笔、后续 4 向、最多 12 笔、阈值/超时、点击透传、修饰和捕获状态机。
- `engine/intents.rs`:全局/应用意图选择、继承、黑名单、exe/精确路径/AUMID 匹配优先级。
- `engine/runtime.rs`:钩子输入到识别、覆盖层、捕获事件、暂停、脚本生命周期和命令分发的协调层。
- `engine/script.rs`:单 QuickJS Runtime、按逻辑命令惰性复用的隔离 Context、200 ms 中断、生命周期槽和受限宿主边界。
- `engine/corners.rs`:多显示器触发角/摩擦边状态机;文件头常量、语义和有意偏差是维护契约。
- `engine/config.rs`:Rust 侧共享配置镜像、默认种子、`config.json` 与本机设置持久化;Windows 使用可覆盖既有目标的原子替换。
- `account.rs`:OS 凭据存储、RFC 8252 OAuth 回环监听、本机设备身份和 `sync-state.json` 原子持久化;refresh token 不进入 WebView 持久化。
- `legacy_import.rs` 与 `lib.rs` 的 `legacy_import_apply`:WGestures 双配置批量应用、写命令互斥与进程内回滚。两个独立文件不保证进程被强制终止时的跨文件崩溃原子性。
- `platform/windows/hook.rs`:低级鼠标钩子、模拟输入标记、同步重入 fail-open、FFI panic 边界。
- `platform/windows/startup.rs`:当前用户 SID 任务身份、Task Scheduler COM 对账/快照/所有权、split-token 校验、`runas` 与早期启动模式。
- `platform/windows/overlay.rs`:原生分层窗口轨迹和命令提示;不得改成 WebView 覆盖层。
- `platform/windows/commands.rs`:除 Script 外的命令执行;窗口命令异步排队,外壳窗口受保护。
- `platform/windows/script.rs`:QuickJS 的 Windows 输入、鼠标、窗口和剪贴板宿主实现;脚本不获得原生句柄。
- `app_acquisition.rs` 与 `platform/windows/window.rs`:按下-拖动-释放窗口准星、光标下根窗口身份解析,以及 `.exe`/`.lnk` 应用绑定获取。
- `platform/windows/input.rs`, `keys.rs`, `clipboard.rs`, `window.rs`, `icon.rs`:输入合成、键名、选中文本、窗口信息/AUMID 和图标。
- `platform/macos/hook.rs`:CGEventTap 全局鼠标捕获、同步吞噬、模拟事件标记、超时重启和 FFI panic fail-open。
- `platform/macos/overlay.rs`:主线程 `NSWindow` + `CALayer` 原生覆盖层,tiny-skia 绘制、点击穿透、全 Spaces/全屏辅助和渐隐。
- `platform/macos/input.rs`, `keys.rs`, `clipboard.rs`:键鼠/Unicode/SendKeys/滚轮/热键合成,以及保留 NSPasteboard 的选中文本获取。
- `platform/macos/window.rs` 与 `commands.rs`:CoreGraphics z-order + Bundle ID、带 TTL 的有界窗口 token、AX 窗口操作、Mission Control、文件/URL/Web 搜索、音量和 zsh/Terminal 命令;topmost 显式不支持。
- `platform/macos/script.rs`:QuickJS 的 macOS 输入、窗口、剪贴板和状态宿主实现。
- `platform/macos/permissions.rs` 与 `startup.rs`:Accessibility/Input Monitoring/event-posting 状态、权限请求/设置入口,以及 macOS 13+ `SMAppService` 登录项。
- `app_acquisition.rs`:除 Windows 准星/拖放外,在 macOS 解析准星目标和 `.app` Bundle ID/display name。
- `lib.rs`:Tauri IPC、托盘、暂停快捷键、单实例、窗口隐藏和引擎启动。

## Desktop Vue

- 页面:`OptionsView`, `GesturesView`, `CornersEdgesView`, `AccountView`, `AboutView`;中文/英文均走 vue-i18n。
- `api/backend.ts` 是唯一 Tauri IPC 网关;浏览器运行时自动使用 `api/mock.ts`。
- `stores/config.ts` 负责加载、可取消防抖、串行保存、导入/远端应用 barrier 和即时生效;同步推送前可显式 flush,远端应用期间的新本地编辑不会被覆盖;协议变更必须同步核对 Rust `engine/config.rs`。
- 本机设置通过显式串行更新操作保存,可观察 Task Scheduler/UAC pending 与结构化错误;`rollback_incomplete` 会重读后端状态,文档保存不会清除本机错误。
- Options 在 macOS 显示 Accessibility、Input Monitoring、event posting 与引擎状态,支持请求权限和打开系统设置;本机设置成功后重读运行时状态,保留登录项 `requires approval`。
- `runAsAdmin` 在 macOS 禁用并提供双语说明;后端也会清理旧本机文件可能遗留的 `true`,不伪装成已应用。
- `LegacyImportDialog.vue` 从 Options 提供 WGestures 文件选择、4 MiB 输入限制、256 KiB 输出限制、结构化诊断预览和整库替换;`runAsAdmin` 在导入时保留。
- 手势录制由 `CaptureDialog.vue` 驱动,开始后持续接收捕获,关闭时显式 `capture_cancel`。
- `AppDialog.vue` 通过 `api/backend.ts` 使用窗口准星和 Tauri WebView 拖放;Windows 验证/规范化 `.exe` 并解析 `.lnk`,macOS 在 Bundle ID 分组提供准星和 `.app` 拖放且隐藏 Windows 字段。
- `ScriptEditor.vue` 惰性加载 Monaco、JavaScript/TypeScript worker 和 `script-api/godgesture.d.ts`;五个脚本槽共用编辑器,Lua 只保留高亮和不可执行警告。
- `cloud/` 负责 OpenAPI + Zod 传输校验、内存 access token、refresh 去重/轮换、PKCE、整库同步状态机、3 秒防抖推送、30 分钟拉取、退避和最多 3 次 `409` 拉取重推。
- `stores/account.ts` 与 `AccountView.vue` 已接密码注册/登录、服务端启用的 OAuth 提供方、会话恢复/离线登出、手动同步及配置快照查看/恢复;窄窗口下快照信息与恢复操作保持可达。

## Shared、Server 与 Web

- `packages/shared` 是 TypeScript 协议单一来源,同时发布 ESM、CommonJS 和类型声明。配置格式当前为 `CONFIG_FORMAT_VERSION = 1`;`src/api/generated.ts` 与 `openapi-fetch` 封装提供 OpenAPI 类型化客户端。
- 配置是整库同步文档;本机专属设置不进入同步。容量限制集中在 `config/limits.ts`。
- Server 路由前缀为 `/api/v1`;包含 health、密码注册/登录、刷新/退出、OAuth、设备管理、配置推拉、快照列表/恢复。
- `apps/server/openapi.json` 由 shared Zod Schema 和服务端 HTTP 注册表生成,覆盖 15 条路径/17 个操作;`pnpm generate:api` 更新文档与 shared 类型,`pnpm check:api` 检查漂移。开发环境挂载 Swagger UI,生产环境不挂载。
- OAuth 已实现 GitHub/Google 可配置提供方和 PKCE;微信/QQ 保留配置位并默认不可用。不得按邮箱把 OAuth 自动关联到未验证密码账户。
- 同步使用整库版本、乐观并发、后写胜出和快照;恢复快照也要求版本 CAS。设备删除会撤销其访问。
- Web Console 使用 shared Schema 校验 API 数据,支持密码/OAuth 登录、跨标签刷新协调、只读配置、设备改名/移除和快照恢复。

## 已知未完成边界

- WGestures 导入的 `language = lua` 脚本只保留原文并可编辑,不会执行或自动转换为 JavaScript。
- macOS 原生实现已落地,但尚无真实 Mac 对 TCC 拒绝/授权、输入吞噬与点击透传、X1/X2、Retina 多屏、全屏 Spaces 覆盖层、AX 窗口命令和 Bundle ID 匹配的验收证据。
- GitHub/Google live OAuth 验收仍要求部署环境提供真实客户端凭证;本地已覆盖 PKCE、提供方发现、回环解析与 code exchange 契约。Windows Credential Manager 与 macOS Keychain 由同一 `keyring-rs` 边界承载;真实 macOS Keychain 运行时观察仍需真实 Mac,不改变 M4 的未完成状态。
- Windows `autoStart` 和 `runAsAdmin` 已接 Task Scheduler COM 与 `runas`;macOS `autoStart` 已接 `SMAppService`,`runAsAdmin` 显式不支持。Windows 安装/卸载阶段尚未自动清理遗留任务,移动或删除可执行文件会使任务失效;macOS 登录项仍待真实机器注销/登录验收。
- macOS 免费 ad-hoc universal app/DMG workflow 已配置,无需 Apple Developer 凭证;尚未在 GitHub macOS runner 和真实 Mac 取得架构、DMG、校验和、手动放行及升级权限证据。Developer ID、公证、staple 和无警告 Gatekeeper 启动按 ADR-0011 明确不在完成定义内。Updater、手势模板库、安装包完整验收和快速引导未完成。

## 不得破坏的语义

- PathEnd 按 `executed_on_modifier` 处理。
- 录制持续到前端显式 `capture_cancel`,不是捕获一次自动停止。
- 保留 `corners.rs` 文件头记录的状态机常量、多显示器语义和有意偏差。
- 鼠标键按下时仍喂角/边状态机,只抑制命令分发。
- 不复现 WGestures Bottom 边绝对/局部坐标 bug。
- 外壳窗口不得执行窗口控制命令。
- Windows `SendInput` 可能同步重入鼠标钩子;当前 TLS handler 临时取出、嵌套事件 fail-open 和 FFI panic 防护不得回退。
- QuickJS 必须保持单 Runtime、按逻辑命令惰性隔离 Context;定义改变只重建对应 Context,删除配置时裁剪缓存。内存 64 MiB、栈 256 KiB、单槽 200 ms 上限及锁定宿主对象不得放宽。
- `handleModifiers` 脚本切换时先结束旧脚本再识别新脚本;释放触发键时结束当前脚本,取消和录制模式不运行用户脚本槽。
- macOS CGEventTap 回调必须同步决定事件吞噬、过滤 GodGesture 模拟事件、超时后恢复,且 panic 时 fail-open;AppKit 覆盖层对象只能在主线程访问。
- macOS 窗口目标必须继续使用有界且带 TTL 的不透明 token,不得把未持有的 Objective-C 指针或通用原生句柄暴露给脚本。
- OAuth 不得按未验证密码账户邮箱自动关联。
- Windows 启动任务按当前用户 SID 命名并校验 GodGesture 所有权;不得覆盖同名的非本项目任务,不得改回 `schtasks.exe` 或加入 `uiAccess`。

## 本地开发与运行时 QA

- Node >= 22,pnpm 10,Rust stable;Windows 还需 WebView2。
- 桌面开发固定为 Vite `127.0.0.1:14200`、HMR `14201`、Tauri devUrl `http://127.0.0.1:14200`。旧端口 1420/1421 位于本机排除范围,不得改回。
- 启动 `pnpm dev:desktop` 前先检查 14200 监听者和 GodGesture/Node/Cargo 精确进程树。不要启动第二份会话,不要批量终止 Node/Cargo。
- 开发日志约定:`%TEMP%\godgesture-dev\stdout.log` 和 `%TEMP%\godgesture-dev\stderr.log`。
- 暂停快捷键可能因其他程序占用而出现 `HotKey already registered`;应用仍可启动,但快捷键不可用。
- WebView 曾在窗口关闭命令后记录 `Failed to unregister class Chrome_WidgetWin_0. Error = 1412`;证据不足,先稳定复现再改代码。
- M3 Windows 宿主 smoke 已验证 Context 持久状态、`ReportStatus`、`Input.sendText`、异常恢复、约 200 ms 无限循环中断、修饰生命周期和超时后继续执行;测试文本精确为 `SMOKE1;SMOKE2;RECOVERED;LIFE:gestureRecognized,wheelForward;SMOKE3;`,临时配置、测试模块和进程均已清理。
- 已在真实 Tauri 会话验收 Monaco 行号、JavaScript 诊断和明暗主题同步。中文输入法截获 `Ctrl+Space`,未取得可靠的补全弹窗证据;声明契约测试及 `Input` 无未定义诊断覆盖 API 注入。已运行的提升权限 WGestures 会先消费低完整性合成鼠标事件,因此自动化完整右键手势注入未建立;未终止用户进程,脚本执行路径由上述真实 Windows 宿主 smoke 覆盖。
- M4 Apple 目标已用离线临时检查 crate 在 `aarch64-apple-darwin` 对全部 macOS 模块和应用获取路径执行 `cargo check --tests`;Tauri 合并 macOS 配置后在 Windows 执行 `tauri build --debug --no-bundle` 通过。免费 DMG workflow 的 YAML、无 Apple secrets、触发/权限/架构/校验和检查,以及 macOS JSON 和 plist XML 语法已校验。真实设备验收必须按 `docs/qa/M4_MACOS_SMOKE.md` 逐项记录,配置或交叉编译不能代替观察证据。
- M5 OpenAPI 契约的控制器路由、operationId、组件引用、Bearer 边界和代表性传输已覆盖测试;生成漂移检查通过。生产 Dockerfile 已构建 `linux/amd64` 镜像,确认默认用户为 `node`、启动命令先迁移再启动服务,并在 Linux/CJS 生产依赖树中成功创建生成式 API 客户端;临时验证镜像和容器已清理。
- M6 已用浏览器 Desktop 客户端连接本地真实 Server/PostgreSQL 验收:密码注册/登录后首次推送生成版本 1,本地编辑经 3 秒防抖推送为版本 2,桌面确认恢复版本 1 后推进为版本 3,两个设备并发手动同步经 `409` 拉取重推生成版本 4/5 并收敛到后写整库文档,Server 离线后仍完成本地登出。浅色/暗色、桌面宽度和 `640x800` 窄窗口已截图检查;账户页无翻译键泄漏或横向溢出,窄窗口快照恢复操作可见。一次性 smoke 账户、容器、卷和网络已删除。该 smoke 使用浏览器内存凭据后端,不代替 live OAuth、Windows Credential Manager 或 macOS Keychain 的原生运行时观察。

## 验证基线

从仓库根目录按受影响领域运行,不要为窄改动机械执行全仓测试:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm check:api
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

最近结果:shared 75/75 + typecheck/build;server 86/86 + typecheck/build;`pnpm check:api`;desktop 63/63 + typecheck/build;web-console typecheck/build;prod/dev Compose 结构校验;Rust 146 passed + 1 ignored。Windows Task Scheduler COM 已用唯一测试任务通过 least-privilege 创建/读取/删除 smoke,清理后无测试任务遗留;highest/UAC 仍需人工交互验收。Windows 应用获取已在真实 Tauri 会话验收 Win32 准星选择、自身窗口/Escape 取消、Explorer `.exe`/`.lnk` 拖放和 Shell Link 目标解析;验收后应用保持响应且钩子仍已安装。clippy 唯一允许的既有警告是 `apps/desktop/src-tauri/src/platform/windows/overlay.rs:202 while_let_loop`。

Server 测试中的 `Unhandled Prisma P2002 (OAuthAccount)` 是未知 constraint 映射为 500 的预期日志。Web 构建的 VueUse PURE 注释和大 chunk 警告是既有警告。不要跑全仓 `cargo fmt`;只格式化实际修改的 Rust 文件。

## 新任务接手流程

1. 依次读 `CLAUDE.md`、`CONTEXT.md`、本文、相关 ADR 和 `ROADMAP.md`,再检查 Git 状态与近期提交。
2. 先判断任务影响 Desktop Rust、Desktop Vue、shared、Server、Web Console 或部署中的哪些领域。协议改动必须更新 shared 和所有消费者。
3. Bug 先从现有日志和稳定复现开始;不要仅凭一次观察修改代码。新行为不得与 ADR 或上面的锁定语义静默冲突。
4. 检查是否已有桌面开发会话,保护用户改动,实施最小范围修改,按风险补测试并运行对应验证。
5. 每个领域选择性 `git add <明确路径>` 并独立提交;commit message 用英文。绝不使用 `git add -A`,绝不自动 push。
6. 若任务改变本文记录的事实,在同一领域提交中更新本文;验证数字只有实际重跑后才能更新。

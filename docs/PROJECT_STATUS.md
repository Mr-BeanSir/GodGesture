# GodGesture 当前项目状态

最后核对:2026-08-03。M8 产品与发布基线为 stable `v0.1.0` / `5b81245`;后续文档提交不改变产品行为。从该版本起 GodGesture 作为独立项目演进,新功能由维护者需求驱动,不再以 WGestures 行为作为实现基准。现有 WGestures 配置导入继续作为兼容迁移能力保留。

本文是“当前实际实现”的权威入口。协作与文档路由以 `AGENTS.md` 为准,术语以 `CONTEXT.md` 为准,架构理由按 `docs/adr/README.md` 选择相关 ADR。`docs/ROADMAP.md` 只记录 `v0.1.0` 历史里程碑。功能状态、入口、已知问题或验证基线改变时必须同步更新本文。

## 当前结论

| 里程碑                | 实际状态                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| M0 仓库奠基           | 已完成                                                                        |
| M1 Windows 手势引擎   | Windows 主体已实现并通过运行时 smoke;macOS 尚待真实设备验收,未满足双平台正式完成定义 |
| M2 Windows 命令与设置 | 已完成(显式 Windows 单平台里程碑);脚本执行按历史规划归 M3                      |
| M3 脚本引擎           | 已完成;现役实现已按 ADR-0012 切换为唯一 Node.js 插件运行时                    |
| M4 macOS 引擎         | 原生实现与免费 ad-hoc DMG 流水已落地;待真实 Mac 功能、安装和升级验收后正式完成 |
| M5 后端与账户         | 已完成;外部 OAuth 凭证按设计由部署环境提供                                     |
| M6 云同步             | 已完成;桌面账户、原生凭据边界、整库同步、冲突恢复与快照恢复均已接入 Server    |
| M7 Web 控制台与分发   | 已完成;Web 控制台、签名 Updater、手势模板库与双平台发布流水均已落地           |
| M8 打磨与发布         | 已完成;stable `v0.1.0`、双平台 Release、Windows RC→stable 原生 Updater、快速入门、模板仓库和最终文档均已验收 |

M4 的已知代码、配置和配套文档实现已经结束;当前没有未记录的预定开发任务。所有
需要真实 Mac 的剩余验收（包括 Node 插件真机行为）集中在
`docs/qa/M4_MACOS_SMOKE.md`,安装与免费 DMG 操作见 `docs/MACOS_RELEASE.md`。这些项目
按维护者授权记为 `DEFERRED (owner-approved)`:不阻塞 2026-08-02 的 Node-only 切换,
也不能解释为已通过。验收中发现的缺陷须修复并重跑受影响项;清单全部通过、证据落档
并将本表更新为“已完成”后,M4 才正式结束。

## 部件地图

| 部件                     | 职责与当前状态                                                                       | 关键入口                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/desktop/src-tauri` | Tauri 生命周期、双平台手势引擎、原生平台能力和本地配置;macOS 待真实设备验收         | `src/lib.rs`, `src/engine/`, `src/platform/windows/`, `src/platform/macos/`           |
| `apps/desktop/src`       | Vue 设置界面、Pinia、本地/Tauri IPC;账户与云同步已接真实 Server,浏览器演示使用内存后端 | `src/App.vue`, `src/views/`, `src/cloud/`, `src/stores/account.ts`, `src/api/backend.ts` |
| `packages/shared`        | 配置、认证、同步与手势模板 Zod 协议,生成式 API 客户端、容量限制、热键规范化和旧配置导入 | `src/index.ts`, `src/api/`, `src/config/`, `src/auth/`, `src/sync/`, `src/templates/`, `src/importers/` |
| `apps/server`            | NestJS REST API、Prisma/PostgreSQL、认证、设备、同步、快照                           | `src/app.module.ts`, `src/auth/`, `src/devices/`, `src/sync/`, `prisma/schema.prisma` |
| `apps/web-console`       | 浏览器账户控制台;只读配置、设备、快照、安全                                          | `src/router/index.ts`, `src/api/`, `src/views/`                                       |
| `apps/server` 部署       | 1Panel 手动部署、PostgreSQL、Docker 构建与迁移                                       | `README-DEPLOY.md`, `Dockerfile`, `docker-compose.*.yml`, `.env.example`              |
| `distribution/gesture-templates` | 独立手势模板仓库种子;当前含 2 个低风险模板,生产客户端不读取此目录              | `catalog.json`, `packages/`, `README.md`, `scripts/validate-template-seed.mjs`         |
| Desktop 发布            | Windows x64 NSIS、macOS universal ad-hoc DMG/Updater、确定性 `latest.json`            | `.github/workflows/desktop-release.yml`, `scripts/desktop-release.mjs`, `docs/DESKTOP_RELEASE.md` |

## Desktop Rust

- `engine/parser.rs` 和 `engine/tracker.rs`:8 向首笔、后续 4 向、最多 12 笔、阈值/超时、点击透传、有序输入（笔画/按钮/滚轮）和捕获状态机。
- `engine/intents.rs`:全局/应用意图选择、继承、黑名单、exe/精确路径/AUMID 匹配优先级，以及按有序输入序列匹配。
- `engine/runtime.rs` 与 `engine/boundary.rs`:钩子输入到普通手势/边角序列识别、覆盖层、捕获事件、暂停、Node 插件生命周期和命令分发的协调层;边角序列按前缀匹配并在取消时恢复已暂存输入。
- `engine/script_host.rs`:Node 插件运行时共用的原生宿主 trait、调用上下文、生命周期槽和鼠标按钮类型;不包含 JavaScript 引擎。
- `engine/node_host.rs`、`engine/node_service.rs` 与 `node-host/`:ADR-0012 的常驻 Node supervisor/每插件 Worker、framed JSON IPC、有界非阻塞调用队列和项目物化;`nodePlugin` 命令及五个生命周期是唯一生产脚本执行链。release 只使用随应用分发的固定 Node/pnpm/TypeScript 与类型声明,debug 缺少内置工具链时才允许回退 PATH。
- `engine/corners.rs`:多显示器触发角/摩擦边状态机;文件头常量、语义和有意偏差是维护契约。
- `engine/config.rs`:Rust 侧共享配置镜像、默认种子、`config.json` 与本机设置持久化;Windows 使用可覆盖既有目标的原子替换。
- `account.rs`:OS 凭据存储、RFC 8252 OAuth 回环监听、本机设备身份和 `sync-state.json` 原子持久化;refresh token 不进入 WebView 持久化。
- `updater.rs`:Tauri 原生 Updater 注册、HTTPS endpoint/目标选择、单 pending update、检查/安装互斥、稳定错误和有界进度事件;WebView 不持有下载 URL、签名或原生 update handle。
- `template_download.rs`:GitHub 模板 catalog/package 的原生 HTTPS 文本传输;逐跳验证最多
  5 次重定向、15 秒总超时、固定大小上限、流式超限中止、UTF-8 与稳定错误码,响应
  不落入系统下载目录。
- `legacy_import.rs` 与 `lib.rs` 的 `legacy_import_apply`:WGestures 双配置批量应用、写命令互斥与进程内回滚。两个独立文件不保证进程被强制终止时的跨文件崩溃原子性。
- `platform/windows/hook.rs`:低级鼠标/键盘钩子、模拟输入标记、同步重入 fail-open、FFI panic 边界;快捷键录制期间 `WH_KEYBOARD_LL` 先经有界队列转发到 WebView,再对收到的键盘事件返回非零值尝试阻断系统快捷键,但 Windows 保留组合仍可能由系统优先处理,普通点击在当前钩子回调返回后经有界消息队列重放。
- `platform/windows/startup.rs`:当前用户 SID 任务身份、Task Scheduler COM 对账/快照/所有权、split-token 校验、`runas` 与早期启动模式。
- `platform/windows/overlay.rs`:原生分层窗口轨迹和命令提示;每次唤醒按 64 条命令帧预算
  消费并在队列未清空时先提交脏帧,避免连续鼠标移动造成渲染饥饿;不得改成 WebView
  覆盖层。
- `platform/windows/commands.rs`:除 Node 插件外的命令执行;窗口命令异步排队,外壳窗口受保护。
- `platform/windows/script.rs`:Node 插件的 Windows 输入、鼠标、窗口和剪贴板宿主实现;插件不获得原生句柄。
- `app_acquisition.rs` 与 `platform/windows/window.rs`:按下-拖动-释放窗口准星、光标下根窗口身份解析,以及 `.exe`/`.lnk` 应用绑定获取。
- `platform/windows/input.rs`, `keys.rs`, `clipboard.rs`, `window.rs`, `icon.rs`:输入合成、键名、选中文本、窗口信息/AUMID 和按 exe 名提取 PNG 图标。
- `platform/macos/hook.rs`:CGEventTap 全局鼠标捕获、同步吞噬、模拟事件标记、超时重启和 FFI panic fail-open。
- `platform/macos/overlay.rs`:主线程 `NSWindow` + `CALayer` 原生覆盖层,tiny-skia 绘制、
  点击穿透、全 Spaces/全屏辅助和渐隐;高频命令进入 FIFO pending 队列,同一时刻至多
  一个主线程 drain,每批只栅格化一次。
- `platform/macos/input.rs`, `keys.rs`, `clipboard.rs`:键鼠/Unicode/SendKeys/滚轮/热键合成,以及保留 NSPasteboard 的选中文本获取。
- `platform/macos/window.rs` 与 `commands.rs`:CoreGraphics z-order + Bundle ID、带 TTL 的有界窗口 token、AX 窗口操作、Mission Control、文件/URL/Web 搜索、音量和 zsh/Terminal 命令;topmost 显式不支持。
- `platform/macos/script.rs`:Node 插件的 macOS 输入、窗口、剪贴板和状态宿主实现。
- `platform/macos/permissions.rs` 与 `startup.rs`:Accessibility/Input Monitoring/event-posting 状态、权限请求/设置入口,以及 macOS 13+ `SMAppService` 登录项。
- `platform/macos/icon.rs`:通过 Bundle ID 使用 `NSWorkspace` 定位 `.app`,将 `NSImage`
  转换为 PNG base64;图标只作为本机派生展示数据,不写入配置或同步。
- `app_acquisition.rs`:除 Windows 准星/拖放外,在 macOS 解析准星目标和 `.app` Bundle ID/display name。
- `lib.rs`:Tauri IPC、托盘、暂停快捷键、单实例、窗口隐藏和引擎启动;重复普通启动会唤起既有窗口并发送双语提示事件,重复 `--autostart` 静默退出。

## Desktop Vue

- 页面:`OptionsView`, `GesturesView`, `TemplatesView`, `AccountView`, `AboutView`;中文/英文均走 vue-i18n。触发角与摩擦边已并入手势页,不再有独立页面。
- `App.vue` 使用紧凑工作台壳层和固定导航顺序:手势、手势模板、账户与同步、设置、
  关于;默认页仍为设置。主区不承担页面滚动,五页各自声明唯一
  主滚动区或明确的分区滚动责任。Windows 主窗口在首次显示前移除系统 decorations,
  现有 48px 顶栏提供独立拖动区、最小化和关闭到托盘按钮；macOS 保留原生标题栏。
- `QuickStartDialog.vue` 与 `onboarding/quick-guide.ts` 提供版本化的本机首次引导、平台就绪检查、默认手势试用和既有配置入口;About 可重开,浏览器 `?guide=1` 可强制展示。
- `api/backend.ts` 是唯一 Tauri IPC 网关;浏览器运行时自动使用 `api/mock.ts`。
- `stores/config.ts` 负责加载、可取消防抖、串行保存、导入/远端应用 barrier 和即时生效;同步推送前可显式 flush,远端应用期间的新本地编辑不会被覆盖;协议变更必须同步核对 Rust `engine/config.rs`。
- 本机设置通过显式串行更新操作保存,可观察 Task Scheduler/UAC pending 与结构化错误;`rollback_incomplete` 会重读后端状态,文档保存不会清除本机错误。
- Options 在 macOS 显示 Accessibility、Input Monitoring、event posting 与引擎状态,支持请求权限和打开系统设置;本机设置成功后重读运行时状态,保留登录项 `requires approval`。
- `runAsAdmin` 在 macOS 禁用并提供双语说明;后端也会清理旧本机文件可能遗留的 `true`,不伪装成已应用。
- `LegacyImportDialog.vue` 从 Options 提供 WGestures 文件选择、4 MiB 输入限制、4 MiB 输出限制、结构化诊断预览和整库替换;`runAsAdmin` 在导入时保留。
- 手势录制由 `CaptureDialog.vue` 驱动,开始后持续接收捕获,关闭时显式 `capture_cancel`;捕获协议保留触发键之后的有序输入步骤（笔画、鼠标按钮和滚轮），并可从旧 `strokes + modifier` 字段迁移。`HotkeyInput.vue` 的键盘快捷键录制使用独立草稿:新和弦替换旧值,支持 Ctrl/Win(Cmd)/Alt 等纯修饰组合,最后一个物理键抬起时自动提交,Escape 或未完成失焦则取消。Windows 桌面录制时先订阅 `hotkey-capture` 再启用低级键盘钩子,DOM 事件仅阻止冒泡;取消、失焦和组件卸载均释放原生捕获,macOS/浏览器预览保留 WebView 路径。
- `AppDialog.vue` 通过 `api/backend.ts` 使用窗口准星和 Tauri WebView 拖放;Windows 验证/规范化 `.exe` 并解析 `.lnk`,macOS 在 Bundle ID 分组提供准星和 `.app` 拖放且隐藏 Windows 字段。
- `AppIcon.vue` 通过平台中立 `app_icon` IPC 显示本机应用图标;全局应用使用打包的
  GodGesture 图标,解析失败显示可访问的问号 SVG。请求与失败结果按平台身份在进程内
  去重缓存,不进入 `ConfigDocument`、模板、快照或云同步。
- `GesturesView.vue` 使用固定白色应用列表 + 动作表格 + 编辑器工作台;全局应用同时显示普通手势与边角动作,具体应用只显示普通手势。普通手势编辑器提供独立修饰符选择器与帮助提示,禁用和触发键相同的按钮,重新录制基础输入时保留修饰符。`AddActionDialog.vue` 提供两步新增流程,在同一个屏幕选择器中显示全部四角和四边,并构建最多 12 步的边角序列;触发角/摩擦边开关位于全局应用标题区。三个区域分别持有滚动职责,Element Plus 表格有真实有界高度,`800x560` 下四列、行操作和新增按钮保持可见。
- `ScriptEditor.vue` 惰性加载 Monaco、JavaScript/TypeScript worker、完整 Node/undici 声明与 GodGesture SDK 声明;JavaScript 开启触发字符补全、快速建议和参数提示,溢出提示固定到顶层 widget 避免被编辑面板裁剪。Node 声明独立分块,不进入主界面首屏 chunk。`NodePluginEditor.vue` 支持依赖增改删、精确 lockfile 准备、manifest/lockfile 结构化 diff、用户主动 `tsc` typecheck 和有界 Problems/Output 面板。
- `cloud/` 负责 OpenAPI + Zod 传输校验、内存 access token、refresh 去重/轮换、PKCE、整库同步状态机、3 秒防抖推送、30 分钟拉取、退避和最多 3 次 `409` 拉取重推。
- `stores/account.ts` 与 `AccountView.vue` 已接密码注册/登录、服务端启用的 OAuth 提供方、会话恢复/离线登出、手动同步及配置快照查看/恢复;窄窗口下快照信息与恢复操作保持可达。
- `templates/` 与 `stores/templates.ts` 通过 Backend 调用 Tauri 原生受限下载器,再对不可信
  GitHub catalog/package 执行 shared Schema、身份、目标和风险校验;浏览器 preview 继续
  使用 fixture。模板详情提供冲突策略、风险确认和纯规划,再经 `stores/config.ts` 整库
  原子 barrier 采纳。
- `stores/update.ts` 与 `AboutView.vue` 提供手动/偏好控制的延迟自动检查、去重、稳定错误、下载进度和安装前配置 flush;自动检查不下载或安装。

## Shared、Server 与 Web

- `packages/shared` 是 TypeScript 协议单一来源,同时发布 ESM、CommonJS 和类型声明。配置格式当前为 `CONFIG_FORMAT_VERSION = 5`,`nodePlugins` 项目集合与 `nodePlugin` 是唯一脚本协议;v1-v4 的结构字段可迁移到 v5,但旧 `script` 和 Pause 命令不再属于有效配置且不会自动执行。普通手势的 `GestureSpec.inputs` 保存触发键之后的有序笔画、按钮和滚轮步骤,独立 `modifier` 在基础输入匹配后立即且可重复执行；旧 `strokes + modifier + executeOnModifier` 只在迁移时解释。全局 `boundaryIntents` 与普通手势意图都支持默认启用、可单条关闭的 `enabled`;旧配置缺字段时保持启用。读取 v1 时会把旧触发角/摩擦边命令稳定迁移为空序列边角动作。手势模板是独立分发协议,采纳后才并入个人配置。`src/api/generated.ts` 与 `openapi-fetch` 封装提供 OpenAPI 类型化客户端。
- 配置是整库同步文档;本机专属设置不进入同步。容量限制集中在 `config/limits.ts`。
- Server 路由前缀为 `/api/v1`;包含 health、密码注册/登录、刷新/退出、OAuth、设备管理、配置推拉、快照列表/恢复。
- `apps/server/openapi.json` 由 shared Zod Schema 和服务端 HTTP 注册表生成,覆盖 15 条路径/17 个操作;`pnpm generate:api` 更新文档与 shared 类型,`pnpm check:api` 检查漂移。开发环境挂载 Swagger UI,生产环境不挂载。
- OAuth 已实现 GitHub/Google 可配置提供方和 PKCE;微信/QQ 保留配置位并默认不可用。不得按邮箱把 OAuth 自动关联到未验证密码账户。
- 同步使用整库版本、乐观并发、后写胜出和快照;文档上限为 4 MiB,快照同时限制最新 100 个和每用户 64 MiB 正文。恢复快照也要求版本 CAS。设备删除会撤销其访问。
- Web Console 使用 shared Schema 校验 API 数据,支持密码/OAuth 登录、跨标签刷新协调、只读配置、设备改名/移除和快照恢复。

## 已知未完成边界

- WGestures 导入遇到旧 `ScriptCommand` 时产生结构化不支持告警并降级为“什么也不做”;不保留、执行或转换旧 Lua/JavaScript 源码。
- macOS 原生实现已落地,但尚无真实 Mac 对 TCC 拒绝/授权、输入吞噬与点击透传、X1/X2、Retina 多屏、全屏 Spaces 覆盖层、AX 窗口命令、Bundle ID 匹配和应用图标提取的验收证据。
- 边角序列匹配与输入恢复已同时接入 Windows 和 macOS 源码;普通手势同样按有序输入序列匹配，Windows Rust 测试覆盖按钮、滚轮和方向序列,但 Windows 真实桌面代表性序列及 macOS 真机行为仍待观察验收。
- 带后续序列的摩擦边动作在光标进入边缘带后直接等待输入;滚轮事件会按当前指针位置即时武装,不要求滚动前再次移动。空序列摩擦边仍保持快速往复命中。Windows 平台无关运行时测试覆盖下边缘首格滚轮和停留后重新武装;macOS 复用同一状态机,仍需真机观察。
- 手势工作台支持普通手势和边角动作的单条启停;列表仅保留状态图标,删除与重录/编辑序列集中在助记符下方的独立操作行。边角助记符先绘制灰色屏幕边框、再在上层绘制蓝色命中边;角触发使用蓝色拐角及相邻边段,边角序列可通过拖拽把手快速排序。
- 音量命令的 `delta` 范围为 `-20..20`:正数提高、负数降低、零切换静音;滚轮输入方向决定加减方向并使用绝对值作为步数。Windows 与 macOS 共用同一平台无关判定,不再出现普通触发忽略配置数值而总是静音的语义漂移。
- GitHub/Google live OAuth 验收仍要求部署环境提供真实客户端凭证;本地已覆盖 PKCE、提供方发现、回环解析与 code exchange 契约。Windows Credential Manager 与 macOS Keychain 由同一 `keyring-rs` 边界承载;真实 macOS Keychain 运行时观察仍需真实 Mac,不改变 M4 的未完成状态。
- Windows `autoStart` 和 `runAsAdmin` 已接 Task Scheduler COM 与 `runas`;macOS `autoStart` 已接 `SMAppService`,`runAsAdmin` 显式不支持。Windows 安装/卸载阶段尚未自动清理遗留任务,移动或删除可执行文件会使任务失效;macOS 登录项仍待真实机器注销/登录验收。
- stable `v0.1.0` 已由 GitHub Actions 同版本发布 Windows x64 NSIS 与 macOS universal ad-hoc DMG/Updater;公开 checksum、minisign、manifest/evidence、x64 PE、universal slices、strict ad-hoc codesign 和 DMG runner 校验均通过。Windows 已从已安装 RC.2 经原生 Updater 下载、验签、覆盖安装并重启至 stable。真实 Mac 的 Gatekeeper 手动放行、TCC、手势运行时和已安装升级仍按 owner 授权记为 `DEFERRED (owner-approved)`,不能解释为通过。Developer ID、公证、staple、Authenticode 和无警告首次启动不在当前分发模型内。
- 独立 `Mr-BeanSir/gesture-templates` 公共仓库已发布 `v1.0.0`;catalog 与两个 package 的 production URL、SHA-256、Schema、身份、目标和风险已实时验证。种子仍位于 `distribution/gesture-templates`,自建 Server 不得代理该内容。

## 不得破坏的语义

- PathEnd 只匹配未配置独立修饰符的手势。基础输入匹配后,每次独立修饰符触发立即执行且保持捕获；触发键释放只结束捕获,不再次执行该修饰符动作。未命中的按钮或滚轮继续作为基础有序输入处理,滚轮保持 100 ms 节流。
- 录制持续到前端显式 `capture_cancel`,不是捕获一次自动停止。
- 保留 `corners.rs` 文件头记录的状态机常量、多显示器语义和有意偏差。
- 鼠标键按下时仍喂角/边状态机,只抑制命令分发。
- Bottom 摩擦边保持当前全局坐标语义,不得混用局部坐标。
- 外壳窗口不得执行窗口控制命令。
- Windows `SendInput` 可能同步重入鼠标钩子;当前 TLS handler 临时取出、嵌套事件 fail-open 和 FFI panic 防护不得回退。
- Node 插件事件必须继续使用有界非阻塞队列并按插件串行;Worker 超时/崩溃后重建并重跑 `init`,supervisor 退出后由服务恢复,原生输入钩子不得等待插件执行。
- macOS CGEventTap 回调必须同步决定事件吞噬、过滤 GodGesture 模拟事件、超时后恢复,且 panic 时 fail-open;AppKit 覆盖层对象只能在主线程访问。
- macOS 窗口目标必须继续使用有界且带 TTL 的不透明 token,不得把未持有的 Objective-C 指针或通用原生句柄暴露给脚本。
- OAuth 不得按未验证密码账户邮箱自动关联。
- Windows 启动任务按当前用户 SID 命名并校验 GodGesture 所有权;不得覆盖同名的非本项目任务,不得改回 `schtasks.exe` 或加入 `uiAccess`。

## 本地开发与运行时 QA

- Node >= 22,pnpm 10,Rust stable;Windows 还需 WebView2。
- 桌面开发首选 Vite `127.0.0.1:14200`、HMR `14201`;`pnpm dev:desktop` 会按连续端口对自动选择两个都可用的组合,并用同一次结果覆盖 Tauri devUrl。Vite 保持 `strictPort`,预检后的竞争占用会明确失败。旧端口 1420/1421 位于本机排除范围,不得改回。
- 启动器不终止端口占用者。完整 GodGesture 实例已存在时,Tauri 单实例裁决会停止新实例并唤起既有窗口;不要批量终止 Node/Cargo。
- 开发日志约定:`%TEMP%\godgesture-dev\stdout.log` 和 `%TEMP%\godgesture-dev\stderr.log`。
- 暂停快捷键可能因其他程序占用而出现 `HotKey already registered`;应用仍可启动,但快捷键不可用。
- WebView 曾在窗口关闭命令后记录 `Failed to unregister class Chrome_WidgetWin_0. Error = 1412`;证据不足,先稳定复现再改代码。
- 已在真实 Tauri 会话验收 Monaco 行号、JavaScript 诊断和明暗主题同步。Desktop 开发服务直接消费 shared 源码,Monaco 深层入口不参与 Vite 依赖预构建并复用同一模块实例,避免 JavaScript 模型静默退化为纯文本。浏览器 preview 与声明契约测试覆盖 `node:`、`@godgesture/sdk`、`context.input` 补全和语法诊断;自动化完整右键手势注入未建立,脚本执行路径由 Windows Node 宿主 smoke 覆盖。
- 2026-07-29 Windows 右键点击恢复修复:未形成手势时不再于低级钩子回调内嵌套 `SendInput`,而是在回调返回后由钩子线程消息泵重放完整点击;维护者在真实桌面确认右键抬起后已无明显感知延迟。已有 Vite-only 会话占用 `14200/14201` 时,真实 Tauri 开发会话自动使用 `14202/14203` 并连接成功。重复运行同一 debug 构建时第二进程以 0 退出,前后均仅一个 `godgesture.exe`,既有窗口已唤起;双语 toast 事件由 Desktop 测试覆盖,受本机窗口捕获接口限制未取得实机视觉证据。
- 2026-07-29 原生轨迹调度修复:Windows 覆盖层不再清空无界 channel 后才绘制,
  单次唤醒最多消费 64 条命令,有剩余工作时重新唤醒;macOS 使用 FIFO pending 队列、
  单 scheduled drain 和每批一次 render。Windows 全库测试 158 passed + 1 ignored,
  clippy `-D warnings` 通过。该提交只解决连续输入下的渲染饥饿,后续连续路径、覆盖层
  Z-order 和跨屏语义由 2026-07-30 的后续修复完成。
- 2026-07-30 原生轨迹与多屏覆盖修复:Windows 复用长期 DIB、局部 scratch 和完整 path
  重绘,单 wake pending、FIFO 及每批 4096 条命令避免 wake storm 和分节圆帽;可视点上限
  取 `512 × DPI` 与虚拟桌面可遍历距离两者较大值。Windows 使用完整虚拟桌面共享 DIB,
  每台显示器由两个非全屏 `WS_EX_TOPMOST` 分层窗口切片显示,轨迹可跨任意显示器并覆盖
  任务栏,同时不触发 Explorer 的全屏任务栏 Z-order 调整;命令提示仍锚定手势起点屏幕。
  维护者已在真实双屏桌面确认轨迹跟手且连续、任务栏保持压住普通应用、轨迹位于任务栏
  之上,并确认 A→B 与 B→A 跨屏轨迹连续。macOS 同步改为活动显示器联合边界并保留
  全局坐标;Apple target 已由 macOS CI 编译,仍需真实 Mac 对混合 DPI 多屏完成验收。
- 2026-07-29 模板网络路径修复:生产 catalog/package 不再由 WebView `fetch`,而是经
  `download_template_text` 原生 IPC 使用 reqwest/rustls 读取。真实联网 smoke 在
  4.56 秒内通过 GitHub Release production catalog 和两个 package 的受限重定向、JSON
  与 slug/version 身份核对,请求未打开浏览器或系统下载器。
- 2026-07-29 应用图标与工作台刷新:真实 Tauri 开发会话自动选择 `14204/14205`,
  debug 二进制已重新编译启动。Windows 本机定向 smoke 确认 `explorer.exe` 与
  `chrome.exe` 都返回 PNG base64;全局图标和问号回退由前端实现与测试覆盖。浏览器
  preview 对六页分别以 `800x560` 英文深色和 `980x700` 中文浅色完成 DOM 溢出检查,
  并对手势、模板、触发角等代表页截图;另以 `800x560` 中文浅色复核手势三分区。
  主区和侧栏均无横向溢出、翻译 key 泄漏或滚动争用。Windows Graphics Capture 的
  `SetIsBorderRequired` 在本机不受支持,因此未取得真实 Tauri 窗口自动截图;不影响
  原生 IPC smoke。macOS 图标运行行为仍需真实 Mac 验收。
- M4 Apple 目标已用离线临时检查 crate 在 `aarch64-apple-darwin` 对全部 macOS 模块和应用获取路径执行 `cargo check --tests`;Tauri 合并 macOS 配置后在 Windows 执行 `tauri build --debug --no-bundle` 通过。免费 DMG workflow 的 YAML、无 Apple secrets、触发/权限/架构/校验和检查,以及 macOS JSON 和 plist XML 语法已校验。真实设备验收必须按 `docs/qa/M4_MACOS_SMOKE.md` 逐项记录,配置或交叉编译不能代替观察证据。
- M5 OpenAPI 契约的控制器路由、operationId、组件引用、Bearer 边界和代表性传输已覆盖测试;生成漂移检查通过。生产 Dockerfile 已构建 `linux/amd64` 镜像,确认默认用户为 `node`、启动命令先迁移再启动服务,并在 Linux/CJS 生产依赖树中成功创建生成式 API 客户端;临时验证镜像和容器已清理。
- M6 已用浏览器 Desktop 客户端连接本地真实 Server/PostgreSQL 验收:密码注册/登录后首次推送生成版本 1,本地编辑经 3 秒防抖推送为版本 2,桌面确认恢复版本 1 后推进为版本 3,两个设备并发手动同步经 `409` 拉取重推生成版本 4/5 并收敛到后写整库文档,Server 离线后仍完成本地登出。浅色/暗色、桌面宽度和 `640x800` 窄窗口已截图检查;账户页无翻译键泄漏或横向溢出,窄窗口快照恢复操作可见。一次性 smoke 账户、容器、卷和网络已删除。该 smoke 使用浏览器内存凭据后端,不代替 live OAuth、Windows Credential Manager 或 macOS Keychain 的原生运行时观察。
- M7 已在浏览器 Desktop preview 验收模板列表、About Updater 状态和模板详情/采纳对话框:覆盖中文/英文、深色/浅色、`980x700` 与最小 `800x560`;无页面横向溢出、翻译 key 泄漏、对话框越界或不可达采纳操作。该观察使用确定性 mock,不代替 M8 的真实 GitHub Release 与已安装升级 smoke。
- M7 发布合同已静态校验 workflow 触发器、最小权限、签名 Secrets、无 Apple 凭据、平台/资产名、checksum、tag/version gate 与 release 条件;fixture 装配出的 `latest.json` 在双次独立输入间字节一致。此证据不代替 GitHub runner 的真实产物。

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

2026-07-29 M7 最终交接复核重跑结果:shared 90/90 + build;desktop 83/83 + typecheck/build;Rust 152 passed + 1 ignored;2 个模板种子验证通过;发布脚本 8/8 且 workflow 静态合同通过;`git diff --check 06374ac..HEAD` 通过。未受 M7 影响的最近基线保持为 server 86/86 + typecheck/build、`pnpm check:api`、web-console typecheck/build 和 prod/dev Compose 结构校验。Windows Task Scheduler COM 已用唯一测试任务通过 least-privilege 创建/读取/删除 smoke,清理后无测试任务遗留;highest/UAC 仍需人工交互验收。Windows 应用获取已在真实 Tauri 会话验收 Win32 准星选择、自身窗口/Escape 取消、Explorer `.exe`/`.lnk` 拖放和 Shell Link 目标解析;验收后应用保持响应且钩子仍已安装。clippy 唯一允许的既有警告是 `apps/desktop/src-tauri/src/platform/windows/overlay.rs:202 while_let_loop`;Desktop build 仍只有既有 VueUse PURE 注释和大 chunk 警告。

2026-07-29 M8 最终验证:shared 90/90 + build;Desktop 88/88 + typecheck/build;发布脚本 10/10 且 workflow 静态合同通过;2 个模板种子验证通过;Rust 全库 152 passed + 1 ignored;clippy 仅既有 `overlay.rs:202 while_let_loop`。快速入门已在中文/英文、明/暗主题、`980x700`/`800x560` 和全部三步组合下完成 24 组浏览器截图与 DOM 验收。模板仓库 `v1.0.0` 的三个 production URL 已通过实时内容和协议验证。RC.2 run `30435122047` 和 stable run `30437621772` 均成功;stable 的 Windows/macOS Rust cache 均 exact hit,总时长由 RC.2 冷构建 14m17s 降至 6m53s。公开 stable 10 个用户资产已独立下载并通过 checksum、minisign、PE/Mach-O、app/DMG 与 evidence 校验;Windows RC.2→stable 原生 Updater 已保留配置 hash、9 条手势、本机设置、托盘设置和快速入门 dismissal。完整证据见 `docs/qa/M8_RELEASE_ACCEPTANCE.md`。

2026-07-29 Windows 输入与启动可靠性验证:动态端口启动器 4/4;Desktop 89/89 + typecheck/build;Rust 全库 155 passed + 1 ignored,Windows hook 队列定向 5/5;clippy 仅既有 `overlay.rs:202 while_let_loop`。真实运行验证结果见上方本地开发与运行时 QA 条目。

2026-07-29 原生轨迹调度定向验证:Windows overlay 新增 3 个批次预算/FIFO/断连测试;
Rust 全库 158 passed + 1 ignored;`cargo clippy --lib -- -D warnings` 通过。macOS target
交叉检查在第三方 C 依赖构建阶段因本机缺少 Apple `cc` 工具链停止,不计作 macOS
编译通过。

2026-07-29 原生模板下载验证:Rust 全库 162 passed + 2 ignored,其中 production GitHub
smoke 已单独以 `--ignored --exact` 运行并通过;clippy `-D warnings` 通过。shared 90/90
+ build;Desktop 92/92 + typecheck/build。Desktop build 仍只有既有 VueUse PURE 注释和
大 chunk 警告。

2026-07-29 应用图标与工作台刷新验证:Desktop 95/95 + typecheck/build;Rust 全库
162 passed + 2 ignored;`cargo clippy --lib -- -D warnings` 通过。Windows 本机通过
一次性定向 smoke 确认 Explorer 与 Chrome 图标均为 PNG base64。六页以
`800x560` 英文深色、`980x700` 中文浅色两组代表性组合完成 DOM 溢出矩阵,
并对关键页面截图;手势页另在 `800x560` 中文浅色复核三分区布局。
Desktop build 仍只有既有 VueUse PURE 注释和大 chunk 警告。macOS target 检查因本机
缺少 Apple `cc` 在第三方 C 依赖阶段停止,不计作 macOS 编译通过。

2026-07-30 原生轨迹与多屏覆盖验证:Windows Rust library `176 passed, 2 ignored`;
`cargo clippy --lib --no-default-features -- -D warnings`、定向 rustfmt 和
`git diff --check` 通过。自动测试覆盖完整 path 的逐点像素等价、自交、脏区域、FIFO、
可视点上限、上下堆叠与左右错位显示器、窗口切片接缝及任务栏带状区域。Windows 实机
验收覆盖连续轨迹、任务栏层级、任务栏上方轨迹以及双向跨屏。macOS 仅完成源码同步和
联合显示器边界测试代码,Windows 未执行该平台测试,不提供 Apple 编译或真机证据。

2026-07-30 统一动作与快捷键录制验证:shared 92/92 + build;Desktop 103/103 +
typecheck/build;`pnpm check:api`、Server typecheck、Web Console typecheck 通过;Rust library
`185 passed, 2 ignored`,`cargo clippy --lib --no-default-features -- -D warnings` 通过。
浏览器 preview 以 `800x560` 中文浅色和 `980x700` 英文深色验收手势页与两步新增动作
对话框,确认白色应用列表、无横向溢出、翻译 key 泄漏或对话框越界;八个边角起点
在同一屏幕选择器中显示。另以 Vue reactive 序列回归测试和浏览器“下边缘 + 滚轮向前”
完整保存流程确认提交不会再触发 `DataCloneError`。macOS 边角序列仍按上方未完成边界
等待真机证据。

2026-07-30 动作编辑与命令语义验证:shared 94/94 + typecheck;Desktop 104/104 +
typecheck/build;`pnpm check:api` 通过;Rust library `188 passed, 2 ignored`,
`cargo clippy --lib --tests -- -D warnings` 通过。浏览器 preview 确认普通手势操作行位于
助记符下方,脚本编辑器在切换命令类型后保持编辑面板有界宽度;边角 SVG 通过 DOM 结构
确认灰框先绘制、蓝色边/拐角后绘制且不再使用角点 circle。Monaco 已加载 JavaScript
worker、宿主声明、触发字符补全、快速建议和参数提示;应用内浏览器的自动输入桥接未能
稳定取得补全弹窗截图,因此不把该自动化限制记录为真实桌面视觉验收。

2026-07-31 音量与脚本编辑修复:音量命令的数值统一解释为准确百分点,Windows 使用
Core Audio 读取并设置默认输出端点,macOS 使用系统音量百分比,`0` 仍切换静音;负数可
保存并表示降低音量,滚轮输入仍按滚动方向使用绝对值。Desktop 开发服务直接消费 shared
源码,Monaco 编辑器贡献、JavaScript 定义与 TypeScript provider 共享同一语言注册表。
浏览器 preview 已确认 `-1` 保存后保持不变,并确认 `Input.` 补全包含全部 8 个宿主方法、
明显语法错误产生诊断标记。shared `95/95` + typecheck;Desktop `105/105` +
typecheck/build;`pnpm check:api` 通过;Rust library `189 passed, 2 ignored`,
`cargo clippy --lib --tests -- -D warnings` 通过。

2026-07-31 Node 脚本宿主性能原型:Windows release 模式使用系统 Node `v22.13.0`
运行常驻 supervisor 与预加载 Worker,真实加载 `node:path`、`process`、全局 `fetch`
并完成一次 `Input.sendText` 宿主往返。10,000 次热态空处理为 p95 `0.140 ms`、
p99 `0.199 ms`;10,000 次宿主调用为 p95 `0.246 ms`、p99 `0.320 ms`;冷启动并加载
Worker 为 `83.2 ms`。定向测试 `5 passed, 1 ignored` 覆盖分帧、超限、Node API、
宿主调用、顺序、协议错误、超时和 Worker 崩溃后重载;显式 release gate 通过,
`cargo clippy --lib --tests -- -D warnings` 通过。该证据只满足当时的 Windows 原型门槛。

2026-07-31 Node 插件配置协议:shared 配置升级至 v3,新增最多 32 个 Node 插件、
每插件最多 64 个文件、单文件 256 KiB、源码合计 1 MiB、manifest 64 KiB 和 lockfile
512 KiB 限制;同步文档上限提高至 4 MiB,Server 快照按最新 100 个及每用户 64 MiB
正文双重裁剪。shared `99/99` + build;Desktop `105/105` + typecheck/build;Server
`87/87` + typecheck;Web Console typecheck/build;`pnpm check:api`;Rust library
`194 passed, 3 ignored`,`cargo clippy --lib --tests -- -D warnings` 通过。

2026-07-31 Node 插件生产宿主接线:同步插件被校验后按内容修订物化为真实 ESM 项目,
常驻 supervisor 为每插件预载 Worker;手势执行线程只向 256 条有界队列投递,Node
执行、宿主调用和超时均不阻塞输入钩子或原生命令。`init`、`execute`、
`gestureRecognized`、`modifierTriggered`、`gestureEnded` 已接入,相对导入、完整 Node API、
`fetch`、输入/窗口/剪贴板/状态异步 API、每插件顺序、可选生命周期、Worker 超时/崩溃
重建和重建后自动 `init` 均由真实 Node 测试覆盖。新增 `@godgesture/sdk` 类型与运行时
helper 包。Windows release 新基准:冷启动 `96.786 ms`,noop p95/p99 `0.152/0.223 ms`,
包含输入、剪贴板和状态三次真实宿主往返的 handler p95/p99 `0.495/0.640 ms`。
shared `99/99`;Desktop `105/105`;SDK `1/1` + typecheck/build;Rust library
`196 passed, 3 ignored`,严格 clippy 通过。

2026-07-31 Node 内置工具链与依赖准备:发布资源固定为 Node `v24.18.1` LTS 与
pnpm `10.34.5`,下载脚本校验官方 SHA-256/SHA-512 后按 Windows x64、macOS x64 和
macOS arm64 填充 Tauri resource。release 缺少内置工具链时稳定失败,不读取 PATH;
插件仅在物化新修订时使用独立 pnpm store 执行离线、精确锁文件、生产依赖安装,
生命周期脚本默认禁用并可按插件显式允许。工具链脚本合同 `3/3`,release 静态合同
`10/10`,Rust 定向编译与测试通过。手势触发路径不会安装依赖或访问网络。

2026-07-31 Node 插件工作区:手势命令编辑器可创建、选择并绑定 Node 插件及 handler
export;工作区支持插件名称、多源文件新增/删除/入口切换、Monaco 源码与 `package.json`
编辑、精确 lockfile 和生命周期脚本批准。布局按编辑器容器宽度响应,在 `980x700`
中文与 `800x560` 英文浏览器 preview 中完成新增文件、切换文件、自动保存和 DOM
溢出检查,无横向溢出或翻译 key 泄漏。Desktop `106/106` + typecheck/build,
`git diff --check` 通过。

2026-07-31 Node 依赖工作区:Node 插件编辑器增加内联依赖增改删、manifest 校验、用户主动
lockfile 解析/离线生产安装和入口 import smoke;Rust 通过同一内置 Node/pnpm 工具链执行,
输出限制 128 KiB、单命令超时 120 秒,并把 `@godgesture/sdk` 内置运行时写入物化插件。
Windows/macOS 共用 Tauri IPC,浏览器 mock 可演示保存 lockfile、Problems 和 Output。Desktop
`114/114` + typecheck/build;Rust library `200 passed, 3 ignored`;严格 clippy 通过。
依赖搜索与更新建议由后续 Node 插件工具链补齐。

2026-07-31 Node macOS 性能门槛接线:`macOS CI` 使用与产品工具链一致的 Node
`v24.18.1`,以 release 模式运行 10,000 次有序 no-op 和 10,000 次代表性宿主调用,
断言批准的 p95/p99 上限并上传包含系统、架构、Node 版本和百分位结果的 30 天日志
artifact。`docs/qa/M4_MACOS_SMOKE.md` 已增加物理 Mac 上的同一性能测试、首手势热态、
Node/fetch/SDK、精确锁文件离线重建、Worker 与 supervisor 恢复验收。

2026-08-01 Node 插件工具链:编辑器通过受限原生网关搜索 npm 包和读取 latest dist-tag,
可将搜索结果加入 manifest、以最多 4 路并发检查并采用最新版;网关固定 npm 官方 HTTPS
origin、禁止重定向、限制 15 秒和 256 KiB,并过滤包名及截断说明。新增真实 Node handler
dry-run,完整加载 ESM、Node API、`fetch` 和已锁定依赖,同时把输入、窗口、剪贴板与状态
宿主调用记录为无副作用输出;有外部依赖但没有 lockfile 时明确拒绝,已有 lockfile 只执行
离线 frozen install,测试过程不会隐式解析或修改依赖。Desktop `116/116` + typecheck/build;
Rust library `204 passed, 3 ignored`,严格 clippy、cargo check 和 `git diff --check` 通过。
浏览器 preview 已确认搜索/添加 `zod 4.4.3`、无误报更新检查、无副作用 dry-run Output,
以及 `800x560` 无横向溢出。

2026-08-01 Node 插件多文件编辑器:插件源码编辑器现在为每个文件保留稳定 Monaco model,
使用插件 ID 与文件路径组成的 URI,并通过隐藏 model 同步所有源文件,使相对导入能够参与
TypeScript worker 的跨文件诊断;可见编辑区提供文件标签页。Desktop `119/119` + typecheck/
build 通过。浏览器刷新本地预览本轮被 URL 安全策略拒绝,未将旧页面观察计入视觉验收。

2026-08-01 Node 脚本文档:新增 `docs/SCRIPTING.md`,说明 Node 插件项目结构、完整
Node/fetch 能力、五个生命周期、`PluginContext`/SDK API、npm 搜索与精确 lockfile、
离线缓存、dry-run、恢复、分发与信任边界。文档契约测试覆盖 SDK 方法、生命周期、
窗口操作和容量边界,Desktop `117/117` + typecheck、`git diff --check` 通过。设计中的
本机缓存 readiness 已补为只读原生状态:复用 production revision fingerprint、`.ready`
标记和内置 SDK 文件,区分无需缓存、缺锁文件、未准备与已就绪;“生成锁文件并准备”
成功后会直接物化同一 production revision。编辑器已显示本次会话的 manifest 修改、
lockfile 是否过期和当前缓存状态;完整结构化 manifest/lockfile diff 与独立 `tsc`
子进程输出尚未实现。Monaco `checkJs`、Node/SDK 类型和 JSON marker 已接入 Problems,
按文件、行和列显示。

2026-08-01 macOS CI 触发复核:通过 GitHub Actions 页面触发的 run `30700761547` 使用远端
旧 `main` 提交 `5b81245`,在 42 秒后因旧 workflow 检查失败结束,未执行本地新增的 Node
性能 gate,也没有性能 artifact。当前本地 Node 迁移提交尚未 push,因此该 run 不构成 macOS
性能或 Node-only 证据。

2026-08-01 macOS CI 最新提交复核:run `30705019857` 已在 `19cec77` 上执行,但 Desktop
typecheck 因 workflow 未先构建 `@godgesture/shared` 的 `dist` 入口失败,因此仍未进入
Node 性能 gate,也没有性能 artifact。workflow 已在依赖安装后增加
`pnpm --filter @godgesture/shared build`;本地按相同顺序重跑 shared build、Desktop
`123/123`、typecheck、build 和 `git diff --check` 均通过,待推送该 workflow 修复后重跑。

2026-08-01 macOS CI Rust gate 复核:run `30705419543` 已确认 workflow 的 shared build
与 Desktop frontend 均通过,但 `Test native Rust target` 在 macOS `-D warnings` 下因
macOS 图标弃用 API/未使用导入、非 Windows 旧导入事务辅助、以及剪贴板 Clippy lint
失败(12 个诊断,无测试失败);Node 性能 gate、双架构检查和性能 artifact 因此未执行。
已改用 `NSBitmapImageFileType::PNG`,修正剪贴板默认值与格式化,并将仅 Windows 的旧导入
事务辅助限制到 Windows、标注跨平台快照字段的真实使用边界。本地 Windows `cargo test`
为 `205 passed + 3 ignored`,严格 Clippy 通过;待推送后重新取得 macOS runner 证据。

2026-08-01 macOS CI #4 复核:提交 `7b8fea1` 已通过依赖安装、shared build、Desktop 测试
`123/123` 与 typecheck,但 Node `v24.18.1` arm64 在 `vite build` 阶段因默认 V8 堆上限
耗尽而以 `Abort trap: 6` 退出;Rust 与 Node 性能 gate 未执行。workflow 已为 Desktop
frontend 验证显式设置 `NODE_OPTIONS=--max-old-space-size=6144`,待新运行确认构建和后续
macOS Node gate。

2026-08-01 macOS CI #5 复核:提交 `828e35c` 已通过前端 build（6 GiB 堆配置生效）,但
Rust gate 仅剩 `legacy_import.rs` 顶部 Windows 专属类型导入在 macOS 未使用;已补上同样的
`cfg(windows)` 边界。Node 性能 gate 仍未执行,待下一次 runner 运行。

2026-08-02 Node 插件编辑器工具链补齐:编辑器增加 manifest 与 pnpm lockfile 的结构化
added/removed/changed 对比,Problems/Output 继续分别承载诊断与完整输出;新增用户主动触发的
TypeScript typecheck IPC,由随包 Node 执行固定 tsc,使用 Node、undici 和 GodGesture SDK 类型,
输出有界并规范化文件/行/列诊断。浏览器 mock、结构化 diff 单测、Desktop `126/126`、
typecheck、Rust Node package 测试和严格 clippy 已通过。随包 TypeScript 资源尚未重新下载并
写入忽略的本机工具链目录,发布前需重新运行 `pnpm fetch:node-toolchain --target=...`。

2026-08-01 Node 工具链发布 smoke:在 Windows x64 真实执行 `pnpm fetch:node-toolchain
--target=windows-x64`,修复 Windows PowerShell 解压调用的参数传递后,随包 Node
`v24.18.1`、pnpm `10.34.5`、supervisor 和 worker 均可用。使用随包 Node 启动随包
supervisor 完成插件 load/invoke、`fetch` 能力和 `Input.sendText` 宿主往返;生成资源按
`.gitignore` 规则保持为本机发布输入,不进入仓库。工具链单测 4/4、release 合同 10/10、
`git diff --check` 通过。

2026-08-02 Node 缓存隔离修复:插件物化目录与 pnpm store 现在按构建 OS/架构隔离,
生命周期脚本批准状态进入 revision fingerprint,避免同步配置或信任设置变化后复用
不匹配的原生依赖。Rust library `207 passed, 3 ignored`,严格 clippy 和定向格式检查
通过。

2026-08-02 macOS CI #7 复核:提交 `9881fe4` 在 macOS 15.7.7 arm64 runner 上完整通过
shared build、Desktop 测试/typecheck/build、Rust 测试与严格 clippy、Node 插件性能 gate
和双架构 `cargo check`;workflow run 为
`https://github.com/Mr-BeanSir/GodGesture/actions/runs/30709559609`。Node
`v24.18.1` 的 `node-host-performance-macos-ARM64` artifact 已上传,本地下载文件的
SHA-256 为 `07f6629ff141a537bcaa0a1e9c19cc49a6ca919747710b1d30ba8675458ba766`。
10,000 次有序 no-op 与 10,000 次代表性宿主调用均通过;冷启动 `263.573375 ms`,no-op
p95/p99 为 `0.122083/0.18425 ms`,宿主调用 p95/p99 为 `0.350167/0.614709 ms`。
该结果完成 macOS CI runner 性能门槛,但不替代物理 Mac 的 TCC、全局捕获、覆盖层、多屏、
npm 离线依赖及 Worker/supervisor 恢复验收。

2026-08-02 Node 工具链资源复核:重新执行 `pnpm fetch:node-toolchain --target=windows-x64`,
确认随包 `node v24.18.1`、`pnpm 10.34.5`、TypeScript `tsc`、Node/undici 类型和
supervisor/worker 均写入忽略的 Windows 资源目录并可读取。修复 Windows pnpm junction
复制时的 `EPERM`，复制前解析真实路径；工具链测试 `5/5` 通过。该资源是本机发布输入，
不进入 Git；macOS 目标仍需在对应 runner/物理 Mac 环境分别生成和验收。

2026-08-02 Node-only 切换:维护者在 Windows 门槛完成且 macOS CI release gate 已通过后,
明确授权把物理 Mac 观察项延期,不再让其阻塞唯一 Node.js 运行时。配置协议升级到 v4,
删除 `script` 命令、QuickJS/rquickjs 引擎、旧宿主声明、旧脚本转换工具及“迁移旧版本”/
“转为 Node.js 插件”入口;WGestures 旧脚本导入会告警并降级为“什么也不做”。Node 插件
继续通过常驻 supervisor、预加载 Worker 和有界队列执行。未完成的 macOS Node 真机项
保留在 `docs/qa/M4_MACOS_SMOKE.md`,状态为 `DEFERRED (owner-approved)`,不能解释为通过。
本轮最终验证为 shared `98/98` + typecheck/build、Desktop `118/118` +
typecheck/build、`pnpm check:api`、Rust library `199 passed, 3 ignored`和严格 Clippy。
Windows release Node 门槛为冷启动 `87.2651 ms`,noop p95/p99
`0.1921/0.2707 ms`,宿主调用 p95/p99 `0.5828/0.7498 ms`;全部通过 ADR 上限。

2026-08-02 有序手势输入:普通手势的捕获与匹配统一使用 `GestureSpec.inputs`,按真实顺序
记录方向笔画、鼠标按钮和滚轮。待定状态收到附加鼠标键或滚轮时立即建立捕获,支持“右键
按住 → 中键/滚轮 → 移动”;录制 IPC 实时推送完整序列。桌面助记符按序显示,滚轮方向使用
俯视 SVG,滚轮按下显示中央蓝色区域,普通手势编辑器移除旧修饰符选择并改为“最后一个按键
触发时立即执行”。旧 `strokes + modifier` 仅在读取/展示边界规范化。验证:Rust `205 passed,
3 ignored`,严格 Clippy;shared `102 passed` + typecheck/build;Desktop `120 passed` +
typecheck/build;`pnpm check:api` 与 `git diff --check` 通过。Windows 真实桌面和 macOS
真机输入序列仍按既有 M4 清单观察,不将自动化测试视为平台验收。

2026-08-02 快捷键录制修复:命令快捷键与暂停快捷键现在以单个完整和弦事件原子提交,
避免连续更新 modifiers/keys 时后一个更新覆盖前一个更新。Ctrl/Shift/Alt/Win(Cmd) 与
主键组合在释放后均保留;新增 Ctrl+W 回归测试。Desktop `121 passed`、typecheck/build
和 `git diff --check` 通过。

2026-08-02 Windows 快捷键优先捕获:新增 `WH_KEYBOARD_LL` 原生低级键盘钩子和
`hotkey-capture` IPC 事件。录制期间钩子将收到的键盘事件转发给前端并返回非零值尝试
阻断系统快捷键;Windows 保留组合（例如 `Win+W`）仍可能由系统优先处理,因此不承诺捕获
全部系统级组合。失焦、Escape、完成和组件卸载都会停用捕获,结束录制后恢复系统输入。
该能力为 Windows 专属,macOS 仍使用 WebView 录制并待真实设备验收。

2026-08-03 轨迹收尾与右键消费修复:触发键一旦跨过 `initialValidMovePx` 进入 Tracking,
释放时统一产生 `PathEnd`,不再因为尚未形成笔画而合成原始点击。这样无匹配手势也会走统一
覆盖层收尾流程,轨迹按设置清除或淡出,目标应用不会收到右键;仍处于 Pending 且未达到阈值
的普通点击保持原有透传。新增方向折返与跨 runtime 无匹配回归测试;Rust library
`209 passed, 3 ignored`,严格 Clippy 和 `git diff --check` 通过。

2026-08-03 Pause 命令移除与可重复修饰符:配置协议升级至 v5,命令类型删除 Pause,旧配置
中的 Pause 稳定降级为“什么也不做”,当前 v5 文档严格拒绝该已删除命令；设置窗口顶栏、
托盘、全局快捷键、左键+中键和弦及暂停状态机继续保留。普通手势新增独立修饰符,基础输入匹配后每次按钮或滚轮
修饰符触发都立即执行且继续监听,释放触发键不二次执行；未命中的附加输入继续进入基础有序
输入链,滚轮保持 100 ms 节流。Shared `105/105` + typecheck/build,Desktop `123/123` +
typecheck/build,Server `87/87` + typecheck/build,Web Console typecheck/build,`pnpm check:api`,
2 个模板种子验证,Rust library `213 passed, 3 ignored` 与严格 Clippy 全部通过。应用内浏览器
在 `800x560` 中文/英文下确认独立修饰符 8 个选项、同触发键禁用、问号提示的双语绑定、
命令类型只剩 11 项且无横向溢出；真实 Windows/macOS 重复输入仍按平台 QA 观察。

2026-08-03 任务切换执行时机修复:删除任务切换在增量识别阶段启动并保持按键的特殊生命周期,
`RecognitionChanged` 现在只更新原生覆盖层提示。未配置独立修饰符时,任务切换与其他普通命令
一致,仅在触发键释放产生 `PathEnd` 后执行；配置独立修饰符时仍由每次 `ModifierFired` 立即
执行,释放触发键不重复。Windows `Alt+Tab` 与 macOS Mission Control 共用该时机语义。
新增两条 runtime 回归测试,Rust library `212 passed, 3 ignored`。

2026-08-03 Windows 自定义标题栏与图标:Windows 主窗口在 Rust setup 中于首次显示前
移除系统 decorations,现有 48px 顶栏增加不覆盖交互控件的拖动区、最小化和关闭到托盘
按钮；macOS 原生标题栏与 `icon.icns` 保持不变。桌面 `favicon-transparent.png` 已生成
包含 16/24/32/48/64/256px 六帧 32-bit 的 Windows `icon.ico`,并同步 32px 顶栏图标。
Tauri capability 显式授权 close/minimize/start-dragging。Desktop `125/125`、typecheck/build、
Rust 严格 Clippy、定向格式、capability JSON、ICO 帧与 `git diff --check` 通过。Windows
Tauri dev 窗口已启动且 UIA 确认自定义控制组与 drag-resize 层；Computer Use 对 borderless
WebView2 截图返回 `SetIsBorderRequired (0x80004002)`,随后检测到用户输入而停止自动点击,
拖动、最小化与关闭到托盘仍由维护者实际体验确认。

Server 测试中的 `Unhandled Prisma P2002 (OAuthAccount)` 是未知 constraint 映射为 500 的预期日志。Web 构建的 VueUse PURE 注释和大 chunk 警告是既有警告。不要跑全仓 `cargo fmt`;只格式化实际修改的 Rust 文件。

## 新任务接手流程

1. 从 `AGENTS.md` 进入,完整读取 `CONTEXT.md` 和本文,再检查 Git 状态与近期提交。
2. 先判断任务影响 Desktop Rust、Desktop Vue、shared、Server、Web Console、部署或发布中的哪些领域,再通过 `docs/adr/README.md` 和部件地图选择相关文档。协议改动必须更新 shared 和所有消费者。
3. Bug 先从现有日志和稳定复现开始;不要仅凭一次观察修改代码。新行为不得与 ADR 或上面的锁定语义静默冲突。
4. 检查是否已有桌面开发会话,保护用户改动,实施最小范围修改,按风险补测试并运行对应验证。
5. 每个领域选择性 `git add <明确路径>` 并独立提交;commit message 用英文。绝不使用 `git add -A`,绝不自动 push。
6. 若任务改变本文记录的事实,在同一领域提交中更新本文;验证数字只有实际重跑后才能更新。

# GodGesture 当前项目状态

最后核对：2026-08-25。本文是当前实现的唯一状态入口；术语以
[`CONTEXT.md`](../CONTEXT.md) 为准，协作规则以 [`AGENTS.md`](../AGENTS.md) 为准，架构理由按
[`docs/adr/README.md`](adr/README.md) 路由。本文不保存逐日开发流水；历史与发布审计按需读取
[`docs/CHANGELOG.md`](CHANGELOG.md) 和 [`docs/history/`](history/)。

## 当前结论

官方模板服务、Desktop 投稿复核、共享 UI 迁移、Web Console 审核/作者管理和管理员系统配置均已接入当前工作区。
`/admin/system` 使用共享且可访问的折叠 panel：模板策略默认展开，RustFS 默认收起，凭证状态徽章始终可见，
折叠不会清空未保存字段。模板父级暂停/恢复写入 `AdminAuditLog`，不改写版本审核记录，并在审核详情展示治理记录。

真实 Windows/macOS 原生窗口与输入验收、live OAuth/SMTP、RustFS 生产连接和生产部署仍按“已知边界”保持 pending。

Desktop 手势页现已将“导入/导出”与“分组/应用”分别收敛为可键盘操作的选择卡片入口：导出继续进入既有“选择交付方式”，本地导入通过 Tauri JSON 文件选择器解析后复用模板 store 的冲突计划、风险确认、插件安装和原子采纳流程；分组/应用卡片直接打开既有添加应用或添加分组窗口。Windows 与 macOS 共用同一 Vue、shared 协议和 Backend contract，不新增数据库字段或 migration；真实双平台文件选择器和导入现场仍需设备验收。

边角显示引导已接入 v8 同步配置、Desktop 设置、共享 Rust 几何查询和 Windows/macOS 原生覆盖层路径：引导显示当前
显示器实际启用的四角与四边区域，即使没有配置对应边角动作；角显示为 display-only 的固定 10px 半径四分之一圆，
边显示仍为实际 DPI 缩放的边带；`hotCorners.enabled=false` 隐藏四角，`rubEdges.enabled=false` 隐藏四边，并且不依赖
`boundaryIntents`。真实精确角命中和近角序列准入行为未改变。Windows 已补齐 End/Cancel 立即清理 trail、guide redraw 不恢复旧轨迹、
普通标签淡出期间隐藏会清空 layered-window 表面、以及 label feedback 独立生命周期的回归测试；Windows layered-window 已完成无重启现场复现、截图和肉眼验收。
macOS 原生隐藏路径也会清空 retained pixmap，macOS native compile、runtime/device acceptance、
Retina、多屏、Spaces 和点击透传验收仍 pending；当前 Windows 主机不能执行 macOS `cfg` 测试或原生编译，因此不将本功能
记为双平台运行时验收通过。

边角显示引导的 API 生成物已同步：Server 子模块 `25e3900` 刷新两个配置 schema 节点，根仓库已更新 gitlink和
`packages/shared/src/api/generated.ts`；`pnpm check:api` 已通过。该协议变更没有新增 endpoint 或 Prisma migration。

本轮已接入管理员可配置的注册开关：关闭时同时禁止邮箱密码注册和首次未绑定 OAuth 身份建号；已有账户
密码登录、密码找回、已绑定 OAuth 登录，以及未绑定 OAuth 绑定到已有非禁用账户仍可用。Windows 边角点击重放
已确认存在 `SendInput` 约 1 秒同步阻塞样本，并将点击注入移到独立 FIFO 工作线程；`SetCursorPos=false`
且 `error=0` 但目标前后坐标已满足的样本已确认是误警告并按目标已满足分类。顶部边角失配日志进一步确认：
边角序列在首个右键后因 `timer_expired` 提前取消并立即回放点击，导致光标跳回和原生右键提前触发；当前实现
在首个按钮仍按住时延期该超时，等待释放后再走取消。未形成方向轨迹时仍回放点击，形成方向轨迹后按
`PathTracker` 语义吞掉主键释放且不回放，已由 Rust 回归测试覆盖。真实 Windows 现场仍需验收。

Windows 通知区域现在拥有原生输入优先权：低级钩子通过光标下窗口及父链识别
`TrayNotifyWnd`、`TrayButton` 和通知区域溢出窗口；没有普通或边角捕获时，托盘区域的鼠标按下直接放行，
不再先被 `BoundaryMatcher`/`PathTracker` 吞掉后依赖 `SendInput` 回放，从而避免 GodGesture 托盘右键菜单在
重复点击后失去原生打开机会。该适配仅属于 Windows；macOS 不使用该判定，现有行为不变。真实 Windows
托盘菜单重复点击仍需在新构建进程中现场验收。

音量反馈的自动 locale 已接入双平台 `PlatformServices`：Windows 读取用户 locale 名称，macOS 从
`/usr/bin/defaults read -g AppleLocale` 读取并按进程缓存；两者失败时均回退 English。系统 locale 只将语言首段
为 `zh` 的标签解析为简体中文，具体平台设备现场验收仍按 M4/M8 清单执行。

音量反馈设计已实现：当前使用公共 `platform::overlay::OverlaySink`、`show_label_feedback` 和
`ShowLabelFeedback` 边界，普通手势、修饰手势、触发角和摩擦边共用消费者路径。Windows 和 macOS
音量命令都在 mutation 后读取最终系统音量；非静音时显示最终整数百分比，静音按 `Locale::ZhCn`/
`Locale::En` 显示 `静音`/`Muted`。`show_command_name` 控制标签可见性，`fade_out` 控制原生覆盖层
生命周期；独立标签反馈还支持可选展示停留时长和淡出时长，当前音量反馈停留 500ms、淡出 300ms，
普通手势继续使用默认时长。
读取或显示失败时不显示反馈。Windows Core Audio 使用默认 `eRender`/`eMultimedia`
endpoint；macOS 在同一次 `osascript` 中设置并读取 `output volume`/`output muted`。

本轮将普通手势与边角手势的活动轨迹和输入账本统一收敛为 `engine::capture::GestureCapture`：普通路径仍由
`PathTracker` 负责准入，边角路径仍由 `BoundaryMatcher` 负责边/角候选，但两侧共用同一个 parser、输入顺序、
释放锚点和已消费输入记录。边角首 token 的候选判断由 `BoundaryMatcher` 内部完成，无匹配时仍建立 visual-only
捕获并阻止 `PathTracker` 接管；未形成方向笔画时取消才 replay 原生输入，形成方向笔画后按普通捕获语义吞掉主键释放且不 replay。统一捕获阶段的历史验证基线为 272 passed、2 ignored；当前 Rust 库基线为 295 passed、0 failed、2 ignored；真实 Windows/macOS 输入现场仍 pending。

## 里程碑状态

| 领域 | 状态 | 边界 |
| --- | --- | --- |
| M0 仓库奠基 | 已完成 | 独立项目从 stable `v0.1.0` 起演进，不以 WGestures 行为作为产品基准 |
| M1 Windows 手势引擎 | Windows 主体与覆盖层现场验收已完成 | macOS 真实设备按 M4 清单验收 |
| M2 Windows 命令与设置 | 已完成 | Windows 专属命令显式标注；原生窗口验收不由浏览器预览替代 |
| M3 脚本引擎 | 已完成 | ADR-0012 的常驻 Node.js supervisor/Worker 是唯一生产脚本链 |
| M4 macOS 引擎 | 代码与 CI 已完成，平台验收 pending | TCC、输入、覆盖层、多屏、AX、Keychain、插件和升级需真实 Mac 证据 |
| M5 后端与账户 | 已完成 | Server 是私有子模块；注册开关覆盖邮箱注册和首次未绑定 OAuth 建号；OAuth/SMTP 凭证由部署环境提供；模板服务使用 PostgreSQL + RustFS |
| M6 云同步 | 已完成 | 整库 v8、乐观并发、后写胜出、快照和离线优先 |
| M7 Web Console 与分发 | 已完成 | Server-owned Console、模板审核/举报/配额、系统配置、账户编辑和作者管理已接入 |
| M8 打磨与发布 | 根仓库 `v0.2.5` 提交/tag 已推送；本次 `pnpm release` 未创建 GitHub Release/安装包 | tag `v0.2.5` 指向 `e8ade88`，Server Web commit `777e3ce` 已推送；GitHub Actions、双平台安装验收和生产部署仍 pending |

## 部件地图

| 部件 | 当前职责 | 入口 |
| --- | --- | --- |
| Desktop Rust | Tauri 生命周期、跨平台手势引擎、原生输入/命令/覆盖层、本地配置 | `apps/desktop/src-tauri/src/lib.rs`、`engine/`、`platform/` |
| Desktop Vue | 设置、账户、模板、插件、同步和本地日志界面；消费共享 UI 并保留 store/Tauri/i18n 绑定 | `apps/desktop/src/App.vue`、`src/views/`、`src/stores/` |
| Shared | v8 配置、认证、同步/快照分页、模板、插件目录、DSL 和生成客户端 | `packages/shared/src/` |
| Shared UI | 无业务 Vue 原语、`--gg-*` token、Dialog/选择卡片/确认/Toast 和基础状态组件 | `packages/ui/src/` |
| Server | 私有 NestJS 子模块：REST、Prisma/PostgreSQL、认证、设备、同步和快照 | `apps/server/src/`、`apps/server/prisma/` |
| Web Console | Server-owned Vue/Vite SPA：只读配置、设备、快照、安全、作者模板和管理员区域 | `apps/server/web-console/src/` |
| SDK / 插件示例 | `@godgesture/sdk` 类型和五生命周期 demo | `packages/sdk/`、`distribution/plugins/` |
| 发布与部署 | GitHub Actions、Windows NSIS、macOS universal ad-hoc DMG、1Panel Compose | `.github/workflows/`、`docs/*_RELEASE.md`、`apps/server/README-DEPLOY.md` |

## 现役实现

### 输入与覆盖层

- 普通手势和边角序列共用 `engine/capture.rs` 的 `GestureCapture`、有序匹配、消费记录和主释放键语义；`PathTracker` 负责普通准入，`BoundaryMatcher` 负责边角候选；边缘或近角区域一旦命中即归属边角路由，即使首 token 没有匹配候选也进入视觉捕获、显示轨迹并阻止 `PathTracker` 接管；无方向笔画的取消才重放原生输入，形成轨迹后按 `PathTracker` 语义吞掉主键释放且不 replay；架构理由见 ADR-0013。
- 普通手势支持方向、鼠标按钮、滚轮和键盘 `KeyboardEvent.code`；独立修饰符在没有更长有序前缀时触发，可重复且不追加基础序列。
- 边角非空序列由首个按钮/滚轮准入；有匹配候选时进入序列匹配，无匹配时保留视觉捕获但不执行意图，光标移动不会单独武装；形成方向轨迹后的主键释放不触发原生点击；精确角点保留给空序列立即动作。
- 轨迹和命令提示由原生覆盖层绘制，不能迁移到 WebView。Windows 使用低级钩子与 Raw Input 兜底，macOS 使用 CGEventTap。
- 边角显示引导为 display-only：角的真实视觉区域仍是固定 10px quarter-circle，边的真实视觉区域仍是实际 DPI-scaled edge band；真实区域内 alpha 为 100%，只有向屏幕内部越过真实区域内边界后才渐隐，角渐隐带为 10..20px，边渐隐带为一个等厚 fade band，超出不显示。该 alpha 语义不改变真实角/边命中区域、状态机或输入路径。
- Windows/macOS 原生 overlay 的 `End` 和 `Cancel` 立即清理 live trail points、render/cache/show path；`trail_fade_surface` 及等价的 snapshot capture/restore/composition/专用淡出机制已删除。`SetBoundaryGuide` 只更新引导，不承担清理旧轨迹。
- 普通 `Trail` 在 `End` 后按 `fade_out` 独立处理命令标签：轨迹立即清除；启用淡出时保留标签并复用原生标签 fade 生命周期，淡出完成后清除并隐藏；关闭淡出或收到 `Cancel` 时立即清除标签并隐藏。
- Label feedback 保持独立生命周期：`ShowLabelFeedback -> End` 的同批次路径仍会启动一次待定 label fade，后续批次的 `End` 保留已存在的 label fade；`End` 清理轨迹，不移除 label。
- Windows 轨迹不可见修复已有 focused 测试和 Rust 格式证据；本轮又补充了普通手势越过起始阈值、边角覆盖层 Begin/End/Cancel 以及高耗时输入分发的 debug 事件。维护者已完成原始复现进程上的无重启运行态验收、截图和肉眼确认。
- Desktop 支持 Gesture Template v2 多目标导出、详情、冲突复核和高风险采纳确认；原生使用保存面板，浏览器预览回退到下载。

### UI、配置与同步

- `@godgesture/ui` 提供无业务原语、token、`AppDialog`、折叠 panel、确认服务、Toast 和全局 Message；不读取 router、store、API client 或 i18n。
- Desktop 已移除 Element Plus，使用共享原语、Lucide 和原生语义控件；Web Console 由 Server 拥有，使用共享原语、Tailwind v4 和本地薄适配层。
- Web Console `/config` 保持只读，已展示 Desktop 设置页中全部可云同步的偏好：手势起始/停留阈值、轨迹显示与颜色、淡出、边角引导、暂停快捷键、界面语言和更新检查；开机自启、托盘可见性等本机设置不进入云同步。偏好位于整库 JSONB 文档中，不新增数据库列或 migration。
- 快速入门对话框包含“程序权限”步骤，仅提供“开机启动”；Windows Desktop 交互启动和开机自启均在进入 Tauri 前强制执行 UAC 提权，Windows 启动任务固定使用 `HighestAvailable`，macOS 保留开机启动。Windows 仍不使用 `uiAccess`/代码签名证书。
- 现行配置为 v8：应用分组、有序 `inputs`、边角意图和 `nodePlugin.pluginId` 为现役结构；旧格式不迁移，旧 `enable8Directions` 只读取忽略并在规范化保存时移除。
- 首笔笔画固定 8 方向，后续笔画 4 方向；`sendText` 只接受 `text`、`key`、`hotkey`、`sleep` DSL。
- `全屏时自动禁用手势` 仍是可配置项，新配置默认开启，已有配置的显式关闭值继续保留。
- Desktop 同步采用 30 秒尾随防抖、启动/定时拉取和手动同步；refresh token 仅进 Windows Credential Manager/macOS Keychain。
- Server API 前缀为 `/api/v1`；快照列表分页，恢复使用版本 CAS；OAuth 绑定身份采用一次性授权码 + PKCE，首次第三方身份必须先完成 GodGesture 邮箱验证。管理员可在 `/admin/system` 关闭注册；登录页读取匿名状态并隐藏注册标签，旧注册链接显示“注册已关闭”后回到登录，密码找回与已有账户认证路径不受影响。

### 模板、插件与 Web Console

- 官方模板目录由 Server 的 PostgreSQL 元数据、审核/举报/配额/指标模型和 RustFS 不可变对象提供；匿名用户可浏览/采纳，官方端点登录用户可投稿；自定义端点不提供目录或投稿。Desktop 从构建时官方 Server origin 分页读取并通过短期签名 URL 下载。
- Desktop 手势页支持本地 Gesture Template v2 JSON 导入：原生文件选择器只返回受大小限制的文本，shared 协议先校验，随后通过 `useTemplatesStore.openLocalPackage()` 进入与在线模板相同的 plan/adopt 流程；插件安装失败、配置并发变化或校验失败都不会覆盖现有配置。手势页的“导出”仍保留 JSON/公共目录交付选择，“分组/应用”使用无 footer 的选择卡片直接进入既有窗口。
- 公共目录每个模板族只展示最高已发布版本；更新审核期间保留旧版本，通过后切换；父模板暂停隐藏目录、详情和下载，恢复后重新投影。作者可按状态撤回、重新投稿或删除模板族，最新 50 个版本受保留策略约束。
- `TemplatePolicy` 是数据库级单例；RustFS 参数和加密凭证由 `SystemConfig` 管理，OAuth、SMTP、JWT 与指标 HMAC 仍只在部署环境管理。
- 模板审核状态转换在事务内按版本 ID 和来源状态条件更新；竞争失败不会写入模板状态、审核记录或管理员审计。
- Node 插件位于应用配置目录的 `plugins/` 直接子目录；manifest 生命周期为 `onInit`、`onExecute`、`onGestureRecognized`、`onModifierTriggered`、`onEnd`。官方目录固定使用 `Mr-BeanSir/GodGesture-Plugins` 的 `main`，模板和同步配置只保存 `pluginId`。
- Web Console 固定使用 `zh-CN`；`/admin`、`/admin/system`、`/admin/users/<user-id>/edit` 和 `/admin/templates` 已实现用户管理、系统配置、用户编辑和模板审核三标签。全局设计真源为 `design-system/godgesture-web-console/MASTER.md`；浏览器预览不替代原生平台验收。

### 日志、发布与部署

- Desktop 在 `app_log_dir()` 写脱敏 JSONL，级别为 `off/error/warn/info/debug`；日志不上传、不参与同步，页面支持筛选、trace 折叠、导出、清理和关闭自动跟随。2026-08-24 起，Windows/macOS 原生覆盖层 debug 日志记录 `End`/`Cancel`/`SetBoundaryGuide`/`ClearBoundaryGuide` 的命令顺序、轨迹状态、可见性、重绘类型和 dirty 区域；Windows 额外记录引导重绘前后的 DIB 非透明像素摘要。
- Desktop 已接入进程内统一运行时诊断采集：前端 fetch、Tauri IPC、页面导航、稳定控件 UI 操作、console、未捕获异常和未处理 Promise 统一进入本地日志；Rust 模板/插件 HTTP 请求、更新阶段、OAuth loopback 阶段和既有 Node supervisor/worker 生命周期也使用同一日志中心。采集只保留脱敏 URL 的协议/主机/端口/pathname、method、status、耗时、content-length、command、稳定控件标识或错误类别，不记录 headers/body/token/password/clipboard/input value/完整配置；日志命令保持 raw IPC 以避免递归。前端诊断受本地日志级别短路，写入采用有界串行 IPC，并过滤 Tauri callback warning；`ipc.localhost` 内部 fetch 不再生成 `http.fetch` 诊断，因此 `log_write` 等内部通信不会刷屏，真实业务 HTTP 仍保留。
- Windows Desktop 的开发启动器现在在启动 Vite/Tauri 前通过 PowerShell 查询当前 Node 进程是否为管理员令牌；普通权限 `pnpm dev:desktop` 直接退出并提示使用管理员终端，不再触发 UAC 子进程或依赖 dev runner 等待提权实例。生产版仍保留应用自身的 UAC `runas`，Windows 强制管理员边界和 macOS 启动路径不变。
- Desktop 发布构建的主窗口已启用 WebView DevTools，Tauri `devtools` feature 与配置同时打开；Windows WebView2 关闭浏览器专用 accelerator 后由 F12 页面 contract 调用 `devtools_toggle`，原生打开独立 DevTools 窗口，不嵌入页面。浏览器预览为 no-op；Windows/macOS 共用 contract，但真实设备上的 F12、DevTools 窗口和原生行为仍分别 pending。
- Windows 边角点击重放在 debug 级别记录 `replay_id`、入队/调度/工作线程等待/完成耗时、队列深度、光标恢复前后位置与原始 Win32 错误码、`SendInput` 请求/插入数量和短写状态；低级钩子按钮事件、边角 token/候选索引/取消原因、释放吞咽掩码和 tracker 处理结果也按低频采集。另记录普通手势起始阈值、边角覆盖层生命周期和超过 1 ms 的输入分发。普通 `PathTracker` 无轨迹点击恢复统一记录为 `mouse_replay_requested`，不再使用边角专属事件名；触发键准入还记录 `tracker_admission_decision` 或具体拒绝原因，并包含 `self_integrity`、`target_integrity` 和 `elevation_boundary`。点击注入仍保持 FIFO，但执行已移出低级钩子消息泵，避免 `SendInput` 阻塞时丢失真实按钮释放。
- `pnpm release` 由维护者显式指定 `patch`、`minor`、`major` 或完整 SemVer；`feat`/`fix` 只影响 Release Notes，不自动选择版本。Desktop 发布先同步四个 manifest，再由 release-it 的 `after:bump` hook 运行不带 `--locked` 的 Cargo 命令同步 `Cargo.lock`；发布 commit 同时包含两者。CI 和 Tauri 发布构建使用 `--locked`，Server 独立维护，不参与校验或修改。
- Release body 由脚本同时归类合并 PR 与直接提交；原生 `generate_release_notes` 关闭。GitHub Release 是发布日志，`docs/CHANGELOG.md` 只保存历史和发布审计资料。
- Windows NSIS 统一 `perMachine`，新安装默认 `C:\Program Files\GodGesture`，升级沿用已记录目录；不自动迁移旧 `currentUser` 安装。macOS 为 universal ad-hoc DMG，不提供 Authenticode、Developer ID、公证或 staple。
- Server 生产部署由维护者使用 1Panel 手动完成，交付物为 docker-compose；更新和在线插件目录通过 GitHub 分发，模板对象与数据库必须同窗口备份。
- pnpm 构建脚本许可已迁移到 `pnpm-workspace.yaml` 的布尔型 `allowBuilds`：`esbuild`、`unrs-resolver`、`vue-demi` 显式允许，`@scarf/scarf`、`@prisma/engines`、`prisma`、`@prisma/client` 显式禁止；根 `package.json` 的旧 `pnpm.onlyBuiltDependencies` 已移除，pnpm 10.34.5 的配置 warning 已消除。

## 已知边界

- 发布版 F12/DevTools 的 Windows 与 macOS 原生现场验收尚未完成；当前已在管理员 Windows 进程确认应用可运行，并完成 release `cargo check`、前端 contract 与 mock 验证，但自动化无法向该高完整性窗口注入用户 F12，因此仍需维护者在管理员实例手动确认独立 `DevTools - ...` 窗口。当前实现不再依赖未可靠触发的 WebView2 accelerator callback。
- `pnpm dev:desktop` 不接受普通权限终端：启动器会在端口探测和 Vite/Tauri 启动前检查当前进程的管理员令牌，失败时直接退出。此前为普通权限 dev runner 提权而加入的父进程等待逻辑已移除；生产版 UAC 提权仍由 Desktop 保留。管理员终端启动、普通权限终端的明确拒绝和 debug 控制台不再出现仍需维护者在 Windows 现场验收。
- 真实 Mac 的 TCC、全局输入、点击透传、X1/X2、Retina 多屏、Spaces/全屏覆盖层、AX、Bundle ID/图标、Keychain、插件恢复和已安装升级仍 pending，清单见 [`docs/qa/M4_MACOS_SMOKE.md`](qa/M4_MACOS_SMOKE.md)。
- 共享 UI 浏览器预览只证明 Vue 构建的视觉、导航、焦点和溢出行为；不替代 Windows/macOS 原生窗口、权限、全局输入或覆盖层验收。
- Windows 安装/卸载后遗留 Task Scheduler 任务的自动清理未纳入安装器；移动或删除可执行文件会使旧任务失效。
- GitHub/Google OAuth 真实凭证、SMTP、生产 Prisma 迁移、RustFS、生产部署和本地日志真实目录行为需部署环境或设备验证；本地契约测试不等于 live 通过。
- Windows 轨迹不可见问题已完成无重启复现、截图和用户肉眼验收；当前开发实例可能锁定 `target/debug/godgesture.exe`，构建时可使用独立 `CARGO_TARGET_DIR`，不要强杀实例。
- Windows 释放触发键后 hover 边/角时轨迹短暂闪现的问题已通过现有进程复现日志确认：`End` 已清空轨迹状态，但隐藏前未清空 layered-window 缓存，后续 `SetBoundaryGuide` 的局部提交会再次暴露旧标签/轨迹像素，并可能因 tile dirty 范围不同表现为标签半边异常。Windows 现在在 `hide` 前将 DIB 清空并完整提交透明帧；macOS `hide` 同步清空 retained pixmap，新增跨平台隐藏表面回归测试。维护者已完成 Windows layered-window 无重启复现和肉眼验收；macOS 原生运行时验收仍按 M4 清单 pending。
- Windows 触发角/摩擦边右键重放的真实行为仍需在现有 Windows 进程上复现：`SendInput` 同步阻塞已定位并完成工作线程隔离，`SetCursorPos=false/error=0` 的目标已满足误警告已修正；顶部 `timer_expired` 提前回放的根因已定位并在代码层延期。通知区域新增原生输入优先适配，托盘菜单需在新构建进程中重复点击验收；其它屏幕边缘仍须结合新增的生命周期和 `mouse_input_slow` 日志验收。
- 音量反馈的当前平台边界是：本机为 Windows，仅完成 Windows 自动化和代码验证；尚未对真实默认音频设备执行音量上调、下调、静音，以及普通手势、修饰手势、触发角、摩擦边四类入口的用户可见覆盖层现场验收。macOS native compile/runtime/parser/device acceptance pending；交叉构建曾因缺少 `cc` 在 `objc2-exception-helper` 阶段失败。该功能不得记为双平台已验收。
- Windows 高完整性目标窗口是已验证的平台限制：普通 GodGesture 进程通常为 `Medium`，Windows Terminal 等管理员窗口为 `High`；低级鼠标钩子可能仍收到触发键按下/抬起并恢复原生点击，但收不到足以形成轨迹的移动链路，因此不会执行指定手势命令。Windows Desktop 现在统一在交互启动和开机自启时通过 UAC 运行在管理员完整性级别；不通过 `uiAccess` 绕过。`tracker_admission_decision` 中 `self_integrity=Medium target_integrity=High elevation_boundary=true` 是旧普通权限进程的诊断证据。该限制只适用于 Windows，macOS 不使用此完整性级别路径。
- 部分应用窗口内的右键“无日志”仍需按链路区分：若连 `platform.windows/event=mouse_button_received` 都没有，问题位于低级钩子或日志采集边界，不是应用意图匹配；若有 `tracker_admission_decision` 但 `allowed=false`，则是应用黑名单/全屏策略。窗口外无轨迹但出现 `mouse_replay_requested` 属于待定点击的原生右键恢复，不代表执行了手势。

## 最近验证

- 2026-08-25（手势模板导入与手势页入口）：新增 `AppChoiceDialog` 选择卡片原语、Tauri `gesture_template_open` 双平台 contract、shared 模板采纳 store 的本地 package 入口、手势模板导入复核和手势页“导入/导出”“分组/应用”路由；Desktop 定向测试 `54 files / 265 passed / 3 skipped`、Desktop typecheck、UI typecheck、Rust 模板命令编译测试和 `git diff --check` 通过。浏览器 mock 的文件选择返回取消；真实 Windows/macOS 文件选择器和导入现场验收仍 pending。
- 2026-08-25（手势模板导入复核复用）：提取 `GestureTemplateAdoptionDialog` 作为在线模板页与手势页本地导入的唯一详细复核入口；本地 JSON 解析后复用目标应用/手势预览、Review、风险确认、冲突策略、插件提示和采纳流程，删除导入页重复的简化复核实现。Desktop 全量测试 `54 files / 265 passed / 3 skipped`、typecheck 与 `git diff --check` 通过；真实 Windows/macOS 文件选择器和导入现场验收仍 pending。

- 2026-08-25（Cargo.lock 发布同步）：release-it 已在 bumper 更新 `Cargo.toml` 后运行 `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`，并把生成的 `Cargo.lock` 纳入 release commit；Windows 发布 Rust 测试、Windows/macOS CI 的 Cargo test/check/clippy/performance 命令均使用 `--locked`，Tauri Windows/macOS 构建通过 `-- --locked` 转发给 Cargo。当前 `v0.2.6` 的 `Cargo.lock` 根包已从 `0.2.5` 同步为 `0.2.6`，未改写 `v0.2.6` tag；`pnpm validate:release` 通过（43 tests passed，发布 workflow 校验通过）。

- 2026-08-25（删除遗留兼容代码）：维护者确认删除 `COMPAT-0001` 与 `COMPAT-0002`；Windows startup helper 不再接受旧三参数格式，Shared/Rust `MachineLocalSettings` 对已移除的 `runAsAdmin` 字段改为严格拒绝，兼容登记、源代码标记和旧兼容测试已删除。Shared 测试 `12 files / 94 passed`、Server Jest `26 passed / 1 skipped`（`235 passed / 13 skipped`）、Web Console `27 files / 188 passed`、Server typecheck 和 Web typecheck 通过；Rust library 测试 `344 passed / 0 failed / 2 ignored`。

- 2026-08-25（Desktop F12、运行时诊断与开发启动权限预检）：新增 release DevTools contract、Windows WebView2 accelerator 配置、前端 fetch/IPC/UI/console/异常采集、Rust HTTP wrapper、更新器/OAuth 生命周期日志；`ipc.localhost` 内部 fetch 不再写入 `http.fetch`，真实业务 HTTP 仍采集。`pnpm dev:desktop` 现在在 Windows 启动 Vite/Tauri 前检查当前终端的管理员令牌，普通权限直接退出；移除开发期 runas 等待逻辑，保留生产 UAC 和 `SEE_MASK_NO_CONSOLE`。Desktop 启动器测试 `7 passed`；Desktop 全量测试、typecheck/build、Rust 全量 library 测试、fmt、库级 clippy 和 release check 的上一轮基线仍有效，管理员终端启动与普通权限拒绝需现场验收。Tauri release `devtools` feature 已显式开启，未修改 Server、Web Console、数据库 schema 或 migration。

- 2026-08-25（v0.2.5 发布）：Server Web Console commit `777e3ce` 和根仓集成 commit `9da74fa` 已推送；`pnpm release patch` 创建并推送根仓 release commit `e8ade88` 与 tag `v0.2.5`。发布校验 `42/42`、仓库布局 `8/8`、`pnpm check:api` 和 `Cargo.lock` 版本同步通过；GitHub CLI 未登录，CI、安装包和 live 用户路径未核验。

- 2026-08-25（Web Console 云同步设置展示）：`/config` 只读展示与 Desktop `ConfigDocument.preferences` 对应的全部可同步字段；Server `UserConfig.document`/`ConfigSnapshot.document` 继续使用现有 JSONB，不需要数据库 migration。Web Console 测试 `27 files / 188 passed`、Server Jest `26 passed / 1 skipped`（`235 passed / 13 skipped`）、Web 类型检查和生产构建通过。

- 2026-08-25（Windows 强制管理员启动）：Windows Desktop 已移除 `runAsAdmin` 本机设置和设置/快速入门入口；交互启动与 `--autostart` 均在进入 Tauri 前执行 UAC 提权，启动任务固定 `HighestAvailable`。Shared 测试 `94 passed`、Desktop 全量测试 `50 files / 242 passed / 3 skipped`、Desktop typecheck/build、Rust library 测试 `338 passed / 0 failed / 2 ignored`、Rust fmt、Clippy `-D warnings` 和 `git diff --check` 通过；真实 UAC/Task Scheduler 现场验收仍 pending，macOS 不使用该 Windows 提权路径。

- 2026-08-24（Windows layered-window 现场验收）：维护者在现有复现进程上完成隐藏表面清理、边角引导重绘和轨迹不再闪现的无重启复现、截图与肉眼验收；Windows layered-window 标记为完成，macOS 原生运行时和设备验收继续 pending。

- 2026-08-24（Boundary Guide Hidden Surface Cleanup）：根据 `godgesture-export-2026-08-24T134640181Z-0.jsonl` 确认旧标签残留的根因是隐藏窗口缓存未收到透明帧，而不是 `End` 未清理轨迹；Windows `hide_clears_layered_surface_before_hiding`、`boundary_guide_after_end_cannot_restore_hidden_label_pixels` 与 overlay 定向测试 `37 passed / 0 failed`，Rust 全库 `336 passed / 0 failed / 2 ignored`，`cargo fmt --check` 和库级 Clippy `-D warnings` 通过。macOS 交叉检查因本机缺少 `cc` 在 `ring` 构建阶段受环境阻塞，真实 Windows layered-window 与 macOS runtime/device 仍 pending。

- 2026-08-24（普通手势命令标签残留）：复现 JSONL 显示普通 `Recognized -> End` 后 points/rendered_points 已清零、`show_path=false`，但 `show_label=true` 且 label 仍存在；Windows 因 `End` 停止 fade 后重绘了仅标签帧，macOS 因同样保留 label 且未创建 fade 导致覆盖层残留。两端现已让普通 `Trail` 标签按 `fade_out` 进入既有淡出或立即清理；Windows overlay 定向测试 `35 passed / 0 failed`，Rust 全库测试 `334 passed / 0 failed / 2 ignored`，fmt 和库级 Clippy `-D warnings` 通过。macOS native compile/runtime/device 验收仍 pending。

- 2026-08-24（Boundary Guide Reveal Ordering）：复现 JSONL 确认 `End` 清理轨迹逻辑正常，问题是 Windows DIB 旧像素在引导重绘前暴露；新增渲染显示顺序回归测试并通过 Windows overlay suite `33 passed / 0 failed`。Windows layered-window 无重启现场验收和 macOS native runtime/device 验收仍 pending。

- 2026-08-24（Boundary Trail Diagnostic Logging）：新增 Windows/macOS 覆盖层生命周期与重绘 debug 日志；Rust 全库 `--lib --no-default-features` 测试 `331 passed / 0 failed / 2 ignored`，库级 Clippy `-D warnings` 和 Rust fmt 通过。日志仅用于现场定位，不代表 Windows layered-window 或 macOS 原生设备问题已验收。

- 2026-08-24（Boundary Guide Alpha And Trail Lifecycle Task 3）：按 Task 3 brief 完成文档同步，并重新执行 Rust fmt、Rust library test、Rust library Clippy、Shared build、Desktop typecheck、Desktop tests、`pnpm check:api` 和 `git diff --check`；实际结果与受限项详见 [Task 3 报告](../.superpowers/sdd/2026-08-24-boundary-guide-alpha-lifecycle/task-3-report.md)。记录确认角显示仅为固定 10px 半径四分之一圆的 display-only 视觉，边显示为实际 DPI 缩放边带；真实精确角命中和近角序列准入未改变。Windows layered-window 视觉观察，以及 macOS native compile/runtime/device、Retina、多屏、Spaces、点击透传验收仍 pending；Windows 自动化 Rust 结果不代表 macOS 证据。

- 2026-08-23（边角显示引导）：Shared 测试 `93 passed`，Desktop typecheck、Desktop 测试 `50 files / 243 passed / 3 skipped`、Desktop build、`pnpm check:api`、Server Jest `25 passed / 1 skipped`（`233 passed / 13 skipped`）、Web Console `27 files / 187 passed`、Windows cfg 的 overlay suite `32 passed`、Rust 全量库测试 `325 passed / 0 failed / 2 ignored`、Rust fmt 和库级 Clippy 均通过。最终复审修正 macOS 淡出测试 fixture 并通过定向复审；Windows layered-window 现场视觉验收、macOS native compile/runtime/Retina/Spaces/点击透传和真实设备验收仍 pending。

- 2026-08-24：根仓库 `v0.2.4` release commit、tag 和远程 `main` 已 push；发布 tag 保持在 `84dd9ef`，后续 Cargo.lock 版本同步提交为 `9f4d20d`，未改写已发布 tag。GitHub Actions run `32743731223` 的 Windows/macOS checkout 都因远端 Server 仓库缺少 gitlink `25e3900` 而失败，assemble 和 GitHub Release 均跳过，当前没有可核验的安装包；双平台安装验收和生产部署仍 pending。
- 2026-08-19：Desktop 测试 `50 files / 238 passed / 3 skipped`、typecheck 和 build 通过；仅保留动态导入与大 chunk 警告。
- 2026-08-21：Desktop Rust 全量 `--lib --no-default-features` 测试 `274 passed, 2 ignored`，格式检查和库级 Clippy 通过；新增边角未匹配轨迹不 replay、无轨迹点击仍 replay 回归测试。真实 Windows/macOS 输入现场仍 pending。
- 2026-08-21：Windows 托盘原生输入优先适配新增；系统托盘路由回归测试与窗口类识别测试通过，真实托盘菜单重复点击仍 pending。
- 2026-08-21：音量反馈自动 locale 接入 Windows `GetUserDefaultLocaleName` 与 macOS `defaults` 缓存；Desktop Rust 全量库测试 `283 passed, 2 ignored`，Windows check 通过，macOS cross-target check 因本机缺少 `cc` 未完成。
- 2026-08-21（Task 8 最终音量反馈验证）：`cargo fmt --check` 通过；`cargo test --lib --no-default-features` `295 passed, 0 failed, 2 ignored`；`cargo clippy --lib --no-default-features -- -D warnings` 通过。
- 2026-08-21（Task 8 Desktop 验证）：`pnpm --filter @godgesture/shared build` 通过（为生成 workspace 类型声明）；首次 `pnpm --filter @godgesture/desktop typecheck` 因 shared dist 类型声明未生成失败，构建 shared 后 `pnpm --filter @godgesture/desktop typecheck` 通过；`pnpm --filter @godgesture/desktop test -- --run` 通过，`50 files passed`，`242 tests passed`，`3 skipped`；`git diff --check` 通过。Windows 仅完成自动化和代码验证，macOS native compile/runtime/parser/device acceptance pending；交叉构建曾因缺少 `cc` 在 `objc2-exception-helper` 阶段失败。
- 2026-08-21：快速入门新增程序权限步骤，覆盖 Windows 管理员启动/开机启动开关及 macOS 管理员项禁用引导；`QuickStartDialog` 定向测试 4/4 通过。
- 更早的逐轮验证已压缩至 [`docs/CHANGELOG.md`](CHANGELOG.md)，stable `v0.1.0` 完整发布证据见 [`docs/history/M8_RELEASE_ACCEPTANCE.md`](history/M8_RELEASE_ACCEPTANCE.md)。

## 工作区与文档路由

- `apps/server` 是私有 Git 子模块，`distribution/plugins` 是官方插件仓库子模块；开发、CI 和 1Panel 检出需具备私有子模块只读权限并运行 `git submodule update --init --recursive`。
- 旧 `distribution/templates` 子模块已移除，不参与运行时、发布校验或递归检出；浏览器预览使用源码 fixture。
- 新会话读取 [`AGENTS.md`](../AGENTS.md)、本文和 [`CONTEXT.md`](../CONTEXT.md)；架构按 [`docs/adr/README.md`](adr/README.md) 选读。用户操作、脚本、DSL、发布和部署分别看 `docs/USER_GUIDE.md`、`docs/SCRIPTING.md`、`docs/SEND_TEXT_DSL.md`、`docs/*_RELEASE.md` 和 `apps/server/README-DEPLOY.md`。
- 历史里程碑、逐轮验证和 stable 发布审计只按需读取 [`docs/CHANGELOG.md`](CHANGELOG.md) 与 [`docs/history/M8_RELEASE_ACCEPTANCE.md`](history/M8_RELEASE_ACCEPTANCE.md)；普通开发不要默认读取历史资料。

## 接手要求

保护工作区已有改动；协议变更同时更新 Shared 和全部消费者；界面文案走 zh-CN/en；跨平台能力不得把 Windows 自动化结果写成 macOS 已完成；显式 `git add <path>`，不使用 `git add -A`，默认不 push。详细规则只保留在 [`AGENTS.md`](../AGENTS.md)。

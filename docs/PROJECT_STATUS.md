# GodGesture 当前项目状态

最后核对：2026-08-21。本文是当前实现的唯一状态入口；术语以
[`CONTEXT.md`](../CONTEXT.md) 为准，协作规则以 [`AGENTS.md`](../AGENTS.md) 为准，架构理由按
[`docs/adr/README.md`](adr/README.md) 路由。本文不保存逐日开发流水；历史与发布审计按需读取
[`docs/CHANGELOG.md`](CHANGELOG.md) 和 [`docs/history/`](history/)。

## 当前结论

官方模板服务、Desktop 投稿复核、共享 UI 迁移、Web Console 审核/作者管理和管理员系统配置均已接入当前工作区。
`/admin/system` 使用共享且可访问的折叠 panel：模板策略默认展开，RustFS 默认收起，凭证状态徽章始终可见，
折叠不会清空未保存字段。模板父级暂停/恢复写入 `AdminAuditLog`，不改写版本审核记录，并在审核详情展示治理记录。

真实 Windows/macOS 原生窗口与输入验收、live OAuth/SMTP、RustFS 生产连接和生产部署仍按“已知边界”保持 pending。

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

本轮音量反馈已建立公共 `platform::overlay::OverlaySink`、`show_label_feedback` 和
`ShowLabelFeedback` 边界，普通手势、修饰手势、触发角和摩擦边共用消费者路径。Windows 和 macOS
音量命令都在 mutation 后读取最终系统音量；非静音时显示最终整数百分比，静音按 `Locale::ZhCn`/
`Locale::En` 显示 `静音`/`Muted`。`show_command_name` 控制标签可见性，`fade_out` 控制原生覆盖层
生命周期，读取或显示失败时不显示反馈。Windows Core Audio 使用默认 `eRender`/`eMultimedia`
endpoint；macOS 在同一次 `osascript` 中设置并读取 `output volume`/`output muted`。

本轮将普通手势与边角手势的活动轨迹和输入账本统一收敛为 `engine::capture::GestureCapture`：普通路径仍由
`PathTracker` 负责准入，边角路径仍由 `BoundaryMatcher` 负责边/角候选，但两侧共用同一个 parser、输入顺序、
释放锚点和已消费输入记录。边角首 token 的候选判断由 `BoundaryMatcher` 内部完成，无匹配时仍建立 visual-only
捕获并阻止 `PathTracker` 接管；未形成方向笔画时取消才 replay 原生输入，形成方向笔画后按普通捕获语义吞掉主键释放且不 replay。统一捕获阶段的历史验证基线为 272 passed、2 ignored；当前（Task 8 音量反馈验证）Rust 库基线为 294 passed、0 failed、2 ignored；真实 Windows/macOS 输入现场仍 pending。

## 里程碑状态

| 领域 | 状态 | 边界 |
| --- | --- | --- |
| M0 仓库奠基 | 已完成 | 独立项目从 stable `v0.1.0` 起演进，不以 WGestures 行为作为产品基准 |
| M1 Windows 手势引擎 | Windows 主体已完成，覆盖层现场复现 pending | 轨迹不可见问题仍需无重启现场复现；macOS 真实设备按 M4 清单验收 |
| M2 Windows 命令与设置 | 已完成 | Windows 专属命令显式标注；原生窗口验收不由浏览器预览替代 |
| M3 脚本引擎 | 已完成 | ADR-0012 的常驻 Node.js supervisor/Worker 是唯一生产脚本链 |
| M4 macOS 引擎 | 代码与 CI 已完成，平台验收 pending | TCC、输入、覆盖层、多屏、AX、Keychain、插件和升级需真实 Mac 证据 |
| M5 后端与账户 | 已完成 | Server 是私有子模块；注册开关覆盖邮箱注册和首次未绑定 OAuth 建号；OAuth/SMTP 凭证由部署环境提供；模板服务使用 PostgreSQL + RustFS |
| M6 云同步 | 已完成 | 整库 v8、乐观并发、后写胜出、快照和离线优先 |
| M7 Web Console 与分发 | 已完成 | Server-owned Console、模板审核/举报/配额、系统配置、账户编辑和作者管理已接入 |
| M8 打磨与发布 | `v0.2.2` 已发布 | `6008e1d` 的 Release Notes 标题修复从下一次 tag 生效；双平台安装验收仍 pending |

## 部件地图

| 部件 | 当前职责 | 入口 |
| --- | --- | --- |
| Desktop Rust | Tauri 生命周期、跨平台手势引擎、原生输入/命令/覆盖层、本地配置 | `apps/desktop/src-tauri/src/lib.rs`、`engine/`、`platform/` |
| Desktop Vue | 设置、账户、模板、插件、同步和本地日志界面；消费共享 UI 并保留 store/Tauri/i18n 绑定 | `apps/desktop/src/App.vue`、`src/views/`、`src/stores/` |
| Shared | v8 配置、认证、同步/快照分页、模板、插件目录、DSL 和生成客户端 | `packages/shared/src/` |
| Shared UI | 无业务 Vue 原语、`--gg-*` token、Dialog/确认/Toast 和基础状态组件 | `packages/ui/src/` |
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
- Windows 轨迹不可见修复已有 focused 测试和 Rust 格式证据；本轮又补充了普通手势越过起始阈值、边角覆盖层 Begin/End/Cancel 以及高耗时输入分发的 debug 事件。修改后原始复现进程已退出，必须先接管并监控实例，再做无重启运行态验收。
- Desktop 支持 Gesture Template v2 多目标导出、详情、冲突复核和高风险采纳确认；原生使用保存面板，浏览器预览回退到下载。

### UI、配置与同步

- `@godgesture/ui` 提供无业务原语、token、`AppDialog`、折叠 panel、确认服务、Toast 和全局 Message；不读取 router、store、API client 或 i18n。
- Desktop 已移除 Element Plus，使用共享原语、Lucide 和原生语义控件；Web Console 由 Server 拥有，使用共享原语、Tailwind v4 和本地薄适配层。
- 快速入门对话框包含“程序权限”步骤：Windows 用户可直接切换“以管理员身份启动”和“开机启动”，管理员项以红色说明高完整性目标窗口的使用条件和重启要求；macOS 保留开机启动并将管理员项标记为不可用。Windows 仍不使用 `uiAccess`/代码签名证书。
- 现行配置为 v8：应用分组、有序 `inputs`、边角意图和 `nodePlugin.pluginId` 为现役结构；旧格式不迁移，旧 `enable8Directions` 只读取忽略并在规范化保存时移除。
- 首笔笔画固定 8 方向，后续笔画 4 方向；`sendText` 只接受 `text`、`key`、`hotkey`、`sleep` DSL。
- `全屏时自动禁用手势` 仍是可配置项，新配置默认开启，已有配置的显式关闭值继续保留。
- Desktop 同步采用 30 秒尾随防抖、启动/定时拉取和手动同步；refresh token 仅进 Windows Credential Manager/macOS Keychain。
- Server API 前缀为 `/api/v1`；快照列表分页，恢复使用版本 CAS；OAuth 绑定身份采用一次性授权码 + PKCE，首次第三方身份必须先完成 GodGesture 邮箱验证。管理员可在 `/admin/system` 关闭注册；登录页读取匿名状态并隐藏注册标签，旧注册链接显示“注册已关闭”后回到登录，密码找回与已有账户认证路径不受影响。

### 模板、插件与 Web Console

- 官方模板目录由 Server 的 PostgreSQL 元数据、审核/举报/配额/指标模型和 RustFS 不可变对象提供；匿名用户可浏览/采纳，官方端点登录用户可投稿；自定义端点不提供目录或投稿。Desktop 从构建时官方 Server origin 分页读取并通过短期签名 URL 下载。
- 公共目录每个模板族只展示最高已发布版本；更新审核期间保留旧版本，通过后切换；父模板暂停隐藏目录、详情和下载，恢复后重新投影。作者可按状态撤回、重新投稿或删除模板族，最新 50 个版本受保留策略约束。
- `TemplatePolicy` 是数据库级单例；RustFS 参数和加密凭证由 `SystemConfig` 管理，OAuth、SMTP、JWT 与指标 HMAC 仍只在部署环境管理。
- 模板审核状态转换在事务内按版本 ID 和来源状态条件更新；竞争失败不会写入模板状态、审核记录或管理员审计。
- Node 插件位于应用配置目录的 `plugins/` 直接子目录；manifest 生命周期为 `onInit`、`onExecute`、`onGestureRecognized`、`onModifierTriggered`、`onEnd`。官方目录固定使用 `Mr-BeanSir/GodGesture-Plugins` 的 `main`，模板和同步配置只保存 `pluginId`。
- Web Console 固定使用 `zh-CN`；`/admin`、`/admin/system`、`/admin/users/<user-id>/edit` 和 `/admin/templates` 已实现用户管理、系统配置、用户编辑和模板审核三标签。全局设计真源为 `design-system/godgesture-web-console/MASTER.md`；浏览器预览不替代原生平台验收。

### 日志、发布与部署

- Desktop 在 `app_log_dir()` 写脱敏 JSONL，级别为 `off/error/warn/info/debug`；日志不上传、不参与同步，页面支持筛选、trace 折叠、导出、清理和关闭自动跟随。
- Windows 边角点击重放在 debug 级别记录 `replay_id`、入队/调度/工作线程等待/完成耗时、队列深度、光标恢复前后位置与原始 Win32 错误码、`SendInput` 请求/插入数量和短写状态；低级钩子按钮事件、边角 token/候选索引/取消原因、释放吞咽掩码和 tracker 处理结果也按低频采集。另记录普通手势起始阈值、边角覆盖层生命周期和超过 1 ms 的输入分发。普通 `PathTracker` 无轨迹点击恢复统一记录为 `mouse_replay_requested`，不再使用边角专属事件名；触发键准入还记录 `tracker_admission_decision` 或具体拒绝原因，并包含 `self_integrity`、`target_integrity` 和 `elevation_boundary`。点击注入仍保持 FIFO，但执行已移出低级钩子消息泵，避免 `SendInput` 阻塞时丢失真实按钮释放。
- `pnpm release` 由维护者显式指定 `patch`、`minor`、`major` 或完整 SemVer；`feat`/`fix` 只影响 Release Notes，不自动选择版本。Desktop 发布同步四个 Desktop 版本文件，Server 独立维护，不参与校验或修改。
- Release body 由脚本同时归类合并 PR 与直接提交；原生 `generate_release_notes` 关闭。GitHub Release 是发布日志，`docs/CHANGELOG.md` 只保存历史和发布审计资料。
- Windows NSIS 统一 `perMachine`，新安装默认 `C:\Program Files\GodGesture`，升级沿用已记录目录；不自动迁移旧 `currentUser` 安装。macOS 为 universal ad-hoc DMG，不提供 Authenticode、Developer ID、公证或 staple。
- Server 生产部署由维护者使用 1Panel 手动完成，交付物为 docker-compose；更新和在线插件目录通过 GitHub 分发，模板对象与数据库必须同窗口备份。

## 已知边界

- 真实 Mac 的 TCC、全局输入、点击透传、X1/X2、Retina 多屏、Spaces/全屏覆盖层、AX、Bundle ID/图标、Keychain、插件恢复和已安装升级仍 pending，清单见 [`docs/qa/M4_MACOS_SMOKE.md`](qa/M4_MACOS_SMOKE.md)。
- 共享 UI 浏览器预览只证明 Vue 构建的视觉、导航、焦点和溢出行为；不替代 Windows/macOS 原生窗口、权限、全局输入或覆盖层验收。
- Windows 安装/卸载后遗留 Task Scheduler 任务的自动清理未纳入安装器；移动或删除可执行文件会使旧任务失效。
- GitHub/Google OAuth 真实凭证、SMTP、生产 Prisma 迁移、RustFS、生产部署和本地日志真实目录行为需部署环境或设备验证；本地契约测试不等于 live 通过。
- Windows 轨迹不可见问题仍需无重启复现、截图和用户肉眼验收；当前开发实例可能锁定 `target/debug/godgesture.exe`，构建时可使用独立 `CARGO_TARGET_DIR`，不要强杀实例。
- Windows 触发角/摩擦边右键重放的真实行为仍需在现有 Windows 进程上复现：`SendInput` 同步阻塞已定位并完成工作线程隔离，`SetCursorPos=false/error=0` 的目标已满足误警告已修正；顶部 `timer_expired` 提前回放的根因已定位并在代码层延期。通知区域新增原生输入优先适配，托盘菜单需在新构建进程中重复点击验收；其它屏幕边缘仍须结合新增的生命周期和 `mouse_input_slow` 日志验收。
- 音量反馈的当前平台边界是：本机为 Windows，仅完成 Windows 自动化和代码验证；尚未对真实默认音频设备执行音量上调、下调、静音，以及普通手势、修饰手势、触发角、摩擦边四类入口的用户可见覆盖层现场验收。macOS native compile/runtime/parser/device acceptance pending；交叉构建曾因缺少 `cc` 在 `objc2-exception-helper` 阶段失败。该功能不得记为双平台已验收。
- Windows 高完整性目标窗口是已验证的平台限制：普通 GodGesture 进程通常为 `Medium`，Windows Terminal 等管理员窗口为 `High`；低级鼠标钩子可能仍收到触发键按下/抬起并恢复原生点击，但收不到足以形成轨迹的移动链路，因此不会执行指定手势命令。此场景必须启用“以管理员身份运行”并重启 GodGesture；不通过 `uiAccess` 绕过。`tracker_admission_decision` 中 `self_integrity=Medium target_integrity=High elevation_boundary=true` 即为该诊断证据。该限制只适用于 Windows，macOS 不使用此完整性级别路径。
- 部分应用窗口内的右键“无日志”仍需按链路区分：若连 `platform.windows/event=mouse_button_received` 都没有，问题位于低级钩子或日志采集边界，不是应用意图匹配；若有 `tracker_admission_decision` 但 `allowed=false`，则是应用黑名单/全屏策略。窗口外无轨迹但出现 `mouse_replay_requested` 属于待定点击的原生右键恢复，不代表执行了手势。

## 最近验证

- 2026-08-20：Release Notes 定向测试 `4/4`，`pnpm validate:release` `42/42`；v0.2.2 tag run #13 在 `e38ddf1` 成功完成双平台资产，但 live body 仍是旧标题。
- 2026-08-19：Desktop 测试 `50 files / 238 passed / 3 skipped`、typecheck 和 build 通过；仅保留动态导入与大 chunk 警告。
- 2026-08-21：Desktop Rust 全量 `--lib --no-default-features` 测试 `274 passed, 2 ignored`，格式检查和库级 Clippy 通过；新增边角未匹配轨迹不 replay、无轨迹点击仍 replay 回归测试。真实 Windows/macOS 输入现场仍 pending。
- 2026-08-21：Windows 托盘原生输入优先适配新增；系统托盘路由回归测试与窗口类识别测试通过，真实托盘菜单重复点击仍 pending。
- 2026-08-21：音量反馈自动 locale 接入 Windows `GetUserDefaultLocaleName` 与 macOS `defaults` 缓存；Desktop Rust 全量库测试 `283 passed, 2 ignored`，Windows check 通过，macOS cross-target check 因本机缺少 `cc` 未完成。
- 2026-08-21（Task 8 最终音量反馈验证）：`cargo fmt --check` 通过；`cargo test --lib --no-default-features` `294 passed, 0 failed, 2 ignored`；`cargo clippy --lib --no-default-features -- -D warnings` 通过。
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

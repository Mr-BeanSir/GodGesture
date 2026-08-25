# Desktop Diagnostics And Release DevTools Design

## Goal

让已编译的 Desktop 版本可以使用 F12 打开或关闭 WebView DevTools，并把 GodGesture 自身的运行链路统一接入现有本地 JSONL 日志中心。日志必须能覆盖 HTTP、IPC、界面切换、用户界面操作、前端异常、控制台输出、Rust 原生请求、更新流程和 Node 宿主生命周期，而不依赖维护者逐个发现缺失位置后再补日志。

## Scope And Non-Goals

本次只修改 Desktop 及其原生 Rust 宿主，不修改 Server、Web Console、数据库 schema 或 migration。浏览器预览继续使用 mock backend，不伪造原生 DevTools 和系统级日志。

GodGesture 核心请求和宿主生命周期属于采集范围。第三方 WebView 内部请求、用户 Node 插件自行发起的网络请求和操作系统内部网络流量不归入 GodGesture 核心请求；宿主只记录可观察到的插件/更新生命周期结果。

日志不记录请求体、请求头、token、密码、剪贴板、输入框内容或完整同步配置。URL 只保留协议、主机和路径，移除 credentials、query 和 fragment。现有 `off/error/warn/info/debug` 级别和本地日志文件轮转策略保持不变。

## Architecture

现有 Rust `log` 全局 logger 和 `LoggingService` 继续作为唯一落盘与事件分发出口。所有新增采集点只使用已有 logger 或前端 `Backend.logWrite`，不新增第二套文件格式、上传通道或远程日志服务。

### Release DevTools And F12

1. 在 `apps/desktop/src-tauri/tauri.conf.json` 的主窗口启用 release DevTools。
2. 在 Tauri backend contract 增加 `devtoolsToggle(): Promise<boolean>`，Rust `devtools_toggle` 命令根据当前状态调用 Webview 的 open/close DevTools 并返回新状态。
3. Desktop 启动阶段注册一次 F12 `keydown` listener。命中 F12 时阻止 WebView 默认处理并调用 `devtoolsToggle`；浏览器预览的 mock backend 为 no-op。快捷键处理失败写入 `devtools` error 日志，不影响设置窗口工作。
4. Windows 与 macOS 使用同一前端入口和同一 Tauri 命令。该能力是发布构建的一部分，不增加设置页选项，也不依赖 debug assertion。

### Frontend Runtime Diagnostics

新增 `apps/desktop/src/runtime-diagnostics.ts`，提供幂等的 `installRuntimeDiagnostics(backend: Backend): () => void`。`apps/desktop/src/main.ts` 在挂载 Vue 应用前安装一次，测试可以注入 mock backend 和 fetch/console 对象。

采集器包含以下边界：

- `fetch`：记录 `http.fetch` 请求开始、响应完成和网络异常。开始事件为 `debug`；完成事件在成功响应时为 `info`，HTTP 4xx/5xx 为 `warn`，网络异常/超时为 `error`。字段包括 method、脱敏 URL、status、durationMs 和可用的 content-length，不读取或复制 body。
- `console`：保留原始 console 方法后包装 `debug/info/warn/error`。console 调用分别映射到对应级别，参数通过有长度上限的安全格式化转为文本；logger 失败不得递归调用 console。
- 全局异常：`window.error` 和 `unhandledrejection` 写入 `runtime` error，记录错误类型、消息和有限的堆栈文本，不记录事件对象、页面内容或 Promise 值中的敏感对象。
- IPC：在 `apps/desktop/src/api/backend.ts` 的 Tauri invoke 唯一网关中增加统一的调用包装器。命令开始和成功完成属于 `ipc` debug，命令失败属于 `ipc` error，记录命令名和耗时，不记录参数及返回值。日志相关命令走 raw invoke，避免日志递归。
- UI 操作：采集器使用事件委托记录 button、link、select 和 checkbox/radio 的 click/change，目标只使用 `data-testid`、aria-label、name、id 或元素类型等稳定标识，不读取可见文本、输入值或键盘字符。UI 操作为 `ui.action` debug。
- 页面切换：`apps/desktop/src/App.vue` 的 section 选择统一记录旧 section、新 section 和耗时/焦点结果；页面进入和离开属于 `ui.navigation` info。重复选择同一页面不重复写入导航事件。

现有云同步 transport 中与同一网络异常重复的手工日志会被收敛，避免一次请求同时产生重复错误；业务错误码仍由原有异常协议保留。配置保存、插件扫描、模板刷新、更新检查/安装等已有业务生命周期继续记录业务结果，统一采集器负责跨模块的基础事件。

### Native Rust HTTP Diagnostics

新增 `apps/desktop/src-tauri/src/http.rs`，提供轻量的 `LoggedHttpClient` 和 `execute(Request)` 入口。它持有现有 `reqwest::Client`，在发送请求前后自动记录：

- `http.reqwest` debug：请求开始、method、脱敏 URL；
- `http.reqwest` info：2xx/3xx 响应、status、durationMs、content-length；
- `http.reqwest` warn：4xx/5xx 响应；
- `http.reqwest` error：连接、超时、请求构造或发送失败的分类和 durationMs，不记录完整错误文本中的 URL。

`template_download.rs` 和 `engine/plugin_download.rs` 的客户端改为使用该 wrapper。redirect 仍由业务层按现有安全策略逐跳处理，因此每一跳都有独立的请求事件。响应 body 仍由业务层按既有大小上限流式读取，不由日志层缓存。

以下不能直接替换底层 HTTP client 的链路改为生命周期日志：

- `updater.rs` 在 update check、download progress、install 成功/失败处记录 endpoint（脱敏）、版本和阶段；Tauri updater 内部的网络实现不被重复复制。
- `account.rs` 的 OAuth loopback 记录监听启动、回调成功、非法回调、取消和超时，不记录 code、state 或 query 值。
- Node supervisor/worker 继续把结构化诊断、stderr 和生命周期结果转入 `node.supervisor`/`node.worker`；插件源码自身的 fetch 不被宿主伪装为 GodGesture 核心请求。

### Level Policy

| Target | Debug | Info | Warn | Error |
| --- | --- | --- | --- | --- |
| `http.fetch` / `http.reqwest` | start | successful response | HTTP failure | network/timeout failure |
| `ipc` | start/success | - | - | command failure |
| `ui.action` | control action | - | - | instrumentation failure |
| `ui.navigation` | focus detail | section changed | - | navigation failure |
| `runtime` / `console` | debug/info output | - | console warning | uncaught error/rejection |
| business lifecycle | detailed phase | user-visible operation result | recoverable degradation | operation failure |

日志总开关为 `off` 时沿用现有行为，不写入日志文件；切换到 `info` 可以看到 HTTP 完成、页面切换和关键业务结果；需要诊断完整调用顺序时切换到 `debug`。

## Error Handling And Privacy

- 诊断采集失败永远不阻塞原业务操作；包装 fetch、console、IPC 和 UI listener 时均保留原始行为。
- 日志写入队列已满时沿用 `LoggingService` 的丢弃策略，并保留必要的 writer failure 错误。
- URL 脱敏在前端和 Rust 两侧分别执行，不能依赖日志落盘层的二次清洗。
- 任何新增日志测试都必须断言 token、query 值、body、header 和输入值不出现在最终消息中。
- DevTools 是维护诊断能力，不把日志内容上传，也不因为打开 DevTools 改变同步或权限行为。

## Testing And Acceptance

### Frontend

- `runtime-diagnostics` 单元测试验证 fetch 成功、HTTP 错误、网络异常、URL 脱敏、console 包装、全局异常、UI 委托事件、幂等安装和卸载。
- backend tests 验证普通 IPC 统一记录、日志命令不递归、失败记录命令名但不记录参数。
- App tests 验证 F12 阻止默认行为并调用 toggle，重复页面选择不写导航事件。
- mock backend 增加 DevTools no-op contract，浏览器预览测试保持通过。

### Rust

- `http.rs` 单元测试验证 URL 脱敏、状态码到级别的映射、错误分类和不包含请求 body/header。
- template/plugin download 定向测试验证所有实际请求均通过 wrapper；现有 redirect、大小限制和错误码测试继续通过。
- updater/OAuth 生命周期测试验证日志不泄露 endpoint query、OAuth code/state。
- Rust fmt、library tests 和 clippy `-D warnings` 必须通过。

### Release Configuration And Documentation

- release config test 验证 `tauri.conf.json` 的主窗口 release DevTools 开启，F12 contract 在 Tauri command handler 中注册。
- Desktop typecheck/build/test、`pnpm check:api`（确认协议未受影响）和 `git diff --check` 通过。
- 更新 `CONTEXT.md` 的日志术语和 `docs/PROJECT_STATUS.md` 的功能状态/验证基线；不新增兼容旧代码，因此不分配 `COMPAT-*` ID。
- Windows 与 macOS 共享代码验证；真实 DevTools 快捷键和原生窗口行为分别在两平台现场标注验收状态，不把单平台自动化结果写成双平台现场验收。

## Alternatives Rejected

- 逐个调用点手工添加日志：新增请求和页面仍可能漏记，不能满足完整采集要求。
- 系统代理或抓包：会引入 HTTPS 证书、代理配置和隐私边界，无法自然关联 IPC/UI 生命周期。

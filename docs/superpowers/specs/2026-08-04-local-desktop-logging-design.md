# Desktop 本地日志系统设计与交接任务

状态：**代码实现已完成；本地日志的 Windows/macOS 平台运行验收 pending。** Windows 手势录制的键盘输入链路已由真实运行日志验证,但这不等同于本地日志目录、轮转、级别持久化和 Node 崩溃回退已完成平台验收。本文保留现役契约、实现边界和未完成平台观察；不要把自动化测试或浏览器 mock 验收解释为真实平台日志已通过。

## 1. 目标

为 GodGesture Desktop 建立统一的本地日志链路，覆盖 Tauri/Rust、Vue/WebView、Node supervisor/Worker，并提供一个可筛选、实时刷新、可导出、可清理、可修改采集级别的“日志”侧边栏页面。

一期只做 Desktop 本地日志。Server/Web Console 继续使用部署侧日志，不把本地日志上传云端，也不改变账户同步协议。

## 2. 已确认边界

- 级别只有 `off`、`error`、`warn`、`info`、`debug`；默认 `off`，`debug` 是最低（最细）粒度，不实现 `trace`。
- 级别是阈值：`error` 只采集错误；`warn` 采集错误和警告；`info` 再加信息；`debug` 采集全部四类。
- 使用 Tauri `app_log_dir()`，主文件建议为 `godgesture.log`，JSONL 格式。
- 单文件上限 10 MiB，最多保留 5 个轮转文件，总量约 50 MiB；写入失败不能阻塞手势钩子、Node 调用或 WebView。
- 日志页支持级别、来源/target、关键词筛选，实时 `log-event`，导出筛选结果，清理所有轮转文件，以及修改采集级别。
- 严禁记录密码、验证码、access/refresh token、剪贴板正文、插件源码、完整请求体和授权头；错误上下文只保留稳定错误码、HTTP 状态、端点和脱敏摘要。
- Windows 与 macOS 共用实现；平台路径、文件锁和打开日志目录行为必须分别验收。当前本地日志平台验收仍 pending；已验证的是 Windows 手势键盘输入链路：`WH_KEYBOARD_LL` 优先、Raw Input 兜底,并按虚拟键码/按下状态/100 ms 窗口去重。

## 3. 当前已写入代码

这些文件属于本任务的部分实现，下一位模型应在其上继续，不要重新设计一套并行接口：

- `apps/desktop/src/api/backend.ts` 已声明 `LogLevel`、`LogEntry`、`LogsQueryRequest`、`LogsQueryResponse`，并预留 `logLevelGet`、`logLevelSet`、`logWrite`、`logsQuery`、`logsExport`、`logsClear`、`onLogEvent`。
- `apps/desktop/src/api/mock.ts` 已有默认 `off` 的内存日志实现、筛选、清理、事件监听，供浏览器预览使用。
- `apps/desktop/src/logging.ts` 提供 `appLog.debug/info/warn/error`，调用前做 token/password 等常见模式脱敏。
- `apps/desktop/src/stores/logs.ts` 提供 Pinia 状态、初始化、事件订阅、筛选刷新、级别设置、导出和清理。
- `apps/desktop/src/views/LogsView.vue` 已按现有 Element Plus 工作台做紧凑日志查看器；暗色等宽日志区、级别颜色、过滤工具栏、实时指示、空态和错误态均已覆盖。
- `apps/desktop/src/App.vue`、`src/locales/zh-CN.ts`、`src/locales/en.ts` 已加入“日志”导航入口和完整中英文文案。
- Vue 关键失败路径（cloud、config、capture、hotkey、legacy import、window controls）已开始改用 `appLog`；这不是全量埋点完成的证明。
- `apps/desktop/src-tauri/src/logging.rs` 已提供全局 `log::Log`、有界非阻塞写队列、独立 writer、JSONL、10 MiB 轮转、5 个历史文件、约 50 MiB 历史总量、查询/导出/清理和级别持久化；Rust 侧二次脱敏、控制字符清理和长度上限均在 writer 写入边界执行。
- `apps/desktop/src-tauri/src/lib.rs` 已在 Tauri setup 使用 `app_log_dir()` 配置服务，注册六个命令并通过 `log-event` sink 推送实际写入的记录；日志级别设置存放在配置目录独立文件，不进入同步文档。
- Node supervisor/Worker 的诊断已改为稳定 code、pluginId/actionId、生命周期、耗时、退出码和受限行长度，并由 `node.supervisor` / `node.worker` 转入 Rust 日志；候选 prepare/import/onInit 失败继续保留最后可用宿主。

## 4. Rust 实现（已完成）

`apps/desktop/src-tauri/src/logging.rs` 由 `log::Log` 自定义实现承接现有 `log::debug/info/warn/error!`：

1. 在 Tauri `setup` 取得 `app_log_dir()`，创建日志服务状态并注册 `Arc<LoggingService>`；替换 `env_logger` 初始化。默认级别必须为 `off`，可将用户选择持久化到配置目录的独立设置文件。
2. 实现动态级别过滤、线程安全写入、JSONL 序列化、10 MiB 轮转和 5 个历史文件。日志写入异常不能递归写日志或阻塞输入线程。
3. 实现 `log_level_get/set`、`log_write`、`logs_query`、`logs_export`、`logs_clear`。`logs_query` 返回至少 `{ entries, total, files?, logPath?, level? }`；`logs_export` 返回生成文件的绝对路径。
4. 实现 `log-event`：只有实际写入成功且级别满足阈值的记录才推送，字段固定为 `timestamp`、`level`、`target`、`message`。
5. 对长度、控制字符和敏感字段做 Rust 侧二次防护，不能只信任前端脱敏。
6. 检查 Tauri capability 和 Windows/macOS 路径边界；若导出/打开需要权限，只授权 app log 目录及子路径。

## 5. Node 实现（已完成）

- `apps/desktop/src-tauri/src/engine/node_host.rs`、`node_service.rs` 和 `apps/desktop/node-host/supervisor.mjs` / `worker.mjs` 的启动、依赖准备、IPC、超时、重载、崩溃、生命周期拒绝和队列丢弃，统一映射到 Rust 日志中心。
- supervisor/Worker 的 stdout/stderr 由宿主按行解析为 `target=node.supervisor` / `target=node.worker`，限制单行长度并脱敏，不再直接继承或静默丢弃。
- 只记录 pluginId/actionId、生命周期名、稳定错误码和耗时；不记录插件源码、上下文正文、剪贴板正文或原生句柄。
- 保持最后可用宿主语义：候选 prepare/import/onInit 失败记录 `error`，但不能因为日志处理失败替换旧宿主。

## 6. 现有 Desktop 埋点清单

直接 `console.*` 和关键 Rust 分支已改为统一日志，来源名使用稳定小写 target：

| target | 记录内容 | 级别 |
| --- | --- | --- |
| `app.lifecycle` | 启动、重复实例、窗口/托盘建立、退出 | info/warn/error |
| `config` | 读取、校验、保存、回滚、磁盘损坏 | debug/info/warn/error |
| `gesture.capture` | capture start/cancel、监听失败、录制清理 | debug/info/warn/error |
| `gesture.runtime` | 手势开始、识别变化、完成、取消、命令分发失败 | debug/info/warn/error |
| `platform.windows` / `platform.macos` | hook、权限、输入投递、覆盖层关键失败 | info/warn/error |
| `cloud` | origin、endpoint、状态码、稳定错误码；禁止 token/body | debug/info/warn/error |
| `plugin.workspace` / `node.supervisor` / `node.worker` | 扫描、重载、依赖准备、生命周期、队列和崩溃 | debug/info/warn/error |
| `logs` | 级别变更、查询/导出失败、清理失败 | info/warn/error |

高频路径（逐点轨迹、鼠标钩子回调、每个 IPC 帧）默认只在 `debug` 下记录，并且必须限流或采样，不能让日志改变实时输入性能。

## 7. 验收顺序

1. 完成 Rust 日志服务和 `lib.rs` 注册，再确认 `backend.ts` 返回字段与 Rust serde 完全一致。
2. 浏览器预览检查 `LogsView` 的 `off/error/warn/info/debug` 空态、筛选、实时事件、清理和导出；检查 `980x700`、`800x560`，中英文、浅色/深色，无横向溢出。
3. 仅运行受影响的 Desktop/Vue、Rust library、Node host 定向验证；执行过的命令和数字才能写入 `PROJECT_STATUS.md`。
4. Windows 真实运行验证 `%APPDATA%\\com.godgesture.app` 日志目录、轮转、重启后级别持久化、Node 崩溃回退；macOS 真实运行验证对应 `app_log_dir`、文件权限和热更新日志。
5. 做敏感信息审计：日志文件、导出文件、事件 payload 和 UI 均不得出现密码、验证码、令牌、剪贴板正文或插件源码。

本轮实际执行的浏览器预览检查覆盖中文浅色日志页的默认 `off` 空态、`debug` 级别、实时记录、关键词筛选、导出路径提示和清理空态。Rust/Node/Desktop 定向命令与通过数字记录在 `docs/PROJECT_STATUS.md`；英文、暗色、精确 `980x700`/`800x560` 预览，以及 Windows/macOS 真机日志目录、轮转、重启持久化和 Node 崩溃回退仍是 pending。Windows 手势录制的实际运行日志已确认连续两次“右键按住 + Q”均产生 `KeyQ` 输入步骤,但该证据只覆盖输入捕获链路,不覆盖上述本地日志平台验收。

## 8. 当前状态矩阵（换模型交接）

| 事实面 | 状态 | 说明 |
| --- | --- | --- |
| 代码 | changed-and-verified | Rust 日志服务、Tauri 命令/event、Node 诊断、前端 mock/store/page 和定向测试已落地；`env_logger` 已移除。 |
| 运行态 | pending | 浏览器 mock 已验证日志页交互,Windows 手势键盘捕获已由真实运行日志验证；本轮未完成真实 Tauri Windows/macOS 日志目录、轮转、重启持久化和 Node 崩溃回退观察。 |
| 文档 | changed-and-verified | 本文、`CONTEXT.md` 和 `PROJECT_STATUS.md` 已记录现役契约、实际验证和平台 pending。 |
| 规则 | verified-current | 遵守 AGENTS.md：双平台、脱敏、本地优先、协议消费者同步。 |
| 记忆 | generated-read-only | 未写入或修改平台长期记忆。 |
| 工作区 | pending | 工作树原有大量未提交插件/账户改动，本任务新增改动未独立提交；不得 reset 或广泛清理。 |

## 9. 明确不做

- 不实现 `trace`；未来如需增加，必须单独评估高频采样、隐私和性能。
- 不把日志上传 Server、不新增 Web Console 日志页、不把日志加入同步文档。
- 不把插件源码、用户配置正文、密码或令牌写入日志。
- 不在本轮改动插件目录位置、Node 生命周期命名、邮件认证或管理员端行为。

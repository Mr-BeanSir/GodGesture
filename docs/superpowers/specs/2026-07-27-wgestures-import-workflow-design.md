# WGestures 导入桌面工作流设计

## 目标与范围

GodGesture 已能在 `packages/shared` 中解析 WGestures 1.8.5 的
`gestures.wg2` 和可选的 `config.plist`，但桌面端尚无可用入口。本子项目补齐从选取文件、预览诊断到一次性应用配置的完整 Windows 桌面工作流。

本次只实现已有导入器的桌面接入，不重写解析器，不新增 Tauri 文件系统或文件对话框插件，也不实现 `autoStart` / `runAsAdmin` 的 Task Scheduler 系统集成。导入采用整库替换语义，不做条目级合并。

## 用户流程

在“选项”页新增“从 WGestures 导入”入口，点击后打开
`LegacyImportDialog.vue`：

1. 用户通过浏览器原生文件输入选择必选的 `gestures.wg2`，并可选择一个 `config.plist`。
2. 每个文件在读取前检查大小，单文件上限为 4 MiB；超限时不读取、不解析，也不改变现有配置。
3. 文件齐备后在前端调用 `importLegacyConfig`。`gestures.wg2` 的致命解析错误显示为本地化错误并停留在选择阶段；`config.plist` 缺失或不可用时仍允许继续，并显示将使用默认偏好的提示或诊断。
4. 对解析结果调用 `configDocumentSizeBytes`；超过 `MAX_CONFIG_DOCUMENT_BYTES`（256 KiB）时作为致命错误阻止预览，避免生成只能本地保存、不能按 ADR-0009 同步的配置。
5. 解析成功且输出大小合规后进入预览阶段，显示：
   - 全局意图数；
   - 应用数及所有应用的意图总数；
   - 已配置的触发角数及摩擦边数；
   - 所有降级诊断；
   - “导入会替换当前整套手势与偏好”的明确提示。
6. 用户确认后只调用一次批量 Backend API。成功后关闭对话框并提示完成；普通失败时保留对话框、显示错误，导入结果不会进入前端 store，允许重试或取消。若后端报告回滚不完整，先从后端重新加载实际状态，加载完成前禁用重试。

取消、重新选择文件、解析失败和文件超限均不产生配置写入。点击确认时，为建立一致基线，store 可能先保存用户在打开导入对话框之前尚未落盘的正常编辑；批量失败不得把本次导入结果留在稳定存储中，回滚不完整的异常边界除外。

## 文件读取边界

文件内容由 WebView 的 `File.text()` 读取，因此无需扩展 Tauri capability。文件输入使用 `accept` 帮助筛选，但文件名和 MIME 类型不作为安全边界；真正的有效性由 shared 导入器和 Zod schema 决定。

大小常量在桌面前端集中定义为 `4 * 1024 * 1024` 字节，并分别应用到两个输入。对话框关闭时清除文件引用、解析结果和错误，避免下一次打开误用旧预览。

## Shared 结构化诊断

当前导入器返回面向中文用户的 `string[]`。为使桌面双语 UI 能可靠本地化，改为结构化诊断：

```ts
interface LegacyImportDiagnostic {
  code: LegacyImportDiagnosticCode;
  source: "gestures.wg2" | "config.plist";
  location?: {
    scope: "global" | "app" | "hotCorner" | "rubEdge" | "preferences";
    appName?: string;
    intentName?: string;
    index?: number;
    field?: string;
  };
  details?: Record<string, string | number | boolean>;
}
```

`LegacyImportResult.warnings` 保留字段名以减少调用方迁移面，但元素类型改为
`LegacyImportDiagnostic`。诊断代码是稳定的 snake_case 字符串联合，覆盖现有全部降级点：

- `invalid_virtual_key`、`unknown_virtual_key`、`invalid_command`、`invalid_hotkey`；
- `unknown_window_operation`、`unknown_command_type`；
- `unknown_trigger_button`、`invalid_stroke_direction`、`stroke_limit_exceeded`、`unknown_modifier`；
- `intents_not_array`、`invalid_intent`、`unknown_file_version`；
- `invalid_app_entry`、`empty_app_executable`；
- `hot_corner_slots_exceeded`、`hot_corner_commands_not_array`；
- `plist_root_not_dictionary`、`plist_parse_failed`；
- `trigger_mask_empty`、`pause_hotkey_invalid`、`preference_clamped`。

shared 只产生代码、位置和原始参数，不拼接任何语言的展示文案。桌面 i18n 使用
`options.legacyImport.warning.<code>` 将其格式化；位置也由 UI 按 `scope` 本地化。未来调用方遇到未知代码时使用通用“部分内容已降级”文案并附带代码，不因缺少翻译阻止导入。

`gestures.wg2` 无法解析或根节点非法仍是阻止预览的致命错误，不进入 warnings。桌面只展示本地化的安全摘要；解析器原始错误可写入开发控制台，但不作为稳定 UI 契约。

## 本机设置合并规则

导入结果替换完整 `ConfigDocument`。本机设置按以下规则生成后提交：

- `autoStart` 和 `trayIconVisible` 使用导入器从 `config.plist` 得到的值；缺少 plist 或键时使用 schema 默认值；
- `runAsAdmin` 在 WGestures 源格式中没有对应键，必须保留导入前当前机器的值；
- 合并时先复制当前 machine-local 对象，再只覆盖导入器明确映射的 `autoStart` 和 `trayIconVisible`，因此未来新增字段也不会被旧格式意外清空。

这保证导入不会意外关闭用户已有的管理员运行偏好，同时保持现有 WGestures 映射语义。

## Backend 与 Store 契约

`Backend` 新增以下窄接口：

```ts
legacyImportApply(
  document: ConfigDocument,
  machine: MachineLocalSettings,
): Promise<void>;
```

Tauri 实现只调用一个 `legacy_import_apply` 命令；浏览器 mock 先分别执行 Zod 校验，再同时替换内存中的 document 和 machine，保持同样的全成或全不成语义。

Backend 将 Tauri 拒绝值规范化为带 `code` 的错误。`apply_failed` 表示导入结果已完整回滚；`rollback_incomplete` 表示至少一项恢复失败、后端状态未知。UI 不依赖 Rust 的中文或英文错误文本判断分支。

Pinia store 暴露 `applyLegacyImport(result)`，而不是让对话框直接操作 backend：

1. 校验导入文档和合并后的 machine 设置；
2. 暂停自动保存调度，清除两个尚未触发的 debounce timer，将当前 `doc`、`machine` 立即加入既有两个串行队列，并等待队列 barrier 完成；
3. 若旧改动刷新失败，中止导入并保留当前前端状态；
4. 调用一次 `legacyImportApply`；
5. 只有调用成功后，才更新 `doc`、`machine`、两个 persisted baseline 和保存状态。

自动保存改为由 store 自己持有、可取消的 timer，而不使用无法由导入流程 flush 的黑盒 debounce。`persistDocNow` / `persistMachineNow` 在设置 `saveState = "error"` 后继续向调用方抛出异常，使 barrier 能可靠检测失败。`applyingImport` 为 true 时 watcher 不安排新任务；导入成功时先更新两个 persisted baseline，再替换响应式对象，watcher 看到新值已持久化后不得再次调用单项保存接口。`finally` 恢复自动保存调度。测试必须使用 fake timers 覆盖这些时序。

## Rust 批量应用与回滚

`legacy_import_apply` 同时接收已由 serde 验证的 `ConfigDocument` 和
`MachineLocalSettings`。`config_set`、`machine_set` 和 `legacy_import_apply` 在 Rust 侧共享同一个配置事务互斥锁，锁覆盖平台副作用、文件写入、回滚和引擎更新的完整区间，防止另一个窗口或未来调用方绕过前端队列造成交错写入。Windows 路径按以下顺序执行：

1. 取得事务锁，快照旧配置、旧本机设置、两个配置文件的原始内容/是否存在、当前快捷键注册状态和托盘可见性；任何非 `NotFound` 的快照读取错误都必须在平台副作用前中止；
2. 切换到新的暂停快捷键；若注册或内部恢复失败，进入统一回滚路径；
3. 应用新的托盘可见性；失败时进入统一回滚路径；
4. 使用 `ConfigStore` 的单文件原子替换能力依次保存 `config.json` 和 `machine.json`；替换实现必须在 Windows 上覆盖已存在的目标文件，而不依赖 `std::fs::rename` 的 Unix 覆盖语义；
5. 从首次状态改变开始，任一步失败都按快照尽力恢复两个文件、旧快捷键注册状态和旧托盘状态；恢复完整时返回 `apply_failed`，任一恢复动作失败时返回 `rollback_incomplete`，两者都保留主错误与回滚错误摘要；
6. 两个文件都保存成功后才调用 `engine.replace_config`。此后返回成功，前端才更新 store。

该工作流本次只在 Windows 产品路径启用。非 Windows 版本保留可编译的 unsupported stub，不写文件或改变状态；与平台无关的双文件快照/恢复逻辑仍保持独立可测试。`autoStart` / `runAsAdmin` 在本子项目中仍仅持久化，不触碰 Task Scheduler。

每个配置文件继续采用“同目录临时文件 + 原子替换”的单文件写入，Windows 实现使用支持 replace-existing 的平台原语。两个独立文件无法在普通文件系统上形成真正的崩溃原子事务：进程存活时发生的错误由上述逻辑回滚；若进程在两次替换之间被强制终止，重启后可能观察到一新一旧。该边界在本子项目中明确接受，不引入日志式事务或合并 machine-local 与同步文档。后续若实际故障证据表明需要崩溃一致性，再单独设计事务清单或恢复日志。

## 错误与并发行为

- 用户重复点击确认时，按钮进入 loading 并禁用，保证一次对话框只发出一个导入请求。
- 后端命令本身按一次调用执行；store 队列保证它排在当前编辑保存之后。
- 快捷键冲突、托盘更新失败或文件写入失败都视为整体失败并触发回滚。
- 回滚是 best-effort；若回滚本身也失败，Rust 记录详细日志并返回 `rollback_incomplete`。store 不写入导入结果，而是立即重新执行 `load()` 以对齐后端可观察到的实际文件状态；重新加载完成前对话框禁止重试，并明确提示用户检查快捷键和托盘状态。
- warnings 只表示可接受的降级，不阻止确认；致命解析错误和 schema 校验错误阻止进入确认步骤。

## 测试与验证

### Shared

- 将所有现有字符串断言迁移为诊断代码、位置和参数断言；
- 覆盖每类代表性诊断，证明 shared 不再产生本地化展示字符串；
- 保持 FileVersion 1/2/3、命令映射、Lua 原文和 plist 映射的现有行为测试。

### Desktop Rust

- 批量成功时两个文件、快捷键、托盘和引擎只在正确阶段更新；
- 新快捷键或托盘应用失败时不写文件；
- 第一或第二个文件保存失败时恢复已改变的文件和副作用；
- 回滚失败会保留主错误并报告恢复不完整；
- 同一路径连续保存两次在 Windows 上成功且第二份内容生效，防止退回到不可覆盖既有目标的 rename 行为；
- 非 Windows 分支至少通过编译，并测试与平台无关的文件快照/恢复逻辑。

### Desktop UI / Store

- 为 `apps/desktop` 启用 Vitest 和真实的 `test` script；不为本次测试额外引入浏览器自动化框架；
- 把文件校验、预览统计和诊断格式化保留为可在 Node 环境测试的纯函数，store 用 fake timers 和 mock Backend 测试队列；Vue 模板本身由 typecheck/build 与运行时 smoke 验证；
- 文件缺失、单文件超过 4 MiB、致命解析失败和取消不会调用 backend；
- 导入后的同步文档超过 256 KiB 时阻止预览和应用；
- 预览统计、缺 plist 提示、结构化 warning 的中英文格式化正确；
- `runAsAdmin` 被保留，`autoStart` 与托盘设置来自导入结果；
- 导入会先刷新已有保存队列，只调用一次批量接口，成功后才更新 store；
- 批量接口普通失败时不把导入值写入 store 或 persisted baselines；确认前成功刷新的用户既有编辑及其 baseline 可以正常前移；
- browser mock 的成功与校验失败保持原子性。

最终运行 shared 测试与 build、desktop tests/typecheck/build、Rust tests 和 clippy。clippy 只允许仓库已记录的 `overlay.rs:202 while_let_loop` 警告。需要运行时验证时先确认没有现存 dev 会话，再启动唯一实例检查导入入口与对话框交互。

## 提交边界

实现按领域选择性暂存并独立提交：

1. shared 结构化诊断及测试；
2. Rust 批量 IPC、回滚及测试；
3. Desktop Backend/store/mock、导入对话框、i18n 及测试；
4. 全部验证完成后更新 `docs/PROJECT_STATUS.md`。

任何提交都不得包含用户未跟踪文件、参考目录 `WGestures/` 或其他无关改动；不 push。

# 手势分组、账户会话与日志工作台设计

日期: 2026-08-05

## 范围

本次同时处理 Desktop 的五项需求:

1. 手势页增加应用分组。全局应用固定在最上方并独立于分组；默认创建“默认”分组；应用可在分组间拖拽，分组可拖拽排序和重命名；模板采纳产生的应用进入默认分组。
2. 账户与同步页使用本机系统凭据存储持久化 refresh token，启动时恢复会话，避免每次重新登录。
3. 日志页改为 Console 风格的最新优先查看器，错误/警告附加 trace 可折叠；实时跟随保留原有元信息行右侧圆点 + 文本外观，点击后只变灰并停止自动回顶；日志区随应用浅色/深色主题变化；移除无明确用途的刷新圆形按钮。
4. 应用启动默认显示手势页。
5. Windows 任务切换命令使用 Ctrl+Alt+Tab；macOS Mission Control 行为不变。

不在范围内: Server 数据模型、Web Console、Node 插件协议、日志上传、WebView 替代原生覆盖层、账户凭据写入 WebView `localStorage` 或普通配置文件。

## 架构决策

### 1. 应用分组属于同步配置

应用分组是用户配置的一部分，必须随整库配置文档同步、离线保存和跨设备恢复。因此 shared 配置增加 `groups`，每个 `AppEntry` 增加 `groupId`。Desktop UI 只负责编辑这些字段；Rust 手势匹配继续只使用应用绑定和手势内容，不依赖分组字段。

配置格式从 v6 升级到 v7。迁移要求:

- 建立固定 UUID 的默认分组，名称为“默认”。
- v1-v6 文档没有分组时，把所有应用放入默认分组并保留其现有应用顺序。
- `groupId` 缺失、格式错误或指向不存在分组时，归入默认分组。
- 已有合法分组和应用归属保持不变。
- 全局应用仍单独存放在 `global`，不增加 `groupId`。

分组限制使用独立的 `MAX_APP_GROUPS`，应用仍使用现有 `MAX_APPS` 限制。分组和应用的 `order` 都是各自集合内的排序值，移动后统一规范化为从 0 开始的连续值，减少重复排序值在同步后的不确定性。

### 2. 模板采纳与分组

手势模板仍由 shared 的采纳规划器生成整库文档:

- global 模板只写入 `global.intents`。
- app 模板新建应用时写入默认分组 ID。
- app 模板命中已有应用时只补缺失的平台绑定和手势，不改变已有 `groupId`。
- 采纳计划与配置版本检查继续复用现有 `applyTemplateDocument` 乐观检查。

默认分组允许重命名，但不能删除。删除自定义分组前确认；确认后将其中应用迁入默认分组并按默认分组末尾重新排序。

### 3. 手势页交互

左栏改为:

```text
全局
默认                         ...
  [drag grip] Chrome          edit delete
  [drag grip] VS Code         edit delete
工作                         ...
  [drag grip] ...
```

- 全局固定置顶，不显示应用拖拽把手，也不受分组折叠和排序影响。
- 分组标题支持折叠；折叠组仍是可见的应用拖放目标。
- 应用行最左侧在 hover/focus 时显示 3x3 点阵 SVG，把手是唯一的应用拖拽起点，避免拖动应用时误触选中。
- 应用拖入其他分组只修改 `groupId` 和目标组内 `order`，手势意图内容保持不变。
- 分组同样通过 hover/focus 的点阵把手拖拽到其他分组位置，完成排序。
- 分组菜单使用现有 Element Plus 交互，提供重命名和删除；默认分组删除动作禁用或不显示。
- 所有变更直接改动响应式 `ConfigDocument`，交由现有配置 store 防抖校验、保存和同步。

新增和修改的可见文案全部加入 `zh-CN` 与 `en`，不得在组件模板中硬编码中文。

### 4. 账户会话持久化

现有设计已经将 refresh token 放在 Windows Credential Manager / macOS Keychain，并由 `CloudSession` 在登录和 refresh rotation 后写入。此次不改变凭据边界，增强原生边界的可靠性:

- 对 keyring store 初始化和单次读写使用进程内锁，避免多个 `spawn_blocking` 首次并发操作导致默认 store 尚未完成初始化。
- API origin 继续经过现有 HTTPS/本机 HTTP 规范化，并以规范化 origin 隔离不同同步端点的凭据。
- 登录或 refresh 只有凭据写入成功后才安装新的 access token；写入失败继续撤销新 access token并返回明确错误。
- 启动恢复读取现有 refresh token并轮换；网络临时失败保留凭据并显示可恢复会话错误，服务端明确判定 token 失效时清除凭据并回到账户登录态。
- 账户诊断只记录 origin、稳定错误码和 HTTP 状态，不记录任何 token、密码或响应正文。

浏览器 mock 仍不代表生产凭据存储；生产 Desktop 不使用 WebView 持久化 refresh token。

### 5. 日志查看器

日志协议仍保持 `{ timestamp, level, target, message }`。为支持 trace 展示，Rust 日志清洗允许 `\\n` 作为受控行分隔符，其他控制字符继续清理，敏感信息规则不变。

前端读取后按以下规则展示:

- 后端查询结果和实时事件在 store 中统一转为最新在前，实时事件使用 prepend，不再 append 到末尾。
- `error` / `warn` 且 message 含附加换行内容时视为可折叠记录；默认显示第一行，附加行折叠在详情区。
- 行首使用展开/折叠箭头；点击箭头或记录本身切换状态，键盘 Enter/Space 也能操作；没有附加内容的记录不显示可操作箭头。
- 每条记录显示稳定的分隔线，详情使用缩进和等宽字体。
- 移除页面顶部的刷新圆形按钮；筛选、级别变更和初始化仍可主动查询。
- `自动跟随` 保持现有 `logs-meta` 元信息行右侧位置、圆点 + 文本样式和尺寸。开启时为绿色，实时事件 prepend 后把 viewer 滚动位置设为顶部；关闭时仅变为灰色，实时事件仍 prepend，但保留用户当前滚动位置。
- 日志区使用现有 `--gg-*` 表面、画布、边框 token 和 Element Plus 语义色。浅色模式使用白/浅灰表面，深色模式使用深灰表面；不使用纯黑背景或主题专属硬编码整块覆盖。

### 6. 默认页和 Windows 任务切换

- `App.vue` 的初始 `active` 设为 `gestures`。浏览器 preview 仍允许 URL `section` 参数覆盖默认页，以保留现有验收入口。
- Windows `Command::TaskSwitcher` 通过原生输入合成 Ctrl、Alt、Tab 的按下/释放序列；macOS `Command::TaskSwitcher` 继续执行 Mission Control。
- 中文和英文命令说明同步从 Windows Alt+Tab 改为 Ctrl+Alt+Tab。

## 状态与错误处理

- 分组名称为空时拒绝保存并保留编辑态。
- 拖放目标不是有效分组、拖拽源已经被删除或配置在拖拽期间被同步替换时，清除临时拖拽态并重新按当前文档渲染，不产生部分更新。
- 删除分组只允许自定义分组；迁移应用和删除分组在同一个响应式更新批次中完成。
- 日志折叠只影响视图，不修改日志文件、查询结果或导出内容。
- 日志事件处理失败不能阻塞输入、Node 宿主或配置保存；视图只在现有日志 store 的事件边界更新。
- 凭据读取或写入失败不降级到不安全的 WebView 存储，显示现有可本地清理/重试状态。

## 测试与验收

### Shared

- v6 文档迁移后有且只有默认分组，全部旧应用归入默认组。
- v7 文档合法分组和归属保持不变；缺失/未知 groupId 回退默认。
- 分组数量限制和应用 groupId UUID 校验生效。
- app 模板新建应用进入默认组，命中已有应用不改变其组；global 模板行为不变。

### Desktop Vue

- 手势页默认选择全局，分组树显示全局、默认组和应用；应用跨组移动、分组排序、重命名和删除迁移会更新配置文档。
- 3x3 拖拽把手仅在 hover/focus 显示，键盘/点击选择应用行为不被拖拽事件破坏。
- 日志 store 的初始结果和实时事件均是最新在前；错误/警告 trace 折叠判定、展开和筛选不泄漏正文以外的数据。
- `自动跟随` 开关的 prepend、回顶和保留视口逻辑有定向测试或可重复的组件验收。
- 删除刷新按钮后，日志导出、清理、筛选、级别设置和实时事件仍可用。
- 账户会话 store 保留已有登录、恢复、登出和失效 token 流程。
- zh-CN/en locale key parity、Desktop typecheck 和 production build 通过。

### Rust / 平台

- 配置 v7 round-trip、v6 迁移和默认组回退测试通过。
- 原生凭据入口的规范化、串行初始化和错误映射测试通过；不在测试输出中打印 token。
- Windows 命令单元测试或调用序列验证包含 Ctrl、Alt、Tab；macOS 命令不变。
- `cargo check`、受影响 Rust 测试、严格 Clippy 和 `git diff --check` 通过。
- Windows 真实验收:登录后关闭并重新打开应用可自动恢复会话，Windows Credential Manager 存在持久凭据；任务切换实际触发 Ctrl+Alt+Tab。
- macOS 真实验收:Keychain 会话恢复和分组/日志 UI 行为通过；任务切换仍为 Mission Control。

## 文档影响

- `CONTEXT.md` 增加“应用分组”术语，并修正“应用”定义为应用绑定条目。
- `docs/PROJECT_STATUS.md` 记录配置 v7、分组/日志/会话实现和实际运行验证；未执行的平台验收继续标为 pending。
- 不新增 ADR；本设计与现有本地优先、整库同步、双平台和本地日志边界一致。

# Desktop 与 Web Console 共享 UI 重构设计

## 背景

`apps/desktop` 的 Vue 设置界面目前仍依赖 Element Plus 和
`@element-plus/icons-vue`。Element Plus 同时承担了布局、按钮、表单控件、表格、
标签、提示、空状态、骨架屏、弹窗、确认框和全局主题样式，导致 Desktop 与已经
采用 Tailwind、CSS 变量和 Lucide 的 Server-owned Web Console 形成两套视觉语言。

维护者要求 Desktop 遵循 Web Console 的 UI 设计样式，放弃现有 Desktop UI 和
Element UI，并允许将组件统一封装到 shared 以避免两端重复实现。

当前仓库中的 `packages/shared` 是协议和领域类型包，供 Rust、Desktop、Server
以及 Web Console 使用；它不依赖 Vue。Web Console 源码仍由 `apps/server` 私有
子模块拥有。共享 UI 必须新增独立的包边界，不能把 Vue 组件混入协议包，也不能
改变 Web Console 归 Server 所有的架构决策。

## 目标

- 新增 `@godgesture/ui` workspace 包，提供 Desktop 与 Web Console 共用的 Vue UI
  原语、设计 token、全局样式和无业务交互工具。
- 将 Desktop 的全局外壳、页面、编辑器、弹窗、通知、表单、列表和状态组件迁移到
  Web Console 的安静、高密度、边框分层的视觉语言。
- 完全移除 Desktop 对 `element-plus`、`@element-plus/icons-vue` 及其全局 CSS 的
  运行时和构建时依赖；图标统一使用 `lucide-vue-next` 或现有共享助记符资产。
- Web Console 的现有 `src/ui` 原语改为消费 `@godgesture/ui`，避免按钮、标签、
  alert、dialog、spinner、empty state、toast 和焦点行为维护两份。
- 保留现有业务行为、API、同步数据结构、原生窗口能力、Tauri 生命周期、
  `zh-CN/en` Desktop 文案和 Web Console 固定 `zh-CN` 的语言策略。
- 在 980x700 默认窗口和 800x560 最小窗口下保持可用；窄视口不产生页面级横向
  溢出，表格或日志等宽内容只在其工作面内滚动。
- 对弹窗、确认操作、Toast、加载、错误恢复和键盘焦点提供与 Web Console 相同的
  可访问行为。

## 非目标

- 不修改 `packages/shared` 的协议、Zod schema、OpenAPI 生成客户端或同步数据。
- 不改变 Server REST API、认证、授权、数据库、RustFS、插件运行时或原生覆盖层。
- 不把 Web Console 的页面、路由或 Server 业务逻辑迁入根共享包；共享包只包含无业务
  UI 原语和样式。
- 不在本次重构中重新设计 Desktop 的信息架构、业务字段、手势匹配规则或模板采用
  流程；页面布局可以为匹配 Console 设计系统而调整，但行为和文案语义不变。
- 不引入新的 UI 框架或重量级组件库来替代 Element Plus。

## 设计真源

视觉和交互以 [`design-system/godgesture-web-console/MASTER.md`](../../../design-system/godgesture-web-console/MASTER.md)
为真源，关键约束如下：

- 画布、表面、边框、文字、主色、成功/警告/危险和遮罩使用同名 `--gg-*` CSS
  变量；浅色与深色主题必须完整定义。
- 字体使用 `Aptos`, `Segoe UI Variable`, `PingFang SC`, `Microsoft YaHei`,
  sans-serif；数据、版本和日志等单色信息使用系统等宽字体。
- 基础空间单位为 4px；桌面控件默认 40px，高密度表格行 40px，窄屏交互控件至少
  44px；图标按钮也保留完整命中区域。
- 默认使用不超过 8px 的圆角、细边框、轻阴影和 150-200ms 的状态过渡；不使用渐变、
  装饰性光晕、营销式 hero、嵌套卡片或持续动画。
- 所有交互元素必须有可见键盘焦点；图标按钮必须有 `aria-label` 和 `title`；错误
  通过 `role=alert` 或 `aria-live` 告知辅助技术；删除、退出、覆盖和安装等不可逆
  操作必须先确认。
- `prefers-reduced-motion` 下禁用装饰性过渡和旋转动画。

## 包边界

### `packages/shared`

保持现状，只放协议、schema、领域类型、解析器和共享静态助记符资源。它不能引入
Vue、浏览器 API、Pinia、Tailwind 或 `lucide-vue-next`。

### `packages/ui`

新增公开 workspace 包 `@godgesture/ui`，只依赖 Vue 运行时和图标包的 peer contract。
组件通过 props、slots 和 DOM attrs 接收文案与业务状态，不调用任一应用的 router、
store、API client 或 i18n 全局实例。包导出以下稳定入口：

- `@godgesture/ui/styles.css`：reset、字体、`--gg-*` light/dark token、焦点、
  motion、基础 `.gg-*` 样式。
- `AppButton`：`primary`、`secondary`、`ghost`、`danger`、`quiet` 变体，`sm`/`md`
  尺寸，disabled/loading/`aria-busy` 状态。
- `AppBadge`：`neutral`、`info`、`success`、`warning`、`danger` 变体。
- `AppAlert`：`info`、`success`、`warning`、`error` 变体，图标、标题、正文和关闭
  槽位，默认使用 `role=alert` 或 `role=status`。
- `AppDialog`：受控 `open`、标题、关闭文案、busy 状态和 footer slot；处理遮罩、
  Escape、焦点初始位置、焦点恢复、Tab 循环以及 busy 时禁止绕过确认。
- `AppEmptyState`、`AppSpinner`、`AppSkeleton`：统一空、加载和骨架状态。
- `ToastViewport` 与 `pushToast`：支持 info/success/warning/error、自动关闭、
  手动关闭、`aria-live` 和 reduced-motion。
- `useConfirmDialog`：将确认请求建模为 Promise，返回 `confirmed`/`cancelled`，
  由应用提供本地化标题、正文和按钮文案。
- `ui-test-utils`：为两端测试提供统一的 token、焦点和 Promise 确认测试辅助，不
  暴露生产运行时依赖。

`@godgesture/ui` 不导出业务页面，也不导出默认 i18n 文案。`lucide-vue-next` 作为
peer dependency 由 Desktop 和 Server workspace 各自声明，避免多个 Vue 运行时或
图标版本被隐式打包。

### Desktop 消费边界

`apps/desktop` 引入 `@godgesture/ui/styles.css`，使用共享原语替换所有 Element
组件。页面特有的布局类和状态仍留在各自的 view/component 文件；与数据 store、Tauri
命令和 `vue-i18n` 的绑定留在 Desktop。

### Web Console 消费边界

`apps/server/web-console` 保留其页面、路由和 Tailwind 构建链；`src/ui` 的同名原语
改为从 `@godgesture/ui` 导出或薄封装适配，保留既有测试选择器、i18n 调用和页面特有
attrs。Server 子模块仍是 Console 源码的所有者，只在其 `package.json` 中增加对根
workspace UI 包的依赖，并提交对应子模块 gitlink。

## 组件与状态契约

### 表单控件

优先使用原生 `button`、`input`、`select`、`textarea`、`fieldset`、`legend` 和
`label`，由 `.gg-input`、`.gg-select`、`.gg-checkbox`、`.gg-switch`、`.gg-number`
等共享样式提供外观。所有表单字段保留可见 label、键盘操作、disabled 语义和错误
旁路提示；不会通过 placeholder 代替 label。

### 表格与列表

使用语义 HTML table 或可访问的 list，表头、行高、hover、focus 和边框遵循 Console
规则。桌面宽度使用工作面内水平滚动；窄屏将详情表转换为字段列表或堆叠行，不能让
整个窗口产生横向滚动。

### 弹窗与确认

所有现有 `ElMessageBox.confirm` 调用迁移到 `useConfirmDialog`。确认 Promise 在
取消、Escape、遮罩点击和确认按钮路径上都只结算一次；busy 时关闭按钮、Escape 和
遮罩不会绕过正在进行的操作。`AppDialog` 把焦点放到首个可用控件或标题，关闭后
恢复原触发元素。

### 通知与错误

所有现有 `ElMessage` 调用迁移到 `pushToast`。成功、警告和错误不只依赖颜色，同时
使用 Lucide 语义图标和可读文本；网络/API 错误保留既有本地化 key。加载状态在按钮
和页面工作面可见，错误提供原有的重试或恢复动作。

### 图标

移除 `@element-plus/icons-vue` 后，按语义从 `lucide-vue-next` 选择 outline 图标。
图标按钮必须有可访问名称和 tooltip/title；手势、边界和模板助记符继续使用
`packages/shared/src/assets/mnemonic.svg` 现有组件路径，不重绘资产。

## Desktop 外壳设计

- 顶栏高度 56px，包含品牌、暂停/运行状态、主题切换、语言选择和 Windows 自定义
  窗口控制；窗口拖拽区域和最小化/关闭 Tauri 命令保持现有行为。
- 侧栏在宽度大于等于 1024px 时为 248px，采用 Console 的 surface/border/active
  状态；小于 1024px 时使用可访问的导航按钮和抽屉，保持七个 section 都可达。
- 主工作区使用 Console 的 canvas、页面标题、副标题和单一工作面层级；底部保存
  状态保留，但改用共享文本和 badge 样式。
- 深浅主题只保存本机偏好，不进入同步载荷；Desktop 的 `preferences.locale` 继续
  由现有 store 和 `vue-i18n` 管理。
- 页面路由仍由 `active` section 控制，快速入门、单实例提示、mock 预览 query、
  自动更新提示和 config loading/retry 行为保持不变。

## 迁移顺序

1. 建立 `@godgesture/ui` 包、token 样式、组件 API、测试环境和 workspace 依赖；先
   让共享组件独立通过单元测试。
2. 将 Web Console `src/ui` 原语切换到共享包，确保现有 Console 测试和视觉基线不
   回归；这一步验证包边界可以被私有 Server 子模块消费。
3. 重写 Desktop `main.ts` 与 `App.vue` 外壳，接入共享样式、Lucide、响应式导航、
   主题和 Toast/确认宿主，删除 Element 全局注入。
4. 按风险从基础页面到复杂页面迁移：Options、Logs、About、Account、Plugins、
   Templates，最后迁移 Gestures 及其 Intent/Command/Boundary/Export 等编辑器和
   多步弹窗。每一步保留原有 store 绑定和 i18n key。
5. 删除 Desktop 的 Element 依赖和所有残留 `el-*`、`ElMessage`、`ElMessageBox`、
   `@element-plus/icons-vue` 引用，清理仅服务 Element 的样式和类型。
6. 更新 ADR、`CONTEXT.md`/`docs/PROJECT_STATUS.md` 的现状说明和验证基线，记录
   Desktop 已切换到共享 UI、Web Console 复用共享原语及任何仍需真实平台验收的项。

## 验证

### 自动化

- `pnpm --filter @godgesture/ui test`：共享组件状态、键盘焦点、确认 Promise、Toast
  live region、主题 token 和 reduced-motion 契约。
- `pnpm --filter @godgesture/desktop test`、`typecheck`、`build`：Desktop 业务回归、
  Vue 类型和生产构建。
- `pnpm --filter @godgesture/server web:test`、`web:typecheck`、`web:build`：Console
  消费共享组件后原有页面与路由回归。
- `rg -n "element-plus|@element-plus/icons-vue|<el-|ElMessage|ElMessageBox" apps/desktop packages/ui`
  必须无结果；根 lockfile 中 Desktop 不再保留这两个依赖。

### 视觉与交互

- Desktop 浏览器预览和 Tauri 窗口验证浅色/深色主题、980x700 默认尺寸、800x560 最小
  尺寸、1024px 断点以及窄屏抽屉；页面级无横向溢出。
- 每个 section 至少验证加载、空、成功、错误、禁用和保存中状态；复杂编辑器验证
  添加/编辑/删除、取消、确认、Escape 和焦点恢复。
- Windows 与 macOS 只验收 UI 层在相同 Vue 构建下的行为；原生窗口按钮、拖拽区域、
  全局输入和权限能力继续按各自 QA 清单显式区分，不把浏览器预览当作平台验收。

## 风险与缓解

- **Server 子模块依赖协调**：`apps/server/package.json` 属于私有仓库。先在子模块
  中增加 `@godgesture/ui` 依赖并验证 web 构建，再由根仓库更新 gitlink；不在根仓库
  复制 Console 源码。
- **Element 行为隐式依赖**：迁移顺序先共享原语和 focused tests，再逐页替换；不
  以全局 CSS 兼容层假装已经移除 Element。
- **弹窗/焦点回归**：把 `AppDialog` 与确认服务作为独立组件测试，并在 Desktop
  页面测试中覆盖 Escape、取消和 busy 分支。
- **小窗口信息密度**：使用 44px 最小触控命中区和工作面内滚动；对复杂表格在窄屏
  显示堆叠字段，而不是缩小到不可读。
- **共享包版本漂移**：两端都使用同一 workspace 版本，UI 组件只接受稳定 props/slot
  contract；协议包 `packages/shared` 与 UI 包保持独立发布边界。

## 需要的架构记录

实现开始前新增 ADR-0017，记录 `@godgesture/ui` 的 workspace 位置、Vue peer 依赖、
Server 子模块消费方式、无业务/i18n 边界和 Desktop/Web Console 共用原语的验证责任。
该 ADR 不改变 ADR-0015/0016 的 Server 私有子模块与 Web Console ownership 结论。

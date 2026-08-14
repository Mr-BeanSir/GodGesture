# Desktop 与 Web Console 共用 Vue UI 原语包

## 状态

已采纳（2026-08-12）。本 ADR 记录共享 UI 重构设计中的包边界和验证责任，
不改变 ADR-0015/0016 关于 Server 私有子模块和 Web Console ownership 的结论。

## 背景

Desktop 设置界面原先依赖 Element Plus，而 Server-owned Web Console 已使用项目内
Vue 原语、Tailwind、CSS 变量和 Lucide。两端维护重复的按钮、标签、提示、弹窗、
加载、空状态和通知行为，会造成视觉和可访问性回归，也让 Desktop 无法遵循当前
Web Console 设计系统。

## 决策

- 在根 pnpm workspace 新增 `packages/ui`，包名为 `@godgesture/ui`；它是独立于
  `packages/shared` 的 Vue UI 包，不把 Vue 依赖或浏览器运行时引入协议包。
- `@godgesture/ui` 只提供无业务 UI 原语、`styles.css`、设计 token、Toast 状态和
  Promise 确认工具。组件通过 props、slots 和 DOM attrs 接收文案，不读取 router、
  store、API client 或任一应用的 i18n 实例。
- Vue 与 `lucide-vue-next` 作为 peer contract；Desktop 和 Server workspace 各自
  声明实际消费依赖，确保双方共享同一 workspace 版本，不隐式复制 Vue runtime。
- Web Console 仍由 `apps/server` 私有子模块拥有。其 `src/ui` 允许保留薄适配层，
  负责绑定 Console 的 vue-i18n 文案和既有测试选择器，但原语行为来自
  `@godgesture/ui`，不得复制第二套焦点、确认或 Toast 实现。
- Desktop 从 `main.ts` 引入共享样式和原语，页面特有布局与 store、Tauri、
  vue-i18n 绑定留在 Desktop。Element Plus、`@element-plus/icons-vue` 及其全局
  CSS 不再属于 Desktop 的运行时或构建依赖。
- Desktop 是固定尺寸的原生设置窗口，沿用 48px 顶栏、168px 常驻左栏和 30px
  底栏；不使用 viewport 断点、导航切换按钮或抽屉。共享 UI 的 Web Console 触控和
  多尺寸响应式规则不得反向改变 Desktop 的固定外壳和 32px 常规控件密度，页面既有
  的 36px/40px 工作面特例继续由 Desktop 自己保留。
- UI 迁移只改变呈现、交互反馈和无障碍行为，不改变配置协议、REST/OpenAPI、同步、
  原生输入/覆盖层、插件运行时、权限边界或页面业务语义。

## 验证责任

- `packages/ui` 必须独立通过组件状态、焦点、确认 Promise、Toast live region、
  token 和 reduced-motion 测试及类型检查。
- Server 子模块在增加 `@godgesture/ui` workspace 依赖后，必须通过 Web Console 的
  测试、类型检查和生产构建；根仓库只更新对应 gitlink，不复制 Console 源码。
- Desktop 迁移完成前必须通过 Desktop 测试、类型检查、生产构建，并且在源代码和
  lockfile 中不再出现 Element Plus 运行时依赖或 `el-*`/`ElMessage`/`ElMessageBox`
  引用。
- Desktop UI 验收覆盖浅色/深色、980x700 默认窗口、800x560 最小窗口、固定 48px
  顶栏、168px 常驻左栏、30px 底栏、32px 常规控件和工作面内溢出；不验收 Desktop
  的导航断点或抽屉。Web Console 单独验收自己的多尺寸响应式行为。Windows 与
  macOS 共用同一 Vue 构建，原生窗口和平台输入能力继续按各自 QA 清单验收。

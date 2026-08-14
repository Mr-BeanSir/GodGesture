# 系统配置折叠 Panel 设计

## 目标

降低管理员系统配置页在 panel 增多后的纵向滚动成本。页面首个“模板策略”
panel 初始展开，RustFS 和以后新增的 panel 初始收起；管理员可以独立展开或
收起任一 panel。

## 方案

在 `packages/ui` 新增无业务依赖的 `AppCollapsiblePanel`。组件接收受控的
`v-model:open`、稳定的内容区域 ID 和可访问名称；标题、摘要/状态和内容均通过
slot 提供。它使用原生 `button` 作为触发器，并输出：

- `aria-expanded` 表示当前状态；
- `aria-controls` 指向内容区域；
- 具名内容区域使用 `role="region"` 和触发器关联；
- 可见焦点环、Lucide Chevron 状态图标，以及 150-200ms 的非装饰性过渡；
- `prefers-reduced-motion` 下不依赖动画表达状态。

组件不读取 i18n、router、store、API 或本地存储。它不持久化展开状态，不修改
slot 内输入值，也不拦截表单提交。

`SystemConfigView` 用两个本地布尔值消费该组件：模板策略初始化为 `true`，RustFS
初始化为 `false`。RustFS 凭证状态徽章保留在可见标题区；测试连接、保存、错误和
加载逻辑保持原样。

## 测试

先为公共组件添加失败测试，覆盖默认/受控展开、点击切换、`aria-expanded`、
`aria-controls` 与内容可见性。再扩展系统配置页测试，验证初始状态为首项展开、
后续项收起，且展开 RustFS 后其原有测试连接和输入行为不变。

验证范围为 `@godgesture/ui` 定向测试和 typecheck、Web Console 的系统配置页
测试、typecheck 与生产构建。无需修改 REST/OpenAPI、Desktop 或 Server 业务逻辑。

## 非目标

- 不实现“全部展开/全部收起”全局命令。
- 不将展开状态保存到 localStorage、账户或服务端。
- 不改动系统配置字段、凭证处理、保存时机或 RustFS 连通性请求。

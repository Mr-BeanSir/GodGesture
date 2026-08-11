# Web Console 中文固定与管理员导航分区设计

## 背景

Server-owned Web Console 当前同时维护 `zh-CN` 与 `en` 两套文案，并在顶部提供语言切换。维护者确认该后台只需要简体中文；当前截图中的右上角语言控件也存在展示不完整的问题。左侧导航把普通用户工作区和管理员工作区放在同一组列表中，管理员入口缺少明显的层级分隔。

## 目标

- 仅将 `apps/server/web-console` 固定为简体中文；Desktop 的中英文支持不变。
- 删除 Web Console 的英文兼容面：英文 locale、浏览器语言检测、语言本地存储、顶部语言选择器及其测试分支。
- 保留 `vue-i18n` 的文案 key 层和 `zh-CN` 消息文件，避免把约 17 个生产文件中的文案改成硬编码，并为未来重新加入英文保留低成本入口。
- 将左侧导航拆为“用户功能”和“管理员功能”两个视觉分区；管理员分区只对管理员显示，并保留现有路由权限守卫。
- 去除语言选择器后保持顶部标题、主题切换和移动端导航按钮在 375/768/1024/1440px 下可用且不产生横向溢出。

## 非目标

- 不修改 `/api/v1`、OpenAPI、共享协议、认证模型或路由权限规则。
- 不改变管理员页面、模板审核页面或普通用户页面的业务功能。
- 不移除 `vue-i18n` 依赖，不迁移现有文案 key，不改变 Desktop 的 `zh-CN/en` locale。
- 不新增独立的管理员路由或面包屑体系。

## 方案

### 固定中文的 i18n 边界

`src/i18n/index.ts` 只加载 `zh-CN` 消息，locale 和 fallback 都固定为 `zh-CN`，删除 `ConsoleLocale`、浏览器语言检测、`godgesture.locale` localStorage 读写和可变 `setLocale` API。`main.ts` 继续注册 i18n，但只将 `<html lang>` 和标题初始化为中文。删除 `src/i18n/locales/en.ts`。

`ConsoleLayout.vue` 删除 `Languages` 图标、语言切换处理函数和 `#console-locale` 选择器；其余页面继续使用 `useI18n().t`，日期格式化继续使用固定的 `zh-CN` locale。测试统一使用中文消息，不再切换或断言英文文案；标题测试改为验证固定中文标题和 `lang="zh-CN"`。

### 导航层级

`ConsoleLayout.vue` 将当前扁平 `navItems` 拆为两个计算数组：

- 用户功能：概览、配置查看、设备、快照、账户安全。
- 管理员功能：管理员、模板审核；仅当 `auth.user.role === "admin"` 时渲染。

两个区域使用现有语义设计 token。管理员区域在顶部增加 `border-t`、足够的上内边距和可读的组标题（“管理员功能”）；用户区域也有对应的组标题（“用户功能”），以便视觉和辅助技术都能理解层级。导航按钮继续使用图标、文字、活动态和现有焦点行为。移动端抽屉复用同一 DOM 顺序、焦点陷阱和 Escape 关闭逻辑。

### 顶部布局

语言选择器移除后，顶部只保留移动端导航按钮、当前页面标题和主题切换按钮。标题保持 `min-w-0 flex-1 truncate`，主题按钮保留 40px 命中区域；不通过压缩文字或负间距解决布局问题。视觉验收同时覆盖浅色/深色主题和设计系统规定的四个视口。

## 影响文件

- 修改：`apps/server/web-console/src/i18n/index.ts`、`src/main.ts`、`src/layouts/ConsoleLayout.vue`、`src/i18n/locales/zh-CN.ts`。
- 删除：`apps/server/web-console/src/i18n/locales/en.ts`。
- 修改测试：i18n 依赖的布局、路由、视图、UI 与标题测试，删除语言切换专用断言并增加导航分区/固定中文断言。
- 不修改：根工作区、Shared、Desktop、Server API 和数据库迁移。

## 验证

- 单元测试：`pnpm --filter @godgesture/server web:test`。
- 类型检查：`pnpm --filter @godgesture/server web:typecheck`。
- 生产构建：`pnpm --filter @godgesture/server web:build`。
- 视觉检查：在 Web Console 预览中验证 375、768、1024、1440px 的浅色/深色主题，确认右上角无语言控件残留、管理员分区有分隔线和标题、普通用户看不到管理员分区、移动端抽屉焦点行为不回归。

## 取舍

彻底移除 `vue-i18n` 会牵涉约 17 个生产文件、约 378 个文案调用点和大部分测试，并把未来多语言恢复成本提高到重新改写所有文案调用；本设计只删除不需要的多语言兼容面，保留稳定的 key 层，因此改动更小、风险更低且未来可逆。

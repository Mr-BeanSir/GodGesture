# 手势模板列表卡片化美化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变模板数据、风险徽章逻辑或交互行为的前提下，将 Desktop 手势模板目录的连续分隔线列表调整为清晰的卡片式列表。

**Architecture:** 复用现有 `TemplatesView.vue` 的 DOM 和 `--gg-*` 设计 token，只调整 `.templates-view__list` 与 `.templates-view__row` 相关 CSS。模板条目继续是语义 `<button>`，保持现有两列信息结构、整行点击和键盘焦点行为；不触碰 Shared 协议、Store、API、详情页或采纳流程。

**Tech Stack:** Vue 3 SFC、TypeScript、scoped CSS、`@godgesture/ui` 设计 token、Vitest、pnpm workspace。

## Global Constraints

- 本次只改变模板列表的呈现方式，不改变模板数据、风险协议、详情页、采纳逻辑或列表的交互行为。
- 保留现有的统一风险徽章渲染，不拆分风险类型，不改变 `entry.risks` 的协议或 Store 处理。
- 使用项目现有 `--gg-*` 设计 token，不引入硬编码主题颜色。
- 保持 Desktop 固定窗口布局，不新增 Web Console 的响应式断点。
- 保持语义按钮、现有 `aria-label`、整行点击行为和 `:focus-visible` 键盘焦点反馈。
- 不修改 `apps/desktop/src/desktop.css` 中已有的滚动条改动。
- 显式执行 `git add <path>`，不使用 `git add -A`。

---

### Task 1: 将模板目录列表调整为卡片式视觉

**Files:**
- Modify: `apps/desktop/src/views/TemplatesView.vue:499-508`（`.templates-view__list`、`.templates-view__row` 及相关列表选择器）
- Test: `apps/desktop/src/views/__tests__/TemplatesView.test.ts`（只运行现有 focused 套件，不因纯 CSS 改动新增脆弱的源码字符串断言）

**Interfaces:**
- Consumes: 现有 `templates.filteredEntries`、`GestureTemplateCatalogEntry` 映射和模板列表 DOM。
- Produces: 视觉独立、可聚焦、可整行点击的模板卡片列表；不产生新的数据字段或组件接口。

- [ ] **Step 1: 在实现前确认干净基线**

运行：

```powershell
pnpm --filter @godgesture/desktop exec vitest run src/views/__tests__/TemplatesView.test.ts
```

预期：当前 `TemplatesView` focused 套件通过；如果基线失败，记录既有失败并保持本任务范围不变。

- [ ] **Step 2: 更新模板列表容器样式**

在 `TemplatesView.vue` 中把当前连续分隔线容器改为带条目间距的滚动网格，保留 `min-width`、`min-height`、纵向滚动和稳定滚动条占位；移除列表顶部的连续横线，并加入少量容器内边距以避免卡片焦点边框贴边：

```css
.templates-view__list {
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  overflow-y: auto;
  padding: 1px 2px 4px;
  scrollbar-gutter: stable;
}
```

- [ ] **Step 3: 更新模板条目卡片样式并保留现有信息层级**

将条目从无边框按钮改为独立卡片，同时保留现有两列布局和全部交互选择器。使用现有 token 实现默认、悬停和聚焦状态：

```css
.templates-view__row {
  width: 100%;
  min-height: 96px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 128px;
  gap: 18px;
  padding: 14px 16px;
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  color: var(--gg-text);
  background: var(--gg-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.templates-view__row:hover {
  border-color: var(--gg-primary-border);
  background: var(--gg-surface-hover);
}

.templates-view__row:focus-visible {
  outline: 2px solid var(--gg-ring);
  outline-offset: -2px;
}
```

继续保留 `.templates-view__row-main`、`.templates-view__row-meta`、`.templates-view__tags` 的现有 flex 结构和右侧作者/统一风险徽章内容；仅按新卡片内边距微调元信息列宽或垂直间距时，仍使用现有字号和 token。

- [ ] **Step 4: 运行 focused 回归验证**

运行：

```powershell
pnpm --filter @godgesture/desktop exec vitest run src/views/__tests__/TemplatesView.test.ts
git diff --check
```

预期：模板列表、详情工作区、外层 tabs、采纳忙碌态等现有测试通过；差异检查无空白错误。确认变更只涉及模板列表样式，不出现 `desktop.css` 或协议/Store 文件变化。

- [ ] **Step 5: 提交本次实现**

运行：

```powershell
git add -- apps/desktop/src/views/TemplatesView.vue
git commit -m "style: polish template catalog list"
```

提交前确认 `git diff --cached --stat` 只有模板视图文件，且不包含设计文档提交之外的其他文件。


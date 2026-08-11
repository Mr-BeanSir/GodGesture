# Web Console 中文固定与管理员导航分区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Server-owned Web Console 固定为简体中文，移除语言切换入口，并用明确的用户/管理员导航分区改善左侧层级。

**Architecture:** 保留 `vue-i18n` 作为单一中文文案 key 层，只加载 `zh-CN`，删除英文 locale、语言检测、locale 持久化和顶部选择器。ConsoleLayout 将扁平导航拆成用户区与管理员区，管理员区用现有语义 token 的分隔线和组标题表达层级，权限判断继续由路由守卫和角色条件共同承担。

**Tech Stack:** Vue 3 + TypeScript + Vite + Tailwind CSS v4 + `vue-i18n` + Vitest + Vue Test Utils；Server 私有子模块通过根工作区 `pnpm` 脚本构建。

## Global Constraints

- 仅修改 `apps/server/web-console` 的表现层与测试；不修改 `/api/v1`、OpenAPI、Shared、Desktop、认证模型或数据库迁移。
- Web Console 用户可见文案固定为 `zh-CN`；Desktop 继续保留 `zh-CN/en`。
- 保留 `vue-i18n` key 层，禁止把所有页面文案改成组件内硬编码字符串。
- 管理员分区只对 `auth.user.role === "admin"` 渲染；路由 `meta.admin` 守卫保持不变。
- 保留现有 248px 桌面侧栏、移动端抽屉焦点陷阱、Escape 关闭、活动路由态和 44px 移动端命中区域。
- 设计系统要求浅色/深色主题在 375、768、1024、1440px 验证，页面不得产生横向溢出。
- 根仓库和 `apps/server` 均只使用显式 `git add <path>`；不使用 `git add -A`，不 push。

---

### Task 1: Lock The Fixed Chinese Contract With Failing Tests

**Files:**
- Modify: `apps/server/web-console/src/ui/__tests__/design-tokens.test.ts`
- Modify: `apps/server/web-console/src/layouts/__tests__/ConsoleLayout.test.ts`
- Modify: `apps/server/web-console/src/views/__tests__/ConfigView.test.ts`
- Modify: `apps/server/web-console/src/views/__tests__/OAuthCallbackView.test.ts`

**Interfaces:**
- Consumes: current `i18n` instance and `ConsoleLayout` test mount helpers.
- Produces: failing assertions that prove only `zh-CN` is available, the document language is Chinese, the language selector is absent, and tests no longer rely on English-only branches.

- [ ] **Step 1: Replace the locale-switching design-token tests with fixed-Chinese assertions.**

  In `design-tokens.test.ts`, replace the two tests that call `setLocale("en")`/`setLocale("zh-CN")` with assertions equivalent to:

  ```ts
  it("keeps the console locale and document language fixed to zh-CN", () => {
    expect(i18n.global.locale.value).toBe("zh-CN");
    expect(i18n.global.availableLocales).toEqual(["zh-CN"]);
    expect(read("../../../index.html")).toContain('<html lang="zh-CN">');
  });
  ```

  Keep the existing theme contrast and token assertions unchanged. Remove the `setLocale` import and localStorage cleanup that only served the deleted language switch.

- [ ] **Step 2: Add layout assertions for the removed top-right selector.**

  In `ConsoleLayout.test.ts`, after mounting the layout assert that `#console-locale` is absent and the theme button remains labelled with the Chinese theme action. Keep the existing mobile focus tests intact.

- [ ] **Step 3: Remove test-only English locale mutations before production changes.**

  Change test setup values from `"en"` to `"zh-CN"`, remove `ConsoleLocale` imports and previous-locale restoration in `ConfigView.test.ts`, and reduce `OAuthCallbackView.test.ts` to the Chinese callback error cases. Do not change production code in this task.

- [ ] **Step 4: Run the focused tests and confirm the expected RED state.**

  Run from the root checkout:

  ```powershell
  pnpm --filter @godgesture/server exec vitest run --config web-console/vite.config.mts src/ui/__tests__/design-tokens.test.ts src/layouts/__tests__/ConsoleLayout.test.ts src/views/__tests__/ConfigView.test.ts src/views/__tests__/OAuthCallbackView.test.ts
  ```

  Expected: failures because the current app still exposes `en`, `setLocale`, the language selector, and English-specific test behavior. Fix only test syntax/setup errors; do not make production changes until the failure identifies the missing behavior.

### Task 2: Fix The Single-Locale Runtime

**Files:**
- Modify: `apps/server/web-console/src/i18n/index.ts`
- Modify: `apps/server/web-console/src/main.ts`
- Modify: `apps/server/web-console/src/layouts/ConsoleLayout.vue`
- Delete: `apps/server/web-console/src/i18n/locales/en.ts`
- Test: focused tests from Task 1

**Interfaces:**
- Consumes: `zh-CN` message object and existing `useI18n()` calls in views/components.
- Produces: an `i18n` instance with `locale: "zh-CN"`, `fallbackLocale: "zh-CN"`, and only one registered message locale; `main.ts` initializes `<html lang="zh-CN">` and the Chinese document title.

- [ ] **Step 1: Simplify `src/i18n/index.ts` to one immutable locale.**

  Keep `createI18n({ legacy: false })`, import only `zh-CN`, set `locale` and `fallbackLocale` to `"zh-CN"`, register `{ "zh-CN": zhCN }`, and delete `ConsoleLocale`, `LOCALE_STORAGE_KEY`, `detectLocale`, and `setLocale`.

- [ ] **Step 2: Initialize the static document language and title in `main.ts`.**

  Keep `app.use(i18n)`, then set `document.documentElement.lang = "zh-CN"` and `document.title = i18n.global.t("app.title")`. Remove the `setLocale` call and its type cast.

- [ ] **Step 3: Remove the language selector from `ConsoleLayout.vue`.**

  Delete the `Languages` import, `setLocale`/`ConsoleLocale` import, `locale` destructuring if it is no longer used by the layout, `switchLocale`, and the labelled `select#console-locale`. Preserve the header title, mobile menu button, theme toggle, and all accessibility labels.

- [ ] **Step 4: Run the focused tests and confirm GREEN.**

  Re-run the Task 1 command. Expected: all selected tests pass with no missing translation warnings and no `#console-locale` element.

### Task 3: Add Explicit User And Administrator Navigation Sections

**Files:**
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`
- Modify: `apps/server/web-console/src/layouts/ConsoleLayout.vue`
- Modify: `apps/server/web-console/src/layouts/__tests__/ConsoleLayout.test.ts`
- Modify: `apps/server/web-console/src/router/__tests__/access.test.ts`

**Interfaces:**
- Consumes: `auth.user.role`, existing `navItems` route names/icons, and the Chinese `t()` key layer from Task 2.
- Produces: `userNavItems` and `adminNavItems` computed arrays plus `data-nav-section="user|admin"` wrappers, with admin group rendered only for admin users.

- [ ] **Step 1: Add failing navigation-section tests.**

  In `ConsoleLayout.test.ts`, assert an administrator mount contains `[data-nav-section="user"]`, `[data-nav-section="admin"]`, visible Chinese headings `用户功能` and `管理员功能`, and the admin section has a top border class. Temporarily set `auth.user.role = "user"` in a separate test and assert the admin section and both admin route buttons are absent; restore the admin role in `afterEach`.

  In `access.test.ts`, keep the existing route guard cases and add a layout-level assertion only for rendered navigation visibility; do not weaken route access tests.

- [ ] **Step 2: Run only the new navigation tests and confirm RED.**

  ```powershell
  pnpm --filter @godgesture/server exec vitest run --config web-console/vite.config.mts src/layouts/__tests__/ConsoleLayout.test.ts src/router/__tests__/access.test.ts
  ```

  Expected: failures because the current layout has one flat navigation list and no section markers.

- [ ] **Step 3: Split the computed navigation arrays.**

  In `ConsoleLayout.vue`, define the five regular items in `userNavItems`; define `adminNavItems` as the existing administrator and template moderation entries gated by `auth.user?.role === "admin"`. Keep `activeName`, `onSelect`, route focus, and the existing icon components unchanged.

- [ ] **Step 4: Render semantic section wrappers and Chinese headings.**

  Add `nav.userSection` and `nav.adminSection` to `zh-CN.ts`. Render the user group first. When admin items exist, render a second wrapper with `mt-5 border-t border-[var(--gg-border)] pt-4`, a small visible heading using `text-[var(--gg-text-muted)]`, and the same button class/active-state logic. Keep the shared `nav` landmark, scroll behavior, and drawer focus query working.

- [ ] **Step 5: Run the navigation tests and confirm GREEN.**

  Re-run the Task 3 command. Expected: admin users see both groups and non-admin users see only the user group; existing focus and route guard tests remain green.

### Task 4: Full Console Verification, Documentation, And Submodule Commits

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: affected tests under `apps/server/web-console/src/**/__tests__` only as required by Tasks 1-3
- Commit in submodule: `apps/server` Web Console source/tests and deleted English locale
- Commit in root: `apps/server` gitlink update and `docs/PROJECT_STATUS.md`

**Interfaces:**
- Consumes: fixed Chinese runtime and grouped navigation from Tasks 2-3.
- Produces: a buildable Server submodule, a root gitlink pointing at the tested submodule commit, and current project status documenting the new Console baseline.

- [ ] **Step 1: Run the complete Web Console test suite.**

  ```powershell
  pnpm --filter @godgesture/server web:test
  ```

  Expected: Vitest completes with zero failed files and no Vue warning caused by missing i18n messages.

- [ ] **Step 2: Run typecheck and production Web Console build.**

  ```powershell
  pnpm --filter @godgesture/server web:typecheck
  pnpm --filter @godgesture/server web:build
  ```

  Expected: both commands exit 0 and generate the Server-owned static output.

- [ ] **Step 3: Run the browser visual checks.**

  Start the existing Web Console preview/dev flow and inspect 375px, 768px, 1024px, and 1440px in light and dark themes. Confirm the top-right language selector is absent, the theme control remains fully visible, the administrator divider/title appears only for admin fixtures, and no page-level horizontal overflow is introduced. Confirm mobile drawer Escape/Tab focus behavior manually or through the existing focus tests.

- [ ] **Step 4: Update the current status entry.**

  Add a dated note under the Web Console current-state section in `docs/PROJECT_STATUS.md`: the Console is zh-CN-only, retains the `vue-i18n` key layer, no longer exposes a language selector, and separates user/admin navigation; record the exact test/typecheck/build commands from this task after they pass.

- [ ] **Step 5: Commit the private Server submodule changes explicitly.**

  From `apps/server`, stage only the changed Web Console files and tests, then commit with an English message such as:

  ```powershell
  git add web-console/src/i18n/index.ts web-console/src/i18n/locales/en.ts web-console/src/main.ts web-console/src/layouts/ConsoleLayout.vue web-console/src/i18n/locales/zh-CN.ts web-console/src/layouts/__tests__/ConsoleLayout.test.ts web-console/src/router/__tests__/access.test.ts web-console/src/ui/__tests__/design-tokens.test.ts web-console/src/views/__tests__/ConfigView.test.ts web-console/src/views/__tests__/OAuthCallbackView.test.ts
  git commit -m "feat: simplify console language and admin navigation"
  ```

  The delete path for `web-console/src/i18n/locales/en.ts` must be staged explicitly; do not stage unrelated Server files.

- [ ] **Step 6: Commit the root status and gitlink update explicitly.**

  From the root checkout, stage only `apps/server` and `docs/PROJECT_STATUS.md`, verify the staged diff points at the tested submodule commit, then commit with:

  ```powershell
  git add apps/server docs/PROJECT_STATUS.md
  git commit -m "feat: simplify web console navigation"
  ```

  Do not stage the root checkout's pre-existing template changes, and do not push either repository.

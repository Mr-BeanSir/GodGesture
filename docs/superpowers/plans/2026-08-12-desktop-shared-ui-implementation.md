# Desktop 与 Web Console 共享 UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Desktop 与 Server-owned Web Console 迁移到同一套 `@godgesture/ui` Vue 原语和设计 token，同时保留现有业务、协议、平台和文案行为。

**Architecture:** 根 workspace 的 `packages/ui` 只提供无业务 Vue 原语、CSS token、焦点/确认/Toast 工具；`packages/shared` 保持协议包且不依赖 Vue。Web Console 在私有 `apps/server` 子模块内用薄适配层消费共享原语，Desktop 在自己的页面中消费原语并保留 store、Tauri 和 vue-i18n 绑定。

**Tech Stack:** pnpm workspace、Vue 3、TypeScript、Vite、Vitest、Vue Test Utils、Lucide Vue、Tauri 2、Tailwind v4（Web Console）。

## Global Constraints

- `packages/shared` 不引入 Vue、浏览器 API、Pinia、Tailwind 或 `lucide-vue-next`。
- `@godgesture/ui` 不调用 router、store、API client 或全局 i18n，也不导出业务页面和默认文案。
- Desktop 保留 `zh-CN/en` 和 `preferences.locale`；Web Console 固定 `zh-CN` 并保留 key 层。
- 不修改协议、API、同步数据、原生覆盖层、插件运行时、权限和页面业务语义。
- 所有图标使用 Lucide；图标按钮保留可见 `aria-label` 和 `title`；不可逆动作保持确认。
- Web Console 共享 UI 默认桌面控件 40px、窄屏交互控件至少 44px；Desktop 固定
  设置窗口通过 `apps/desktop/src/desktop.css` 将常规控件固定为 32px，并在工作面内
  滚动，不产生页面级横向溢出。
- Windows 与 macOS 共用同一 Vue 构建；平台原生能力仍需分别验收并显式记录 pending。
- 每个改动显式 `git add <path>`；不使用 `git add -A`，默认不 push。

---

### Task 1: Shared UI package contract

**Files:**

- Create/modify: `packages/ui/package.json`, `packages/ui/src/index.ts`, `packages/ui/src/styles.css`, `packages/ui/src/components/*`, `packages/ui/src/confirm.ts`, `packages/ui/src/toast.ts`
- Test: `packages/ui/src/__tests__/*`
- Create: `docs/adr/0017-shared-vue-ui-package.md`

**Interfaces:**

- Produces `AppButton`, `AppBadge`, `AppAlert`, `AppDialog`, `AppEmptyState`, `AppSpinner`, `AppSkeleton`, `ToastViewport`, `pushToast` and `useConfirmDialog`.
- `AppDialog` exposes `open`, `title`, `closeLabel`, `busy` and `close` event; it traps Tab, handles Escape/backdrop unless busy, and restores the opening focus target.
- `useConfirmDialog().confirm(request)` returns `Promise<boolean>` and `resolveConfirm(value)` settles the current request once.

- [x] Repair the CSS contract test so it reads `styles.css` reliably under Vitest.
- [x] Run `pnpm --filter @godgesture/ui test` and `pnpm --filter @godgesture/ui typecheck`.
- [x] Add any missing contract tests discovered while integrating both consumers.

### Task 2: Web Console consumer migration

**Files:**

- Modify: `apps/server/package.json`, `apps/server/web-console/vite.config.mts`, `apps/server/web-console/src/main.ts`, `apps/server/web-console/src/ui/*`
- Test: `apps/server/web-console/src/**/__tests__/*`

**Interfaces:**

- Consumes the root `@godgesture/ui` exports and `@godgesture/ui/styles.css`.
- Produces unchanged local component names, slots, i18n calls and selectors for existing Console pages/tests.

- [x] Add workspace UI and Vue/Lucide peer consumers to the Server package manifest and lockfile.
- [x] Replace duplicated primitive implementation with thin adapters or direct shared exports.
- [x] Preserve Console-specific i18n and Tailwind page classes.
- [x] Run `pnpm --filter @godgesture/server web:test`, `web:typecheck`, and `web:build`.

### Task 3: Desktop shell and runtime removal

**Files:**

- Modify: `apps/desktop/package.json`, `apps/desktop/src/main.ts`, `apps/desktop/src/App.vue`, `apps/desktop/src/locales/*`
- Create/modify: `apps/desktop/src/components/UiConfirmHost.vue`, `apps/desktop/src/components/UiToastHost.vue` as needed
- Test: `apps/desktop/src/__tests__/*`, `apps/desktop/src/components/__tests__/*`

**Interfaces:**

- Consumes shared styles/primitives while keeping existing Pinia stores, Tauri commands, active section routing and locale keys.
- Produces fixed 48px header, fixed 168px persistent sidebar, 30px footer, Toast host and confirm host; Desktop has no viewport navigation breakpoint or drawer.

- [x] Write shell tests for section selection, loading/error/retry, theme/locale controls, persistent navigation and fixed Desktop density.
- [x] Replace Element global registration, menus, tooltips, result, skeleton and tag with native/shared UI.
- [x] Wire shared Toast/confirm hosts and replace App-level message calls.
- [x] Replace Element/Lucide imports and update manifest/lockfile.

### Task 4: Desktop page migration

**Files:**

- Modify: `apps/desktop/src/views/{Options,Logs,About,Account,Plugins,Templates,Gestures}View.vue`
- Modify: `apps/desktop/src/components/*.vue`
- Test: affected existing tests plus focused component tests for dialog, form, save, delete, confirm, Escape and focus restoration.

**Interfaces:**

- Consumes the same stores, backend methods, command editors, template/plugin adoption flows and locale keys.
- Produces native semantic controls with `.gg-*` classes, Lucide icons, shared dialogs/alerts/badges/loading/empty states and work-surface-local overflow.

- [x] Migrate low-risk pages first: Options, Logs, About, Account, Plugins, Templates.
- [x] Migrate Gestures and all intent/command/boundary/export/capture dialogs last.
- [x] Replace every `ElMessage` with `pushToast` and every `ElMessageBox.confirm` with the shared confirmation host.
- [x] Remove every `el-*`, Element import and Element-only style rule.

### Task 5: Full verification and status handoff

**Files:**

- Modify: `CONTEXT.md`, `docs/PROJECT_STATUS.md`, `docs/adr/README.md`
- Verify: root lockfile, all Desktop/Console/UI sources and builds.

- [x] Run shared UI tests/typecheck.
- [x] Run Desktop tests, typecheck and build with an independent `CARGO_TARGET_DIR` if Tauri locks the default target.
- [x] Run Server Console tests, typecheck and build.
- [x] Run repository layout and relevant protocol/regression tests.
- [x] Run the required Element residual scan and confirm Desktop no longer declares either Element package.
- [x] Record actual UI verification and any remaining Windows/macOS native pending items in `docs/PROJECT_STATUS.md`.

# Desktop Shared UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tauri Desktop Vue interface use the Web Console design system, remove Element Plus completely from Desktop, and share framework-neutral UI primitives between Desktop and the Server-owned Web Console through `@godgesture/ui`.

**Architecture:** Keep `packages/shared` protocol-only. Add a root workspace package at `packages/ui` that exports Vue UI primitives, CSS tokens, styles, and generic toast/confirmation behavior without app stores, routes, or i18n. Desktop and `apps/server/web-console` consume that package while retaining their own page layouts, business stores, and localization. The private Server submodule receives a workspace dependency and the root repository records its gitlink after the submodule change is committed.

**Tech Stack:** Vue 3.5, TypeScript, Vite, Vue Test Utils/Vitest, `lucide-vue-next`, native HTML form controls, CSS custom properties, pnpm workspace, Tauri 2.

## Global Constraints

- `packages/shared` remains free of Vue, browser APIs, Pinia, Tailwind, and UI dependencies.
- UI copy remains in each app's existing `vue-i18n` keys; `@godgesture/ui` has no hard-coded Chinese or English copy.
- Desktop retains `zh-CN/en`; Web Console remains fixed to `zh-CN` as recorded by ADR-0016.
- Existing Desktop stores, API clients, Tauri commands, window controls, native overlays, and business behavior remain unchanged.
- Use `uv run python` for every Python script invoked during implementation or verification.
- Preserve unrelated worktree changes; stage only files belonging to the current task with explicit paths.
- Web Console UI must match `design-system/godgesture-web-console/MASTER.md`: semantic `--gg-*` tokens, 40px desktop controls, 44px narrow-window hit targets, visible focus, reduced motion, and no decorative gradients. Desktop is a fixed native settings window with a local 32px compact density layer; Desktop does not inherit Web Console viewport navigation breakpoints or drawers.

---

### Task 1: Scaffold the shared UI workspace package

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/styles.css`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/package.json`
- Modify: `apps/server/package.json` in the private Server submodule

**Interfaces:**
- Produces package name `@godgesture/ui` with exports for `./src/index.ts`, `./styles.css`, and `./test-utils`.
- Declares Vue and `lucide-vue-next` as peer dependencies; both consuming apps declare compatible workspace dependencies.
- `packages/ui/src/styles.css` owns the complete `--gg-*` light/dark token set and shared `.gg-*` base styles.

- [ ] **Step 1: Write the package contract test**

Create `packages/ui/src/__tests__/package-contract.test.ts` that imports the package entry and asserts the named exports exist, and reads the stylesheet text to assert `--gg-canvas`, `--gg-surface`, `--gg-primary`, `--gg-ring`, `@media (prefers-reduced-motion: reduce)`, `.gg-input`, and `.gg-table` are present.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @godgesture/ui test -- package-contract`

Expected: FAIL because the package and exports do not exist yet.

- [ ] **Step 3: Add the package metadata and source entry**

Use an ESM package with `type: "module"`, `private: true`, Vue `^3.5.0` and `lucide-vue-next` `^1.0.0` peer ranges, and scripts `test`, `typecheck`, and `build` that compile the package through the existing workspace toolchain. Export each component only from `src/index.ts`; do not export app-specific helpers.

- [ ] **Step 4: Port the Web Console token and base CSS**

Move the semantic values from `apps/server/web-console/src/styles.css` into `packages/ui/src/styles.css`, including `:root` and `:root.dark`, font stack, box sizing, focus ring, selection, reduced-motion rules, `.gg-panel`, `.gg-input`, `.gg-textarea`, `.gg-select`, `.gg-table-wrap`, `.gg-table`, `.gg-page-heading`, and `.gg-page-copy`. Add native checkbox/switch/number, button, badge, alert, dialog, skeleton, toast, and sr-only styles with no `el-*` selectors.

- [ ] **Step 5: Add workspace dependencies and install**

Add `@godgesture/ui: workspace:*` and `lucide-vue-next` to Desktop. Add `@godgesture/ui: workspace:*` to the private Server package and commit that submodule change in its own repository before updating the root gitlink. Run `pnpm install --lockfile-only` from the root and confirm the lockfile has no Element dependency entry under Desktop.

- [ ] **Step 6: Run the package contract test and typecheck**

Run: `pnpm --filter @godgesture/ui test -- package-contract` and `pnpm --filter @godgesture/ui typecheck`.

Expected: PASS with no warnings.

- [ ] **Step 7: Commit the package scaffold**

Commit the root package, root lockfile, Desktop package metadata, and the separately committed Server submodule dependency with English messages. Do not stage unrelated worktree files.

### Task 2: Implement shared UI primitives and interaction services

**Files:**
- Create: `packages/ui/src/components/AppButton.vue`
- Create: `packages/ui/src/components/AppBadge.vue`
- Create: `packages/ui/src/components/AppAlert.vue`
- Create: `packages/ui/src/components/AppDialog.vue`
- Create: `packages/ui/src/components/AppEmptyState.vue`
- Create: `packages/ui/src/components/AppSpinner.vue`
- Create: `packages/ui/src/components/AppSkeleton.vue`
- Create: `packages/ui/src/components/ToastViewport.vue`
- Create: `packages/ui/src/toast.ts`
- Create: `packages/ui/src/confirm.ts`
- Create: `packages/ui/src/test-utils.ts`
- Create: `packages/ui/src/__tests__/AppButton.test.ts`
- Create: `packages/ui/src/__tests__/AppDialog.test.ts`
- Create: `packages/ui/src/__tests__/toast.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- `AppButton` props: `variant`, `size`, `loading`, `disabled`, `type`; forwards attrs and slots; loading disables activation and sets `aria-busy`.
- `AppBadge` prop `variant`; default slot is the visible label.
- `AppAlert` props: `variant`, `title`, `dismissible`; default and action slots; uses `role="alert"` for error/warning and `role="status"` for info/success.
- `AppDialog` props: `open`, `title`, `closeLabel`, `busy`, `initialFocus`; emits `close`; default/footer slots; exposes no app state.
- `pushToast({ kind, message, duration? })` returns a toast id; `dismissToast(id)` removes it; `ToastViewport` renders a live region.
- `useConfirmDialog()` returns `confirm(request): Promise<boolean>` and `resolveConfirm(value)`; the host renders one `AppDialog`.

- [ ] **Step 1: Write failing component tests**

Test that `AppButton` disables while loading, preserves an accessible loading description, and applies the primary/secondary classes; `AppDialog` emits close on Escape and restores focus to the trigger; and `pushToast` renders text in an `aria-live` region then removes it after a fake timer.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @godgesture/ui test -- AppButton AppDialog toast`

Expected: FAIL because the components and services are not implemented.

- [ ] **Step 3: Implement the primitives with native semantics**

Use Lucide icons only for semantic status/action indicators. Keep all copy in props/slots. Implement the dialog focus trap for Tab/Shift+Tab, initial focus, focus restoration, Escape, busy close protection, and modal backdrop. Use Teleport to `body` only for overlays/toasts.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter @godgesture/ui test -- AppButton AppDialog toast`.

Expected: PASS with the live-region and focus assertions green.

- [ ] **Step 5: Run package typecheck and commit**

Run: `pnpm --filter @godgesture/ui typecheck`; then commit only the shared UI source and tests with `feat: add shared ui primitives`.

### Task 3: Switch Web Console primitives to `@godgesture/ui`

**Files:**
- Modify: `apps/server/web-console/src/main.ts`
- Modify: `apps/server/web-console/src/styles.css`
- Modify: `apps/server/web-console/src/ui/AppButton.vue`
- Modify: `apps/server/web-console/src/ui/AppBadge.vue`
- Modify: `apps/server/web-console/src/ui/AppAlert.vue`
- Modify: `apps/server/web-console/src/ui/AppDialog.vue`
- Modify: `apps/server/web-console/src/ui/AppEmptyState.vue`
- Modify: `apps/server/web-console/src/ui/AppSpinner.vue`
- Modify: `apps/server/web-console/src/ui/ToastViewport.vue`
- Modify: `apps/server/web-console/src/ui/toast.ts`
- Modify: `apps/server/web-console/src/layouts/ConsoleLayout.vue`
- Modify: `apps/server/web-console/src/ui/__tests__/*.test.ts`

**Interfaces:**
- Console keeps existing imports and test selectors where practical, but each local UI file becomes a thin typed re-export/adapter over `@godgesture/ui`.
- Console `pushToast` and `AppDialog` continue accepting its existing local call shapes so route/view code does not change in this task.

- [ ] **Step 1: Add a failing integration assertion**

Update `apps/server/web-console/src/ui/__tests__/design-tokens.test.ts` to assert the app imports the shared stylesheet and no local token diverges from the shared light/dark values.

- [ ] **Step 2: Run Console UI tests to verify the assertion fails**

Run: `pnpm --filter @godgesture/server web:test -- src/ui/__tests__/design-tokens.test.ts`.

Expected: FAIL until Console imports `@godgesture/ui/styles.css` and removes duplicate tokens.

- [ ] **Step 3: Replace local primitive implementations with adapters**

Import shared components and services, preserve Console-specific `useI18n` labels through props/slots, remove duplicated CSS from `src/styles.css` only where it is owned by the package, and keep page/layout utility classes intact.

- [ ] **Step 4: Run the Console UI and route tests**

Run: `pnpm --filter @godgesture/server web:test`; expected all existing tests plus the token assertion pass.

- [ ] **Step 5: Run Console typecheck/build and commit the submodule**

Run: `pnpm --filter @godgesture/server web:typecheck` and `pnpm --filter @godgesture/server web:build`. Commit the private submodule change with `refactor: consume shared ui primitives`, then update the root gitlink in a separate root commit.

### Task 4: Replace Desktop global styles and shell

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/components/WindowControls.vue`
- Modify: `apps/desktop/src/components/QuickStartDialog.vue`
- Create: `apps/desktop/src/__tests__/AppShell.test.ts`
- Modify: `apps/desktop/src/locales/zh-CN.ts`
- Modify: `apps/desktop/src/locales/en.ts`

**Interfaces:**
- `App.vue` remains the section switcher and continues to expose `openGuideDestination`, single-instance notification, saved locale, theme query preview, config retry, and automatic update prompt behavior.
- Shell layout uses shared `AppButton`, `AppBadge`, `AppAlert`, `AppDialog`, `ToastViewport`, and Lucide icons; window control commands remain `minimizeWindow` and `closeWindow`.

- [ ] **Step 1: Write failing shell tests**

Add tests that mount `App.vue` in browser mock mode and assert no `el-*` elements, a fixed 48px header, persistent 168px navigation, the semantic navigation buttons, theme control accessible name, pause control state, footer save status, and config error retry are rendered.

- [ ] **Step 2: Run shell tests to verify they fail**

Run: `pnpm --filter @godgesture/desktop test -- AppShell`.

Expected: FAIL because the current shell is Element-based and uses the old token set.

- [ ] **Step 3: Remove Element global injection and rewrite the shell template**

Import `@godgesture/ui/styles.css`, replace `el-container`, `el-header`, `el-aside`, `el-main`, `el-footer`, `el-menu`, `el-button`, `el-select`, `el-result`, `el-skeleton`, and `el-tag` with semantic HTML/shared primitives. Keep the Windows drag region and custom controls. Implement the fixed 48px header, 168px persistent sidebar, 30px footer, and Desktop-only compact density layer. Do not add a viewport breakpoint or navigation drawer; Web Console owns its own responsive navigation.

- [ ] **Step 4: Replace shell icon/message imports**

Map Element icon names to Lucide equivalents (`Play`, `Pause`, `Moon`, `Sun`, `Settings`, `Info`, `Files`, `User`, `ListTree`, and `Link`). Replace `ElMessage` with `pushToast` and `ElMessageBox` with the shared confirmation host. Delete Element locale imports and provider.

- [ ] **Step 5: Run shell tests and Desktop typecheck**

Run: `pnpm --filter @godgesture/desktop test -- AppShell` and `pnpm --filter @godgesture/desktop typecheck`; expected PASS.

- [ ] **Step 6: Commit the shell migration**

Commit Desktop shell files and tests with `refactor: align desktop shell with console ui`.

### Task 5: Migrate Desktop low-risk views and shared editor controls

**Files:**
- Modify: `apps/desktop/src/views/OptionsView.vue`
- Modify: `apps/desktop/src/views/LogsView.vue`
- Modify: `apps/desktop/src/views/AboutView.vue`
- Modify: `apps/desktop/src/views/AccountView.vue`
- Modify: `apps/desktop/src/components/AppDialog.vue`
- Modify: `apps/desktop/src/components/ArgbColorPicker.vue`
- Modify: `apps/desktop/src/components/HotkeyInput.vue`
- Modify: `apps/desktop/src/components/CommandEditor.vue`
- Modify: `apps/desktop/src/components/NodePluginPicker.vue`
- Modify: `apps/desktop/src/components/BoundaryIntentEditor.vue`
- Modify: `apps/desktop/src/components/IntentEditor.vue`
- Modify: relevant `apps/desktop/src/**/*.test.ts`

**Interfaces:**
- Existing `v-model` and emits for preferences, logs, account, command editors, and app binding remain unchanged.
- All status messages use `pushToast`; all destructive confirmations use `useConfirmDialog`; all fields use shared native control classes.

- [ ] **Step 1: Add focused failing tests for one representative per view**

Cover an Options switch update, Logs filter/error/clear confirmation, Account login or session error, and CommandEditor command-type selection. Assert native controls and shared class names are rendered instead of `el-*` components.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter @godgesture/desktop test -- OptionsView LogsView AccountView CommandEditor`.

Expected: FAIL against the current Element markup.

- [ ] **Step 3: Replace controls and status surfaces**

Use labelled native controls with `.gg-input`, `.gg-select`, `.gg-switch`, `.gg-checkbox`, `.gg-number`, shared buttons/badges/alerts/empty/spinner/skeletons, and keep existing CSS layout classes only where they do not reference `--el-*` variables.

- [ ] **Step 4: Replace logs and account dialogs**

Use semantic table/list markup and `AppDialog` for clear confirmation, login errors, logout, and provider actions. Preserve auto-follow, export, filtering, pagination, loading and retry behavior.

- [ ] **Step 5: Run focused tests, typecheck and build**

Run the focused Desktop tests, `pnpm --filter @godgesture/desktop typecheck`, and `pnpm --filter @godgesture/desktop build`; expected PASS.

- [ ] **Step 6: Commit low-risk view migration**

Commit with `refactor: migrate desktop settings and account views`.

### Task 6: Migrate Plugins and Templates views

**Files:**
- Modify: `apps/desktop/src/views/PluginsView.vue`
- Modify: `apps/desktop/src/views/TemplatesView.vue`
- Modify: `apps/desktop/src/components/TemplateSubmissionReview.vue`
- Modify: `apps/desktop/src/components/GestureExportDialog.vue`
- Modify: `apps/desktop/src/components/TemplateDetailDialog.vue` if present
- Modify: relevant `apps/desktop/src/**/*.test.ts`

**Interfaces:**
- Plugin catalog, install confirmation, open-directory actions, template catalog filters, detail inspector, adoption policy, risk confirmation, export and submission flows keep existing store method names and emitted events.

- [ ] **Step 1: Add failing tests for catalog and adoption states**

Assert native filter controls, shared badges, loading/empty/error states, a shared confirmation dialog for install/adoption, and no `el-*` nodes in the representative plugin/template mounts.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter @godgesture/desktop test -- PluginsView TemplatesView`.

Expected: FAIL because the current catalog/detail views render Element controls.

- [ ] **Step 3: Convert list/detail layouts to Console-style working surfaces**

Use a bordered surface with a header, toolbar, table/list, detail inspector, status badges, and one primary action per surface. Keep table overflow inside the list surface and keep Desktop workbench rails at their original fixed widths; do not add a Desktop narrow breakpoint. Web Console may retain its own responsive detail behavior.

- [ ] **Step 4: Convert multi-step and review dialogs**

Use `AppDialog`, native radio/checkbox controls, shared alert/badge components, and the existing i18n keys. Busy adoption/submission states must prevent Escape, backdrop, or close-button bypass.

- [ ] **Step 5: Run focused tests, typecheck and build**

Run `pnpm --filter @godgesture/desktop test -- PluginsView TemplatesView`, `pnpm --filter @godgesture/desktop typecheck`, and `pnpm --filter @godgesture/desktop build`; expected PASS.

- [ ] **Step 6: Commit catalog migration**

Commit with `refactor: migrate desktop plugin and template views`.

### Task 7: Migrate Gestures and action editors

**Files:**
- Modify: `apps/desktop/src/views/GesturesView.vue`
- Modify: `apps/desktop/src/components/AddActionDialog.vue`
- Modify: `apps/desktop/src/components/CaptureDialog.vue`
- Modify: `apps/desktop/src/components/IntentEditor.vue`
- Modify: `apps/desktop/src/components/BoundaryIntentEditor.vue`
- Modify: `apps/desktop/src/components/CommandEditor.vue`
- Modify: `apps/desktop/src/components/MnemonicIcon.vue`
- Modify: `apps/desktop/src/components/MnemonicText.vue`
- Modify: relevant `apps/desktop/src/utils/__tests__/*.test.ts` and new view tests

**Interfaces:**
- Gesture group selection, app drag/drop, add/edit/delete, boundary sequence builder, capture window, command editor, mnemonic rendering, conflict detection and autosave retain current models, emits, store methods and shared asset paths.

- [ ] **Step 1: Add failing gesture editor tests**

Cover adding a regular gesture, building a boundary sequence, deleting an action after confirmation, command type switching, capture cancel/confirm, and rendering the shared mnemonic asset. Assert the new controls are keyboard reachable and no Element markup remains.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter @godgesture/desktop test -- GesturesView AddActionDialog IntentEditor CommandEditor`.

Expected: FAIL until the Element dialog/forms are replaced.

- [ ] **Step 3: Convert the main gesture workbench**

Use a Console-style split work surface: group/app navigation on the left, gesture/action table in the center, and selected editor/inspector on the right where the current layout supports it. Keep drag handles and action affordances with visible focus and 40/44px hit targets.

- [ ] **Step 4: Convert all editor dialogs and controls**

Replace every Element dialog/select/radio/checkbox/input-number/switch/tooltip/icon with shared dialog/native controls/Lucide/title. Preserve validation, disabled states, sequence limits, command-specific fields and save scheduling.

- [ ] **Step 5: Run gesture tests, typecheck and build**

Run `pnpm --filter @godgesture/desktop test -- GesturesView AddActionDialog IntentEditor CommandEditor`, `pnpm --filter @godgesture/desktop typecheck`, and `pnpm --filter @godgesture/desktop build`; expected PASS.

- [ ] **Step 6: Commit gesture migration**

Commit with `refactor: migrate desktop gesture editors`.

### Task 8: Remove Element dependencies and update architecture/status docs

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/adr/README.md`
- Create: `docs/adr/0017-shared-vue-ui-package.md`
- Modify: `CONTEXT.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `apps/desktop/README.md`
- Modify: `AGENTS.md` only if an implementation rule needs clarification

- [ ] **Step 1: Add ADR-0017**

Record that `packages/ui` is the shared Vue UI package, `packages/shared` remains protocol-only, both apps consume the same package, and private Server submodule commits/gitslinks are required. Reference ADR-0015 and ADR-0016 without changing their ownership conclusions.

- [ ] **Step 2: Delete Element imports and dependencies**

Run a repository scan scoped to Desktop and shared UI. Remove all Element packages from `apps/desktop/package.json`, remove Element CSS imports from `main.ts`, and delete every `el-*`, `ElMessage`, `ElMessageBox`, `@element-plus/icons-vue`, and `--el-*` reference under Desktop.

- [ ] **Step 3: Update project status and Desktop README**

Record the shared UI package, Desktop Element removal, current automated verification, and remaining real Windows/macOS platform QA boundaries. Document `pnpm --filter @godgesture/ui` checks and the browser preview dimensions.

- [ ] **Step 4: Run the full scoped verification**

Run:

```powershell
pnpm --filter @godgesture/ui test
pnpm --filter @godgesture/ui typecheck
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
pnpm --filter @godgesture/server web:test
pnpm --filter @godgesture/server web:typecheck
pnpm --filter @godgesture/server web:build
```

Expected: all commands pass; only known platform QA items remain pending.

- [ ] **Step 5: Commit documentation and dependency cleanup**

Stage explicit root paths and the already committed Server gitlink; commit with `refactor: finalize shared desktop console ui`.

### Task 9: Browser and Tauri visual verification

**Files:**
- Modify only files needed to correct verified UI regressions.
- Create: `apps/desktop/src/__tests__/visual-contract.test.ts` if a deterministic DOM contract is missing.

- [ ] **Step 1: Start the browser preview**

Run: `pnpm --filter @godgesture/desktop dev -- --host 127.0.0.1` on an unused port, then inspect the mock preview routes with the browser skill. Use the existing `?guide=0&updates=0` query to make the shell deterministic.

- [ ] **Step 2: Capture required viewports and themes**

Check Desktop at 980x700 and 800x560 in light and dark themes. Verify the fixed shell, persistent navigation, compact controls including Teleport dialogs, each section, Toast, loading/error/empty states, focus rings, and no page-level horizontal overflow. Verify Web Console responsive viewports in its own Server-owned workflow.

- [ ] **Step 3: Correct only evidence-backed visual regressions**

Keep changes limited to token/layout/control issues demonstrated by the screenshots or DOM measurements. Do not restore Element styles or add broad global overrides.

- [ ] **Step 4: Run the final verification commands**

Repeat the scoped tests/typechecks/builds from Task 8 after visual fixes and record the viewport/theme evidence in `docs/PROJECT_STATUS.md`.

- [ ] **Step 5: Commit final verification fixes**

Commit only the verified corrections with an English message; do not push by default.

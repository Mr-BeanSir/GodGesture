# Gesture Transfer and Group/App Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local gesture-template import and consolidate the Gestures page transfer and group/app actions behind accessible card-selection dialogs.

**Architecture:** Add a business-free `AppChoiceDialog` UI primitive, extend the existing typed Tauri backend with a bounded JSON-open command, and let a Desktop import dialog enter the existing templates store adoption context. The Gestures page only routes selection results; the shared plan/adopt logic remains the single source for online and local template adoption.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Pinia, `@godgesture/ui`, `@godgesture/shared` template protocol/adoption, Tauri 2 dialog plugin, Vitest, Rust tests.

## Global Constraints

- Windows and macOS use the same Vue/backend contract; native file selection is implemented for both Tauri platforms.
- All user-facing copy is added to both `apps/desktop/src/locales/zh-CN.ts` and `apps/desktop/src/locales/en.ts`.
- Desktop keeps its fixed-size layout; the new dialogs must fit existing fixed dialog sizing and must not add responsive breakpoints.
- Existing template adoption remains the only path for planning conflicts, risks, plugin installation, and atomic config application.
- No database migration, shared protocol change, compatibility shim, or `docs/COMPATIBILITY.md` entry is needed.
- Use explicit `git add <path>` for any commit; do not push or release.

---

### Task 1: Add the reusable choice-card dialog primitive

**Files:**
- Create: `packages/ui/src/components/AppChoiceDialog.vue`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/__tests__/package-contract.test.ts`
- Create: `packages/ui/src/__tests__/AppChoiceDialog.test.ts`

**Interfaces:**
- Consumes: `open`, `title`, `closeLabel`, and an array of `{ id, title, description }` items; an optional `icon` slot receives `{ item }`.
- Produces: `AppChoiceDialog` with `select(id)` and `close` emits. Each card is a real button with `data-choice-id`, `aria-label`, and visible `:focus-visible` styling; it has no footer slot.

- [ ] **Step 1: Write the failing component contract test**

  Mount `AppChoiceDialog` with two items and assert both cards render, no footer is rendered, clicking a card emits `select` with its id, Escape emits `close`, and Tab focus can move through cards.

- [ ] **Step 2: Run the focused UI test and verify it fails**

  Run: `pnpm --filter @godgesture/ui test -- src/__tests__/AppChoiceDialog.test.ts --run`

  Expected: FAIL because `AppChoiceDialog` is not exported/implemented.

- [ ] **Step 3: Implement the minimal primitive**

  Follow `packages/ui/src/components/AppDialog.vue` focus and close conventions, render the items as `<button type="button">`, expose the icon slot, and add compact two-column card styles using existing `--gg-*` tokens.

- [ ] **Step 4: Run the focused test and package contract test**

  Run: `pnpm --filter @godgesture/ui test -- src/__tests__/AppChoiceDialog.test.ts src/__tests__/package-contract.test.ts --run`

  Expected: PASS with zero failures.

- [ ] **Step 5: Commit the primitive**

  ```powershell
  git add packages/ui/src/components/AppChoiceDialog.vue packages/ui/src/index.ts packages/ui/src/__tests__/AppChoiceDialog.test.ts packages/ui/src/__tests__/package-contract.test.ts
  git commit -m "feat: add reusable choice card dialog"
  ```

### Task 2: Add bounded native JSON file reading

**Files:**
- Modify: `apps/desktop/src/api/backend.ts`
- Modify: `apps/desktop/src/api/mock.ts`
- Modify: `apps/desktop/src/components/__tests__/GestureExportDialog.test.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Tauri dialog plugin and the existing template size limit.
- Produces: `Backend.gestureTemplateOpen(title: string): Promise<string | null>` and Tauri command `gesture_template_open`.

- [ ] **Step 1: Write failing backend contract assertions**

  Add a mock-backend assertion that `gestureTemplateOpen` exists and resolves `null` in browser preview; add a Rust unit-level command contract test or compile reference that the command is registered alongside `gesture_template_save`.

- [ ] **Step 2: Run the focused tests and verify the contract fails**

  Run: `pnpm --filter @godgesture/desktop test -- src/components/__tests__/GestureExportDialog.test.ts --run`

  Expected: FAIL at the missing backend method in the mock/contract setup.

- [ ] **Step 3: Implement the typed command**

  Add the interface and Tauri invoke wrapper. In Rust, use `blocking_pick_file`, filter JSON, return `None` on cancel, reject empty or over-`MAX_GESTURE_TEMPLATE_PACKAGE_BYTES` text, and return a stable string error. Register the command in `invoke_handler`. Keep the mock implementation as a safe `null` result.

- [ ] **Step 4: Run frontend and Rust focused verification**

  Run: `pnpm --filter @godgesture/desktop test -- src/components/__tests__/GestureExportDialog.test.ts --run`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features gesture_template -- --nocapture`

  Expected: PASS; Rust command code compiles under the library test target.

- [ ] **Step 5: Commit the backend contract**

  ```powershell
  git add apps/desktop/src/api/backend.ts apps/desktop/src/api/mock.ts apps/desktop/src/components/__tests__/GestureExportDialog.test.ts apps/desktop/src-tauri/src/lib.rs
  git commit -m "feat: read local gesture template files"
  ```

### Task 3: Make the templates store accept local packages

**Files:**
- Modify: `apps/desktop/src/stores/templates.ts`
- Modify: `apps/desktop/src/stores/__tests__/templates.test.ts` (or the repository's existing templates store test file)

**Interfaces:**
- Consumes: parsed `GestureTemplatePackage` and the existing `planGestureTemplateAdoption`/`adopt` lifecycle.
- Produces: `openLocalPackage(templatePackage: GestureTemplatePackage): void`, which creates an in-memory catalog entry only for UI metadata and calls the existing `buildPlan()`; it must not add the package to the online catalog.

- [ ] **Step 1: Write failing store tests**

  Test that `openLocalPackage` exposes the package title/summary, builds added/conflict stats against the current config, and that `setConflictPolicy("replaceExisting")` recomputes the plan. Test that `adopt()` installs plugin sources before applying the planned document by using the existing backend/plugin-store test harness.

- [ ] **Step 2: Run the store tests and verify failure**

  Run: `pnpm --filter @godgesture/desktop test -- src/stores/__tests__/templates.test.ts --run`

  Expected: FAIL because `openLocalPackage` is not present.

- [ ] **Step 3: Implement local context entry**

  Parse no data in the store; accept only a package already validated by `parseGestureTemplatePackage`. Derive risks with `gestureTemplatePackageRisks`, assign a non-persisted UUID via `newId()`, populate the metadata required by the existing details UI, set `selectedPackage`, and call `buildPlan()`.

- [ ] **Step 4: Run store tests and existing template tests**

  Run: `pnpm --filter @godgesture/desktop test -- src/stores/__tests__/templates.test.ts src/views/__tests__/TemplatesView.test.ts --run`

  Expected: PASS with no regression in online catalog adoption.

- [ ] **Step 5: Commit the store extension**

  ```powershell
  git add apps/desktop/src/stores/templates.ts apps/desktop/src/stores/__tests__/templates.test.ts
  git commit -m "feat: reuse template adoption for local packages"
  ```

### Task 4: Implement the local import review dialog

**Files:**
- Create: `apps/desktop/src/components/GestureTemplateImportDialog.vue`
- Create: `apps/desktop/src/components/__tests__/GestureTemplateImportDialog.test.ts`
- Modify: `apps/desktop/src/locales/zh-CN.ts`
- Modify: `apps/desktop/src/locales/en.ts`

**Interfaces:**
- Consumes: `modelValue`, `useBackend().gestureTemplateOpen`, `parseGestureTemplatePackage`, and `useTemplatesStore().openLocalPackage/setConflictPolicy/adopt`.
- Produces: a local file picker phase and an adoption review phase with `modelValue` close behavior; successful adoption emits a success toast and closes.

- [ ] **Step 1: Write failing import-dialog tests**

  Cover: opening the dialog requests a local file; valid JSON renders added/replaced/skipped statistics; conflict policy controls are visible; elevated commands require confirmation; plugin/adopt failure remains visible; successful adoption closes only after `adopt()` resolves true.

- [ ] **Step 2: Run focused tests and verify failure**

  Run: `pnpm --filter @godgesture/desktop test -- src/components/__tests__/GestureTemplateImportDialog.test.ts --run`

  Expected: FAIL because the component and locale keys do not exist.

- [ ] **Step 3: Implement the dialog**

  On open, call the backend file picker. Parse with `parseGestureTemplatePackage`; map protocol errors to a localized import error. On success, call `templates.openLocalPackage`. Reuse `templates.adoptionPlan`, conflict policy, plugin source list, `templates.adopt`, and the same high-risk confirmation pattern as `TemplatesView`. Do not write config directly from this component.

- [ ] **Step 4: Run the focused component test**

  Run: `pnpm --filter @godgesture/desktop test -- src/components/__tests__/GestureTemplateImportDialog.test.ts --run`

  Expected: PASS with all import states covered.

- [ ] **Step 5: Commit the import dialog**

  ```powershell
  git add apps/desktop/src/components/GestureTemplateImportDialog.vue apps/desktop/src/components/__tests__/GestureTemplateImportDialog.test.ts apps/desktop/src/locales/zh-CN.ts apps/desktop/src/locales/en.ts
  git commit -m "feat: add gesture template import review"
  ```

### Task 5: Wire the Gestures page entries

**Files:**
- Modify: `apps/desktop/src/views/GesturesView.vue`
- Modify: `apps/desktop/src/views/__tests__/GesturesView.test.ts`
- Modify: `apps/desktop/src/locales/zh-CN.ts`
- Modify: `apps/desktop/src/locales/en.ts`

**Interfaces:**
- Consumes: `AppChoiceDialog`, `GestureTemplateImportDialog`, existing export/app/group dialogs.
- Produces: one “Import/Export” button and one “Group/App” button. Selection cards close immediately and route to the existing destination dialogs. The export destination still starts at the existing “Choose delivery” step.

- [ ] **Step 1: Write failing GesturesView interaction tests**

  Assert the old three labels are absent, the new two buttons are present, import/export cards emit the expected route, group/app cards open the existing app/group dialog, and the choice dialogs have no footer buttons.

- [ ] **Step 2: Run GesturesView tests and verify failure**

  Run: `pnpm --filter @godgesture/desktop test -- src/views/__tests__/GesturesView.test.ts --run`

  Expected: FAIL because the new labels and routing do not exist.

- [ ] **Step 3: Implement the routing**

  Replace the old buttons with `AppChoiceDialog` instances. Keep `addGroup()` and `openAddApp()` unchanged as the destination behavior. Mount `GestureExportDialog` for export and `GestureTemplateImportDialog` for import. Use Lucide icons through the primitive slot and all copy through i18n.

- [ ] **Step 4: Run GesturesView and export regressions**

  Run: `pnpm --filter @godgesture/desktop test -- src/views/__tests__/GesturesView.test.ts src/components/__tests__/GestureExportDialog.test.ts --run`

  Expected: PASS; existing export behavior still begins with delivery selection and existing group/app windows remain functional.

- [ ] **Step 5: Commit the page integration**

  ```powershell
  git add apps/desktop/src/views/GesturesView.vue apps/desktop/src/views/__tests__/GesturesView.test.ts apps/desktop/src/locales/zh-CN.ts apps/desktop/src/locales/en.ts
  git commit -m "feat: consolidate gesture page actions"
  ```

### Task 6: Update project status and perform full verification

**Files:**
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Add the feature and verification baseline**

  Record the new Gestures page entries, local import reuse of template adoption, native JSON picker on Windows/macOS, and any remaining real-device acceptance boundary in the current-status and recent-verification sections. Do not add compatibility records.

- [ ] **Step 2: Run Desktop and shared verification**

  Run: `pnpm --filter @godgesture/shared build`; `pnpm --filter @godgesture/desktop test -- --run`; `pnpm --filter @godgesture/desktop typecheck`; `pnpm --filter @godgesture/desktop build`.

  Expected: all commands exit 0; tests report zero failures.

- [ ] **Step 3: Run Rust and repository checks**

  Run: `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features`; `git diff --check`; `rg -n "COMPAT-" apps/desktop/src packages/shared/src docs/COMPATIBILITY.md`.

  Expected: Rust tests and formatting pass, diff is clean, and no new compatibility ID is present.

- [ ] **Step 4: Review requirements against implementation**

  Verify the old standalone export/group/app buttons are gone, export delivery choices are unchanged, import uses the existing adoption store, card dialogs have no footer actions, and both locale files contain every new key.

- [ ] **Step 5: Commit the status update**

  ```powershell
  git add docs/PROJECT_STATUS.md
  git commit -m "docs: record gesture transfer workflow"
  ```

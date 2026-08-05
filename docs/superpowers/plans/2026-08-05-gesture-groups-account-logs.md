# Gesture Groups, Account Sessions, and Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synchronized application groups, reliable native account-session restoration, a theme-aware latest-first log console, a gestures-first startup page, and Windows `Ctrl+Alt+Tab` task switching.

**Architecture:** Configuration format v7 adds a required `groups` collection and `groupId` on non-global applications. The shared Zod protocol remains the source of truth; Rust mirrors and normalizes the same shape before persistence, while template adoption and Desktop UI use the fixed default-group UUID. Desktop group and log interactions stay local to the Vue layer and flow through the existing debounced config store; refresh tokens remain exclusively in Windows Credential Manager/macOS Keychain, with a process-wide native keyring lock.

**Tech Stack:** pnpm monorepo, TypeScript/Zod, Vue 3 + Pinia + Element Plus + vue-i18n, Tauri/Rust + serde/keyring, Vitest, Cargo test/Clippy.

---

### Task 1: Shared Config v7 and Template Adoption

**Files:**
- Modify: `packages/shared/src/config/limits.ts`
- Modify: `packages/shared/src/config/gestures.ts`
- Modify: `packages/shared/src/config/document.ts`
- Modify: `packages/shared/src/templates/adoption.ts`
- Test: `packages/shared/src/config/__tests__/document-migration.test.ts`
- Test: `packages/shared/src/config/__tests__/limits.test.ts`
- Test: `packages/shared/src/templates/__tests__/adoption.test.ts`

- [ ] **Step 1: Write failing schema and migration tests**

Add tests for: v6 documents receiving exactly one fixed default group and every legacy app receiving its original relative order in that group; v7 documents preserving valid groups and app assignments; missing, malformed, and unknown `groupId` values falling back to the default group; group capacity enforcement; new app-template adoption assigning `DEFAULT_APP_GROUP_ID`; existing app-template adoption preserving its current `groupId`.

Use the exported constant in assertions instead of duplicating the UUID:

```ts
expect(document.groups).toEqual([
  { id: DEFAULT_APP_GROUP_ID, name: "默认", order: 0 },
]);
expect(document.apps.map((app) => app.groupId)).toEqual([
  DEFAULT_APP_GROUP_ID,
  DEFAULT_APP_GROUP_ID,
]);
```

- [ ] **Step 2: Run the focused shared tests and verify RED**

Run `pnpm --filter @godgesture/shared exec vitest run src/config/__tests__/document-migration.test.ts src/config/__tests__/limits.test.ts src/templates/__tests__/adoption.test.ts`.

Expected: failures because `groups`, `groupId`, `DEFAULT_APP_GROUP_ID`, and the v7 migration do not exist yet.

- [ ] **Step 3: Implement the minimal v7 protocol**

Add `MAX_APP_GROUPS = 64`; export `DEFAULT_APP_GROUP_ID`; add `AppGroup` with UUID `id`, non-empty trimmed `name`, and integer `order`; add required `AppEntry.groupId`; change `CONFIG_FORMAT_VERSION` to `7`; and make the preprocess migration construct a default group when absent, preserve valid v7 groups, and assign invalid/unknown/legacy app group IDs to the default group. Keep global outside grouping. Add `groups` to the strict document schema and use `MAX_APP_GROUPS`.

In `planGestureTemplateAdoption`, set `groupId: DEFAULT_APP_GROUP_ID` only when creating a new app. Do not change the group of a matched app.

- [ ] **Step 4: Run the focused shared tests and verify GREEN**

Run the same Vitest command. Expected: all focused tests pass, including existing migration and adoption cases.

- [ ] **Step 5: Commit the shared protocol domain**

```powershell
git add packages/shared/src/config/limits.ts packages/shared/src/config/gestures.ts packages/shared/src/config/document.ts packages/shared/src/templates/adoption.ts packages/shared/src/config/__tests__/document-migration.test.ts packages/shared/src/config/__tests__/limits.test.ts packages/shared/src/templates/__tests__/adoption.test.ts
git commit -m "feat: add synchronized application groups"
```

### Task 2: Rust Config Mirror and Native Command Contracts

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/config.rs`
- Modify: `apps/desktop/src-tauri/src/platform/windows/commands.rs`
- Test: `apps/desktop/src-tauri/src/engine/config.rs`
- Test: `apps/desktop/src-tauri/src/platform/windows/commands.rs`

- [ ] **Step 1: Write failing Rust tests**

Add config tests that deserialize a v6 document into a v7 document with one default group, verify invalid and unknown IDs fall back, and verify config round-trip keeps groups and `group_id`. Add a Windows command test around a named `TASK_SWITCHER_MODIFIERS` constant that requires both `VK_CONTROL` and `VK_MENU` before `VK_TAB`.

- [ ] **Step 2: Run focused Rust tests and verify RED**

Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib engine::config::tests platform::windows::commands::tests`. Expected: compile/test failures because the Rust mirror is still v6 and the task switcher still uses only Alt.

- [ ] **Step 3: Implement the Rust mirror and migration**

Add `AppGroup`, `groups`, and `AppEntry.group_id`; set `CONFIG_FORMAT_VERSION` to `7`; normalize groups and app IDs in `migrate_config_value` before strict serde decoding; use the same fixed UUID and default name as shared; include the default group in `ConfigDocument::default` and the seeded Chrome app; keep node-plugin and engine matching independent of groups. In Windows command dispatch, synthesize `Ctrl`, `Alt`, then `Tab` while leaving macOS Mission Control untouched.

- [ ] **Step 4: Run focused Rust tests and verify GREEN**

Run the focused command again, then `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib engine::config::tests platform::windows::commands::tests`. Expected: all focused tests pass.

- [ ] **Step 5: Commit the Rust config/platform domain**

```powershell
git add apps/desktop/src-tauri/src/engine/config.rs apps/desktop/src-tauri/src/platform/windows/commands.rs
git commit -m "feat: mirror grouped config and update task switching"
```

### Task 3: Desktop Group Operations and Gestures UI

**Files:**
- Create: `apps/desktop/src/utils/app-groups.ts`
- Test: `apps/desktop/src/utils/__tests__/app-groups.test.ts`
- Modify: `apps/desktop/src/views/GesturesView.vue`
- Modify: `apps/desktop/src/components/AppDialog.vue`
- Modify: `apps/desktop/src/api/mock.ts`
- Modify: `apps/desktop/src/locales/zh-CN.ts`
- Modify: `apps/desktop/src/locales/en.ts`

- [ ] **Step 1: Write failing pure group-operation tests**

Test `moveAppToGroup` changes only `groupId` and app order within source/target groups; `moveGroupBefore` normalizes group order; and `removeCustomGroup` moves its apps to the default group while rejecting removal of the default group. Use real `ConfigDocument.parse` values and no UI mocks.

- [ ] **Step 2: Run the helper test and verify RED**

Run `pnpm --filter @godgesture/desktop exec vitest run src/utils/__tests__/app-groups.test.ts`. Expected: module/function-not-found failures.

- [ ] **Step 3: Implement group helpers and minimal UI wiring**

Implement the tested pure mutations, then render the sidebar as fixed global row followed by sorted group headers and sorted app rows. Keep collapsed-group state local to the view. Add HTML drag sources only to the group/app handles: an inline nine-dot SVG (`3 x 3`) appears on hover/focus at the far left of app rows, app drag/drop changes `groupId`, group drag/drop changes group order, and global has no handle. Add localized add-group, inline/confirmation rename, custom-group deletion with migration to default, and existing app edit/delete actions. Add `groupId` to newly saved `AppEntry` values and seed/mock documents through `ConfigDocument.parse`.

Do not move the existing `自动跟随`/log controls in this task. All visible group text and dialog messages must use `zh-CN`/`en` locale keys.

- [ ] **Step 4: Run helper tests and Desktop typecheck**

Run `pnpm --filter @godgesture/desktop exec vitest run src/utils/__tests__/app-groups.test.ts` and `pnpm --filter @godgesture/desktop typecheck`. Expected: helper tests and Vue TypeScript checks pass.

- [ ] **Step 5: Commit the Desktop group domain**

```powershell
git add apps/desktop/src/utils/app-groups.ts apps/desktop/src/utils/__tests__/app-groups.test.ts apps/desktop/src/views/GesturesView.vue apps/desktop/src/components/AppDialog.vue apps/desktop/src/api/mock.ts apps/desktop/src/locales/zh-CN.ts apps/desktop/src/locales/en.ts
git commit -m "feat: organize gesture apps into groups"
```

### Task 4: Account Credential Reliability and Startup Selection

**Files:**
- Modify: `apps/desktop/src-tauri/src/account.rs`
- Test: `apps/desktop/src-tauri/src/account.rs`
- Modify: `apps/desktop/src/App.vue`
- Test: `apps/desktop/src/stores/__tests__/account.test.ts`

- [ ] **Step 1: Write failing native synchronization test**

Add a unit test for the credential-store guard using two worker threads and a barrier/counter: at most one keyring operation may enter the critical section at a time. Keep tests independent of real credentials and never print token values. Add/adjust the account-store startup test to assert restore is attempted before the signed-out state is exposed.

- [ ] **Step 2: Run focused tests and verify RED**

Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib account::tests` and `pnpm --filter @godgesture/desktop exec vitest run src/stores/__tests__/account.test.ts`. Expected: the new guard test fails until the guard exists; existing tests must remain green.

- [ ] **Step 3: Serialize native credential operations and default to gestures**

Protect keyring entry creation and get/set/delete calls with a process-wide `OnceLock<parking_lot::Mutex<()>>` inside the existing blocking closures. Preserve endpoint normalization, keyring-only storage, refresh-token rotation, invalid-token deletion, and transient-error retention. Change `App.vue` initial `active` to `"gestures"`; keep browser URL `section` overrides intact.

- [ ] **Step 4: Run focused tests and typecheck**

Run the focused Cargo/Vitest commands and `pnpm --filter @godgesture/desktop typecheck`. Expected: all pass without token output.

- [ ] **Step 5: Commit account/startup behavior**

```powershell
git add apps/desktop/src-tauri/src/account.rs apps/desktop/src/App.vue apps/desktop/src/stores/__tests__/account.test.ts
git commit -m "fix: restore account sessions reliably on startup"
```

### Task 5: Latest-First Theme-Aware Log Console

**Files:**
- Modify: `apps/desktop/src/stores/logs.ts`
- Modify: `apps/desktop/src/views/LogsView.vue`
- Modify: `apps/desktop/src/api/mock.ts`
- Modify: `apps/desktop/src-tauri/src/logging.rs`
- Modify: `apps/desktop/src/locales/zh-CN.ts`
- Modify: `apps/desktop/src/locales/en.ts`
- Test: `apps/desktop/src/stores/__tests__/logs.test.ts`
- Test: `apps/desktop/src-tauri/src/logging.rs`

- [ ] **Step 1: Write failing log tests**

Add store tests proving query results and real-time events are newest-first, filtered events do not enter the list, and toggling auto-follow does not change prepend behavior. Add Rust tests proving queries return the newest entry first and sanitized messages preserve safe `\n` trace separators while removing other control characters and secrets.

- [ ] **Step 2: Run focused log tests and verify RED**

Run `pnpm --filter @godgesture/desktop exec vitest run src/stores/__tests__/logs.test.ts` and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib logging::tests`. Expected: failures for append ordering, missing store behavior, and flattened trace/newest-first results.

- [ ] **Step 3: Implement store ordering and view behavior**

Change the store event path to `entries.value = [entry, ...entries.value].slice(0, 2000)` and keep `live` as a true-by-default auto-follow flag with a toggle action. Return mock query entries newest-first. In Rust reverse filtered chronological entries before applying the query limit and keep newest-first export/query semantics. Allow newline and tab in Rust sanitation, convert CRLF/CR to LF, and continue redacting sensitive fields.

In `LogsView.vue`, remove the refresh icon/button, keep export and clear controls, and render a theme-token-backed viewer using `var(--gg-*)` surfaces in both themes (no pure black). Split error/warn messages on newline; render the first line in the row and additional trace lines collapsed by default, with a caret and keyboard-accessible row click to expand. Add a stable bottom border between every record. Keep `logs-meta__live` on the right in its existing dot-plus-text shape, reset button chrome so it does not look like a rectangle, turn it gray when off, and watch the viewer element to scroll to `scrollTop = 0` only while auto-follow is enabled.

- [ ] **Step 4: Run focused tests, typecheck, and visual preview**

Run the focused Vitest/Cargo commands, `pnpm --filter @godgesture/desktop typecheck`, and `pnpm --filter @godgesture/desktop build`. Start the existing Vite preview on an unused port and inspect both `?theme=light` and `?theme=dark`, checking that the viewer is non-black in dark mode, newest rows are at the top, the auto-follow control stays on the right, and turning it off preserves the current scroll position.

- [ ] **Step 5: Commit the log domain**

```powershell
git add apps/desktop/src/stores/logs.ts apps/desktop/src/views/LogsView.vue apps/desktop/src/api/mock.ts apps/desktop/src-tauri/src/logging.rs apps/desktop/src/locales/zh-CN.ts apps/desktop/src/locales/en.ts apps/desktop/src/stores/__tests__/logs.test.ts
git commit -m "feat: add latest-first themed log console"
```

### Task 6: Generated Protocol, Documentation, and Full Verification

**Files:**
- Modify: `apps/server/openapi.json`
- Modify: `packages/shared/src/api/generated.ts`
- Modify: `CONTEXT.md`
- Modify: `docs/PROJECT_STATUS.md`
- Test/verify: all affected shared/Desktop/Rust suites

- [ ] **Step 1: Regenerate protocol artifacts**

Run `pnpm generate:api` if the generated OpenAPI artifacts change from the shared schema; otherwise update only the generated `formatVersion`/`groups` shape through the repository generator. Confirm server sync remains an opaque validated `ConfigDocument` and no new server data model is introduced.

- [ ] **Step 2: Update project knowledge with actual behavior**

Add the “应用分组” term to `CONTEXT.md`. Update `docs/PROJECT_STATUS.md` with the implemented v7/group/log/session behavior and exact local verification results; explicitly mark Windows/macOS physical credential and task-switcher acceptance pending if no real-device evidence was collected.

- [ ] **Step 3: Run the complete affected verification**

Run:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --all-targets -- -D warnings
git diff --check
```

Expected: all commands pass; no credentials, tokens, or unrelated files are staged.

- [ ] **Step 4: Commit generated artifacts and project status**

```powershell
git add apps/server/openapi.json packages/shared/src/api/generated.ts CONTEXT.md docs/PROJECT_STATUS.md
git commit -m "docs: record grouped gestures and log console status"
```

### Completion Handoff

After all tasks pass, use `superpowers:requesting-code-review` for a focused review of the commits and fix any Critical/Important findings. Then use `superpowers:finishing-a-development-branch` to report the final verification, pending real-platform acceptance, and integration options. Do not push unless explicitly requested.

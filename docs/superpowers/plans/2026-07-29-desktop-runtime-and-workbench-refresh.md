# Desktop Runtime and Workbench Refresh Implementation Plan

Date: 2026-07-29

Source design: `docs/superpowers/specs/2026-07-29-desktop-runtime-and-workbench-refresh-design.md`

## Delivery Strategy

Implement in four independently verifiable domains. Keep native runtime fixes, template transport,
application icons, and Vue layout changes separable until the final integration pass. Update
`docs/PROJECT_STATUS.md` only with validation that has actually run.

## Task 1: Bound Native Overlay Work Per Frame

Files:

- `apps/desktop/src-tauri/src/platform/windows/overlay.rs`
- `apps/desktop/src-tauri/src/platform/macos/overlay.rs`

Steps:

1. Extract a testable Windows command-batch decision that distinguishes bounded Grow work from
   ordered control commands.
2. Add failing tests for rendering while the receiver remains non-empty, command ordering,
   End/Cancel priority, and stale-point cleanup across Begin.
3. Replace the unbounded Windows drain with a command/time budget. Re-post `WM_APP_WAKE` when work
   remains and render dirty state before yielding.
4. Add a macOS pending Grow buffer with at most one scheduled main-thread flush, preserving control
   command ordering. If target-specific compilation prevents host tests, keep pure scheduling state
   platform-neutral within the module and verify through the macOS CI compile path.
5. Run targeted Rust tests, then the Desktop Rust library suite and clippy.

## Task 2: Move Template Transport To Native HTTPS

Files:

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/template_download.rs` (new)
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/api/backend.ts`
- `apps/desktop/src/api/mock.ts`
- `apps/desktop/src/templates/source.ts`
- `apps/desktop/src/templates/__tests__/source.test.ts`

Steps:

1. Add a native downloader with a closed `catalog | package` resource kind and fixed byte limits.
2. Add tests for URL validation, redirect validation/limit, timeout/error mapping, HTTP status,
   content length, streamed overflow, and UTF-8 handling. Use a loopback test server; do not depend
   on public network in automated tests.
3. Register `download_template_text` in Tauri and normalize structured errors through Backend.
4. Adapt the remote template source to use injected text transport. Tauri uses native transport;
   browser preview retains fixtures. Keep shared schema and package verification unchanged.
5. Run template source tests, shared protocol tests/build, Desktop typecheck/build, and a real Tauri
   GitHub catalog/package smoke when the app is available.

## Task 3: Add Derived Application Icons

Files:

- `apps/desktop/src-tauri/src/platform/macos/icon.rs` (new)
- `apps/desktop/src-tauri/src/platform/macos/mod.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/api/backend.ts`
- `apps/desktop/src/api/mock.ts`
- `apps/desktop/src/components/AppIcon.vue` (new)
- `apps/desktop/src/components/AppIconPlaceholder.vue` or colocated SVG component (new)
- `apps/desktop/src/views/GesturesView.vue`
- `apps/desktop/src/locales/zh-CN.ts`
- `apps/desktop/src/locales/en.ts`

Steps:

1. Replace the Windows-only string IPC input with a platform-neutral icon request containing
   `windowsExeName`, `macBundleId`, or `global`.
2. Reuse Windows icon extraction and implement macOS Bundle ID lookup plus PNG conversion.
3. Build `AppIcon` with fixed geometry, in-process Promise/result caching, bundled GodGesture global
   icon, and an accessible question-mark SVG fallback.
4. Render icons in every application-scope row without writing derived data into ConfigDocument.
5. Add component/backend tests for cache hits, fallback, global icon, and stable dimensions.

## Task 4: Refresh The Desktop Workbench

Files:

- `apps/desktop/src/App.vue`
- `apps/desktop/src/views/GesturesView.vue`
- `apps/desktop/src/views/CornersEdgesView.vue`
- `apps/desktop/src/views/TemplatesView.vue`
- `apps/desktop/src/views/AccountView.vue`
- `apps/desktop/src/views/OptionsView.vue`
- `apps/desktop/src/views/AboutView.vue`
- affected reusable components and locale tests
- `apps/desktop/src/locales/zh-CN.ts`
- `apps/desktop/src/locales/en.ts`

Steps:

1. Establish shared shell tokens and compact header/sidebar/footer geometry. Reorder navigation and
   rename Options to Settings while retaining `options` as the internal section identifier.
2. Give the main workspace `min-width/min-height: 0` and move scrolling ownership into each view.
3. Convert Gestures to the approved fixed application-list/table/editor workbench. Give the table a
   real bounded height and keep the editor independently reachable.
4. Apply the same page-header, toolbar, section, and scroll rules to the other five views without
   changing their business behavior.
5. Add navigation/i18n/layout assertions and run Desktop tests/typecheck/build.

## Task 5: Integration, Visual QA, And Handoff

Files:

- `docs/PROJECT_STATUS.md`
- focused QA documentation only if a new durable procedure is required

Steps:

1. Start Desktop preview and validate all six pages at `980x700` and `800x560`, in zh-CN/en and
   light/dark themes. Capture screenshots and inspect DOM overflow, fixed control dimensions, and
   reachable actions.
2. Start the real Tauri app and smoke native template downloads and Windows application icons.
3. Exercise right/middle/X1/X2 trails with continuous fast motion and rapid End/Cancel/Begin cycles.
4. Record macOS build/CI evidence. Mark hardware-only X1/X2 validation as unavailable when the
   target hardware does not expose those buttons; do not claim it passed.
5. Update `docs/PROJECT_STATUS.md` with actual implementation, known residual risks, and exact test
   counts. Run `git diff --check` and inspect the final scoped diff.
6. Commit by domain with explicit paths; do not stage `.superpowers/` or unrelated user files and do
   not push.

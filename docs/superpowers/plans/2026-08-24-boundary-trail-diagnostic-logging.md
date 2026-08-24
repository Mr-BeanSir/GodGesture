# Boundary Trail Diagnostic Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured debug evidence for the stale-trail flash during boundary-guide hover without changing overlay behavior.

**Architecture:** Add a small shared `OverlayCommand` diagnostic vocabulary, then log command enqueue and platform-specific state transitions at the existing engine/overlay boundaries. Windows and macOS log their own redraw decisions and state snapshots; Windows additionally records the visibility-before-render ordering that can expose stale layered-window pixels.

**Tech Stack:** Rust, Tauri desktop overlay, `log` facade, tiny-skia, Windows `UpdateLayeredWindow`, macOS `CALayer`.

## Global Constraints

- Keep trails and labels in native overlays; do not move rendering to WebView.
- Preserve Windows and macOS behavior and log targets.
- Do not modify Shared, Server, OpenAPI, database, or protocol code.
- Use existing local logging and `debug` level; do not add credentials or external telemetry.
- Keep the user's existing untracked plan file untouched.

---

### Task 1: Define the diagnostic command vocabulary

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/overlay.rs`
- Test: `apps/desktop/src-tauri/src/platform/overlay.rs` unit tests

**Interfaces:**
- Produces `OverlayCommand::debug_kind() -> &'static str` for platform and engine diagnostics.

- [ ] **Step 1: Write the failing test**

Add a unit test asserting stable names for `End`, `Cancel`, `SetBoundaryGuide`, `ClearBoundaryGuide`, `Begin`, `Grow`, `Recognized`, and `ShowLabelFeedback`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib platform::overlay::tests::overlay_command_debug_kind_is_stable`.

Expected result: compilation failure because `OverlayCommand::debug_kind` does not yet exist.

- [ ] **Step 3: Implement the minimal helper**

Add a non-mutating match returning one static diagnostic name per command variant.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same command and expect one passing test.

- [ ] **Step 5: Commit**

Run `git add apps/desktop/src-tauri/src/platform/overlay.rs` and commit with `test: define overlay diagnostic command names`.

### Task 2: Instrument command enqueue and platform lifecycle state

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/platform/macos/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` only if an existing overlay boundary lacks the command context

**Interfaces:**
- Logs remain internal `log::debug!` calls under `platform.windows`, `platform.macos`, and `gesture.runtime`.
- No public API or overlay command payload changes.

- [ ] **Step 1: Add failing assertions for the state summary boundary**

Extend the platform overlay tests to exercise `End` followed by `SetBoundaryGuide` and assert the existing state remains `points.is_empty()` and `show_path == false`; use the test to pin the diagnostic state that logs must report.

- [ ] **Step 2: Run the focused platform tests and verify the diagnostic fixture is meaningful**

Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib platform::windows::overlay::tests::guide_redraw_after_end_does_not_restore_previous_trail_pixels platform::macos::overlay::tests::end_clears_trail_immediately`.

Expected result: the existing behavior tests pass, demonstrating that the issue is likely presentation timing rather than live point state.

- [ ] **Step 3: Implement lifecycle logs**

Log command kind and pre/post state around `End`, `Cancel`, `SetBoundaryGuide`, and `ClearBoundaryGuide`; log ignored/late `Grow` commands when no active trail is present; log the engine-side overlay command enqueue boundary where needed.

- [ ] **Step 4: Implement redraw and present logs**

Log full versus incremental redraw, dirty rectangles, point counts, and visibility. On Windows record whether the window becomes visible before `render()` and whether the subsequent present is full or dirty.

- [ ] **Step 5: Run focused tests and inspect output**

Run the Windows/macOS overlay unit tests with `--nocapture`, confirm no behavior assertions changed, then inspect the emitted diagnostic lines.

- [ ] **Step 6: Commit**

Run `git add apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs apps/desktop/src-tauri/src/lib.rs` for only changed paths and commit with `debug: trace overlay trail lifecycle`.

### Task 3: Verify and hand off the reproduction

**Files:**
- Modify: `CONTEXT.md` or `docs/PROJECT_STATUS.md` only if the diagnostic entry point or known issue status changes.

- [ ] **Step 1: Run verification**

Run `cargo fmt --check`, focused overlay tests, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`, and `git diff --check`.

- [ ] **Step 2: Scan for forbidden behavior resurrection**

Run `rg -n "trail_fade_surface|trail fade snapshot|capture.*trail|restore.*trail|compose.*trail" apps/desktop/src-tauri/src` and expect no old snapshot/fade symbols.

- [ ] **Step 3: Review the diff**

Confirm only debug logs/tests/docs changed, the existing user plan remains untracked and untouched, and no backend/shared files changed.

- [ ] **Step 4: Commit verification documentation if needed**

Only if the project status or known issue entry changes, run `git add CONTEXT.md docs/PROJECT_STATUS.md` and commit with `docs: record trail diagnostic baseline`.

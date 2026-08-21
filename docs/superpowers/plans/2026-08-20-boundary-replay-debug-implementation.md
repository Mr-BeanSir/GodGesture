# Boundary Replay Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correlation-aware Windows boundary-click replay diagnostics without changing replay behavior, event swallowing, or the existing hook-thread architecture.

**Architecture:** The Windows platform creates a process-local replay id at the platform boundary and carries it through `ClickReplay`. The queue and hook message pump log queue depth and wait time, while the input layer logs cursor recovery and `SendInput` request/insertion metrics. Pure helpers cover cursor classification and timing-record construction so the logs retain separate phases.

**Tech Stack:** Rust 2021, Tauri desktop crate, `log`, Windows crate APIs, existing Cargo unit tests.

## Global Constraints

- Desktop behavior is diagnostic-only in this iteration; do not retry, skip, replace, or reorder `SetCursorPos`/`SendInput`.
- Preserve the existing hook-thread message-pump replay path, short-write cleanup, tagged input events, and event-swallowing behavior.
- Keep logs free of window titles, paths, clipboard content, credentials, tokens, and plugin source.
- Windows is the affected implementation; macOS behavior must remain unchanged.
- Use `uv` only for Python scripts; this plan has no Python steps.

---

### Task 1: Replay queue correlation and timing records

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/hook.rs`
- Modify: `apps/desktop/src-tauri/src/platform/windows/mod.rs`
- Test: `apps/desktop/src-tauri/src/platform/windows/hook.rs`

**Interfaces:**
- `ClickReplay` gains a process-local `replay_id: u64`.
- `next_click_replay_id() -> u64` creates monotonic ids.
- `ClickReplayQueue::enqueue` and its test helper return the queue depth after a successful enqueue.
- Hook dispatch logs use `replay_id`, `queue_depth`, `queue_wait_us`, and separate completion timing.

- [ ] **Step 1: Write the failing tests**

Extend the queue tests so two replay records with ids `41` and `42` remain FIFO and the queue depth is `2` then `1`; add a timing-record test asserting queue wait and injection durations remain distinct fields.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml click_replay_queue --target x86_64-pc-windows-gnu`

Expected: FAIL because the replay record has no correlation id/depth result and no timing record.

- [ ] **Step 3: Implement the minimal queue and hook changes**

Add the id counter, queue-depth return values, a `pending_depth` accessor, and a small timing-record helper. Log replay request, enqueue, dispatch, and completion records with the correlation id while leaving the existing closure invocation and queue operations unchanged.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml click_replay_queue replay_timing --target x86_64-pc-windows-gnu`

Expected: PASS.

- [ ] **Step 5: Commit the isolated diagnostics layer**

```powershell
git add apps/desktop/src-tauri/src/platform/windows/hook.rs apps/desktop/src-tauri/src/platform/windows/mod.rs
git commit -m "feat: correlate Windows click replay diagnostics"
```

### Task 2: Cursor and input injection diagnostics

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/input.rs`
- Modify: `apps/desktop/src-tauri/src/platform/windows/mod.rs`
- Test: `apps/desktop/src-tauri/src/platform/windows/input.rs`

**Interfaces:**
- The hook replay callback passes `replay_id` into the Windows click synthesizer.
- A pure cursor-classification helper distinguishes target-already-current, successful move, success without observing the target, and failed move with the raw numeric Win32 code.
- The existing `synthesize_click_checked` API and short-write recovery remain behaviorally compatible.

- [ ] **Step 1: Write the failing tests**

Add unit tests for target-already-current, successful move, failure with Win32 code `0`, and failure with a non-zero code. Add a pure input timing-result assertion for requested count `2`, inserted count `2`, and short-write false.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml cursor_recovery send_input --target x86_64-pc-windows-gnu`

Expected: FAIL because the classification and replay input timing helpers do not exist.

- [ ] **Step 3: Implement the minimal diagnostic instrumentation**

Read cursor position before and after the existing `SetCursorPos` call, capture the `SetCursorPos` result code immediately, log the cursor classification and elapsed time, then measure the existing two-event `SendInput` call with requested/inserted counts and short-write status. Preserve the current warning/error paths and cleanup behavior.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml cursor_recovery send_input --target x86_64-pc-windows-gnu`

Expected: PASS.

- [ ] **Step 5: Commit the input diagnostics**

```powershell
git add apps/desktop/src-tauri/src/platform/windows/input.rs apps/desktop/src-tauri/src/platform/windows/mod.rs
git commit -m "feat: log Windows replay cursor and input stages"
```

### Task 3: Desktop verification baseline

**Files:**
- Verify: `apps/desktop/src-tauri/src/platform/windows/hook.rs`
- Verify: `apps/desktop/src-tauri/src/platform/windows/input.rs`
- Verify: `apps/desktop/src-tauri/src/engine/runtime.rs`

- [ ] **Step 1: Run focused Windows crate tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-gnu`

Expected: PASS, or report the unavailable Windows target/toolchain explicitly.

- [ ] **Step 2: Run Desktop formatting and clippy checks**

Run: `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` and `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-gnu --all-targets -- -D warnings`

Expected: PASS, or report the platform/toolchain limitation.

- [ ] **Step 3: Review the diff for behavior changes**

Run: `git diff --check` and inspect the diff to confirm only logs, correlation data, and pure test helpers changed. Do not claim the runtime bug is fixed until a Windows debug-log reproduction is reviewed.

### Task 4: Reproduction handoff

**Files:**
- Verify: exported runtime JSONL logs from the user’s Windows reproduction

- [ ] **Step 1: Reproduce with the first right-button boundary sequence**

Use debug logging at the bottom-right tray and the four screen edges, then export logs containing `event=boundary_replay_requested`, `event=replay_enqueued`, `event=replay_dispatched`, `event=replay_cursor`, `event=replay_send_input`, and `event=replay_completed`.

- [ ] **Step 2: Correlate stage timings**

Compare `queue_wait_us`, cursor recovery duration, `injection_us`, and completion timing by `replay_id`. Treat the target application’s menu-paint time as external evidence not directly measured by `SendInput`.

- [ ] **Step 3: Decide the next change from evidence**

If a behavioral repair is required, create a separate failing regression test and design; do not include a speculative repair in this diagnostics change.

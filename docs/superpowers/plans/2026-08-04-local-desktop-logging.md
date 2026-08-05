# Desktop Local Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the existing Desktop local logging skeleton with a cross-platform Rust JSONL logger, Tauri commands/events, and safe Node host diagnostics.

**Architecture:** Install one process-wide `log::Log` early with an `off` default and configure its shared service during Tauri setup from `app_log_dir()`. The logger only performs threshold checks and bounded `try_send`; a worker owns file I/O, rotation, querying, export, cleanup, persistence, and `log-event` emission. Existing frontend types remain the contract. Node supervisor/worker diagnostics are line-limited and stable-code based, then pass through the Rust logger's second redaction boundary.

**Tech Stack:** Rust `log`, Tauri 2 commands/events, `serde_json` JSONL, `crossbeam-channel`, Vue 3/Pinia existing log store, Node ESM worker threads.

> **接手核对（2026-08-04）：** 代码实现与定向验证已完成；真实 Windows/macOS 运行验收仍为 pending。历史 TDD 步骤“先运行预期失败测试”未在本次接手中重复，不作为当前验证基线。

---

### Task 1: Logging service contract and core tests

**Files:**
- Create: `apps/desktop/src-tauri/src/logging.rs`
- Modify: `apps/desktop/src-tauri/src/engine/mod.rs` only if shared logging helpers are needed (expected: no)

- [x] Add Rust unit tests for level threshold semantics, JSONL entry shape, sensitive/control-character redaction, query filtering, and rotation limits using a temporary directory.
- [ ] Run the focused Rust tests and observe the expected failure because the module does not exist. (历史 TDD 步骤；本次接手未重复。)
- [x] Implement `LogLevel`, `LogEntry`, `LogsQueryRequest`, `LogsQueryResponse`, and `LoggingService` with an `Arc`-safe bounded queue and worker-owned files.
- [x] Keep one active `godgesture.log`, rotate at 10 MiB, retain five historical files, and expose only paths under the configured app log directory.
- [x] Re-run the focused tests, then format only `logging.rs`.

### Task 2: Tauri registration and commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/capabilities/default.json` only if the existing app-config scope cannot cover exported log files

- [x] Replace `env_logger` initialization with the installed custom logger and configure it during `setup` using `app_log_dir()` and `app_config_dir()`.
- [x] Register the six fixed commands and emit `log-event` only after successful worker writes.
- [x] Preserve `off` as the initial/default level and persist user changes outside the synced config document.
- [x] Run `cargo check` and the focused logging tests.

### Task 3: Rust and Node diagnostics

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/node_host.rs`
- Modify: `apps/desktop/src-tauri/src/engine/node_service.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/engine/config.rs`
- Modify: `apps/desktop/src-tauri/src/engine/plugin_workspace.rs`
- Modify: affected platform hook/runtime modules only where an existing key branch needs a stable target
- Modify: `apps/desktop/node-host/supervisor.mjs`
- Modify: `apps/desktop/node-host/worker.mjs`

- [x] Add stable targets for lifecycle, config, gesture capture/runtime, platform, plugin workspace, Node, and logging events.
- [x] Record Node startup, prepare/import/onInit failures, IPC errors, timeout, reload fallback, worker crash, lifecycle rejection, and queue drops with only plugin/action IDs, lifecycle names, stable codes, and durations.
- [x] Pipe supervisor stderr and worker diagnostic lines through the unified logger without putting protocol frames, context, clipboard data, native handles, or source text in log messages.
- [x] Add/update Node/Rust tests for source routing and keeping the previous host after a failed candidate reload; line-length limiting is enforced at the Node/Rust diagnostic boundaries.

### Task 4: Frontend contract and tests

**Files:**
- Inspect/modify only as needed: `apps/desktop/src/api/backend.ts`, `apps/desktop/src/api/mock.ts`, `apps/desktop/src/logging.ts`, `apps/desktop/src/stores/logs.ts`, `apps/desktop/src/views/LogsView.vue`
- Add focused tests under `apps/desktop/src/api/__tests__` or `apps/desktop/src/stores/__tests__` if the existing logging behavior is not covered.

- [x] Confirm TypeScript fields exactly match Rust serde fields and preserve the existing browser mock behavior.
- [x] Add only the smallest regression assertions for default `off`, filters, live events, clear, and export.
- [x] Run the focused frontend tests and Desktop typecheck.

### Task 5: Verification and documentation

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/superpowers/specs/2026-08-04-local-desktop-logging-design.md`
- Modify: `CONTEXT.md` only if an actually new term or contract is introduced

- [x] Run focused Rust tests, `cargo check`, Desktop typecheck, logging-related frontend tests, and `git diff --check`.
- [x] Audit log files, event payloads, export output, Node diagnostics, and capability scopes for forbidden data and path escape.
- [x] Record only commands actually run and mark Windows/macOS real-device checks pending unless observed in this task.

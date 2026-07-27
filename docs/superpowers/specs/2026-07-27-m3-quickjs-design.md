# M3 QuickJS Script Engine Design

Date: 2026-07-27

## Goal

Complete M3 without pulling macOS engine, sync, updater, or packaging work forward. JavaScript Script commands must execute in QuickJS with persistent per-command state, all existing script slots must have defined lifecycle behavior, the documented host API must cover input, gesture context, window operations, clipboard access, and status reporting, and the settings UI must provide Monaco editing with matching type declarations.

ADR-0005 is authoritative: the process owns one long-lived QuickJS Runtime, each script command lazily receives an isolated Context, and neither Node nor browser APIs are exposed. The existing configuration shape remains format version 1.

## Scope

Included:

- Add `rquickjs` and a platform-neutral script engine owned by the engine consumer thread.
- Cache one Context per logical command and preserve its global state between invocations.
- Recreate a cached Context when that command's script definition changes.
- Execute init, main, recognized, modifier-triggered, and ended script fields with explicit lifecycle rules.
- Expose bounded host APIs for keyboard/mouse input, invocation context, target-window operations, clipboard text, and `ReportStatus`.
- Add execution limits, structured logging, focused Rust tests, a lazy Monaco editor, and the same API as a `.d.ts` extra library.
- Update M3 status and verification facts after automated and Windows runtime validation.

Excluded:

- Lua execution or automatic Lua-to-JavaScript translation. Imported Lua remains editable but non-executable.
- Node.js, browser DOM, network, filesystem, subprocess, dynamic module loading, or arbitrary native access from scripts.
- macOS host implementations; M4 remains responsible for the native macOS engine and platform services.
- Shared-schema changes, account/sync work, updater/templates, and release packaging.

## Considered Approaches

### Platform-neutral runtime with a Windows host adapter (selected)

Keep QuickJS context management, lifecycle, limits, and error handling in `engine/script.rs`. Define a narrow host trait and implement it with the existing Windows input, window, clipboard, and overlay facilities. This keeps M3 testable without Win32 while leaving a direct M4 extension point.

### Put the complete engine in `platform/windows`

This is initially smaller, but it hard-codes the first host into context ownership and duplicates the runtime/cache design when M4 arrives. It conflicts with the dual-platform architecture even though M3 can only be runtime-smoked on Windows today.

### Execute each script in a fresh Context

This avoids cache invalidation, but violates ADR-0005 and prevents init code and user globals from persisting across lifecycle events. It is rejected.

## Runtime And Cache

The existing engine consumer is the single script owner. It creates one `ScriptEngine` beside the overlay and TaskSwitcher consumer, so script execution never blocks the low-level hook thread. The engine contains one `rquickjs::Runtime` and a map of logical command keys to cached Contexts.

Gesture commands use the intent ID as their key. Hot-corner and rub-edge commands use their configured slot key. Each cache entry retains the exact script definition; a changed language, slot, or modifier-handling flag replaces only that entry before the next invocation. Deleted entries may be pruned when configuration changes, but correctness does not depend on retaining stale entries.

The Runtime uses a 64 MiB memory limit and the QuickJS default-sized 256 KiB stack limit. Every evaluated slot gets a 200 ms instruction deadline through the Runtime interrupt handler. A timeout or exception aborts that slot, is logged with command key and slot name, and does not terminate the consumer or execute later slots from the same event. Host calls can perform bounded native work, so their existing native timeouts remain authoritative.

## Script Lifecycle

JavaScript contexts initialize lazily. On first use, the host globals are installed and non-empty `initScript` runs once before any other slot. A changed script definition discards the old Context and runs its new init slot on next use.

- Normal PathEnd execution: run `script` once with the final invocation context.
- Immediate modifier execution with `handleModifiers = false`: run `script` for every matching modifier event, preserving existing repeat behavior.
- Immediate modifier execution with `handleModifiers = true`: run `gestureRecognizedScript` once when that script intent first becomes active during the path, run `modifierTriggeredScript` for each matching modifier event, then run `gestureEndedScript` when the trigger button is released.
- Changing to another immediate script intent ends the previous active script before recognizing the new one.
- Cancellation, recording mode, and unmatched gestures do not run user script slots.
- Hot-corner and rub-edge Script commands use normal main-slot execution and have no gesture modifier lifecycle.

This preserves the existing `executed_on_modifier` PathEnd rule: an immediate command is never executed again as a normal command at release. The lifecycle metadata is carried separately so the script's ended slot still runs.

## Host API

The global API, documented verbatim by the Monaco `.d.ts`, is intentionally small:

- `Input.keyCombo(modifiers, keys)`, `Input.sendText(text)`, `Input.mouseClick(button)`, `Input.mouseDown(button)`, `Input.mouseUp(button)`, `Input.movePointer(x, y)`, and `Input.wheel(delta)`.
- `Context.origin`, `Context.endpoint`, `Context.triggerButton`, `Context.modifier`, `Context.phase`, `Context.targetWindowAvailable`, and `Context.activateTargetWindow()`.
- `Window.perform(operation)` for the six existing `WindowOperation` values against the captured target window.
- `Clipboard.readText()`, `Clipboard.writeText(text)`, and `Clipboard.selectedText()`.
- `ReportStatus(status)` to replace the visible command hint for the current invocation.

Arguments are validated before native calls. Unknown key, mouse-button, modifier, or window-operation names throw JavaScript errors instead of partially executing. Strings returned from the clipboard are nullable. Native window handles are never exposed as JavaScript numbers, avoiding precision loss and arbitrary-handle operations.

The API does not expose raw Win32, Node, DOM, `eval` extensions beyond ordinary JavaScript evaluation, file access, shell execution, or networking. QuickJS standard language intrinsics remain available.

## Monaco Editor

`ScriptEditor.vue` wraps Monaco as a framed editing tool and is reused for all five persisted script fields. It loads Monaco and the JavaScript worker only when a Script command is visible, uses a stable editor height, follows the application's light/dark class, relayouts with its container, synchronizes external model changes, and disposes models/workers cleanly.

JavaScript editors register `godgesture.d.ts` as an extra library. Imported Lua uses plaintext mode and keeps the existing warning. Existing Element Plus form density, semantic color variables, 8 px-or-smaller radii, and localized labels remain unchanged. Placeholder text claiming Monaco is future work is removed.

## Error Handling And Observability

- Engine construction failure is logged once; non-script commands continue working and Script invocations report an unavailable-engine error.
- Init failure leaves no usable cache entry, so a later invocation can retry after configuration changes.
- Slot exceptions include the caught JavaScript value or stack when available, command key, and slot name.
- A script error never panics across the engine consumer boundary and never blocks future gestures.
- `ReportStatus` is length-bounded before it reaches the native overlay; the last report from a synchronous slot wins.
- Legacy `language = "lua"` commands log a clear non-executable warning and do not create a Context.

## Tests And Acceptance

- Platform-neutral Rust tests cover lazy init, per-key state isolation, state reuse, definition invalidation, lifecycle order, context updates, status reporting, exceptions, and runaway-script interruption.
- Windows-focused tests cover host argument parsing and the input/clipboard helpers that can be isolated safely.
- Desktop tests cover model synchronization and the API declaration source where practical; typecheck and production build verify Monaco worker integration.
- Required automated checks are Desktop typecheck/test/build and Rust library tests/clippy. Shared checks are required only if the schema unexpectedly changes.
- Windows runtime QA creates a temporary Script gesture and verifies main execution, persistent state, `ReportStatus`, one input or clipboard operation, modifier lifecycle, an exception, and an infinite-loop timeout without losing hooks or UI responsiveness. Test configuration is removed afterward.

M3 is complete only when Script execution, lifecycle slots, host APIs, Monaco hints, documentation, automated checks, and Windows runtime evidence all agree. macOS remains explicitly incomplete under M4 rather than being hidden by the M3 status.

## Ownership And Commits

- Design: this document in its own commit.
- Rust engine and Windows host: Cargo files, `engine/script.rs`, runtime/consumer integration, Windows platform helpers, tests, and project status in one explicit domain commit.
- Desktop editor: package files, Script editor/API declarations, command editor integration, locale updates, tests, and project status in a separate explicit domain commit.
- Never stage or modify `接手提示词.md`, never run repository-wide `cargo fmt`, never use `git add -A`, and never push.

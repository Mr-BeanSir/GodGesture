# Unified Actions and Hotkey Recording Implementation Plan

## Scope

Implement the approved design in
`docs/superpowers/specs/2026-07-30-unified-actions-and-hotkey-recording-design.md`
without overwriting the maintainer's existing `GesturesView.vue` background
change or restoring separately deleted historical documents.

## 1. Hotkey Recording

- Extract a small hotkey recording state helper that tracks physical keydown and
  keyup events, committed value, draft modifiers/keys, cancellation, and chord
  completion.
- Update `HotkeyInput.vue` to start a fresh draft on focus, render modifiers
  immediately, commit once all pressed keys are released, cancel on Escape or
  incomplete blur, and keep Clear explicit.
- Use platform-specific Win/Cmd labels while retaining canonical `meta` data.
- Add focused unit/component tests for replacement, multi-key chords,
  modifier-only chords, repeats, cancellation, clear, and auto-finish.

## 2. Shared Configuration v2

- Add boundary origin, token, and intent schemas plus explicit capacity limits.
- Upgrade `ConfigDocument` to version 2 with deterministic preprocessing of
  version 1 `hotCorners.commands` and `rubEdges.commands` into global boundary
  intents while retaining the enabled flags.
- Update importers, template adoption, mock documents, tests, and generated API
  artifacts.
- Mirror the v2 structures and migration in Rust configuration loading and
  saving; add deterministic migration and round-trip tests.

## 3. Boundary Sequence Runtime

- Add a platform-independent prefix matcher with origin activation, exact and
  prefix conflict rules, timeout/cancel behavior, and bounded candidates.
- Normalize hook events into boundary tokens and coordinate the matcher with
  existing gesture capture, pause, config replacement, and synthetic-event
  filtering.
- Preserve ordinary gesture semantics and existing corner/rub detection.
- Add unit tests for empty, wheel, button, stroke, mismatch, timeout, reset, and
  replay decisions before native adapter work.
- Connect Windows and macOS hook adapters and command dispatch, keeping replay
  fail-open and platform-specific validation explicit.

## 4. Unified Workbench

- Add the two-step Add Action dialog and the boundary recorder.
- Generalize the Global App list/editor to show gesture and boundary intents;
  application scopes continue to show gesture intents only.
- Move corner/rub enabled switches into the Global App toolbar.
- Preserve the requested white application-pane background.
- Remove the dedicated navigation item and page after all behavior is routed.
- Add bilingual strings and focused view/utility tests.

## 5. Knowledge and Verification

- Update `CONTEXT.md` with boundary action terminology.
- Update `docs/PROJECT_STATUS.md` with the new schema, entry point, migration,
  implementation status, and actual verification results.
- Run shared tests/build, API drift checks, Desktop tests/typecheck/build, Rust
  library tests, Clippy with warnings denied, targeted formatting, and
  `git diff --check`.
- Perform a Windows runtime smoke for hotkey replacement/modifier-only capture
  and representative boundary actions when the development session is usable.
- Record macOS build/device gaps accurately.

## Commit Boundaries

1. `docs: plan unified action implementation`
2. `fix: make hotkey recording transactional`
3. `feat: add boundary action configuration`
4. `feat: recognize boundary action sequences`
5. `feat: unify action management workbench`

Each commit uses explicit path staging. No push is performed.

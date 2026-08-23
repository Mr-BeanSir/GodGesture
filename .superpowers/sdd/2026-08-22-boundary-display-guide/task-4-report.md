# Task 4 Runtime Routing And Worker Delivery Report

## Status

Implemented the Task 4 runtime routing and worker delivery brief within the requested Rust scope.

## Changes

- Added `GestureViewPreferences.show_boundary_guide` with camelCase serde mapping through the existing `rename_all = "camelCase"` contract and a backward-compatible default of `false`.
- Added `EngineMsg::BoundaryGuideChanged(Option<BoundaryGuideFrame>)`.
- Added an `AtomicBool` cache for the guide preference and a mutex-protected last-frame cache for deduplicated guide messages.
- Evaluated `CornerEdgeDetector::guide_at` before the existing stateful `on_move` call.
- Kept guide geometry independent from configured `boundaryIntents`; actual visible regions are controlled only by the `hotCorners.enabled` and `rubEdges.enabled` switches.
- Cleared the guide when the pointer leaves, pause or recording starts, recording is cancelled, tracker or boundary capture is active, a mouse button is held, fullscreen suppression applies, boundary capture is cancelled, or guide/global region switches change during config replacement.
- Preserved the existing stateful corner/rub hit path, including feeding `on_move` while buttons are held and before fullscreen command suppression.
- Added worker mappings from `BoundaryGuideChanged(Some(frame))` to `OverlayCmd::SetBoundaryGuide(frame)` and from `BoundaryGuideChanged(None)` to `OverlayCmd::ClearBoundaryGuide` beside the existing boundary overlay lifecycle cases.
- Did not add Tauri/WebView events and did not modify platform overlay or renderer files.

## TDD Evidence

The focused tests were added before production implementation. The initial command failed with the expected missing-contract errors:

```text
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features runtime::tests::guide_

error[E0609]: no field `show_boundary_guide` on type `GestureViewPreferences`
error[E0599]: no variant named `BoundaryGuideChanged` for `EngineMsg`
```

After implementation, the focused suite passed all 10 guide tests. The tests cover:

- empty `boundaryIntents` and deduplicated frames;
- disabled hot-corner and rub-edge regions;
- pointer-leave clearing;
- paused and recording suppression;
- active tracker and boundary captures;
- held mouse buttons;
- fullscreen suppression;
- preference and global region-switch changes.

The config test also verifies the `showBoundaryGuide` camelCase shape and default `false` behavior.

## Verification

```text
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
PASS

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features runtime::tests::guide_
10 passed, 0 failed

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features
320 passed, 0 failed, 2 ignored

cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features -- -D warnings
PASS, no warnings

git diff --check
PASS
```

Existing boundary hit, capture, swallowing, timeout, trail, and click replay tests remained green in the full Rust library suite.

## Scope And Platform Limits

- Modified production code only in `engine/config.rs`, `engine/runtime.rs`, and `lib.rs`, plus tests in those files and this required report.
- Preserved the pre-existing untracked `docs/superpowers/plans/` content and did not stage it.
- Verification ran on the current Windows host. It covers shared Rust runtime behavior, the Windows-compiled library target, and the worker mapping at compile time.
- No live Windows hook/overlay process was restarted or visually inspected for this task.
- macOS native compilation, runtime behavior, overlay delivery, and physical-device acceptance were not run in this environment.
- Therefore this report does not claim completed dual-platform runtime or visual acceptance; those remain platform QA work beyond Task 4's automated Rust scope.

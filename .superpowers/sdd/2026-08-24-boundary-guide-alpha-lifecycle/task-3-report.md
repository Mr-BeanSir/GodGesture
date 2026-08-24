# Task 3 Report: Record boundary guide alpha and trail lifecycle behavior

## Status

Documentation update and the requested verification baseline are complete on the Windows
host. The report records Windows automated Rust evidence separately from platform evidence
that cannot be produced on this host.

## Modified files

- `CONTEXT.md`
- `docs/PROJECT_STATUS.md`
- `docs/superpowers/specs/2026-08-24-boundary-guide-alpha-lifecycle-design.md`
- `.superpowers/sdd/2026-08-24-boundary-guide-alpha-lifecycle/progress.md`
- `.superpowers/sdd/2026-08-24-boundary-guide-alpha-lifecycle/task-3-report.md`

No production code, Shared package, Server/backend, protocol, or other documentation file was
modified. No existing user untracked file was modified.

## Documentation changes

- Recorded that guide geometry is unchanged: corners remain the real 10px quarter-circle
  display geometry and edges remain the actual DPI-scaled edge band.
- Recorded the display-only alpha contract: the real corner/edge visual area is fully opaque;
  alpha fades only after crossing the real area's inner boundary toward the screen interior;
  corners use the 10..20px fade range and edges use one fade band equal to the edge-band
  thickness; pixels beyond the display range are not shown.
- Recorded that the guide does not alter real hit geometry, boundary state-machine behavior,
  input ownership, replay, or command matching.
- Recorded authoritative immediate trail cleanup by native overlay `End`/`Cancel`, including
  live points, render/cache/show path state, and removal of `trail_fade_surface` plus equivalent
  snapshot capture/restore/composition and dedicated trail-fade mechanisms.
- Recorded that `SetBoundaryGuide` does not clean up old trails.
- Recorded independent label feedback semantics, including `ShowLabelFeedback -> End` in the
  same batch and in a later batch. `End` clears the trail but does not remove labels.
- Recorded that there are no Shared/Server/backend/protocol changes.
- Updated the project verification entry to point to this lifecycle report instead of the older
  boundary-guide-visual-correction SDD path.

## Verification commands and actual results

The following commands were executed after the documentation edits:

- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
  - Passed, exit code 0; no output.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features`
  - Passed: `330 passed; 0 failed; 2 ignored`.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features -- -D warnings`
  - Passed, exit code 0; no warnings or errors.
- `pnpm --filter @godgesture/shared build`
  - Passed, exit code 0. pnpm emitted the existing warning that the `pnpm` field in
    `package.json` is no longer read and `pnpm.onlyBuiltDependencies` was ignored.
- `pnpm --filter @godgesture/desktop typecheck`
  - Passed, exit code 0.
- `pnpm --filter @godgesture/desktop test -- --run`
  - Passed: `50` test files, `243 passed`, `3 skipped`.
- `pnpm check:api`
  - Constrained and failed, exit code 1. The Server filter matched no projects in this
    worktree, and the subsequent API generation check could not open the absent
    `apps/server/openapi.json`. This is an existing worktree/submodule artifact limitation;
    no API or Server file was generated or modified.
- `git diff --check`
  - Passed, exit code 0; no whitespace errors.
- `rg -n "trail_fade_surface|capture_trail_fade_surface|restore_trail_fade_surface" apps/desktop/src-tauri/src`
  - No matches. `rg` returned exit code 1 for the expected absent symbols; the wrapper
    normalized that expected result to exit code 0.

The focused macOS overlay filter was also run on the Windows host:

```text
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 332 filtered out
```

This is a host-cfg result and is not macOS execution evidence.

## Not executed or constrained

- The Windows Rust automated tests are evidence for the Windows cfg implementation only.
- Running the macOS overlay test filter on this Windows host reports zero tests because the
  macOS module is not compiled under the host cfg; that output is not macOS evidence.
- macOS native compilation, runtime/device behavior, Retina scaling, multi-screen placement,
  Spaces/fullscreen behavior, and click-through remain pending.
- Windows layered-window visual observation also remains pending; automated Rust evidence does
  not replace visual inspection of the native overlay.

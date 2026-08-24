# Boundary Trail Diagnostic Logging Design

**Goal:** Add debug-only evidence for the reported sequence where a finished gesture trail briefly reappears when a boundary guide is shown, without changing overlay behavior.

## Scope

- Trace the engine-to-overlay lifecycle order for `End`, `Cancel`, `SetBoundaryGuide`, and `ClearBoundaryGuide`.
- Record overlay state before and after lifecycle commands, including live points, rendered point count, `show_path`, redraw flags, visibility, guide presence, and overlay mode.
- Record whether a redraw is full or incremental, its dirty region, and Windows layered-window present mode.
- Keep logs under the existing `gesture.runtime`, `platform.windows`, and `platform.macos` targets.
- Do not change trail clearing, rendering, visibility, command ordering, persistence, shared protocol, or backend behavior.

## Diagnostic Hypothesis

The Windows overlay may expose the previous DIB contents when `SetBoundaryGuide` calls `set_overlay_visible(true)` before the command batch reaches `render()`. `End` and `Cancel` clear live trail state and hide the window, but the hidden DIB can still contain the previous trail until a subsequent full redraw. The logs must distinguish this stale-bitmap exposure from any late `Grow` or lifecycle command arriving after `End`.

## Evidence Contract

Every relevant command log records:

- command kind and lifecycle sequence at the overlay boundary;
- pre-command and post-command `points.len`, `rendered_points`, `show_path`, `needs_full_redraw`, `visible`, guide presence, and mode;
- for a render, full/incremental selection, dirty rectangles, point counts, and present mode;
- for Windows, the visibility transition relative to the next render.

The instrumentation is diagnostic only. It must not scan or mutate user data outside the existing overlay bitmap, and it must not introduce a new log setting or protocol field.

## Verification

- Add a focused test for the shared command-kind diagnostic vocabulary.
- Run the focused Windows/macOS overlay unit tests, Rust formatting, and `git diff --check`.
- Run the Desktop Rust library test suite if the focused tests pass.
- Confirm no old trail-fade snapshot symbols are reintroduced.

# Boundary Guide Alpha And Trail Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make boundary-guide alpha follow the real trigger area's inner edge and remove trail fade snapshots so gesture trails disappear immediately at `End`/`Cancel` on Windows and macOS.

**Architecture:** Keep `BoundaryGuideFrame.area` and all real corner/edge hit-test helpers unchanged. Add display-only proximity geometry in `engine/corners.rs`: the actual area stays opaque and only the inward approach band controls fade visibility. Remove `trail_fade_surface` and its capture/composition paths from both native overlays; `End` and `Cancel` clear live trail state immediately while label feedback remains independent.

**Tech Stack:** Rust desktop engine, tiny-skia native overlays, platform-specific Windows layered window and macOS native overlay, Cargo unit tests, pnpm desktop/shared verification.

## Global Constraints

- Windows 与 macOS 同版本交付,或明确标注单平台能力。
- 轨迹和命令提示使用原生覆盖层,不用 WebView。
- 本次不修改 `packages/shared`、Server、OpenAPI、数据库或设置协议。
- 不改变真实 `detect_corner`、`sequence_corner`、`sequence_at`、`active_edge`、边角状态机、输入吞噬、点击重放或命令匹配语义。
- 角真实显示区域为固定内侧半径 `10px` 的四分之一圆；半径 `0..=10px` alpha 为 `255`，半径 `10..=20px` 只作为显示接近区渐隐，超过 `20px` 不生成帧。
- 边真实显示区域为当前 DPI 的实际边带；边带内 alpha 为 `255`，向屏幕内部再以同等边带厚度渐隐，超过该范围不生成帧。
- End 和 Cancel 结束监听时立即清除轨迹点、路径绘制缓存和轨迹相关状态；不保留轨迹淡出快照或等价状态。
- 命令文字反馈可以继续按现有独立停留/淡出生命周期运行，但不得依赖轨迹快照。
- 新增或修改测试必须先形成针对旧行为的失败，再实现最小修复并验证通过。
- 运行 Python 脚本时只能使用 `uv run python`；本计划不需要 Python。

---

### Task 1: Display-only boundary guide proximity alpha

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/corners.rs`
- Test: `apps/desktop/src-tauri/src/engine/corners.rs` unit tests

**Interfaces:**
- Preserve `BoundaryGuideFrame.area`, `region`, DPI fields, and all real hit-test functions.
- Keep `guide_at` as the display-only entry point; only its guide proximity lookup and alpha calculation change.

- [x] **Step 1: Write the failing tests**

Add focused unit assertions that expose the old screen-edge alpha behavior:

```rust
#[test]
fn guide_at_keeps_corner_opaque_until_the_real_radius_then_fades_inward() {
    let mut detector = CornerEdgeDetector::default();
    let center = detector
        .guide_at(p(0, 0), Instant::now(), || Some(screen()), true, true)
        .unwrap();
    let real_edge = detector
        .guide_at(p(10, 0), Instant::now(), || Some(screen()), true, true)
        .unwrap();
    let inward = detector
        .guide_at(p(15, 0), Instant::now(), || Some(screen()), true, true)
        .unwrap();

    assert_eq!(center.alpha, 255);
    assert_eq!(real_edge.alpha, 255);
    assert!(inward.alpha < 255);
    assert!(inward.alpha > 0);
}

#[test]
fn guide_at_stops_corner_proximity_after_twenty_pixels_without_changing_area() {
    let mut detector = CornerEdgeDetector::default();
    let frame = detector
        .guide_at(p(19, 0), Instant::now(), || Some(screen()), true, true)
        .unwrap();
    assert_eq!(frame.area, corner_guide_area(ScreenCorner::LeftTop, screen().bounds));
    assert!(detector
        .guide_at(p(21, 0), Instant::now(), || Some(screen()), true, true)
        .is_none());
}

#[test]
fn guide_at_keeps_edges_opaque_through_the_band_then_fades_toward_the_interior() {
    let mut detector = CornerEdgeDetector::default();
    let edge = detector
        .guide_at(p(0, 500), Instant::now(), || Some(screen()), true, true)
        .unwrap();
    let inner_border = detector
        .guide_at(p(16, 500), Instant::now(), || Some(screen()), true, true)
        .unwrap();
    let fade = detector
        .guide_at(p(24, 500), Instant::now(), || Some(screen()), true, true)
        .unwrap();

    assert_eq!(edge.alpha, 255);
    assert_eq!(inner_border.alpha, 255);
    assert!(fade.alpha < 255);
    assert!(fade.alpha > 0);
    assert!(detector
        .guide_at(p(33, 500), Instant::now(), || Some(screen()), true, true)
        .is_none());
}
```

Use the repository's existing fixtures and adjust only coordinates needed to match their screen dimensions and DPI. The expected assertions must remain literal and must not call the new helper to compute expected alpha.

- [x] **Step 2: Run the focused tests and verify they fail for the old behavior**

Run:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features engine::corners::tests::guide_at -- --nocapture
```

Expected: failure showing alpha is currently strongest at the screen edge and/or the inward proximity frame is missing.

- [x] **Step 3: Implement the minimal display-only geometry change**

Keep `guide_corner`, `corner_guide_area`, `corner_guide_distance`, `active_edge`, and `dist_to_edge` unchanged for their existing consumers. Add display-only helpers that:

- accept corner positions through radius `20px` but return the existing `10px` quarter-circle area;
- compute corner fade distance as the amount beyond the real `10px` radius;
- accept edge positions through `2 * thick` from the screen edge while continuing to return the existing edge-band area;
- compute edge fade distance as the amount beyond the real edge-band thickness;
- return `255` inside the actual area and linearly fade only in the inward approach band;
- return `None` after the approach band.

Do not change the true hit-test functions or the order in which corners and edges are selected.

- [x] **Step 4: Run the focused tests and the existing corner regression tests**

Run:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features engine::corners::tests -- --nocapture
```

Expected: all corner geometry, disabled-region, offset-monitor, and state-machine regressions pass.

- [x] **Step 5: Commit**

```powershell
git add apps/desktop/src-tauri/src/engine/corners.rs
git commit -m "fix: align boundary guide alpha with trigger area"
```

### Task 2: Remove trail fade snapshots from native overlays

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/platform/macos/overlay.rs`
- Test: platform overlay unit tests in the same files

**Interfaces:**
- Preserve `OverlayCommand`, boundary guide rendering, window visibility, click-through, label feedback, and platform message routing.
- `End` and `Cancel` must clear live points/path rendering immediately.
- No platform overlay state may contain `trail_fade_surface` or another captured trail bitmap used by fade redraws.

- [x] **Step 1: Write failing lifecycle tests**

For each platform's existing state fixture, add or adapt tests to assert observable behavior:

```rust
#[test]
fn end_clears_trail_immediately_without_starting_trail_fade() {
    let mut state = overlay_test_state_with_points_and_label();
    state.apply_with_surface(OverlayCommand::End, |_state, _origin| Ok(()));

    assert!(state.points.is_empty());
    assert!(!state.show_path);
    assert!(!state.fade_active);
    assert!(state.label.is_some());
}

#[test]
fn cancel_clears_trail_immediately_without_starting_trail_fade() {
    let mut state = overlay_test_state_with_points_and_label();
    state.apply_with_surface(OverlayCommand::Cancel, |_state, _origin| Ok(()));

    assert!(state.points.is_empty());
    assert!(!state.show_path);
    assert!(!state.fade_active);
}
```

Where the existing platform state names differ, use that platform's real state transitions. Replace tests that directly construct or assert `trail_fade_surface`; tests must exercise `End`, `Cancel`, boundary-guide updates, and independent label feedback rather than asserting a removed field.

- [x] **Step 2: Run the focused overlay tests and verify they fail against the current snapshot implementation**

Run the Windows and macOS overlay test filters separately from the repository root:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features platform::windows::overlay::tests -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features platform::macos::overlay::tests -- --nocapture
```

Expected: the new immediate-clear assertions fail because the current `End`/`Cancel` path starts or preserves fade state and captures trail pixels.

- [x] **Step 3: Remove the snapshot implementation and make end/cancel authoritative cleanup**

On both platforms:

- remove the `trail_fade_surface` field, initialization, capture helper, restore/composition helper, and all render/dirty/visibility branches that exist only for that field;
- remove fade tests that only verify captured trail pixels, captured-fade persistence, or guide compositing with a captured trail;
- make `End` and `Cancel` clear points, path visibility/drawing cache, and trail-related fade state immediately;
- preserve any label-only feedback state needed by existing command feedback behavior;
- ensure `SetBoundaryGuide` only updates guide state and never captures or clears a previous trail as a substitute for end/cancel cleanup;
- ensure subsequent guide redraws cannot source pixels from a previous trail.

Do not remove or merge the independent label fade behavior unless it currently depends on the removed trail bitmap; if it does, retain its live label state and redraw path without trail pixels.

- [x] **Step 4: Run the focused overlay tests and existing overlay regression tests**

Run:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features platform::windows::overlay::tests -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features platform::macos::overlay::tests -- --nocapture
```

Expected: both platform suites pass, including guide raster/dirty bounds, label feedback, visibility, and lifecycle tests; no test or production reference to `trail_fade_surface` remains.

- [x] **Step 5: Commit**

```powershell
git add apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs
git commit -m "fix: clear gesture trails at overlay lifecycle end"
```

### Task 3: Update project status and verify the complete change

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/superpowers/specs/2026-08-24-boundary-guide-alpha-lifecycle-design.md`

**Interfaces:**
- Documentation records behavior only after the implementation and tests establish it.
- No shared protocol or backend changes are expected for this task.

- [x] **Step 1: Update terminology and status records**

Record that:

- actual guide geometry remains unchanged;
- alpha is opaque in the real corner/edge area and fades inward from the area's inner boundary;
- `End`/`Cancel` immediately remove live trails;
- trail fade snapshots were deleted from both native overlays;
- label feedback remains independent;
- Windows visual observation and macOS native/device acceptance remain pending unless separately performed.

- [x] **Step 2: Run formatting, targeted tests, and static checks**

Run:

```powershell
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features -- -D warnings
pnpm --filter @godgesture/shared build
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop test -- --run
pnpm check:api
git diff --check
```

- [x] **Step 3: Search for removed mechanisms and inspect the final diff**

Run:

```powershell
rg -n "trail_fade_surface|capture_trail_fade_surface|restore_trail_fade_surface" apps/desktop/src-tauri/src
git diff --stat
git status --porcelain=v1
```

Expected: the search returns no production or test references, and the only untracked pre-existing user file remains untouched.

- [x] **Step 4: Commit documentation and verification baseline**

```powershell
git add CONTEXT.md docs/PROJECT_STATUS.md docs/superpowers/specs/2026-08-24-boundary-guide-alpha-lifecycle-design.md
git commit -m "docs: record boundary guide lifecycle behavior"
```

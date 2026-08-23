# Boundary Guide Visual Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax and every task ends with a reviewable commit.

**Goal:** 让边角引导只显示真实可视范围：角为半径 10px 的四分之一圆，真实角命中逻辑不变；边为现有真实 DPI 边带；实际触发位置 alpha 为 255；填充为半透明灰色、描边为白色。

**Architecture:** 只修改 `guide_at` 的显示几何和 Windows/macOS 原生栅格绘制。保持 `detect_corner`、`CORNER_TRIGGER_DIST`、`sequence_corner`、`sequence_at`、Runtime 消息、OverlayCommand、窗口生命周期、dirty bounds、fade 和 click-through 不变。

**Tech Stack:** Rust 2021, tiny-skia 0.11, Windows layered DIB, macOS NSWindow/CALayer, cargo test/fmt/clippy, pnpm workspace。

## Global Constraints

- 不修改真实角触发范围、角命中阈值、rearm 状态、输入路由或边角序列 100px 近角准入区域。
- `guide_at` 不推进 corner/rub 状态；角显示半径固定为 `10px`，精确角点 alpha 为 `255`，范围外返回 `None`。
- 边继续使用现有 `active_edge`、DPI 边带和两端 100px 排除区；不扩大边真实区域。
- Windows/macOS 共用相同角几何、颜色和 alpha 语义；不新增 WebView 或窗口。
- 填充为半透明灰色，描边为白色；角使用四分之一圆路径，边使用圆角路径。
- 保持现有点击穿透、no-activate、macOS `ignoresMouseEvents`、Spaces/fullscreen、dirty-region 和 fade 生命周期。
- 不修改 Shared、Server、OpenAPI、数据库、设置协议或用户已有未跟踪文件。
- 每个新行为先写测试并观察 RED；commit message 使用英文；显式 `git add <path>`，不使用 `git add -A`。

---

### Task 1: Correct Display Geometry And Alpha

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/corners.rs`
- Test: existing `corners.rs` unit-test module

**Produces:** Existing `BoundaryGuideFrame` interface with corner frame area limited to a closed 10px bounding box and guide alpha quantized through 255. No change to real hit APIs.

- [ ] **Step 1: Add failing tests.** Add tests asserting `guide_at(p(0,0))` returns `Corner(LeftTop)`, area `{ left: 0, top: 0, right: 10, bottom: 10 }`, alpha `255`; `guide_at(p(7,7))` is weaker; `guide_at(p(11,0))` and `guide_at(p(50,50))` are `None`; and `guide_at(p(0,500))` returns an edge frame with alpha `255`. Add a regression that calls `guide_at(p(0,0))` before `on_move(p(0,0))` and confirms the result equals a fresh detector, while `sequence_at(p(50,50))` still returns the existing near-corner hit.
- [ ] **Step 2: Run RED.** Run the focused new tests with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features corners::tests::guide_`. Expected: old 100px corner guide and 184 alpha cap fail the new assertions.
- [ ] **Step 3: Implement minimally.** Add `CORNER_GUIDE_RADIUS: i32 = 10`; make only the `guide_at` corner branch use a new display-only helper that tests Euclidean distance to the closed screen corner and returns a 10px corner area. Keep `sequence_corner`, `sequence_at`, `detect_corner`, `on_move`, `active_edge` and all state fields unchanged. Update `corner_guide_distance` to use Euclidean distance for this display branch and extend `GUIDE_ALPHA_LEVELS` so distance zero selects `255`; retain the existing minimum level and quantization for nonzero distances.
- [ ] **Step 4: Run GREEN and regression checks.** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features corners::tests::guide_`, the existing hot-corner tests, `corners::tests::boundary_sequence_zone_separates_corners_from_edges`, and `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`.
- [ ] **Step 5: Commit.** Run `git add apps/desktop/src-tauri/src/engine/corners.rs` and `git commit -m "fix: align boundary guide geometry with trigger edges"`.

---

### Task 2: Render Small Gray Rounded Native Guides

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/platform/macos/overlay.rs`
- Test: platform overlay test modules in both files

**Consumes:** Task 1's unchanged `BoundaryGuideFrame` and existing platform coordinate conversion functions.

**Produces:** Same overlay state and commands, with gray rounded edge guides and white-bordered quarter-disk corner guides.

- [ ] **Step 1: Add failing raster tests.** Change the existing fill assertion to require equal RGB channels and nonzero alpha. Add a corner fixture with area `{ left: 0, top: 0, right: 10, bottom: 10 }`; assert an interior quarter-disk pixel is visible, a pixel inside the bounding square but outside the quarter disk is transparent, and a border pixel is brighter than a fill pixel. Keep Windows DIB conversion and macOS Retina/offset coverage.
- [ ] **Step 2: Run RED.** Run the focused Windows overlay raster and fill tests. Expected: old cyan fill and old square/double-line corner rendering fail.
- [ ] **Step 3: Implement Windows drawing.** Keep `boundary_guide_rect`, origin conversion, DIB conversion, dirty regions and clipping unchanged. Use gray base `rgba(112,118,126,128)` and white base `rgba(255,255,255,255)`, multiplying both alpha values by `frame.alpha / 255`. Draw corners with a tiny-skia quarter-disk path using `PathBuilder::cubic_to` and the standard quarter-circle kappa `0.5522848`, oriented for all four corners; fill then white-stroke it. Draw edges with a rounded-rectangle path whose radius is `min(4px * dpi, width/2, height/2)`; fill then white-stroke it.
- [ ] **Step 4: Implement macOS drawing.** Apply the exact same colors, alpha composition, quarter-disk orientation, rounded edge radius, stroke minimum and path construction using the existing Retina coordinate conversion. Do not change AppKit window flags, layer presentation or fade logic.
- [ ] **Step 5: Run GREEN.** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features overlay` and `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`. State clearly that macOS cfg tests/native compilation remain pending on this Windows host.
- [ ] **Step 6: Commit.** Run `git add apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs` and `git commit -m "fix: refine boundary guide native rendering"`.

---

### Task 3: Documentation And Verification Handoff

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Update docs.** State that corner guide visuals are display-only 10px quarter circles, exact-corner hit logic is unchanged, and edge guide visuals remain the actual DPI edge band. Keep Windows visual observation and macOS native/device acceptance pending.
- [ ] **Step 2: Run scoped verification serially.** Run `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features`; `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features -- -D warnings`; `pnpm --filter @godgesture/shared build`; `pnpm --filter @godgesture/desktop typecheck`; `pnpm --filter @godgesture/desktop test -- --run`; `pnpm check:api`; and `git diff --check`.
- [ ] **Step 3: Commit docs.** Run `git add CONTEXT.md docs/PROJECT_STATUS.md` and `git commit -m "docs: record boundary guide visual correction"`.
- [ ] **Step 4: Final review and merge.** Run task reviews and whole-branch review. From the root repository, verify `git status --porcelain=v1`, merge the feature branch into `main` with `git merge --no-ff codex/boundary-display-guide -m "merge: refine boundary display guide"`, then rerun Rust library tests, Desktop typecheck, `pnpm check:api`, and `git diff --check`. Do not push; keep `docs/superpowers/plans/` untouched. Remove the feature worktree only if Git permits non-force removal without deleting user files or submodules.

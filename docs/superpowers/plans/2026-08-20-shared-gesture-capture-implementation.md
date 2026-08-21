# Shared Gesture Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽离普通手势与边角手势共用的 `GestureCapture`，让边角始终拥有边界输入、立即显示轨迹并复用普通手势的捕获与原生恢复语义。

**Architecture:** `engine::capture` 组合现有 `StrokeParser` 和 `CaptureLedger`，提供一份 `GestureCapture` API。`PathTracker` 继续负责普通准入，`BoundaryMatcher` 继续负责边角候选，但二者不再各自保存 parser/ledger；`runtime` 只负责区域所有权和覆盖层消息适配。

**Tech Stack:** Rust 2021、Tauri Desktop engine、现有 `StrokeParser`、`CaptureLedger`、`PathTracker`、`BoundaryMatcher`、crossbeam channel、parking_lot。

## Global Constraints

- Windows 与 macOS 共用 Rust engine 逻辑，平台差异只保留在 hook、屏幕查询、覆盖层和输入合成。
- 边或近角命中后不降级到 `PathTracker`；边和角不互相匹配。
- 边角没有候选时仍建立 visual-only 捕获并显示轨迹；取消只重放已消费输入。
- 保留现有普通手势的 Pending、触发阈值、修饰符、键盘输入、点击透传和超时拖拽语义。
- `PathTracker` 已有的平台原生重放入口继续复用，不新增第二套重放线程或点击注入实现。
- 不修改 `packages/shared`、Server、Web Console、配置版本或 WebView 覆盖层。
- 保留工作区现有用户改动；本次不执行 `git reset`、`git checkout`、批量 `git add` 或 push。

---

### Task 1: 建立共享捕获对象

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/capture.rs`
- Test: `apps/desktop/src-tauri/src/engine/capture.rs`

**Interfaces:**
- `GestureCapture::new(origin: Point, effective_move_px: f64, release_anchor: Option<MouseButton>) -> GestureCapture`
- `GestureCapture::feed_move(point: Point) -> StrokeEvent`
- `GestureCapture::sync_strokes()` 将 parser 的方向序列同步到有序 `GestureInput::Stroke`
- `GestureCapture::strokes() -> &[Direction]`、`inputs() -> &[GestureInput]`、`inputs_mut() -> &mut Vec<GestureInput>`
- `GestureCapture` 委托 `CaptureLedger` 的 `push_ordered`、release、consumed/released 查询和取出方法。

- [ ] **Step 1: 写失败测试**

在 `capture.rs` 测试模块加入：

```rust
#[test]
fn shared_capture_syncs_diagonal_rewrite_without_duplicate_strokes() {
    let mut capture = GestureCapture::new(point(0, 0), 10.0, Some(MouseButton::Right));
    assert_eq!(capture.feed_move(point(20, -20)), StrokeEvent::Grew);
    capture.sync_strokes();
    capture.push_ordered(
        GestureInput::Stroke { direction: Direction::RightUp },
        None,
        None,
    );
    assert_eq!(capture.feed_move(point(80, -40)), StrokeEvent::Grew);
    capture.sync_strokes();
    assert_eq!(capture.strokes(), &[Direction::Up, Direction::Right]);
    assert_eq!(
        capture.inputs(),
        &[
            GestureInput::Stroke { direction: Direction::Up },
            GestureInput::Stroke { direction: Direction::Right },
        ]
    );
}
```

测试应先因 `GestureCapture` 不存在而失败；若编译失败不是缺少类型，先修正测试夹具后重新运行。

- [ ] **Step 2: 运行红灯测试**

运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib shared_capture_syncs_diagonal_rewrite_without_duplicate_strokes
```

预期：失败原因是共享捕获对象/API 尚未实现，而不是测试语法错误。

- [ ] **Step 3: 实现最小公共对象**

在 `capture.rs` 引入 `StrokeParser`、`StrokeEvent`、`Direction` 和 `Point`，实现 `GestureCapture`。把当前 `runtime.rs::sync_stroke_inputs` 的回写算法移入 `CaptureLedger::sync_strokes` 或 `GestureCapture::sync_strokes`，确保首个斜笔被 parser 回写时只更新已有 stroke，不重复追加。

- [ ] **Step 4: 运行绿灯测试**

运行同一 focused test，并补跑：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib capture::tests
```

预期：新增测试及现有 capture 测试通过。

### Task 2: 迁移普通会话到共享捕获对象

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/runtime.rs`
- Test: `apps/desktop/src-tauri/src/engine/runtime.rs`

**Interfaces:**
- `Session` 使用 `capture: GestureCapture`，不再直接保存 `StrokeParser` 和 `CaptureLedger`。
- `Action::PathStart` 创建 `GestureCapture::new(origin, effective_move_px, Some(trigger_mouse_button(trigger)))`。
- `Action::PathGrow` 调用 `capture.feed_move` 与 `capture.sync_strokes`。
- 普通识别、录制更新和结束事件读取 `capture.strokes()`、`capture.inputs()`。

- [ ] **Step 1: 写迁移保护测试**

把现有普通录制的对角线回写测试改为同时断言 `GestureCaptured.inputs` 与 `strokes`；增加主按钮释放后普通会话只发送一个 `PathEnded` 的断言，作为共享释放锚点的回归保护。

- [ ] **Step 2: 运行迁移前测试**

运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib runtime::tests::recording_rewrites_diagonal_stroke_in_ordered_inputs runtime::tests::moved_capture_ends_without_click_when_no_strokes
```

记录现有通过结果，再开始替换字段。

- [ ] **Step 3: 迁移 runtime 普通路径**

删除 `Session.parser`、`Session.capture` 的分裂字段和 `sync_stroke_inputs` 函数，替换为 `GestureCapture`。保留 `PathTracker` 的 `Action` 状态机和 `apply_actions` 的命令查找逻辑，只调整字段访问。

- [ ] **Step 4: 运行普通路径验证**

运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib runtime::tests tracker::tests
```

预期：普通手势行为和 tracker 原有测试无回归。

### Task 3: 迁移边角匹配和轨迹输入

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/boundary.rs`
- Modify: `apps/desktop/src-tauri/src/engine/runtime.rs`
- Test: `apps/desktop/src-tauri/src/engine/boundary.rs`
- Test: `apps/desktop/src-tauri/src/engine/runtime.rs`

**Interfaces:**
- `ActiveBoundary.capture: GestureCapture`。
- `BoundaryMatcher::activate(..., effective_move_px: f64, first_token: &BoundaryToken)` 在边角配置作用域内建立普通或 visual-only 捕获；无首 token 候选时仍返回 `Pending` 并拥有输入。
- `BoundaryMatcher::feed_move(point, now) -> BoundaryResult` 使用共享 parser 生成方向并继续当前边/角候选匹配。
- `runtime` 删除 `boundary_parser` 和 `has_prefix` 路由判断；已有边角捕获的移动交给 `BoundaryMatcher::feed_move`。

- [ ] **Step 1: 写失败的边角所有权测试**

新增/调整 runtime 测试：启用摩擦边但没有 `X2` 边角序列，在边缘 `ButtonDown(X2)`、移动、`ButtonUp(X2)` 后必须收到 `BoundaryPathStarted` 与 `BoundaryPathGrown`，不得收到 `PathStarted`；取消结果只包含已消费的 `X2` 点击重放。

- [ ] **Step 2: 运行红灯测试**

运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib boundary::tests runtime::tests::unmatched_boundary_input_starts_visual_capture
```

预期：迁移 API 尚未存在或旧路由仍无法通过断言，必须看到与目标行为相关的失败。

- [ ] **Step 3: 实现边角共享捕获**

让 `BoundaryMatcher` 创建 `GestureCapture`，并在 `feed_move` 中先推进 parser，再把新增方向转换成 `BoundaryToken::Stroke` 喂给当前候选；喂入完成后调用 `sync_strokes` 修正首笔回写。普通和 visual-only 分支都走同一 capture 对象。

将首 token 是否匹配的判断封装进 `BoundaryMatcher` 激活过程：首 token 有候选时进入序列匹配，没有候选时进入 visual-only；runtime 不把首 token 交还给 `PathTracker`。保留精确角点空序列的移动触发路径。

- [ ] **Step 4: 运行边角和释放验证**

运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib boundary::tests runtime::tests
```

重点确认顶部方向移动、底部托盘右键、侧键无配置、匹配失败重放、主按钮释放和附加按钮释放各自只结束一次。

### Task 4: 文档和完整验证

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/PROJECT_STATUS.md`
- Verify: `apps/desktop/src-tauri/src/engine/capture.rs`
- Verify: `apps/desktop/src-tauri/src/engine/boundary.rs`
- Verify: `apps/desktop/src-tauri/src/engine/runtime.rs`

- [ ] **Step 1: 更新项目知识入口**

在 `CONTEXT.md` 记录 `GestureCapture` 术语和“边角所有权先于普通 PathTracker”的现行规则；在 `docs/PROJECT_STATUS.md` 更新边角共享捕获的实现状态、自动化验证基线和真实 Windows/macOS 验收边界。

- [ ] **Step 2: 运行 Desktop Rust 全部库测试**

运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

预期：所有非 ignored 测试通过。

- [ ] **Step 3: 运行格式、Clippy 和 diff 检查**

运行：

```powershell
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib -- -D warnings
git diff --check
```

- [ ] **Step 4: 复核工作区差异**

运行 `git diff --stat` 和受影响文件的 `git diff`，确认没有修改 shared 协议、Server、Web Console、WGestures 或用户已有无关改动。当前任务不提交、不 push；向用户明确自动化结果和是否有运行实例可供 attach 验收。

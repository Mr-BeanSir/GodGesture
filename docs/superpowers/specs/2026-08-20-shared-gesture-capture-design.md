# Shared Gesture Capture Design

## Goal

让普通桌面手势和边角手势共用一份活动捕获实现，复用 `PathTracker` 现有的输入顺序、轨迹解析、释放锚点和原生输入恢复语义，同时保留普通手势与边角手势各自的候选匹配范围。

## User-visible contract

- 鼠标按下时，先按当前位置决定输入所有权。
- 命中边或近角区域后，无论当前按键是否存在边角配置，都由边角捕获接管，不再降级进入 `PathTracker`。
- 边角捕获在首个特殊按键或滚轮输入被接管后立即显示轨迹；匹配成功、匹配失败或没有候选都不影响轨迹生命周期。
- 边只匹配该边配置，角只匹配该角配置，不混入普通桌面手势或其他边角配置。
- 普通桌面区域继续使用 `PathTracker` 的 Pending/Tracking、修饰符、键盘输入、点击透传和超时拖拽行为。
- 边角取消时只重放已经消费的按钮/滚轮输入，使用与普通手势相同的捕获账本和平台重放入口。
- 主释放键释放后才结束活动捕获；已经消费的附加按钮释放只吞掉，不触发第二次完成。

## Architecture

`engine::capture` 提供 `pub(crate) GestureCapture`。它组合现有 `StrokeParser` 和 `CaptureLedger`，统一保存轨迹、标准化输入、主释放键、已消费输入和按钮释放状态。普通 `Session` 和边角 `ActiveBoundary` 各自拥有一个实例，但不再分别保存 parser 与 ledger。

`PathTracker` 仍负责普通手势独有的准入状态：触发键 Pending、起始阈值、点击透传、起始超时拖拽、停留超时和附加物理输入报告。`BoundaryMatcher` 仍负责边角来源、候选收敛、空序列动作和边角取消；它通过共享捕获对象消费方向输入。`runtime` 只负责在输入路由上选择捕获来源和把统一捕获事件映射到现有覆盖层消息。

边角首 token 的候选判断移动到 `BoundaryMatcher` 的激活过程：激活函数同时知道当前位置、首 token 和配置作用域。如果首 token 没有任何候选，仍建立 visual-only 捕获；运行时不再先用 `has_prefix` 决定是否把输入交还给普通手势。

## Non-goals

- 不修改 `packages/shared`、Server、Web Console 或配置版本。
- 不给 `BoundaryIntent` 增加独立 modifier 字段。
- 不改变 Windows/macOS 平台输入合成接口；只复用已有 `PlatformServices` 重放入口。
- 不把轨迹或命令提示迁移到 WebView。
- 不在本次重构中解决尚未有现场证据的 Windows 光标恢复策略问题。

## Verification

自动化测试覆盖普通和边角捕获对象的共同不变量、边角所有权、visual-only 轨迹、首笔对角线回写、按钮释放和重放记录。Desktop Rust 通过 `--lib` 测试、Clippy、Rustfmt 和 `git diff --check` 后，再进行当前运行实例的 Windows 验收；没有运行实例时明确记录为平台验收 pending。

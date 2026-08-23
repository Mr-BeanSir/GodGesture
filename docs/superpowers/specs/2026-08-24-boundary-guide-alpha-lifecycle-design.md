# Boundary Guide Alpha And Trail Lifecycle Design

## Goal

修正边角显示引导的渐隐基准，并让手势轨迹在动作监听结束时立即清除，同时删除已经没有意义的轨迹淡出快照代码。

## Scope

本次只修改 Desktop Rust 的边角几何/alpha 和 Windows/macOS 原生 overlay 状态；不修改真实边角命中、摩擦边触发、边角序列、Shared、Server、OpenAPI、数据库或设置协议。

## Alpha Semantics

引擎继续生成 `BoundaryGuideFrame`，平台继续使用同一帧数据。

角引导：

- 实际显示区域仍为屏幕角点内侧半径 `10px` 的四分之一圆。
- 半径 `0..=10px` 的真实显示区域 alpha 为 `255`。
- 从半径 `10px` 到 `20px` 的屏幕内部接近区域继续生成引导帧，并按距离渐隐。
- 超过 `20px` 不生成引导帧。
- 该接近区域只影响 alpha 和帧可见性，不扩大绘制路径，不改变真实角命中。

边引导：

- 真实显示区域仍为当前 DPI 计算出的边带。
- 边带内部及其外边框 alpha 为 `255`。
- 从边带朝屏幕内部继续移动一个同等厚度的距离时按距离渐隐。
- 超过该渐隐距离不生成引导帧。
- 该区域只影响 alpha 和帧可见性，不扩大边带绘制，不改变 `active_edge`、两端排除区或摩擦边状态机。

alpha 的距离基准必须从屏幕最外沿改为“越过真实显示区域朝屏幕内部的距离”。真实显示区域内保持满 alpha，只有越过外边框后才衰减。

## Trail Lifecycle

轨迹只属于当前活动手势监听：

- `Begin` 创建当前轨迹状态。
- `Grow` 只更新当前轨迹。
- `End` 和 `Cancel` 立即清除点、标签中的路径部分、绘制缓存和所有轨迹相关状态。
- 不再在手势结束后保留轨迹淡出。
- `fadeOut` 不再作用于轨迹；命令文字反馈仍可按现有独立反馈生命周期停留和淡出。
- 边角引导更新、下一次 `Begin`、`ShowLabelFeedback` 不承担清理上一轮轨迹的责任。

Windows/macOS overlay 都删除 `trail_fade_surface` 字段以及仅服务于轨迹淡出的捕获、合成、fade 分支和测试；实现中不保留该快照字段或等价的轨迹快照状态。清理后，旧轨迹不能在边角引导或后续手势中重新出现。

## State And Platform Boundaries

- `OverlayCommand` 协议保持不变；删除只属于平台 overlay 内部的废弃状态和辅助函数。
- 引导清除、窗口显示、点击穿透、no-activate、Spaces/fullscreen 和命令文字反馈生命周期保持不变。
- Windows 与 macOS 使用相同 alpha 语义；平台差异只保留原生绘制和窗口管理实现。

## Verification

引擎测试覆盖：

- 角半径 `10px` 内 alpha `255`。
- 角半径 `10px` 到 `20px` 渐隐，超过 `20px` 为 `None`。
- 边带内 alpha `255`，边带内侧外边框之后渐隐，超过同等厚度为 `None`。
- 真实命中和近角序列区域保持不变。

Windows/macOS overlay 测试覆盖：

- `End`/`Cancel` 后轨迹点和绘制缓存立即清除，代码中不存在轨迹 fade 快照字段或等价状态。
- `End`/`Cancel` 后命令文字仍按既有配置独立保留或淡出。
- 后续 `SetBoundaryGuide` 不会带出上一轮轨迹。
- 删除轨迹 fade 代码后，现有引导绘制、窗口生命周期和文字反馈测试继续通过。

验证命令至少包括 Rust fmt、Rust library tests、Rust Clippy、Shared build、Desktop typecheck、Desktop tests、`pnpm check:api` 和 `git diff --check`。Windows layered-window 现场视觉观察及 macOS native/device 验收仍按项目状态文档单独记录，不能用自动化结果替代。

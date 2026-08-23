# 边角显示引导视觉修订设计

## 目标

修正已有“边角显示”引导，使它准确表达真实边角触发位置：角的实际命中逻辑保持不变，视觉提示只显示屏幕角内侧半径 `10px` 的四分之一圆；鼠标位于实际精确角点时引导达到 `100%` 不透明度，向屏幕内部移动时按距离渐变透明。

边引导继续只显示现有真实边带，不扩大边带，不把角的近角序列区域当作角引导。引导仍受 `hotCorners.enabled` 与 `rubEdges.enabled` 分别控制，并继续通过 Windows/macOS 原生覆盖层显示。

## 已确认行为

- `CornerEdgeDetector::detect_corner`、`CORNER_TRIGGER_DIST`、角 rearm 状态和角命中消息不修改；精确角点仍是实际触发点。
- `sequence_corner`、`sequence_at` 和边角序列候选区域不修改；现有近角 `100px` 区域仍只服务非空边角序列准入。
- `guide_at` 不调用 `detect_corner` 或 `detect_rub`，不推进任何命中或摩擦边状态。
- 角引导的显示半径固定为 `10px`，单位与现有 `ScreenRect`/鼠标坐标一致，不改变实际命中半径。
- 左上角显示屏幕左上内侧的四分之一圆，其余三个角按屏幕角方向镜像；引导边界位于实际屏幕边界与四分之一圆弧之间。
- 鼠标在精确角点时角引导 alpha 为 `255`；从角点沿引导区域向内移动时 alpha 单调降低；离开 `10px` 显示范围后引导清除。
- 角引导区域只影响可视帧和 dirty bounds，不参与输入命中测试、窗口焦点或点击吞噬。
- 边引导的真实区域仍由现有 `active_edge` 和 DPI 缩放边带决定；边两端的 `100px` 角落排除规则保持不变。
- 引导填充使用半透明灰色；边界使用白色描边；绘制使用抗锯齿圆弧和圆角连接。引导 alpha 同时控制填充与描边的整体显隐，最高档为完全可见，灰色填充本身仍保持半透明。
- Windows 与 macOS 共享同一角引导几何、半径和 alpha 语义；平台代码只负责坐标换算与 tiny-skia 原生栅格绘制。

## 设计范围

### 几何

在 `apps/desktop/src-tauri/src/engine/corners.rs` 中增加仅供 guide 查询使用的常量和辅助函数：

- `CORNER_GUIDE_RADIUS: i32 = 10`；
- `corner_guide_area` 改为返回半径 `10px` 的闭区间包围盒，而不是 `CORNER_SEQUENCE_DIST` 的 `100px` 方形；
- `corner_guide_distance` 继续从屏幕角点计算欧氏距离；
- `guide_at` 的角分支改用半径 `10px` 判断与 alpha 计算，边分支保持现状；
- `detect_corner`、`sequence_corner`、`active_edge` 和 `on_move` 不改行为。

测试必须同时证明：

1. `guide_at` 在精确角点返回角帧且 `alpha == 255`；
2. 角帧包围盒不超过 `10px` 半径的显示范围，`p(50,50)` 不再返回角引导；
3. 角 alpha 从角点向内移动单调降低，并在显示半径外返回 `None`；
4. 现有 `on_move` 在精确角点仍触发，且 `sequence_at` 的近角行为不变；
5. `guide_at` 仍不改变后续 `on_move` 命中状态。

### 原生绘制

在 Windows 和 macOS overlay 中保留现有状态、命令、dirty-region 和 fade 生命周期，仅替换 guide 的绘制形状与颜色：

- 边仍绘制为沿实际边带的灰色半透明区域和白色内外描边；
- 角使用 quarter-disk path，直角两条边贴合屏幕外沿，圆弧位于屏幕内部；
- 路径填充采用灰色，描边采用白色；不再使用当前蓝青色填充和暗色/白色双线组合；
- path 的坐标由 `BoundaryGuideFrame.area` 和 `frame.region` 换算，保持 offset monitor、DPI、Retina 和 Windows DIB 通道语义；
- 绘制区域继续限于 frame area，旧帧与新帧 dirty union 逻辑不变；
- 现有 click-through、no-activate、window level、Spaces/fullscreen 和 fade 合成逻辑不变。

### 运行时与协议

不修改 Shared 配置、Server、OpenAPI、`ConfigDocument` 版本、Runtime 消息接口或设置页。现有 `showBoundaryGuide` 开关、全局角/边 gate 和抑制状态继续复用。

## 验证

先执行 TDD 红绿循环：新增角几何和绘制测试，确认旧实现因 `100px` 方形/旧颜色/旧 alpha 失败，再实现最小修改。

功能分支至少执行这些命令：`cargo fmt --check`、角 guide focused tests、overlay tests、Rust library tests、Clippy、Shared build、Desktop typecheck、Desktop tests 和 `git diff --check`。

Windows 需要现场确认角点四分之一圆、角点 100% alpha、离角渐隐、边带范围和点击穿透；macOS 原生编译、cfg 测试、Retina/多屏和真实设备验收不能由 Windows 结果替代。

## 非目标

- 不修改真实角触发范围或角命中阈值。
- 不修改非空边角序列的 `100px` 近角准入区域。
- 不扩大边带、不改变边角全局开关或输入路由。
- 不修改 Shared/Server/API/数据库或新增设置项。
- 不新增 WebView 或独立引导窗口。

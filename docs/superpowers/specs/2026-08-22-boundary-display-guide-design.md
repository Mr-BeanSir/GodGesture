# 边角显示引导设计

## 目标

在 Desktop 设置中增加“边角显示”开关。开启后，用户将鼠标快速移近当前显示器的边缘或角落时，看到与实际边角判定范围一致的原生视觉引导；引导按鼠标与边界的距离渐显，离开范围后立即隐藏。

引导必须覆盖当前显示器的四个角和四条边，即使对应位置没有配置边角动作；但全局边角能力关闭时，相关区域不显示：`hotCorners.enabled` 关闭隐藏四角，`rubEdges.enabled` 关闭隐藏四边。

## 已确认的行为

- 设置字段命名为 `showBoundaryGuide`，位于同步的 `preferences.gestureView` 中，默认值为 `false`。
- 该设置随 `ConfigDocument` 整库同步，参与快照、回滚和模板采纳后的个人配置；不属于 `MachineLocalSettings`。
- 只显示鼠标当前所在显示器的附近区域。鼠标跨显示器后，旧显示器引导清除，并根据下一次移动切换到新显示器。
- 远离四边四角时完全隐藏；进入实际边角范围后显示弱引导，越靠近边界触发位置越明显。
- 角区域复用 `corners.rs` 中非空边角序列的近角区域：角点向内的 `100px` 轴向范围，并保持现有角/边优先级和边角排除规则。
- 边区域复用现有 `active_edge` 判定：边带厚度为 `16px * DPI scale` 的整数值，距两端 `100px` 内的区域仍让给角落，不绘制为边带。
- 四角与四边均按全局开关独立控制，不读取 `boundaryIntents`，因此没有动作配置的位置也能显示。
- 暂停、录制、普通手势捕获、边角序列捕获、鼠标已有任意按键按下，以及全屏策略当前禁止手势时隐藏引导。引导本身不改变输入吞噬、边角武装、命令匹配、命令执行或点击重放。
- 普通轨迹、命令提示和边角引导不能同时以互相遮挡的状态显示。开始捕获或显示命令标签反馈时，覆盖层清除引导；捕获结束后等下一次鼠标移动重新计算。

## 非目标

- 不改变触发角、摩擦边、边角序列、普通手势或修饰符的匹配语义。
- 不扩大实际边角判定区域，也不新增独立的预告区域。
- 不显示动作名称、未配置提示、角/边文字标签或设置页外的 WebView 画面。
- 不新增独立的覆盖窗口、跨设备专属设置或数据库字段。
- 不把 Windows 自动化结果写成 macOS 真实设备验收通过。

## 配置与同步

### Shared

在 `packages/shared/src/config/preferences.ts` 的 `GestureViewPreferences` 增加：

```ts
showBoundaryGuide: z.boolean().default(false)
```

`ConfigDocument` 继续保持格式版本 `8`。这是可由默认值兼容的新增偏好，不触发格式版本升级。现有本地配置、云端配置、历史快照、模板采纳文档和空文档解析后均得到 `false`；显式 `true` 在解析、同步和回滚中保留。

同步协议中的 `PullConfigResponse`、`PushConfigRequest`、`ConfigIndexResponse` 和 `ConfigDocument` 均通过现有 Shared schema 自动包含该字段，不增加新的 REST endpoint。

### Desktop 设置

在 `apps/desktop/src/views/OptionsView.vue` 的“显示”区域增加原生 checkbox：

- 标签：`边角显示` / `Boundary guide`；
- 绑定：`prefs.gestureView.showBoundaryGuide`；
- 使用现有 `gg-switch` 控件和 `useId()` 关联 label；
- 不写入 `machine`，不增加独立保存逻辑；
- 文案只加入 `apps/desktop/src/locales/zh-CN.ts` 与 `apps/desktop/src/locales/en.ts`。

## 运行时架构

### 几何查询

`CornerEdgeDetector` 增加不推进状态机的引导查询。它复用当前显示器缓存、闭区间屏幕矩形、DPI 和既有区域辅助函数，返回：当前显示器信息、区域类型和归一化接近度。

```text
BoundaryGuideQuery(pos, screen)
  -> None
  -> { screen_origin, screen_size, region: Corner|Edge, proximity: 0.0..=1.0 }
```

角区域使用 `max(abs(dx), abs(dy))` 作为轴向距离，避免与现有方形近角判定区产生视觉偏差；边区域使用到对应屏幕边缘的垂直距离。两种区域都在实际范围边界返回接近度 `0`，在最靠近边/角的位置返回 `1`。查询不调用 `detect_corner`、`detect_rub`，不会改变 rearm、rub 计数或命中状态。

### Runtime 消息

`EngineShared` 从当前配置缓存 `showBoundaryGuide`，并在 `replace_config` 中更新。鼠标移动路径在不影响现有 `detect_corner_edge` 命中逻辑的前提下调用引导查询：

```text
guide disabled / global side disabled / suppressed state -> Clear or no frame
guide query returns None                              -> Clear
guide query returns frame                            -> BoundaryGuideChanged(frame)
```

引导消息只在区域改变或透明度量化级别改变时发送。透明度使用有限级别量化，连续 Move 不会无界地产生重复工作。引导消息走已有 engine worker 和 `OverlaySink` 通道，钩子线程只做缓存几何查询和轻量状态比较，不执行栅格化、窗口操作或系统调用以外的现有屏幕查询。

开始普通/边角捕获、命令反馈、暂停、录制或配置关闭时发送清除状态。清除状态必须与已有轨迹/标签状态独立：只删除引导层，不错误隐藏正在显示的命令反馈；捕获开始和标签反馈则按现有 overlay 生命周期清空引导后再显示主内容。

## 原生覆盖层

### 公共接口

在 `apps/desktop/src-tauri/src/platform/overlay.rs` 增加平台无关的边角引导帧类型和 `OverlayCommand` 分支。帧包含屏幕原点、屏幕物理尺寸、DPI、角/边区域和量化透明度；不将 Shared 配置类型或 WebView 类型引入平台层。

引导命令至少支持：

- 设置/替换当前引导帧；
- 清除当前引导帧。

`OverlaySink` 接口保持单一 `send` 入口，Windows 和 macOS 的现有 `Overlay` 实现继续实现同一 trait。

### Windows

在 `apps/desktop/src-tauri/src/platform/windows/overlay.rs` 的现有 `OverlayState` 中保存可选引导帧。引导使用既有 tiny-skia DIB 和两个分层窗口切片绘制：贴屏幕边缘的半透明填充、内侧高对比边界线和轻微暗色描边。渲染坐标先减去当前显示器原点，并按现有 DPI 因子换算到 DIB。

引导更新纳入现有 dirty-region/full-redraw 机制，至少合并同一批次中的连续帧并重绘旧帧与新帧覆盖的区域。窗口继续使用 `WS_EX_TRANSPARENT | WS_EX_NOACTIVATE`，不参与鼠标命中和焦点切换。

### macOS

在 `apps/desktop/src-tauri/src/platform/macos/overlay.rs` 的现有 `OverlayState` 中保存可选引导帧，沿用 `NSWindow + CALayer + tiny-skia`。按现有 Retina scale 把屏幕坐标换算到 pixmap 局部坐标，使用与 Windows 相同的区域形状、颜色语义和透明度语义。

引导绘制不能改变现有 `ignoresMouseEvents`、window level、Spaces/全屏行为和窗口生命周期；引导只使用当前鼠标所在显示器的原生 surface。

### 视觉参数

- 区域内部为半透明高对比蓝青色强调填充；外边缘用暗色描边，内边界用白色细线，保证在亮暗背景上都能辨认。
- 进入区域的最低 alpha 约为 `24`，最靠近边/角的最高 alpha 约为 `184`；具体值集中在覆盖层模块常量中，不进入用户配置。
- 引导不使用文字、emoji、渐变大背景或装饰性动画；透明度由鼠标位置直接决定，离开后立即清除。

## Server 与 OpenAPI

Server 的同步服务已经通过 `ConfigDocument.parse` 校验整库正文，新增字段无需新增服务逻辑或数据库迁移。但 OpenAPI 注册的 `ConfigDocument` schema 会改变，因此实施时必须：

1. 构建 Shared，确认新的 Zod schema 和类型声明生成；
2. 在 `apps/server` 子模块运行现有 OpenAPI 文档生成/检查脚本，更新其受跟踪的 `openapi.json`（若脚本产生该变更）；
3. 运行根 `generate:api`，更新 `packages/shared/src/api/generated.ts`；
4. 运行 Server sync/OpenAPI 契约测试，确认新增偏好能穿过 push、pull、index、snapshot 和 restore；
5. 根仓库只提交明确的子模块 gitlink 和 Shared 生成文件，不复制 Server 源码到根仓库。

## 验证策略

### Shared 与 Desktop

- `packages/shared/src/config/__tests__/document.test.ts`：默认关闭、显式开启、其他配置默认值不变。
- `apps/desktop/src/views/OptionsView.test.ts`：中英文标签、原生 checkbox 关联和双向偏好绑定。
- `pnpm --filter @godgesture/shared build`
- `pnpm --filter @godgesture/desktop typecheck`
- `pnpm --filter @godgesture/desktop test -- --run`

### Rust

- `corners.rs`：近角/边带实际范围、接近度单调变化、角落排除、DPI 和无显示器场景。
- `runtime.rs`：四角/四边不依赖动作配置，独立全局开关和抑制状态清除引导，既有命中和输入裁决消息不回归。
- `platform/overlay.rs`：引导帧命令可记录、替换和清除。
- Windows/macOS overlay 单元测试：状态清理、旧帧 dirty 区域与新帧渲染状态。
- `cargo fmt --check`
- `cargo test --lib --no-default-features`
- `cargo clippy --lib --no-default-features -- -D warnings`

### API 与后台

- `pnpm check:api`
- Server 现有 `sync` 与 OpenAPI 测试。
- `git diff --check`。

自动化通过后，Windows 需在现有进程接管/新构建进程上验收鼠标靠近四角四边、透明度随距离变化、无动作位置显示、全局开关隐藏和捕获期间隐藏；macOS 按 M4 清单验收原生输入、TCC、Retina 多屏、全屏/Spaces 和点击穿透。自动化或 Windows 结果不替代真实 macOS 证据。

## 文档更新

- `CONTEXT.md`：新增“边角显示引导”术语和现役行为，说明它是同步偏好、使用原生覆盖层、只显示当前显示器和受全局边/角开关控制。
- `docs/PROJECT_STATUS.md`：记录设置入口、Shared/Server OpenAPI 契约、Windows 自动化证据和 macOS 现场 pending 状态；不改写现有 M4/M8 pending 结论。


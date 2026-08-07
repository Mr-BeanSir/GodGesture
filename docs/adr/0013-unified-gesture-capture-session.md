# 普通手势与边角序列共用统一捕获会话

- 状态: Accepted, shared capture primitives and phases 1-5 implemented, platform acceptance pending
- 日期: 2026-08-07
- 范围: `apps/desktop/src-tauri/src/engine`
- 关联决策: [0001](0001-dual-platform-simultaneous-release.md)、[0006](0006-native-overlay-rendering.md)

## 背景

当前输入引擎由两条状态路径组成:

- [`tracker.rs`](../../apps/desktop/src-tauri/src/engine/tracker.rs) 中的 `PathTracker` 负责普通手势的触发键待定、移动阈值、点击透传、路径生长、附加鼠标输入、滚轮和键盘输入。
- [`boundary.rs`](../../apps/desktop/src-tauri/src/engine/boundary.rs) 中的 `BoundaryMatcher` 负责边角/边缘序列候选、前缀过滤、完成等待和输入恢复。

两条路径分别维护了有序输入匹配、已消费按钮、按钮释放和超时取消的一部分逻辑。这样做曾经能快速接入边角序列，但会产生三个持续问题:

1. 同一类物理输入在普通手势和边角手势中有不同的完成和释放语义。
2. 边角序列容易把最后一个按钮当成独立修饰符，在 `ButtonDown` 时就完成，而不是等待主特殊键释放。
3. 普通手势已有的“有序输入优先于独立修饰符、独立修饰符不追加到基础序列、可以重复触发”的规则无法自然复用到边角路径。

当前普通手势的修饰符语义位于运行时而非单纯的物理追踪器中:

- `PathTracker` 把附加按钮和滚轮报告为附加输入事件。
- `runtime.rs` 先用 `any_inputs_with_prefix` 判断该输入是否是更长有序序列的前缀。
- 只有不属于有序前缀时，才用 `find_modifier` 查找独立修饰符。
- 独立修饰符命中后立即执行、不加入基础输入，并继续监听到主触发键释放。

因此，简单地让“边角会话继续交给 `BoundaryMatcher`、普通会话继续交给 `PathTracker`”会把两套手势逻辑长期固定下来。本次重构统一活动捕获会话，仅保留两套必要的准入适配。

## 决策

输入引擎采用“区域准入适配器 + 统一手势捕获会话 + 候选配置提供器”的结构:

```text
物理输入
  |
  v
InputRouter
  |
  +-- RegionAdmission
  |     +-- OrdinaryAdmission
  |     +-- BoundaryAdmission
  |
  +-- GestureCaptureSession
        +-- OrderedInputMatcher
        +-- ModifierResolver
        +-- ReleaseAnchor
        +-- StrokeParser
        +-- Replay / timeout / cancellation
                 |
                 +-- OrdinaryIntentCatalog
                 +-- BoundaryIntentCatalog
```

目标是只保留一份活动手势的输入、匹配、修饰符、释放和取消逻辑。普通手势和边角序列的差异只存在于:

- 是否允许进入活动捕获;
- 首个输入如何判定为普通触发键或边角序列首 token;
- 从哪个配置作用域取得候选序列;
- 轨迹消息使用普通手势或边角序列的覆盖层事件名。

### 保留的准入差异

`PathTracker` 不会被整体删除。它降级为普通手势的 `OrdinaryAdmission`，只保留普通手势独有的物理准入行为:

- 触发键按下后的 `Pending` 状态;
- `initialValidMovePx` 起始阈值;
- 未形成手势时的点击透传;
- 起始超时后的普通拖拽透传;
- 普通触发键抬起和暂停和弦所需的平台输入边界。

边角侧保留 `CornerEdgeDetector` 的区域和立即动作职责:

- 精确角点只用于空序列立即动作;
- 近角区域和排除角落后的边缘区域用于非空边角序列;
- 光标移动本身不能武装非空边角序列;
- 只有首个匹配的按钮或滚轮到来时才进行边角准入。

准入成功后，两条路径都创建同一种活动捕获会话。`BoundaryMatcher` 不再作为第二个完整手势状态机存在；其候选筛选和边角配置读取职责迁移到 `BoundaryIntentCatalog` 或等价的边角适配器。

### 统一会话模型

实现可以使用以下等价的数据结构，字段名可按现有代码风格调整:

```rust
enum GestureSource {
    Ordinary { trigger: TriggerButton },
    Boundary { hit: CornerEdgeHit },
}

enum ReleaseAnchor {
    Button(MouseButton),
    None,
}

struct GestureCaptureSession {
    source: GestureSource,
    origin: Point,
    release_anchor: ReleaseAnchor,
    inputs: Vec<GestureInput>,
    held_buttons: Vec<MouseButton>,
    held_keys: Vec<String>,
    parser: StrokeParser,
    last_input_at: Instant,
    consumed: Vec<ConsumedInput>,
}
```

具体实现不要求立即采用完全相同的 Rust 类型，但必须满足以下不变量:

- 普通手势的触发键是 `release_anchor`。
- 非空边角序列的第一个按钮 token 是 `release_anchor`。
- 后续按钮属于有序输入时，释放后只吞掉，不完成命令。
- 独立修饰符按钮的释放也只结束该物理按钮的消费，不完成基础手势。
- `release_anchor` 释放后才产生普通 `PathEnd` 或边角完成事件。
- 没有按钮可作为锚点时保留现有滚轮序列兜底策略，并在测试中明确记录。

### 输入标准化与有序输入匹配

活动会话只接收统一的 `GestureInput`，不直接依赖持久化层的 `BoundaryToken`。边角适配器提供一个纯函数转换:

```text
BoundaryToken::Button  -> GestureInput::Button
BoundaryToken::Wheel   -> GestureInput::Wheel
BoundaryToken::Stroke  -> GestureInput::Stroke
```

`BoundaryToken` 仍然保留在 v8 配置和同步协议中，第一阶段不修改 `packages/shared`、Server、Web Console 或配置格式版本。转换只属于 Desktop Rust 的运行时边界。

所有按钮、滚轮和键盘附加输入都先作为“附加输入候选”进入统一会话。不能在 `PathTracker` 或区域适配器中直接把它命名为独立修饰符，因为同一个物理事件可能是:

- 某个更长有序手势的下一步;
- 当前基础输入下的独立修饰符;
- 两者都不是的普通有序输入。

统一解析顺序固定为:

1. 用当前基础输入加上新 token 查询有序前缀。
2. 如果存在前缀，追加到基础输入，独立修饰符不得抢占该输入。
3. 如果不存在有序前缀，再查询当前基础输入下的独立修饰符。
4. 独立修饰符命中时立即发送修饰符事件，不追加基础输入，因此相同修饰符可以重复触发。
5. 两者都未命中时，按现有录制和未匹配输入规则追加 token，最终由完成查找决定是否取消。

这保持现有普通手势的修饰符合同，也确保边角序列中的“右键、下移、左键”都按有序步骤处理，而不会因最后一个按钮恰好也是可配置按钮而提前执行。

### 候选配置提供器

统一匹配核心不直接读取 `ConfigDocument` 的具体作用域，使用一个内部候选提供器接口或等价的组合函数:

```text
GestureCatalog
  ordered_prefix(source, inputs) -> bool
  ordered_match(source, inputs) -> Candidate?
  independent_modifier(source, inputs, modifier) -> Candidate?
```

普通手势提供器继续使用 `IntentFinder`:

- 应用意图优先;
- 应用未命中且允许继承时回退全局;
- 全局开关和应用黑名单在普通准入阶段生效;
- 独立 `GestureSpec.modifier` 继续只属于普通手势。

边角提供器按 `CornerEdgeHit`、`BoundaryOrigin`、启用状态和 `order` 筛选 `BoundaryIntent`:

- 空序列作为立即动作或超时回退;
- 非空序列作为统一有序候选;
- 边角动作当前没有独立 `modifier` 字段，因此 `independent_modifier` 返回空;
- 不把普通应用意图混入边角候选，也不把边角候选混入应用级普通手势。

本次重构不为 `BoundaryIntent` 增加独立修饰符字段。若将来需要“边角动作 + 可重复独立修饰符”，必须单独修改 shared 协议、Desktop 编辑器、Web Console、Server 校验和唯一性规则，不在本重构范围内。

### 输入所有权与优先级

`InputRouter` 按以下顺序决定输入所有权:

1. 先更新物理按钮掩码，保证角/边检测知道是否存在正在按住的按钮。
2. 如果已有统一活动捕获会话，所有属于该会话的输入交给会话，不重新进行区域判定。
3. 如果当前是 `ButtonDown` 或 `Wheel`，且没有普通捕获，先调用 `BoundaryAdmission`。
4. 边角位置存在匹配首 token 时，边角会话消费该输入并开始统一会话。
5. 边角没有匹配时，输入回到 `OrdinaryAdmission`，普通触发键按现有规则进入 `Pending`。
6. `Move` 事件只交给已有会话的 `StrokeParser`，或交给角/边检测器处理空序列立即动作；移动本身不能创建非空边角会话。
7. 键盘输入只有已有普通捕获会话时才进入有序输入；边角序列沿用当前允许的 token 类型，不因为路由统一而扩大配置能力。

精确角点的空序列立即动作必须在统一会话之外完成，因为它没有主释放键，也不应显示非空序列轨迹。精确角点与近角序列区域的优先级固定为:

```text
ExactCorner -> NearCorner -> Edge -> Interior
```

### 释放、取消和输入恢复

统一会话必须将“匹配完成”和“命令执行”分开:

- 有序输入达到完整候选时进入 `WaitingForReleaseAnchor`，不立即执行。
- 主释放键 `ButtonUp` 到来时完成候选、结束轨迹并发出命令事件。
- 后续已消费按钮的 `ButtonUp` 被吞掉但不执行命令。
- 无关按钮的 `ButtonUp` 放行，避免破坏前台应用的输入。
- 会话超时或序列不匹配时只恢复已经消费的输入，不能恢复尚未消费的事件。
- 恢复点击时保留原按钮和原位置，并确保合成释放事件不会再次触发当前会话。
- 取消、暂停、录制模式和配置替换必须清理统一会话、轨迹解析器、待吞抬起掩码和已消费输入。

普通手势的 `Pending` 点击透传、起始超时拖拽透传和边角序列的 replay 是不同的准入行为，但都调用统一的消费/恢复工具，避免再次分别维护按钮释放掩码。

### 轨迹与生命周期事件

统一会话只产生一套识别结果和生命周期状态，运行时根据 `GestureSource` 映射到既有外部消息:

- `PathStarted` / `PathGrown` / `PathEnded` 继续服务普通手势;
- `BoundaryPathStarted` / `BoundaryPathGrown` / `BoundaryPathEnded` / `BoundaryPathCancelled` 继续服务边角序列;
- 原生覆盖层仍由 Rust 原生实现，不能把统一会话迁移到 WebView，符合 ADR-0006;
- 识别提示、命令执行和取消使用统一的状态转换，避免普通和边角在完成时机上分叉。

Node 插件生命周期必须遵守已有命令语义:

- 基础有序输入识别后调用识别阶段;
- 独立修饰符每次触发调用修饰符阶段;
- 普通命令在主释放键完成时执行;
- 会话结束或取消调用结束阶段;
- 边角动作如果执行 Node 插件，必须通过同一命令分发路径，不再单独绕过生命周期调度。

## 当前代码边界

统一基础设施已经落在以下模块中:

| 模块 | 当前职责 |
| --- | --- |
| `capture.rs` | 共享 `CaptureLedger`、`OrderedMatcher`、输入标准化、消费记录、主释放键和有序输入优先规则 |
| `tracker.rs` | 普通手势的触发键待定、移动阈值、点击/拖拽透传、路径解析和物理输入报告 |
| `boundary.rs` | 边/角候选筛选、空序列立即/超时回退、边角来源状态，并复用共享捕获基础设施 |
| `runtime.rs` | 输入路由、普通/边角准入、平台服务、覆盖层消息和命令生命周期分发 |
| `corners.rs` | 精确角点、近角和边缘区域检测；不读取普通手势意图 |

普通 `Session` 与边角 `ActiveBoundary` 仍分别保存各自的准入和轨迹状态，这是区域和
覆盖层消息差异所必需的；有序匹配、消费/replay、按钮抬起与主释放键语义不得在两侧另行
实现。`BoundaryMatcher` 只提供边角候选与来源适配，不承担普通手势的应用继承或独立修饰符。

## 当前实施记录

2026-08-07 已完成:

- `engine/capture.rs` 提供 `CaptureLedger`、`ReleaseAnchor`、`ReleaseDisposition`、`OrderedMatcher` 和附加输入仲裁。
- 普通会话使用公共输入账本和公共“有序前缀优先于独立修饰符”判断。
- 边角会话使用公共输入账本、主释放键和有序候选收敛器; `BoundaryToken` 在运行时转换为 `GestureInput`。
- 边角后续按钮抬起只记录为已消费输入,主释放键抬起才完成候选。
- `runtime.rs` 使用显式 `InputRoute` 区分边角会话所有权与回落普通准入,不再用裸布尔值表达路由结果。
- 现有 v8 配置、同步协议、覆盖层消息和平台边界未改变。

## 稳定行为合同

- 普通手势的有序输入优先于同形状的独立修饰符；独立修饰符不进入基础序列，可重复触发。
- 普通和边角命令都在主释放键抬起后完成；边角序列中的后续按钮抬起只被消费，不提前执行。
- 光标移动到边缘不会武装非空边角序列；首个匹配按钮/滚轮到来后才进入边角捕获。
- 精确角点空序列立即执行，近角/边缘非空序列保留轨迹与命令提示，并在取消或超时时只恢复已消费输入。
- Windows/macOS 共用 Rust 捕获与匹配核心；平台差异只存在于钩子、输入合成、屏幕查询和覆盖层窗口。
- `ConfigDocument` 仍为 v8，`BoundaryToken` 仍为同步 JSON 结构；本次重构不改 Shared、Server 或 Web Console 协议。

自动化验证基线和仍待真实平台观察的项目统一记录在
[`docs/PROJECT_STATUS.md`](../PROJECT_STATUS.md) 与 [`docs/qa/M4_MACOS_SMOKE.md`](../qa/M4_MACOS_SMOKE.md)，
不在 ADR 中重复维护逐条测试流水。

## 不在本次重构范围内

- 不修改手势编辑器、助记符 SVG、日志页面或同步协议。
- 不改变普通手势和边角动作的用户配置格式。
- 不给 `BoundaryIntent` 增加独立 `modifier` 字段。
- 不把轨迹和命令提示迁移到 WebView。
- 不删除平台原生输入钩子，也不把平台差异塞进公共匹配器。
- 不恢复旧配置兼容代码或旧脚本运行时。

## 后果

### 正面

- 普通手势和边角序列共享同一套输入顺序、修饰符仲裁和主释放键语义。
- 当前边角最后按钮提前执行的问题不再依赖边角专用补丁。
- 新增鼠标、滚轮或键盘输入类型时只需扩展标准化输入和公共匹配器。
- Windows 与 macOS 的行为更容易保持一致，符合双平台同时交付约束。

### 成本

- 普通点击透传、边角 replay 和两类覆盖层消息仍需要在准入适配层显式映射。
- `BoundaryMatcher` 保留边角来源状态和候选适配，因此新增输入类型时必须同步检查两类适配器。
- Windows/macOS 真实设备验收仍是发布质量门槛，自动化测试不能替代 M4 清单中的物理设备观察。

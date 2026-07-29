# Desktop 实时轨迹、模板访问与工作台界面刷新设计

日期: 2026-07-29

状态:已确认,待实施。本文定义本轮实现边界与验收标准;实施后的实际状态和验证结果
以 `docs/PROJECT_STATUS.md` 为准。

## 背景与目标

本轮解决四个已复现的产品问题,并统一 Desktop 六个页面的界面结构:

1. 按住右键、中键或 X1/X2 移动时,原生手势轨迹明显落后于光标。
2. 手势页的应用列表、手势表格和意图编辑器争用同一高度,表格显示不全。
3. 生产 Tauri 会话无法稳定读取 GitHub Release 模板库,而同一 catalog 经外部下载后
   能通过正式协议解析。
4. 导航“选项”需要改为“设置”并移动到“关于”上方。

同时为应用列表补充本机应用图标,并把已确认的紧凑、安静、面向重复操作的桌面
工作台风格覆盖到手势、触发角与摩擦边、手势模板、账户与同步、设置、关于六页。

完成标准不是局部元素变得更好看,而是实时轨迹跟手、模板下载不再经过 WebView、
页面滚动责任稳定,并且 Windows 与 macOS 同版本具备对应能力。

## 已确认根因

### Windows 轨迹渲染饥饿

引擎把每个采样点作为 `EngineMsg::PathGrown` 发送给覆盖层。Windows 覆盖层线程收到
唤醒后,当前 `drain_commands` 使用 `try_recv` 持续排空无界队列,只在队列完全为空后
调用一次 `render`。鼠标快速连续移动时新 `Grow` 持续到达,覆盖层优先清队列而不是
提交帧,于是轨迹在减速或停止后才追上光标。

问题不在 tracker 的采样精度,也不允许通过降低采样率、增大手势阈值或迁移到
WebView 掩盖。覆盖层必须在连续输入下仍为绘制保留时间。

macOS 覆盖层通过主线程调度命令并逐次渲染,没有 Windows 的“排空后才绘制”结构,
但高频 `Grow` 仍可能给主线程积累过多 render block。两端采用相同的最新点合并原则,
平台实现保留各自线程模型。

### 手势页高度所有权不明确

`GesturesView` 根容器固定为 `height: 100%`,右侧又以纵向 flex 同时容纳无明确高度的
Element Plus 表格、分隔线和 `IntentEditor`。外层 `App` 主区还承担页面滚动。表格
因此生成内部纵向滚动层后继续被下方编辑器压缩,不同内容量和窗口高度下可视区域
不稳定。编辑器只是普通 flex 内容,所以表现为编辑器完整而表格被截断。

### 模板下载受 WebView 网络路径影响

生产 catalog URL 指向 GitHub Release 的 `latest/download` 地址,会跳转到 Release
asset 域名。当前代码在 Tauri WebView 中直接 `fetch`,因此会受 WebView CORS、网络
策略和第三方下载接管影响。2026-07-29 外部取得的 `catalog.json` 为 1579 bytes,
SHA-256 为 `9DE42B7B40BD632392CC2972110D5CF3D784D39202297D3D5327808FABC1C783`,并已通过
项目正式 `parseGestureTemplateCatalog` 校验,包含两个有效模板。数据本身不是故障
来源,下载执行位置才是需要调整的边界。

## 方案选择

采用“局部原生可靠性修复 + 统一工作台壳层”:

- 实时轨迹在现有原生覆盖层内做帧预算和点合并。
- GitHub catalog/package 由受限 Tauri 原生 HTTPS 下载器读取,前端继续负责共享协议
  解析与模板业务。
- 保留 Vue、Element Plus、现有路由方式和明暗主题,统一壳层、页面标题、工具栏、
  滚动容器与紧凑密度。
- 应用图标作为本机派生展示数据通过 IPC 获取,不改变同步配置。

不采用仅修 CSS 与 WebView 重试的方案,因为它不能消除轨迹饥饿和 WebView 网络边界。
也不更换 UI 框架或重写路由,因为这会扩大回归面且不服务本轮目标。

## 原生轨迹设计

### 命令分类与顺序

`OverlayCmd` 分为两类:

- 控制命令:`Begin`、`Recognized`、`End`、`Cancel` 及设置变化。必须按发送顺序处理,
  不得丢弃或越过彼此。
- 增量命令:`Grow(point)`。相邻且尚未绘制的 Grow 可以合并处理,但轨迹几何仍保留
  已采样点;所谓合并是一次批量追加后提交一帧,不是只保存最后一个点或降低引擎
  采样精度。

如果批次中遇到控制命令,先提交它之前的 Grow 批次,再处理控制命令。`End/Cancel`
不得等待后续帧定时器,必须及时结束或隐藏当前覆盖层。新 `Begin` 不得继承上一次轨迹
积压。

### Windows 帧预算

Windows 覆盖层线程保留 Win32 消息泵和原生 layered window。每次 `WM_APP_WAKE`:

1. 处理有限数量或有限时间的队列命令,将连续 Grow 追加到当前轨迹状态。
2. 只要本批状态变脏,立即 `render` 和 `UpdateLayeredWindow`,不等待 channel 为空。
3. 队列仍有数据时重新投递唤醒,让消息泵和绘制都有调度机会。
4. 控制命令可以提前终止本批,保证结束和取消延迟不随 Grow 积压增长。

预算使用可测试常量,默认目标是一帧内完成并在连续输入中保持至少接近显示刷新率
的视觉更新。实现不得在鼠标钩子线程执行绘制,也不得阻塞输入引擎等待覆盖层。

为避免每帧重新栅格化全屏透明位图随轨迹增长而成为下一处瓶颈,本轮先保留现有
tiny-skia 全帧路径并用时间测试确认预算。如果实测单次 present 超过一帧预算,仅在
覆盖层模块内增加脏区域或持久 pixmap 优化,不得改变引擎协议。

### macOS 合并边界

macOS 保留 AppKit 主线程、CALayer 和 tiny-skia。`Overlay::send` 不为每个 Grow 都
无条件排入独立 render block;它通过线程安全的 pending 状态合并尚未执行的连续点,
并保证同一时刻最多有一个 Grow flush 等待主线程。flush 取走当前批次、追加全部点并
render;flush 执行期间到达的新点触发下一次 flush。

控制命令仍单独按序调度。发送控制命令前先封口此前 Grow 批次,以维持与 Windows
相同的 Begin/Grow/Recognized/End 观察顺序。若当前实现的定向压力测试证明主线程
不会积压且逐命令绘制已满足帧延迟,可只增加顺序测试而不做无收益的结构改写;必须在
`docs/PROJECT_STATUS.md` 明确记录该平台结论。

## 原生模板下载设计

### IPC 与职责

新增窄接口 `download_template_text(url, resource_kind)`,其中 `resource_kind` 是封闭的
`catalog | package` 枚举。它只返回 UTF-8 文本或稳定错误,
不理解 catalog/package schema,不采纳模板,也不访问用户配置。前端远程 source 通过
Backend 抽象调用该接口,然后继续使用:

- `parseGestureTemplateCatalog`;
- `parseGestureTemplatePackage`;
- `verifyGestureTemplatePackage`;
- 现有 target、identity、risk 与采纳冲突检查。

浏览器 preview/mock 继续读取确定性 fixture,不尝试绕过 Tauri IPC。生产模板仍直接
来自 GitHub,自建 Server 不代理内容,符合 ADR-0008。

### 网络与安全边界

Rust 端使用 `reqwest` 的 rustls TLS 后端,关闭自动重定向并逐跳检查。请求必须满足:

- 只允许 `https` URL,拒绝用户名、密码、fragment 和非默认危险结构;
- 最多跟随 5 次重定向,每个 `Location` 解析后重新执行完整 URL 检查;
- catalog/package 共用 15 秒总超时,不是每次重定向重新获得 15 秒;
- Rust 命令端根据 `resource_kind` 选择 catalog/package 固定上限,前端不能传入任意
  字节数;
- 先检查 `Content-Length`,读取流时继续累计字节,超限立即中止;
- 只接受 2xx 最终响应和有效 UTF-8;响应体不落入 Downloads、不调用系统打开器;
- 日志记录错误码、HTTP 状态和安全裁剪后的 host/path,不记录 URL credentials 或正文。

错误统一映射到现有前端可本地化的类别:`template_url_invalid`、
`template_network`、`template_timeout`、`template_http`、
`template_redirect_insecure`、`catalog_too_large`、`package_too_large` 和协议解析错误。
无法识别的原生错误映射为 `template_network`,同时保留内部日志原因。

原生客户端可在应用进程内复用连接池。catalog 的 force refresh 仍由 store 控制;
本轮不新增磁盘缓存、后台定时刷新或服务端代理。

## 工作台壳层设计

### 导航与全局结构

Desktop 保留单窗口和当前组件切换方式。导航固定为:

1. 手势
2. 触发角与摩擦边
3. 手势模板
4. 账户与同步
5. 设置
6. 关于

中文 `选项` 改为 `设置`,英文 `Options` 改为 `Settings`,全部通过 vue-i18n。设置位于
关于正上方。为避免额外启动行为变化,默认页继续是设置。

壳层采用窄侧栏、紧凑顶栏/底栏和单一主工作区。页面 section 本身不包装成悬浮卡片,
不嵌套 card。边框、背景、文本、强调色与圆角通过现有 CSS 变量集中定义;兼容现有
明暗主题,避免一套界面被单一蓝紫色或大面积装饰色主导。

页面标题使用紧凑桌面字号,不使用 hero 级字体。图标按钮使用 Element Plus 已有
图标并提供 tooltip/aria-label;二元设置继续使用 checkbox/switch,模式使用 segmented
control/radio group,数值使用 input/slider,不以带文本的圆角块代替熟悉控件。

### 滚动所有权

`App` 主工作区提供可用高度,但具体工作台页面自行声明唯一滚动区域。通用规则:

- 页面根必须有 `min-width: 0`、`min-height: 0`。
- 固定标题和工具栏不参与内容滚动。
- 长内容页只允许一个主纵向滚动容器。
- 固定分区工作台的每个分区可以拥有一个明确内部滚动容器,外层不得同时滚动。
- 表格、列表、编辑器使用 grid `minmax(0, 1fr)` 或明确 flex 约束,不能依赖内容撑高。
- `800x560` 下所有命令仍可通过滚动到达,不出现页面横向滚动或控件重叠。

### 手势页固定双区工作台

采用已确认的方案 B:

- 左列是应用作用域列表,宽度使用稳定的响应式约束,列表内部滚动。
- 右列是上下双区:上部手势表格,下部意图编辑器。
- 右列使用 grid 的两个 `minmax` track;常规窗口优先让表格获得更多高度,编辑器保留
  完成编辑所需的最小高度。
- 表格由外层 panel 提供确定高度,Element Plus table 使用 `height="100%"` 或等价
  flex 约束,只有 table body 滚动;表头、工具栏和编辑器操作区保持可见。
- 选中行切换只更新编辑器内容,不得改变双区几何。空状态、加载状态和最长双语文案
  也不得导致布局跳动。

在窄宽度但仍满足最小窗口时保持三分区,通过收紧列宽和工具栏换行适配,不把编辑器
移入模态框。若英文按钮无法容纳,工具栏允许按命令组换行,但固定高度元素不得因
hover、loading 或图标出现而位移。

### 六页统一原则

- 手势:固定应用列表 + 表格 + 编辑器工作台。
- 触发角与摩擦边:预览/选择区与命令编辑区明确分栏,各自保持稳定尺寸。
- 手势模板:筛选工具栏固定,模板列表承担主滚动;错误状态保留重试和仓库入口,详情
  drawer 在最小窗口内可完整滚动。
- 账户与同步:状态、认证、同步操作和历史记录按全宽 section 组织;表格或历史区承担
  自身滚动,不使用卡片套卡片。
- 设置:相近设置按无嵌套 section 分组,标签列对齐,长说明换行且不压缩控件。
- 关于:产品标识、版本、更新状态和链接保持紧凑,更新状态有稳定区域,异步结果不推动
  主要命令跳动。

本轮统一视觉和布局,不新增页面功能、不更改同步语义、不重写已有表单业务。

## 应用图标设计

新增复用组件 `AppIcon`,输入是展示名称和可选平台标识:

- Windows:`exeName`;
- macOS:`bundleId`;
- 全局作用域:`global`。

Windows 复用现有 `platform/windows/icon.rs` 提取 exe/Shell 图标。macOS 通过 Bundle ID
使用 `NSWorkspace` 定位应用,取得 `NSImage` 后转换为小尺寸 PNG。原生 IPC 返回
base64 PNG 或 `null`,不抛出阻断列表渲染的错误。

前端按规范化平台标识建立进程内 Promise/result cache,同一应用只发起一次请求;
失败结果也在当前会话缓存,避免滚动列表时重复 IPC。列表先渲染固定尺寸占位,异步图标
到达后只替换图像,不改变行高、名称位置或列表宽度。

全局作用域直接使用随 Desktop 打包的 GodGesture 图标,不调用进程查询。解析失败使用
仓库内问号 SVG 占位:圆角方形中包含清晰问号路径,支持明暗主题和 16/20/24 px,
具有可本地化的 aria-label/tooltip。SVG 不使用 emoji 或字体字符,避免平台字体差异。

图标、base64、缓存状态均不写入 `ConfigDocument`,不进入快照、同步或模板协议。
已有 `app_icon(exeName)` IPC 可演进为平台中立请求结构;因为它不是 shared 配置协议,
不提升 `CONFIG_FORMAT_VERSION`,但必须同步更新 Tauri backend、mock 和所有前端消费方。

## 状态与错误体验

- 轨迹覆盖层发送或绘制失败继续记录结构化日志,输入引擎不能因此阻塞或遗留触发键。
- 模板 catalog 失败显示本地化原因、重试和仓库入口;本地手势保持可用。第三方下载器
  不再参与应用内请求。
- 应用图标失败是可降级展示问题,只显示问号占位,不弹 toast。
- 页面异步 loading 使用稳定尺寸 skeleton/spinner,不能改变工具栏或工作区尺寸。
- 所有新增用户可见文本必须同时加入 `zh-CN` 和 `en`,测试禁止翻译 key 泄漏。

## 测试与验收

### 自动验证

- Windows overlay:连续 Grow 下会在队列未空时出帧、每批预算受限、控制命令有序、
  End/Cancel 不被积压、下一次 Begin 不继承旧点。
- macOS overlay:pending flush 至多一个、连续点不丢失、控制命令与 Grow 批次顺序正确;
  在可用 macOS runner 上编译并运行平台定向测试。
- 模板下载:HTTPS-only、credentials/fragment 拒绝、相对与绝对重定向、非 HTTPS
  重定向、重定向上限、总超时、Content-Length 超限、流式超限、非 2xx、UTF-8 和
  稳定错误码。
- 模板 source:catalog/package 仍通过 shared parser 和 identity/target/risk 校验;
  browser fixture 路径保持通过。
- AppIcon:全局图标、Windows/macOS 请求、缓存命中、null/错误回退、固定尺寸和无配置
  写入。
- UI:i18n 键完整性、导航顺序和默认设置页、手势选择不改变布局、各页面关键空/错误/
  loading 状态。
- 对受影响范围运行 Desktop test/typecheck/build、shared 模板协议测试与 build、Rust
  定向测试和 clippy。无需因本轮窄协议边界机械运行 Server 全套测试。

### 真实运行与视觉验收

Windows:

1. 在 60 Hz 及可用的高刷新率显示器上分别用右键、中键、X1/X2 快速绘制长轨迹。
   光标持续移动时轨迹持续更新,不得出现肉眼可感的停顿后追赶。
2. 快速结束、取消和连续开始手势,确认覆盖层无残留、串线或延迟隐藏。
3. 在真实 Tauri 模板页刷新 catalog,确认 GitHub 重定向在应用内完成,不会打开下载器,
   并能打开、校验两个 package。
4. 应用列表验收 Explorer、Chrome、GodGesture 全局图标及一个无法解析目标的问号回退。

macOS:

1. 对右键、中键和可用扩展键执行同等轨迹跟手验收;硬件不提供 X1/X2 时明确记录
   能力缺口,不能伪造通过。
2. 验证 GitHub catalog/package 原生下载、Bundle ID 应用图标和问号回退。

视觉矩阵:

- 尺寸:`980x700` 与最小 `800x560`;
- 主题:浅色、深色;
- 语言:zh-CN、en;
- 页面:全部六页,并覆盖手势页有/无选中项、模板加载/错误/列表/详情、账户主要状态。

使用真实浏览器 preview 做确定性 DOM 与截图检查,再用真实 Tauri 窗口确认原生 IPC
状态。验收必须确认无横向溢出、文本截断、元素重叠、不可达操作、嵌套页面卡片和
滚动争用。preview 不能代替轨迹、模板网络和原生图标实机验证。

## 文档与交付边界

实施时同步更新 `docs/PROJECT_STATUS.md` 的 Desktop Rust、Desktop Vue、已知边界、
运行时 QA 和实际验证基线。若实现需要改变以下任一边界,必须先停止并向维护者说明,
再决定是否修订 ADR:

- 轨迹或命令提示迁入 WebView;
- 模板由自建 Server 代理或落入用户同步配置;
- Windows/macOS 不再同版本交付该能力;
- 引入 `uiAccess`、长连接或新的配置同步语义。

本设计不修改 `docs/ROADMAP.md`,不读取或依赖 WGestures 实现,不改变 stable `v0.1.0`
历史里程碑。

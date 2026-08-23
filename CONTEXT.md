# GodGesture

独立演进的跨平台(Windows + macOS)全局鼠标手势工具,由 Tauri 桌面端与
Node.js + PostgreSQL 后端组成,支持可选账户与多设备云同步。产品行为由维护者提出的
GodGesture 需求和现行架构决策定义,不从其他产品推导。

## 语言

### 手势领域

**手势 (Gesture)**:
由触发键、有序输入步骤和可选独立修饰符构成的一次鼠标输入。输入步骤保留用户
实际发生的顺序，可以是方向笔画、鼠标按钮按下或滚轮方向；触发键不重复计入步骤。
触发键、完整输入序列与独立修饰符共同决定唯一性。
_避免_: 鼠标动作、轨迹(轨迹指画出的可见线条)

**触发键 (Trigger Button)**:
按住即进入手势状态的鼠标键:右键、中键、X1、X2;Windows 键手势视为右键的等价触发。
_避免_: 手势键(UI 文案可用,文档统一用"触发键")

**笔画 (Stroke)**:
手势中的一段方向位移,取 8 方向(↑↗→↘↓↙←↖);斜向仅允许出现在首笔(条件性次笔),后续笔画均为 4 方向。

**输入步骤 (Gesture Input)**:
普通手势录制时按发生顺序保存的单步输入，分为方向笔画、鼠标按钮按下、滚轮前/后和
键盘按下(`KeyboardEvent.code`,如 `KeyQ`、`F4`、`Enter`)。因而可以自然表达“右键按住
→ Q → 向右移动”或“右键按住 → 左键按下 → 向右移动”等组合。最多保存 12 步；键盘抬起
用于结束物理按键捕获但不重复计入步骤，独立修饰符不计入输入步骤。

**修饰符 (Gesture Modifier)**:
独立于有序输入步骤的可选重复触发条件，可选无、滚轮前/后、左/中/右键、X1、X2。
基础输入匹配后，每次修饰符触发都立即执行命令并继续监听，直到触发键释放；与触发键
相同的鼠标键不能作为修饰符。

**手势意图 (Intent)**:
"手势 → 命令"的一条映射,含用户可编辑的名称、单条启停状态和可选独立修饰符。
_避免_: 手势绑定、快捷方式

**动作 (Action)**:
手势工作台中可配置的一条映射,包括手势意图和边角动作两类。动作描述“如何触发以及触发后执行什么”,不等同于最终执行的命令。

**命令 (Command)**:
动作被触发后执行的功能单元,共 12 类(什么也不做、执行快捷键、Web 搜索、窗口控制、任务切换、打开文件、按键/文字序列、打开网址、命令行(cmd)、命令行(PowerShell)、Node.js 插件、音量控制)。
_避免_: 操作;不要把命令本身称为动作

**按键/文字序列 DSL (Send Text DSL)**:
`sendText` 命令使用一行一条的 `text`、`key`、`hotkey`、`sleep` 语句,按书写顺序执行。
配置只接受该 DSL;旧 SendKeys 字符串和旧结构化步骤不属于现行配置格式。

**应用 (App)**:
配置分组单位,决定一套手势意图对哪个前台程序生效;含"继承全局手势"开关与黑名单开关。
_避免_: 程序、进程

**应用分组 (App Group)**:
手势页中应用条目的用户可管理分组,属于同步配置的一部分。每个配置默认拥有名为“默认”的分组;
全局应用固定置顶且不属于任何分组。应用分组可重命名、排序和删除,删除自定义分组时其中应用迁移到默认分组。

**全局应用 (Global App)**:
兜底的应用条目,未被匹配的程序统一落在此处;其黑名单开关是总开关。

**应用绑定 (App Binding)**:
应用条目与平台上具体程序的关联凭据,设计为机器无关、可跨设备漫游:Windows 以 exe 文件名为主键(辅以 AUMID 识别商店应用、可选精确路径区分同名程序;路径仅作本机图标提示,不参与匹配),macOS 以 Bundle ID 为准。一个应用条目可同时持有两个平台的绑定,缺绑定的平台上该条目休眠。

**触发角 (Hot Corner)**:
边角动作的四种角起点,空序列立即动作只在显示器精确角点命中;按显示器独立计算。

**摩擦边 (Rub Edge)**:
边角动作的四种边起点。空边角序列保持在屏幕边缘快速往复摩擦鼠标后命中;
带边角序列时,只有在非角落边缘带按下首个鼠标键或滚轮后才开始匹配,移动进入边缘带本身不武装序列。

**边角动作 (Boundary Action / Boundary Intent)**:
仅属于全局应用的“触发角或摩擦边 + 可选边角序列 → 命令”映射,含用户可编辑的名称和单条启停状态。

**边角序列 (Boundary Sequence)**:
边角起点后的零至 12 步有序输入。边缘带或精确角点周围的近角区域收到首个鼠标键/滚轮后即进入边角捕获；首 token 有候选时继续匹配，未匹配时仍记录边角轨迹但不执行命令。未形成方向笔画时取消会重放已消费的原生输入；形成方向笔画后释放主触发键只结束捕获，不重放原生点击。方向笔画可作为后续步骤。空序列表示命中起点后立即执行。

**边角显示引导 (Boundary Display Guide)**:
同步偏好 `preferences.gestureView.showBoundaryGuide` 控制的原生覆盖层视觉提示。引擎按当前显示器实际启用的四角和四边触发区域生成距离渐显帧，不读取 `boundaryIntents`；`hotCorners.enabled` 和 `rubEdges.enabled` 分别控制四角与四边是否可见。引导只用于显示区域，不推进边角状态机，不改变输入吞噬、命令匹配、点击重放、焦点或鼠标命中测试语义。Windows 与 macOS 复用同一帧数据和视觉语义，平台差异仅在原生覆盖层实现。

**统一手势捕获会话 (Gesture Capture)**:
Desktop engine 内普通手势与边角手势共用的活动输入对象,由 `engine::capture::GestureCapture` 提供。
它统一持有方向 parser、有序输入账本、主释放锚点、已消费输入和按钮释放状态；普通手势与边角手势
只在区域准入、候选配置和覆盖层消息上保持差异。边或近角命中后由边角优先拥有输入,不会因为首 token
没有候选而落入 `PathTracker`。

**点击重放 (Click Replay)**:
Windows 边角序列取消或未匹配且尚未形成方向笔画时,为恢复已消费的原始鼠标点击而执行的带位置点击注入。
形成方向笔画后的边角捕获沿普通 `PathTracker` 的结束语义吞掉主触发键释放,不执行点击重放。重放按入队
顺序处理;点击注入在独立重放工作线程执行,不阻塞低级鼠标钩子的消息泵。该术语不表示手势命令
本身,也不改变 macOS 的原生输入实现。

**轨迹 (Trail)**:
手势过程中屏幕上绘制的可见路径线条,按触发键区分颜色,未识别时显示告警色。

**命令提示 (Hint Label)**:
手势过程中实时显示的命令名称大字标签,识别/待执行状态用不同底色。

**暂停 (Pause)**:
临时停用全部手势识别的全局状态,可经设置窗口顶栏、托盘、全局快捷键或左键+中键和弦
四种途径切换。

**原生快捷键捕获 (Native Hotkey Capture)**:
Windows 快捷键录制期间由常驻低级键盘钩子优先接收按键,将物理键码转发到设置页录制器并
尝试阻断系统快捷键;Windows 保留组合仍可能由系统优先处理。录制结束、取消或失焦时立即
停用。macOS 与浏览器预览继续使用平台原生 WebView 键盘事件路径。

**Windows 手势键盘捕获 (Windows Gesture Keyboard Capture)**:
普通手势录制和识别期间优先使用 `WH_KEYBOARD_LL` 接收键盘事件,Windows Raw Input 通过隐藏
message-only 窗口和 `RIDEV_INPUTSINK` 作为兜底;不使用 `RIDEV_NOLEGACY`。两路输入按虚拟键码、
按下/释放状态和 100 ms 窗口去重,避免同一物理事件重复进入 tracker,也避免跨次录制残留状态。
键盘按下按 `KeyboardEvent.code` 进入有序输入步骤,抬起只用于结束物理捕获和吞掉对应事件。该
路径已在 Windows 实机验证;macOS 继续使用 `CGEventTap`,真实设备验收仍按平台清单进行。

**Node 插件 (Node Plugin)**:
插件工作区中的 JavaScript/TypeScript 项目,使用 ESM、npm 依赖和随应用分发的 Node.js
LTS;`package.json` 的 `godgesture` 字段同时充当插件 manifest。插件由一个或多个手势
动作调用,源码、manifest、锁文件和依赖均是本机文件,不参与 GodGesture 云同步。
现役生命周期及 `PluginContext.phase` 统一为 `onInit`、`onExecute`、
`onGestureRecognized`、`onModifierTriggered`、`onEnd`,不提供旧名称兼容。

**插件工作区 (Plugin Workspace)**:
GodGesture 在系统应用配置目录下管理的唯一插件根目录 `plugins/`;每个直接子目录是一个
插件项目。应用不允许注册任意外部目录,也不把插件放入程序安装目录。Windows 现役路径为
`%APPDATA%\com.godgesture.app\plugins`,macOS 为
`~/Library/Application Support/com.godgesture.desktop/plugins`。

**在线插件目录 (Online Plugin Catalog)**:
由 `Mr-BeanSir/GodGesture-Plugins` 仓库根目录 `catalog.min.json` 提供的公开 JSON 目录,每个条目
包含稳定 `pluginId`、单一字符串标题/摘要和指向 `plugins/<subdirectory>/` 的子目录。仓库和 ref
固定为 `Mr-BeanSir/GodGesture-Plugins` 的 `main`；Desktop 只接受符合协议、已启用且大小受限的
目录,不把目录内容写入用户配置。仓库通过审核和 PR 校验 manifest,合并到 `main` 后自动生成
格式化 `catalog.json` 与压缩版 `catalog.min.json`。

**在线插件源 (Online Plugin Source)**:
由官方插件目录按 `pluginId` 解析出的固定仓库、`main` ref 与 `subdirectory`。用户明确确认后,App 在
临时目录取得该项目,验证 `package.json.godgesture.id` 与 `pluginId` 一致,运行受限的 `npm install`
准备生产依赖,再原子激活到本机插件工作区。任何下载、校验或安装失败都不得覆盖现有项目。

**在线目录缓存 (Online Catalog Cache)**:
官方公共模板目录分页结果和官方插件仓库根目录 `catalog.min.json` 的本机有效快照,分别保存到
Tauri `app_config_dir/catalogs` 下的独立文件。模板始终从构建时配置的官方 Server origin 读取；
运行时账户页的自定义同步端点不影响模板目录；插件从 GitHub 读取。刷新后只有通过 shared
协议校验的结果才能原子替换缓存;网络失败时只使用上一份有效快照,不会用损坏内容覆盖缓存。
浏览器预览使用源码 fixture,不访问或写入该缓存。

**Node 插件动作 (Node Plugin Action)**:
Node 插件通过 `package.json` 的 `godgesture.lifecycles` 声明实际提供的固定生命周期导出。
手势命令只保存 `pluginId`;插件文件缺失时命令保留引用但在本机不可执行。当前配置引用的
插件启动时调用 `onInit`,手势识别、修饰符触发、命令执行和生命周期结束分别自动调用对应
的 `onGestureRecognized`、`onModifierTriggered`、`onExecute` 和 `onEnd`。

**Node 插件宿主 (Node Plugin Host)**:
常驻的 Node.js sidecar 与插件 Worker 组成的运行时,通过本地 IPC 调用原生输入、窗口、
剪贴板和状态 API;不在手势触发时启动进程、加载模块或安装依赖。

### 同步领域

**手势模板 (Gesture Template)**:
由官方公共模板目录发布的可采纳手势配置包;用户下载采纳后并入个人配置,自此视同用户自己的
数据参与同步。模板使用 Server UUID 身份，标题可以重复，包含单一字符串标题/摘要、标签和
`targets` 数组；一个 JSON 可以同时包含全局手势和多个应用目标，每个应用目标保留跨平台绑定与
该应用的手势意图。公开作者由用户当前 `displayName`（为空时用已验证 email）实时解析，不进入
模板包或版本快照。模板只引用官方在线插件目录中已启用的 `pluginId`，不能声明任意仓库、ref 或
子目录。采纳前先取得用户确认并安装所有被引用插件,安装成功后才写入配置;同步文档仍只保存
`pluginId`。
_避免_: 默认手势、预设(预设指出厂内置的初始配置)

**官方公共模板目录 (Official Public Template Catalog)**:
由构建时配置的官方 Server origin 提供的匿名可读、服务端分页的模板目录。支持搜索和按最新、
下载次数、热度排序；运行时自定义同步端点不提供该目录。

**模板投稿 (Template Submission)**:
仅官方端点登录用户把本地导出模板提交为待审核不可变版本的操作。它不属于配置同步，用户不手填
作者；禁用账户不能投稿。同一模板族的更新会创建新的不可变版本；被驳回或已撤回的模板可以再次投稿，
不会改写既有版本。

**模板审核 (Template Review)**:
管理员对待审核版本作出的通过或拒绝决定，并保留最小审核记录。管理员可以管理举报、下架、恢复
和配额，不能修改模板内容。

**模板版本 (Template Version)**:
同一模板下的不可变内容和元数据版本。任何修改都创建并审核新版本；更新版本可以修改标题、标签和摘要，
但不会改写旧版本。已发布版本可撤回或由管理员下架。

**模板父状态投影 (Template Parent Status Projection)**:
同一模板全部版本状态的持久化摘要，配合父模板的 `publicationSuspendedAt` 共同决定公开可见性。公共目录、
详情和默认下载每个 `templateId` 只展示最高版本号的已发布版本；新版本审核期间保留旧版本，通过后自动切换。
父状态按 `published > pending_review > suspended > rejected > withdrawn` 聚合，但暂停父模板会隐藏整个模板族，
不改变版本状态、不回退旧版本；恢复后重新投影并展示最高已发布版本。任何版本状态变化或暂停/恢复必须在
锁定父模板行的同一事务内完成，发布配额按至少存在一个已发布版本的父模板计数。

**模板撤回 (Template Withdrawal)**:
作者使自己的已发布模板不再出现在公共目录中的操作，不删除历史版本或对象。

**模板作者管理 (Owned Template Management)**:
登录用户在 Web Console 的“我提交的模板”中查看自己提交的模板族和最多 50 个最新版本。只有包含已发布
版本的模板族可以撤回；只有所有版本均为 `rejected` 或 `withdrawn` 的模板族可以删除。撤回保留模板族以便
重新投稿，删除则移除模板族、版本关联记录和 RustFS 对象。

**模板下架 (Template Suspension)**:
管理员因治理原因暂停整个模板父 ID 的公共发布操作；不改写或回退任何版本，也不把某个版本改成下架状态。
暂停期间公共目录、详情、下载和举报均不可用；恢复后公开该族最高已发布版本。

**模板发布治理记录 (Template Publication Governance Event)**:
管理员暂停或恢复模板父 ID 的操作审计记录，保存于 `AdminAuditLog`，包含操作人、时间、原因和操作时版本。
它独立于版本级的 `TemplateReview` 审核记录，并在 Web Console 模板审核详情的“发布治理记录”中展示。

**模板下载次数 (Template Download Count)**:
模板版本的匿名聚合采纳/下载指标。服务端使用每日轮换 HMAC 与短期去重记录减少重复计数，
不保存用户或设备下载历史。

**Web 控制台 (Web Console)**:
浏览器中登录账户后使用的管理界面:只读查看手势库与设置、管理设备、查看与回滚配置快照、账户安全操作，
并可在“我提交的模板”中查看版本、撤回或删除自己的模板；管理员还可审核公共模板、处理举报并调整全局或
用户级配额；不提供配置编辑或账户注销。
_避免_: 官网、管理后台

**共享 UI 原语包 (Shared UI Package)**:
根 pnpm workspace 的 `@godgesture/ui` (`packages/ui/`)，为 Desktop 与 Server-owned Web Console
提供无业务 Vue 原语、`--gg-*` 设计 token、焦点安全的对话框、确认 Promise 和 Toast。它不读取
router、store、API client 或 i18n；`packages/shared` 继续只保存协议和领域类型而不依赖 Vue，两个
应用各自保留文案和应用特有布局。

**Desktop 固定设置外壳 (Fixed Desktop Settings Shell)**:
Desktop 的原生设置窗口沿用 48px 顶栏、168px 常驻左栏和 30px 底栏；不使用 viewport
断点、导航切换按钮或抽屉。Desktop 常规按钮和表单控件固定为 32px，工作面内容在窗口
内部滚动；多尺寸响应式导航和窄视口触控密度只属于 Server-owned Web Console。

**设备 (Device)**:
登录了同一账户的一个客户端安装实例,持有独立的可撤销登录凭证,可在 Web 控制台改名或踢下线。
_避免_: 客户端(客户端指软件本身)

**设备安装标识 (Device Installation Key)**:
客户端为一个安装实例持久化的 UUID,仅与账户 ID 组合用于认证时复用同一设备记录。Web Console
保存在浏览器 `localStorage` 的 `godgesture.deviceKey`, Desktop 保存在应用配置目录的
`device-key.json`;退出登录不会清除。该标识不采集硬盘、主板或内存序列号,也不参与配置同步或设备列表展示。

**配置快照 (Snapshot)**:
服务端在每次成功推送时保留的整库配置历史版本,可查看与回滚。

**快照备注 (Snapshot Note)**:
随配置快照保存的来源说明;普通同步记录推送基准版本,回滚生成的新版本记录来源快照和回滚前云端版本。
_避免_: 备份(备份指用户手动导出的本地文件)

**同步 (Sync)**:
客户端与后端之间对用户配置整体文档的推拉:本地改动防抖后自动推送,启动与定时拉取,另有手动"立即同步"按钮兜底。
_避免_: 上传/下载(单向动作,不构成同步)

**本机专属设置 (Machine-local Settings)**:
不随账户漫游的设置项:开机自启、以管理员身份运行、托盘图标隐藏;其余设置全部参与同步。

**同步端点 (Sync Endpoint)**:
桌面端账户登录、OAuth、配置同步、设备和快照请求使用的服务端 origin。默认使用构建时
注入的 `GODGESTURE_API`,用户也可在账户页选择自定义 http(s) origin;凭据按端点隔离保存。

**邮箱验证码 (Email Verification Code)**:
由 Server 通过 SMTP 或开发日志适配器发送的一次性六位代码,按注册或找回密码用途隔离,
只保存哈希,具备过期、冷却、尝试次数和单次消费约束。

**管理员端 (Administrator Console)**:
Web 控制台中仅管理员可访问的账户元数据与会话管理区域。管理员端不读取用户配置正文、
密码哈希或令牌;账户启停、角色调整和会话撤销均写入最小审计日志。

**桌面本地日志 (Desktop Local Log)**:
只保存在 Desktop `app_log_dir()` 下的 JSONL 运行记录,覆盖 Rust/Tauri、Vue/WebView 和 Node
插件宿主;默认采集级别为 `off`,可选 `error`、`warn`、`info`、`debug`,不上传 Server、不参与
同步。日志必须脱敏,不得包含密码、验证码、access/refresh token、剪贴板正文或插件源码。

**日志采集级别 (Log Collection Level)**:
本地日志的阈值设置。`error` 只记录错误,`warn` 包含错误和警告,`info` 再包含信息,
`debug` 为一期最细粒度;不提供 `trace`。`off` 表示不落盘普通日志。

**日志记录 (Log Entry)**:
统一字段为 `timestamp`、`level`、`target`、`message`;`target` 是稳定来源名,例如 `config`,
`cloud`, `node.supervisor`。日志页支持按级别、来源和关键词查看、实时刷新、导出和清理;
记录按最新优先显示,error/warn 的多行 trace 默认折叠;右侧“自动跟随”可关闭,关闭后新日志不
自动滚动到顶部,并随应用浅色/深色主题切换日志表面。

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
边角起点后的零至 12 步有序输入。非空序列在边缘带或精确角点周围的近角区域收到首个匹配的鼠标键/滚轮后进入;方向笔画可作为后续步骤。空序列表示命中起点后立即执行。

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
包含插件稳定 `pluginId`、作者、HTTPS GitHub 仓库 URL、Git ref 和指向 `plugins/<slug>/` 的可移植子目录。Desktop
只接受符合协议和大小限制的目录,不把目录内容写入用户配置。仓库通过 PR 校验 JSON 和插件
manifest,合并到 `main` 后自动生成格式化 `catalog.json` 与压缩版 `catalog.min.json`。

**在线插件源 (Online Plugin Source)**:
在线插件目录或手势模板包中声明的一组下载信息。用户明确确认后,App 在临时目录取得指定
仓库和 ref,验证 `package.json.godgesture.id` 与 `pluginId` 一致,运行受限的 `npm install`
准备生产依赖,再原子激活到本机插件工作区。任何下载、校验或安装失败都不得覆盖现有项目。

**在线目录缓存 (Online Catalog Cache)**:
模板仓库和插件仓库根目录 `catalog.min.json` 的本机快照,分别保存到 Tauri `app_config_dir/catalogs`
下的独立文件。Desktop 启动或用户手动刷新时先从 GitHub 取得并通过 shared 协议校验,校验成功后
原子替换缓存;网络失败时只使用上一份有效快照,不会用损坏内容覆盖缓存。浏览器预览使用源码 fixture,
不访问或写入该缓存。

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
托管在专门 GitHub 仓库中的预置手势配置包;用户下载采纳后并入个人配置,自此视同用户自己的数据参与同步。
模板目录从 `Mr-BeanSir/GodGesture-Templates` 根目录的 `catalog.min.json` 读取;每个模板包必须声明
`author` 以及目录生成所需的本地化标题、摘要和标签。仓库通过 PR 校验模板 JSON,合并到 `main` 后
自动生成 `catalog.json` 与 `catalog.min.json`。模板包使用 `targets` 数组,一个 JSON 可以同时包含
全局手势和多个应用目标;每个应用目标保留跨平台绑定与该应用的手势意图。
模板包可以通过 `plugins` 字段声明在线插件源,其 `nodePlugin` 命令必须引用同一 `pluginId`。
每个声明的插件源也必须至少被一个 `nodePlugin` 命令引用,不能借模板安装无关项目。
采纳前先取得用户确认并安装所有被引用插件,安装成功后才写入配置;同步文档仍只保存 `pluginId`。
_避免_: 默认手势、预设(预设指出厂内置的初始配置)

**Web 控制台 (Web Console)**:
浏览器中登录账户后使用的管理界面:只读查看手势库与设置、管理设备、查看与回滚配置快照、账户安全操作;不提供配置编辑。
_避免_: 官网、管理后台

**设备 (Device)**:
登录了同一账户的一个客户端安装实例,持有独立的可撤销登录凭证,可在 Web 控制台改名或踢下线。
_避免_: 客户端(客户端指软件本身)

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

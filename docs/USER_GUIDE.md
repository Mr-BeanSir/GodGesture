# GodGesture 用户指南

GodGesture 是本地优先的全局鼠标手势工具。未登录和断网时，手势、设置、脚本、
触发角与摩擦边仍可使用；账户和同步是可选增强能力。

## 安装

### Windows

1. 从 [GitHub Releases](https://github.com/Mr-BeanSir/GodGesture/releases)
   下载 `GodGesture_<版本>_x64-setup.exe` 和同名 `.sha256`。
2. 在 PowerShell 中校验：

   ```powershell
   $expected = (Get-Content .\GodGesture_<版本>_x64-setup.exe.sha256).Split()[0]
   $actual = (Get-FileHash .\GodGesture_<版本>_x64-setup.exe -Algorithm SHA256).Hash.ToLowerInvariant()
   $actual -eq $expected
   ```

3. 运行安装程序。GodGesture 未做 Authenticode 签名，SmartScreen 可能显示未知
   发布者提示；请只使用本仓库 Release，并先核对 SHA-256。
4. 若系统缺少 WebView2，先安装 Microsoft WebView2 Runtime。

### macOS

GodGesture 支持 macOS 13+，DMG 同时包含 Apple Silicon 和 Intel 架构。

1. 下载 `GodGesture_<版本>_universal.dmg` 和同名 `.sha256`，运行：

   ```bash
   shasum -a 256 -c GodGesture_<版本>_universal.dmg.sha256
   ```

2. 挂载 DMG，把 GodGesture 拖到 `/Applications`。
3. 若首次启动被阻止，在 Finder 中按住 Control 点击 GodGesture，选择“打开”；
   或前往“系统设置 > 隐私与安全性”选择“仍要打开”。
4. 启动后按快速入门或“选项”页提示授予辅助功能、输入监控和输入模拟权限。

该 DMG 仅有 ad-hoc 签名，未经 Apple 公证。Gatekeeper 手动放行、管理员密码和
TCC 权限是三件不同的事；不要使用 `sudo` 启动 GUI，也不要移除 quarantine 或
关闭 Gatekeeper。完整边界见 [macOS 分发说明](MACOS_RELEASE.md)。

## 第一个手势

首次打开会显示“快速入门”；之后可从“关于 > 快速入门”重新打开。

1. 确认手势引擎已就绪。macOS 先完成权限授权。
2. 按住右键并移动鼠标画出方向。
3. 释放右键执行命令；移动不足时仍作为普通右键点击处理。

出厂全局手势包括：

| 手势 | 命令 |
| --- | --- |
| 右键 + `↓→` | 关闭窗口 |
| 右键 + `↑` | 最大化 / 还原 |
| 右键 + `↓` | 最小化 |
| 右键 + `←` | 后退 |
| 右键 + `→` | 前进 |
| 右键 + `↘` | 复制 |
| 右键 + `↗` | 粘贴 |
| 右键 + `↓↑` | 任务切换 |
| 右键 + `↑↓` | 刷新 |

命令实际作用窗口由当前前台应用和“总是作用于指针下方的窗口”设置共同决定。

## 配置手势

### 全局与应用

“手势”页左侧的全局应用是兜底配置。可以为具体应用添加独立条目，并选择是否
继承全局手势或加入黑名单。

- Windows 主要按 exe 文件名匹配；商店应用可使用 AUMID，需要区分同名程序时
  才启用精确路径。
- macOS 按 Bundle ID 匹配。
- 一个应用可同时保存 Windows 与 macOS 绑定；缺少当前平台绑定时，该条目在
  当前设备休眠。

点击“录制新手势”后，按住触发键开始捕获。之后发生的方向移动、鼠标按钮按下和滚轮
都会按原始顺序记录，释放触发键完成录制；录制会持续到完成或显式取消。若与现有手势
冲突，界面会要求确认是否覆盖。

### 输入步骤与命令

鼠标按钮和滚轮可以作为普通手势输入步骤；独立修饰符另行选择,不计入基础输入步骤。
基础输入匹配后,配置了独立修饰符时每次修饰符触发都会立即执行命令并继续监听,直到
触发键释放；没有配置修饰符时,命令在触发键释放后执行。

GodGesture 支持 12 类命令：什么也不做、快捷键、Web 搜索、窗口控制、任务切换、
打开文件、按键/文字序列、打开网址、cmd/PowerShell 命令行、Node.js 插件和音量控制。暂停是全局识别状态,
不属于命令类型；可由顶栏、托盘、暂停快捷键或左键+中键和弦切换。

macOS 上的 PowerShell 命令要求系统 `PATH` 中存在 `pwsh`;缺失时命令会记录执行错误而不回退到 zsh。

脚本使用“Node.js 插件”：支持随应用分发的 Node.js、ESM、`fetch`、Node 内置模块、
npm 依赖和 `@godgesture/sdk`。GodGesture 不包含旧 QuickJS 运行时或旧脚本转换入口。
插件源码在 VS Code、WebStorm 等外部 IDE 中维护,
App 只提供侧边栏“插件”管理页,不提供内置源码编辑器。开发者 API、项目结构和依赖管理见
[脚本开发指南](SCRIPTING.md)，仓库中的中文模板见
[gesture-demo](../distribution/plugins/plugins/gesture-demo/README.md)。

### 安装与开发插件

首次启动时 App 会在系统应用配置目录创建 `plugins` 根目录,空目录会自动生成
`gesture-demo`。也可从“插件”页点击“打开插件目录”。每个直接子目录是一个项目;
不支持注册任意外部目录,插件也不应放到程序安装目录。

| 平台 | 插件目录 |
| --- | --- |
| Windows | `%APPDATA%\com.godgesture.app\plugins` |
| macOS | `~/Library/Application Support/com.godgesture.desktop/plugins` |

在插件根目录打开终端,把仓库中的 `distribution/plugins/plugins/gesture-demo` 复制为自己的项目,随后安装 SDK:

```powershell
Copy-Item -Recurse distribution/plugins/plugins/gesture-demo my-plugin
cd my-plugin
npm install --save-dev @godgesture/sdk
```

再使用 VS Code 或 WebStorm 修改 `index.mjs`、`package.json` 中的插件 ID 和生命周期。App 会自动扫描
并热更新文件,候选版本准备失败时保留最后一份可用版本,插件页显示错误状态。生产依赖项目应提交精确的
`pnpm-lock.yaml` 或 `package-lock.json`;`node_modules` 由本机缓存管理,不要提交。

“插件”页的“在线插件”区域会从公开 GitHub 目录读取可安装项目。点击安装后必须确认：App 会先
从固定的 `Mr-BeanSir/GodGesture-Plugins` `main` 目录按 `pluginId` 和已审核的子目录解析项目，
校验 `package.json.godgesture.id` 后再在临时位置下载并执行 `npm install` 安装生产依赖。成功后项目
才进入本机 `plugins` 目录；下载、校验或依赖安装失败不会覆盖已有项目。在线插件及其依赖会以当前
用户权限运行，安装前应检查仓库和依赖。

## 模板

“手势模板”始终从官方公共目录读取，匿名用户也可浏览、查看详情和采纳。打开详情后先查看目标应用、
命令和风险，再选择保留或替换冲突手势；采纳后的内容成为普通用户配置，可随账户同步。登录到官方端点
且邮箱已验证时，可以把本地导出的模板提交到公共目录，投稿会先进入审核。自定义同步端点只提供账户和
同步，不提供公共目录或投稿。

模板是公开内容，不代表经过安全审计。包含脚本、命令行、文件、URL 或 Web
搜索时，必须逐项检查并确认风险。

模板中的 Node.js 插件只引用稳定的 `pluginId`。确认采纳后，App 会从固定官方插件目录解析已启用
项目并要求确认安装；只有全部插件安装成功才会写入模板的手势配置，因此失败不会留下半套配置。采纳后
同步配置仍只保存 `pluginId`，每台设备可从在线目录重新安装同一插件，或把已审阅的本地项目复制到其
`plugins` 目录。

## 触发角、摩擦边与暂停

“手势”页的全局应用可为每个显示器角和屏幕边配置任意命令。鼠标按键按下时仍
会更新角/边状态，但不会分发命令。

暂停会临时停用全部手势识别，可通过以下入口切换：

- 设置窗口顶栏；
- 托盘菜单；
- “选项”中配置的全局暂停快捷键；
- 左键 + 中键和弦。

关闭设置窗口只会隐藏窗口，GodGesture 仍在托盘运行。使用托盘“退出”才会结束
应用。

## 本机设置与 Windows 启动权限

开机自启和托盘图标显示属于本机专属设置，不参与同步。

Windows Desktop 必须以管理员身份运行。交互启动和开机自启都会先请求 UAC 授权，
Windows 开机任务固定使用 `HighestAvailable`，不使用 `uiAccess`。应用应安装在普通
用户不能替换的位置；移动或删除可执行文件会使启动任务失效。macOS GUI 应用不以
root 身份运行，手势能力由 TCC 权限提供。

## 账户、同步与快照

账户不是使用前提。登录后,手势配置作为一个完整文档同步：本地改动防抖后推送,
启动和约 30 分钟周期拉取，“账户与同步”页也可立即同步。

多设备并发采用整库版本和后写胜出；每次成功推送保留服务端快照。恢复前会先
保存当前配置，设备也可从 Web 控制台改名或撤销。服务离线时本地功能和本地登出
仍可工作。Node 插件源码、`package.json`、锁文件和本机依赖缓存不参与云同步;
同步中的 Node 插件命令只包含 `pluginId`。另一台设备需要单独从在线目录安装同一插件，或把
相同插件项目放入其本机 `plugins` 目录,否则命令会保留引用但无法执行。绑定插件后不再选择单个动作；宿主会根据
插件 manifest 中的生命周期声明,在初始化、手势识别、修饰符触发、命令执行和手势结束时
自动调用对应导出。

## Web 控制台

部署维护者提供官方 Server 地址后，在浏览器打开该地址的根路径，而不是 `/api/v1`。
登录后可只读查看云端配置、管理设备、查看或回滚快照并执行账户安全操作；管理员还可
审核公共模板、处理举报和调整配额。Web 控制台不提供配置正文编辑或账户注销，桌面端与
浏览器使用同一 Server origin 和账户权限。

## 更新

“关于”页可手动检查更新；“自动检查更新”只检查并提示，不会自动下载或安装。
确认安装前，应用会先刷新未保存配置，再下载并验证 minisign 签名，安装后重启。

更新来自 `Mr-BeanSir/GodGesture` 的最新 GitHub Release。更新签名验证内容完整性，
不消除 Windows SmartScreen 或 macOS Gatekeeper/TCC 提示。macOS 更新后可能需要
重新确认权限。

## 排障

- **手势没有响应**：检查顶栏是否暂停、全局应用是否禁用、当前应用是否黑名单，
  再确认触发键和全屏禁用设置。
- **管理员窗口无响应**：确认 GodGesture 已完成启动时的 UAC 授权并以管理员身份运行；
  GodGesture 不使用 `uiAccess`。
- **macOS 无法捕获或模拟输入**：在“选项”检查辅助功能、输入监控和输入模拟，
  必要时打开系统设置重新授权并重启应用。
- **快捷键无法注册**：其他应用可能已占用相同组合；更换暂停快捷键。
- **GitHub 更新或在线插件不可用**：本地手势和已安装插件不受影响，网络恢复后重试。
- **公共模板目录不可用**：先使用上一份有效的目录缓存；没有缓存时，等待官方服务恢复后重试。
- **同步不可用**：本地编辑会继续保存；检查账户页错误和自托管 Server 地址。
- **开发会话日志**：位于 `%TEMP%\godgesture-dev\stdout.log` 与
  `%TEMP%\godgesture-dev\stderr.log`。正式安装版不承诺固定日志文件路径。

报告问题时，请附 GodGesture 版本、操作系统、复现步骤和界面错误码；不要上传
refresh token、Updater 私钥或账户凭据。

## 卸载与本地数据

卸载前建议先退出账户，并关闭“开机自动运行”，让 GodGesture 删除自己拥有的登录
任务。Windows 当前不会在卸载阶段自动清理遗留任务；异常卸载后可在任务计划程序中
检查名称以 `GodGesture Startup ` 开头且确认属于 GodGesture 的当前用户任务。

配置目录由系统按应用标识管理：Windows 使用 `%APPDATA%\com.godgesture.app`，
macOS 使用 `~/Library/Application Support/com.godgesture.desktop`。普通卸载可能保留
这些配置以及系统凭据存储中的会话；确认不再需要后再手动删除，避免误删其他应用
数据。

# GodGesture

GodGesture 是独立演进的 Windows 与 macOS 全局鼠标手势工具。它提供按应用
手势、触发角、摩擦边、Node 插件脚本和窗口命令,并支持可选账户、多设备同步、配置
快照、手势模板与原生更新。

## 下载

正式安装包由 [GitHub Releases](https://github.com/Mr-BeanSir/GodGesture/releases)
提供：

- Windows：x64 NSIS 安装程序；未做 Authenticode 签名，首次安装可能显示
  SmartScreen 提示。
- macOS：macOS 13+ universal DMG，同时包含 Apple Silicon 与 Intel；使用
  ad-hoc 签名且未经 Apple 公证，首次启动需要手动放行。

应用内更新会使用仓库中固定的 minisign 公钥验证更新包。这个签名保护更新
完整性，但不等同于 Windows 发布者签名或 Apple Developer ID。

安装、首次启动和权限步骤见 [用户指南](docs/USER_GUIDE.md)；脚本开发见
[脚本开发指南](docs/SCRIPTING.md)。

## 快速开始

首次打开设置窗口会显示快速入门。GodGesture 默认使用右键作为触发键：按住
右键画出方向，释放后执行命令。例如：

- `右键 + ↓→`：关闭窗口；
- `右键 + ↑`：最大化或还原；
- `右键 + ↓`：最小化；
- `右键 + ← / →`：后退 / 前进。

关闭设置窗口不会退出 GodGesture；应用继续驻留托盘。需要暂时停止识别时，
可使用顶栏、托盘、暂停快捷键或左键+中键和弦。

## 功能

- 右键、中键、X1、X2 触发键，首笔 8 方向、后续 4 方向；
- 有序输入步骤、按应用意图、全局继承与黑名单；
- 窗口、快捷键、文本、文件、URL、命令行、音量与任务切换等 11 类命令；
- 原生轨迹与命令提示覆盖层；
- Node.js 插件脚本、npm 依赖与外部 IDE 开发工具链；Node.js 是唯一脚本运行时；
- WGestures `gestures.wg2` / `config.plist` 导入；
- 可选账户、整库同步、设备管理与配置快照；
- 独立 [手势模板仓库](https://github.com/Mr-BeanSir/gesture-templates)；
- Windows x64 与 macOS universal 原生更新。

## 本地开发

前置环境：Node.js 22+、pnpm 10、Rust stable；Windows 还需要 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm build:shared
pnpm dev:desktop
```

同时启动 NestJS 后端和 Web Console:

```powershell
npm run dev:server
```

该命令会自动寻找可用的后端和前端端口,等待后端 `/api/v1/health` 就绪后再启动
Vite,并在终端打印实际访问地址。Windows 若禁止默认端口,无需手动修改配置。

Desktop 开发首选 `127.0.0.1:14200`，HMR 首选 `14201`；端口被占用时启动器会
自动选择下一组连续端口。更多入口和验证命令见 [Desktop 开发说明](apps/desktop/README.md) 与
[当前项目状态](docs/PROJECT_STATUS.md)。

## 仓库结构

```text
apps/desktop                  Tauri 2 + Rust + Vue 3 桌面端
apps/server                   NestJS + Prisma + PostgreSQL 同步后端
apps/web-console              只读 Web 控制台
packages/shared               配置、认证、同步与模板共享协议
packages/sdk                  @godgesture/sdk 可公开发布的插件开发包
plugins/gesture-demo          中文生命周期示例插件
distribution/gesture-templates  独立模板仓库种子
docs/adr                      架构决策记录
```

后端是可选的自托管增强能力，离线手势不依赖登录或 Server。部署说明见
[1Panel 部署指南](apps/server/README-DEPLOY.md)。

## Node 插件开发

安装应用后,从侧边栏“插件”页打开本机插件目录。插件项目位于系统应用配置目录的
`plugins` 子目录,不放在程序安装目录,也不支持注册任意外部目录。使用 VS Code、WebStorm
等外部 IDE 创建和维护项目:

```shell
# 从 GodGesture 仓库复制 plugins/gesture-demo 为自己的项目后执行
cd my-plugin
npm install --save-dev @godgesture/sdk
```

`@godgesture/sdk` 作为开发依赖为 IDE 提供 `PluginContext` 类型和补全；App 执行时使用随包
SDK 注入的运行副本,不需要从 npm 下载。源码、`package.json` 和锁文件不参与云同步,手势命令只同步
`pluginId`/`actionId` 引用。App 会自动扫描并热更新文件,候选版本失败时保留最后一份可用版本。
完整 manifest、生命周期、demo 复制方式和 Windows/macOS 路径见
[脚本开发指南](docs/SCRIPTING.md)。

## 项目约定

领域术语以 [CONTEXT.md](CONTEXT.md) 为准，实际实现状态以
[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为准，架构边界见
[ADR 索引](docs/adr/README.md)。

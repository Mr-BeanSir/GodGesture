# GodGesture

GodGesture 是独立演进的 Windows 与 macOS 全局鼠标手势工具。它提供按应用
手势、触发角、摩擦边、脚本和窗口命令,并支持可选账户、多设备同步、配置
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

安装、首次启动和权限步骤见 [用户指南](docs/USER_GUIDE.md)。

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
- 修饰、按应用意图、全局继承与黑名单；
- 窗口、快捷键、文本、文件、URL、命令行、音量与任务切换等 12 类命令；
- 原生轨迹与命令提示覆盖层；
- QuickJS JavaScript 脚本与 Monaco 编辑器；
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

Desktop 开发端口固定为 `127.0.0.1:14200`，HMR 使用 `14201`。更多入口和
验证命令见 [Desktop 开发说明](apps/desktop/README.md) 与
[当前项目状态](docs/PROJECT_STATUS.md)。

## 仓库结构

```text
apps/desktop                  Tauri 2 + Rust + Vue 3 桌面端
apps/server                   NestJS + Prisma + PostgreSQL 同步后端
apps/web-console              只读 Web 控制台
packages/shared               配置、认证、同步与模板共享协议
distribution/gesture-templates  独立模板仓库种子
docs/adr                      架构决策记录
```

后端是可选的自托管增强能力，离线手势不依赖登录或 Server。部署说明见
[1Panel 部署指南](apps/server/README-DEPLOY.md)。

## 项目约定

领域术语以 [CONTEXT.md](CONTEXT.md) 为准，实际实现状态以
[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为准，架构边界见
[ADR 索引](docs/adr/README.md)。

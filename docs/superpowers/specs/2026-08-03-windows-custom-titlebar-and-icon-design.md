# Windows 自定义标题栏与应用图标设计

日期: 2026-08-03

## 范围

本次调整设置窗口的 Windows 外观与窗口控制:

1. 使用桌面上的 `favicon-transparent.png` 作为 Windows 应用图标源。
2. Windows 主窗口取消系统原生标题栏,由现有应用顶栏提供拖动、最小化和关闭能力。
3. macOS 保留原生标题栏、交通灯按钮与现有 `icon.icns`,不改变平台习惯。

## 窗口配置

主窗口继续由 `tauri.conf.json` 提供共享尺寸、最小尺寸和初始隐藏状态。应用启动时仅在
Windows Rust 分支调用 Tauri 窗口 API 关闭 decorations；macOS 不执行该设置。这样避免维护
一份容易与共享配置漂移的 `tauri.windows.conf.json`,同时由于主窗口原本不可见,不会出现
先显示原生标题栏再切换的闪烁。

窗口仍保持可调整大小。取消标题栏不改变托盘、单实例唤起、自动启动或关闭事件处理。

## 自定义顶栏

现有 48px 应用顶栏继续承载品牌、暂停、主题和语言控件,同时成为 Windows 窗口标题栏:

- 品牌区域保留应用图标与名称。
- 品牌与现有操作区之间的空白区域作为拖动区域,不覆盖任何交互控件。
- Windows 桌面运行时在最右侧增加最小化和关闭图标按钮；浏览器预览及 macOS 不显示。
- 两个按钮使用固定尺寸,不会因 tooltip、翻译或状态变化导致顶栏位移。
- 最小化调用当前 Tauri 窗口的 `minimize()`。
- 关闭调用当前 Tauri 窗口的 `close()`,继续进入 Rust `CloseRequested` 处理并隐藏到托盘,
  不直接退出进程。
- 关闭按钮采用 Windows 熟悉的红色悬停/按下反馈；最小化按钮使用现有中性 hover token。
- 按钮使用 Element Plus 已有图标,提供中英文 tooltip、`aria-label` 和可见键盘焦点。

不增加最大化按钮。窗口仍可通过边缘调整大小；本次不扩展双击顶栏最大化语义。

## 图标资产

输入文件为 `C:\Users\JBean\Desktop\favicon-transparent.png`,规格为 128x128、32-bit ARGB
透明 PNG。由它生成包含常见 Windows 图标尺寸的 `apps/desktop/src-tauri/icons/icon.ico`,
避免任务栏、小图标和安装包依赖单层位图缩放。同时更新顶栏使用的 32px PNG 派生图。

本次不重建 `icon.icns` 或 macOS bundle 图标。源文件保留在用户桌面,仓库只提交应用实际
使用的派生资产。

## 错误处理

窗口控制只在 Tauri Windows 环境启用。最小化或关闭 API 拒绝时记录错误,不改变应用状态,
也不把失败伪装成成功。Rust 原有关闭前取消手势录制和隐藏到托盘逻辑保持为最终边界。

## 测试与验收

- Desktop 前端测试、typecheck 与 production build 通过。
- Rust 定向编译/Clippy 验证 Windows decorations 设置及现有关闭事件处理。
- 检查 `icon.ico` 确实包含多尺寸帧,透明通道正常,顶栏 32px 图标与源图一致。
- Windows 实际窗口检查原生标题栏消失、顶栏没有双层高度或横向溢出。
- Windows 实际交互检查空白区域拖动、最小化进入任务栏、关闭隐藏到托盘、托盘重新打开。
- 在 980x700 与最小 800x560、中文/英文、明暗主题下检查按钮位置、tooltip、焦点和文本适配。
- macOS 配置与 `icon.icns` 保持不变；真实 macOS 外观仍按现有 M4 延期清单观察。

## 非目标

- 不改变关闭到托盘为真正退出。
- 不新增最大化/还原按钮或双击最大化。
- 不改变托盘图标隐藏设置、托盘菜单或单实例行为。
- 不重设计顶栏、导航、主题或语言选择器。
- 不改变 macOS 标题栏和应用图标。

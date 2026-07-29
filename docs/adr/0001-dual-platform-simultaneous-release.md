# Windows 与 macOS 双平台同一首发版本同时交付

Tauri 只解决 UI 层跨平台;手势引擎(全局鼠标钩子、事件吞噬、输入合成、窗口控制)必须按平台各写一套原生实现(Windows 用 Win32 hook/SendInput,macOS 用 CGEventTap/Accessibility)。首个正式版选择同时交付两个平台,接受更长的首发周期,换取架构从一开始就受双平台约束(平台抽象层、跨平台配置模型、命令能力矩阵),避免单一平台假设渗入核心。此约束延续到后续版本:每个功能的完成定义为在两个平台上均验收通过,或被显式标记为单平台能力。

## Considered Options

- 分阶段:Windows 先发布,macOS 作为下一里程碑(风险低、反馈快,但易累积 Windows 中心的设计债)
- 同时交付(采纳)

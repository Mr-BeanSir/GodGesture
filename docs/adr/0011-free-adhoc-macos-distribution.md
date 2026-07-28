# macOS 免费分发采用 ad-hoc 签名 DMG,不做 Apple 公证

GodGesture 是免费开源软件,维护者决定不加入付费 Apple Developer Program。macOS 安装包仍通过 GitHub Actions 在 macOS runner 上生成,但分发目标改为免费的 ad-hoc 签名 DMG,不使用 Developer ID 证书、不提交 Apple 公证,也不上架 Mac App Store。

ad-hoc 签名只为应用包提供代码签名封装和构建完整性检查,不证明发布者身份,不能获得 Apple 信任或免除 Gatekeeper 首次启动拦截。用户接受在 Finder 中手动“打开”,或通过“系统设置 > 隐私与安全性 > 仍要打开”批准应用。项目必须如实说明这个边界,不得声称产物经过 Apple 验证,也不得自动移除 quarantine 属性或绕过系统安全策略。

Accessibility、Input Monitoring 和 event posting 继续由 macOS TCC 单独授权。Gatekeeper 手动放行、管理员密码和 TCC 授权互不替代;版本升级后可能需要重新确认权限。macOS GUI 应用不以 root 身份运行,`runAsAdmin` 仍是 Windows 单平台能力。

默认生成同时包含 Apple Silicon 与 Intel 的 universal DMG,因为当前双架构不需要额外产品代码。若真实 macOS 构建证明 Intel 支持需要新增架构专用功能代码或独立维护路径,发布目标收缩为 Apple Silicon,不为 Intel 扩大产品实现范围。

本 ADR 取代 ADR-0007 中“macOS 注册 Apple Developer 进行签名与公证”的发布结论;ADR-0007 关于 Windows 不采用 `uiAccess`、使用 `runAsAdmin` 与任务计划的决策保持不变。

## Considered Options

- Developer ID 签名 + Apple 公证:普通用户首次启动体验最好,但需要持续付费,不符合维护者决定。
- 完全无签名 DMG:流程最少,但相比 ad-hoc 签名没有实际用户放行优势,且缺少应用包签名封装校验。
- 免费 ad-hoc 签名 DMG(采纳):无需 Apple 凭证,保留可重复的 GitHub 发布流水和明确的手动安装路径。

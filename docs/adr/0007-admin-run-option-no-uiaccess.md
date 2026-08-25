# Windows Desktop 必须以管理员身份运行,不复刻 uiAccess

> macOS 付费签名与公证结论已由 ADR-0011 取代;本文记录 Windows 强制管理员启动、任务计划和不采用 `uiAccess` 的决策。

Windows 普通权限进程不能操作更高完整性级别的窗口,而用户无法可靠判断目标窗口的完整性级别。为避免应用以 Medium 完整性运行后持续出现全局输入和覆盖层问题,GodGesture 的 Windows Desktop 进程必须以管理员身份运行:

- 普通交互启动和 `--autostart` 启动在进入 Tauri 应用前检查进程是否已提升;未提升时通过系统 UAC `runas` 重新启动,原进程退出,用户取消或无法提升则不继续运行。
- Windows 开机任务固定使用 `HighestAvailable`;不再根据用户设置选择 `LeastPrivilege`。
- 设置页和快速入门不再提供管理员身份开关,`runAsAdmin` 不再是本机设置协议字段。包含该旧字段的 `machine.json` 不再作为兼容格式读取或迁移,会按未知字段拒绝。

GodGesture 仍不使用需要 Authenticode 签名和受信安装位置的 `uiAccess`;管理员身份由应用启动时的 UAC 提升和 Windows 任务计划共同保证。

签名策略:Windows 不购买代码签名证书,接受 SmartScreen 首次运行警告;macOS 按 ADR-0011 使用免费 ad-hoc 分发,手势能力经"辅助功能"权限授权。

未来若用户量值得投入,可重新评估代码签名或其他 Windows 安全模型,但不得在没有新 ADR 的情况下恢复普通权限启动或引入 `uiAccess`。

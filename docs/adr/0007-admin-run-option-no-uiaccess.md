# 提权窗口支持用"以管理员身份运行"选项,不复刻 uiAccess

> macOS 付费签名与公证结论已由 ADR-0011 取代;本文其余 Windows `runAsAdmin`、任务计划和不采用 `uiAccess` 的决策仍有效。

Windows 普通权限进程不能操作更高完整性级别的窗口。GodGesture 决定不使用需要 Authenticode 签名和受信安装位置的 `uiAccess`:默认以普通权限运行;设置中提供"以管理员身份运行"开关,配合任务计划实现开机自启且免 UAC 弹窗,覆盖需要操作提权窗口的场景。

签名策略:Windows 不购买代码签名证书,接受 SmartScreen 首次运行警告;macOS 注册 Apple Developer($99/年)进行签名与公证(Gatekeeper 下分发的事实前提),手势能力经"辅助功能"权限授权。

未来若用户量值得投入,可再买 OV 证书补上 uiAccess 路线,此决策不阻断该演进。

# 提权窗口支持用"以管理员身份运行"选项,不复刻 uiAccess

WGestures 依靠 `uiAccess="true"` 在管理员窗口上工作,代价是必须 Authenticode 签名(它用"自签根证书装进用户机器"实现)+ 安装到 Program Files。GodGesture 决定不走 uiAccess:V1 默认普通权限;设置中提供"以管理员身份运行"开关,配合任务计划实现开机自启且免 UAC 弹窗,覆盖提权窗口场景的效果等价。

签名策略:Windows 不购买代码签名证书,接受 SmartScreen 首次运行警告;macOS 注册 Apple Developer($99/年)进行签名与公证(Gatekeeper 下分发的事实前提),手势能力经"辅助功能"权限授权。

未来若用户量值得投入,可再买 OV 证书补上 uiAccess 路线,此决策不阻断该演进。

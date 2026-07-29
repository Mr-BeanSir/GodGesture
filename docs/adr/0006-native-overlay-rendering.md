# 轨迹与提示标签用原生自绘覆盖层,不用 WebView

手势轨迹/命令提示是产品"手感"的核心路径,要求低延迟、点击穿透、置顶于全屏应用、多显示器随手势起点迁移。WebView 透明窗口方案(WebView2 透明+穿透+多屏 DPI 混合+全屏置顶的组合)存在已知可靠性问题,且常驻多耗几十 MB 内存,故弃用。采用 Rust 原生覆盖窗口:Windows 使用分层窗口(UpdateLayeredWindow),macOS 使用无框 NSWindow + CALayer;画线逻辑用 tiny-skia 跨平台共享,仅窗口创建、穿透和置顶按平台特化。

拒绝"先 WebView 出效果后期换原生":同一功能写两遍,且临时方案有永久化倾向。

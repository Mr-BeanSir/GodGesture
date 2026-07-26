# 脚本命令采用 JavaScript(QuickJS),单 Runtime 多 Context 复用

WGestures 的脚本命令是 Lua(NLua + CLR 反射),旧脚本依赖 .NET,任何引擎下都无法原样运行,因此按"新 API 选最合适的语言"决策。选定 JavaScript,引擎用 rquickjs(QuickJS-ng 绑定):用户基数与前端技术栈一致,可在设置界面提供 Monaco 编辑器 + 官方 API `.d.ts` 类型提示;体积增量 ~1-2 MB 可接受。

执行模型:Rust 核心进程内一个常驻 JS Runtime;每条脚本命令首次触发时懒创建独立 Context(隔离作用域)并缓存复用,与 WGestures 的懒初始化 Lua 状态策略同构。四个脚本槽模型保留(初始化/执行/识别时/修饰触发时/结束时)。宿主 API(输入模拟、窗口操作、剪贴板、状态上报等)由 Rust 注入,不提供 Node/浏览器标准库,提供的全局能力以官方文档为准。

## Considered Options

- Lua(mlua):嵌入生态最成熟、体积最小、老用户语言零迁移;但用户明确偏好 JS,且旧脚本反正必须重写
- 双引擎:维护成本翻倍,否决
- V8/deno_core:+30-50 MB 与嵌入复杂度,对短事件脚本纯属过重,未列入

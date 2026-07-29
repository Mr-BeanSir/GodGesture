# 脚本命令采用 JavaScript(QuickJS),单 Runtime 多 Context 复用

脚本命令选定 JavaScript,引擎使用 rquickjs(QuickJS-ng 绑定):语言与设置界面的前端技术栈一致,可在 Monaco 编辑器中提供官方 API `.d.ts` 类型提示,体积增量约 1-2 MB 可接受。兼容导入的 Lua 脚本只保留原文,不会执行或自动转换为 JavaScript。

执行模型:Rust 核心进程内一个常驻 JS Runtime;每条脚本命令首次触发时懒创建独立 Context(隔离作用域)并缓存复用。命令包含初始化、执行、识别时、修饰触发时和结束时脚本槽。宿主 API(输入模拟、窗口操作、剪贴板、状态上报等)由 Rust 注入,不提供 Node/浏览器标准库,提供的全局能力以官方文档为准。

## Considered Options

- Lua(mlua):嵌入生态成熟、体积小;但与前端语言和 `.d.ts` 工具链不一致
- 双引擎:维护成本翻倍,否决
- V8/deno_core:+30-50 MB 与嵌入复杂度,对短事件脚本纯属过重,未列入

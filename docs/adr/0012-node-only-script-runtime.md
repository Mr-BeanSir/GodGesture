# Node.js 作为最终唯一脚本运行时,QuickJS 仅作迁移期兼容层

GodGesture 最终采用随桌面应用分发的 Node.js LTS 作为唯一可执行脚本运行时。
Node 宿主常驻并预加载插件,通过本地 framed IPC 与原生手势引擎通信;插件在
Worker 中隔离,支持真实 Node API、ESM、`fetch` 和 npm 依赖。应用携带固定版本
Node 与 pnpm,不要求用户安装 Node 或 npm。

当前 QuickJS 实现保留到性能门槛和迁移完成。迁移期间不再向 QuickJS 增加新的
浏览器或 Node 标准库能力。只有在 Windows 与 macOS 均通过 ADR 配套设计中的
热态端到端延迟、队列有序性和崩溃恢复验收后,才删除 QuickJS 与旧脚本执行路径。

本 ADR 取代 ADR-0005 中“长期不提供 Node/浏览器标准库”的最终产品方向,但不
取消 ADR-0005 对当前 QuickJS 单 Runtime、多 Context、内存、栈和中断限制的
迁移期约束。完成迁移后,脚本安全边界改由 Node 插件宿主、插件信任确认和依赖
安装策略承担。

## Considered Options

- 继续增强 QuickJS:短期轻量,但会逐步形成无法兼容 Node 生态的自制运行时,否决。
- 永久双运行时:兼容性最好,但长期维护两套 SDK、编辑器和生命周期,否决。
- 常驻 Node.js + 插件 Worker(采纳):提供完整生态并保留明确的性能闸门,允许现有
  配置平滑迁移,同时避免在没有证据时删除稳定的 QuickJS 路径。

## Consequences

- 桌面包体积增加并新增 sidecar 生命周期、IPC 和跨平台打包维护成本。
- 插件可以使用异步网络、文件和子进程能力,脚本协议必须支持异步结果和重启恢复。
- npm 安装必须使用随应用携带的工具链和锁文件;原生扩展依赖平台预构建产物。
- 插件源码、manifest 与 lockfile 进入整库同步文档;协议上限由 `256 KiB`
  提升到 `4 MiB`,并限制单插件与插件数量以保持同步可预测。
- 完整迁移后,脚本编辑器、SDK、Node 类型和 npm 工作区成为唯一脚本开发体验。

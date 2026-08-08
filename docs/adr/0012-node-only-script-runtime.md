# Node.js 作为唯一脚本运行时

GodGesture 采用随桌面应用分发的 Node.js LTS 作为唯一可执行脚本运行时。
Node 宿主常驻并预加载插件,通过本地 framed IPC 与原生手势引擎通信;插件在
Worker 中隔离,支持真实 Node API、ESM、`fetch` 和 npm 依赖。应用携带固定版本
Node、npm 与 pnpm,不要求用户安装 Node、npm 或 pnpm。

2026-08-02,维护者明确授权在 Windows 性能、顺序和恢复门槛完成后切换为
Node-only,不再以物理 Mac 验收作为删除旧运行时的前置条件。macOS CI 已完成同一
release 性能门槛;仍需真实设备观察的 Node 宿主、输入、窗口、覆盖层、依赖离线重建
和恢复行为集中保留在 `docs/qa/M4_MACOS_SMOKE.md`,作为后续平台验收,不阻塞当前
运行时选择。

本 ADR 完全取代 ADR-0005。QuickJS、旧 `script` 命令、旧宿主适配、迁移按钮和
自动转换工具均已退出现役产品;配置只接受 `nodePlugin` 脚本命令。维护者明确选择不提供
旧脚本向后兼容或自动迁移。脚本安全边界由 Node 插件
宿主、插件信任确认和依赖安装策略承担。

## 2026-08-04 文件系统工作区修订

维护者决定放弃应用内源码编辑器,插件改为用户在 VS Code、WebStorm 等外部 IDE 中
维护的本机项目。唯一受支持的插件根目录是 Tauri `app_config_dir/plugins`;应用不允许
注册任意外部目录,程序安装目录也不是插件写入位置。Windows 的安装目录通常不可写,
macOS 修改 `.app` bundle 还会破坏签名与升级边界。

每个直接子目录是一个插件项目,`package.json` 的 `godgesture` 字段是唯一 manifest。
仓库中的 `distribution/plugins/plugins/gesture-demo` 是用户复制或克隆后开始开发的参考项目;
`@godgesture/sdk` 作为唯一公开开发依赖提供 IDE 类型与辅助函数,运行时则由应用在隔离缓存
中注入匹配版本,不依赖用户机器在执行阶段访问 npm。项目不提供独立脚手架或校验 CLI。

插件源码、`package.json`、锁文件和依赖不再进入 `ConfigDocument` 或云同步。同步命令
只保留稳定的 `pluginId`;manifest 声明实际存在的五个生命周期导出,运行时自动调度它们;
同一插件项目可由用户通过 Git、文件复制等方式维护,也可由已确认的 GitHub 在线来源安装到
每台设备。桌面端插件页负责发现、状态、错误、重新扫描、打开目录和在线安装,但不承担源码编辑。

运行时以 500 ms 文件快照轮询发现变化,忽略 `node_modules`、版本控制和 GodGesture
缓存目录。候选版本准备失败时保留该插件最后一份可用版本,避免一次未完成或错误保存
立即破坏原有手势。该跨平台扫描策略取代内嵌编辑器的显式保存流程。

## Considered Options

- 继续增强 QuickJS:短期轻量,但会逐步形成无法兼容 Node 生态的自制运行时,否决。
- 永久双运行时:兼容性最好,但长期维护两套 SDK、编辑器和生命周期,否决。
- 常驻 Node.js + 插件 Worker(采纳):提供完整生态,以 Windows 真实运行和双平台 CI
  证据约束输入路径性能,并把暂缺设备的 macOS 观察项显式延期。

## 2026-08-07 GitHub 在线插件分发修订

维护者要求模板和插件页能够从 GitHub 分发并安装 Node.js 插件。本修订取代“插件只能通过
外部方式部署、插件页只读”的限制，但不恢复应用内源码编辑，也不改变插件工作区、本机存储或
同步边界。

在线插件目录和模板包中的插件源均只允许 HTTPS GitHub 仓库 URL、受限 Git ref、可移植
子目录和稳定 `pluginId`。安装事务必须在用户明确确认后执行：在临时目录取得指定 ref，
验证 `package.json.godgesture.id` 与声明 ID 一致，使用随应用提供的 npm 安装生产依赖，
再原子地激活到 `app_config_dir/plugins`。下载、校验、安装或最终扫描失败时，保留已有项目；
模板采纳还必须停止于配置写入前。

模板只在其 `plugins` 字段携带这些安装来源。每个模板中的 `nodePlugin` 命令必须引用匹配的
源 `pluginId`；采纳后配置仍只保存该 ID，不保存仓库 URL、ref、源码、lockfile 或
`node_modules`。在线安装和依赖安装属于第三方代码执行边界，界面必须显示仓库来源并取得
显式确认。

## Consequences

- 桌面包体积增加并新增 sidecar 生命周期、IPC 和跨平台打包维护成本。
- 插件可以使用异步网络、文件和子进程能力,脚本协议必须支持异步结果和重启恢复。
- 在线安装必须使用随应用携带的 npm，在临时目录以非交互、无 audit/fund、禁止依赖生命周期
  脚本和仅生产依赖的参数执行；运行时的候选版本准备按项目提供的锁文件选择随包 npm 或
  pnpm，并在隔离缓存中复用精确依赖。原生扩展依赖平台预构建产物。
- 插件项目留在 `app_config_dir/plugins`,不进入整库同步文档;同步只引用 `pluginId`,缺少
  对应本机项目时命令不可执行但引用不丢失。只有当前配置实际引用的插件才启动 Worker
  并执行 `onInit`。
- 外部 IDE、公开 SDK 和仓库内 `distribution/plugins/plugins/gesture-demo` 是源码开发体验;App 提供插件管理页
  和受确认的 GitHub 在线安装，但不提供 Monaco、脚手架或其他内置源码编辑器。
- 旧配置中的 `script` 命令不会自动转换;配置格式升级后应通过校验拒绝或由既有
  解析边界按其稳定错误处理,不再提供产品内迁移入口。
- macOS 真机验收仍是发布质量事项。延期只改变 Node-only 的切换门槛,不把未观察
  的行为记为通过,也不改变 macOS 与 Windows 同版本交付的产品要求。

## 2026-08-05 开发入口修订

维护者决定不再维护独立的 `@godgesture/plugin` 脚手架和校验包。插件作者从仓库的
`distribution/plugins/plugins/gesture-demo` 复制或克隆项目,执行 `npm install --save-dev @godgesture/sdk` 后在
外部 IDE 中开发。Desktop 仍在扫描和候选版本准备阶段校验 manifest、入口、生命周期导出与锁文件;
这部分校验不再暴露为 npm CLI。

最初版本曾决定“插件源码、manifest 与 lockfile 进入整库同步文档”并以应用内 Monaco
编辑器作为开发入口。上述 2026-08-04 修订明确取代这两项结论;本段仅保留它们的历史
决策轨迹,不再描述现役产品合同。

## 2026-08-08 官方插件目录约束修订

维护者将在线插件目录收敛为唯一官方仓库
`https://github.com/Mr-BeanSir/GodGesture-Plugins` 的 `main` 分支。目录条目以稳定
`pluginId` 映射到 `plugins/<subdirectory>/`；模板和同步配置仅能保存 `pluginId`，不得再携带
任意仓库 URL、ref、作者或子目录。

Desktop 仍要求用户明确确认后才下载安装代码；安装时使用当前 `main` 内容，不为模板固定
commit。被管理员停用的插件阻止后续安装，但不静默删除用户已经安装的本地插件。此修订取代
2026-08-07 修订中允许目录或模板声明任意 GitHub 仓库/ref/子目录的部分，其他 Node-only
运行时与原子安装约束继续有效。

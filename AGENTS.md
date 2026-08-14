# GodGesture AI 开发入口

本文件是仓库唯一入口。GodGesture 从 stable `v0.1.0` 起作为独立项目演进:
后续需求由维护者提出,不得再以 WGestures 的实现或行为推导需求。现有
WGestures 配置导入是用户迁移能力,不代表 WGestures 仍是产品基准;除非任务
明确涉及该导入器,否则不要读取、比较或依赖本机可能存在的 `WGestures/`。

## 每次任务必做

1. 完整读取 `CONTEXT.md` 和 `docs/PROJECT_STATUS.md`。
2. 运行 `git status --porcelain=v1` 和 `git log --oneline -12`,保护用户已有改动。
3. 通过 `docs/adr/README.md` 只选择与当前任务相关的 ADR,不要默认通读全部历史
   决策。按受影响领域再读取对应 README、发布指南或 QA 清单。
4. `docs/CHANGELOG.md` 和 `docs/history/` 仅保存历史/发布审计资料。普通开发任务不要默认读取,
   只有追溯历史或执行发布审计时按需读取。

## 不得静默改变的边界

- Windows 与 macOS 同版本交付;功能须双平台验收或显式标注单平台能力。
- 轨迹和命令提示使用原生覆盖层,不用 WebView;脚本仅通过随应用分发的常驻 Node.js 插件宿主执行。
- 后端保存用户数据及受审核的官方公共模板元数据；模板包使用 RustFS，不从 GitHub
  运行时分发。更新和官方在线插件目录仍通过 GitHub 分发。生产部署由维护者使用
  1Panel 手动完成，交付物为 docker-compose。
- 同步采用整库版本、乐观并发、后写胜出和快照;离线优先、账户可选、不做长连接。
- 不使用 `uiAccess`;Windows 提权场景使用“以管理员身份运行”。macOS 采用免费
  ad-hoc 分发,不引入付费 Apple 凭证或公证要求。
- 若新需求与现有 ADR 冲突,先向维护者说明影响,再新增或修订 ADR,不得静默偏离。

## 工程约定

- 与用户使用中文交流;commit message 使用英文。
- pnpm monorepo;协议改动必须同时更新 `packages/shared` 及全部消费方并保证编译通过。
- 运行 Python 脚本统一使用 `uv`,例如 `uv run python <script> [args]`;不要直接调用
  `python`、`python3` 或 `py`。
- 新编写的组件一律封装为公共组件,优先放入现有公共组件包或目录并复用。
- App(Desktop)端固定既定尺寸与布局,不做多尺寸响应式兼容;多尺寸响应式适配仅属于 Web 端。
- 界面文案使用 vue-i18n 的 zh-CN/en,禁止在组件中硬编码中文文案。
- OAuth 等外部凭证只保留配置位并在 `.env.example` 说明,不得写入代码或文档。
- Bug 从日志和稳定复现开始;现场调试先接管并监控当前进程,再编译或重启;不得以新实例替代原复现现场,未复现不得写成已修复。新增功能先确认术语、双平台完成定义和架构影响。
- 按受影响领域补测试并运行对应验证,不要为窄改动机械执行全仓测试。
- 功能状态、关键入口、已知问题或验证基线变化时,同一提交更新
  `docs/PROJECT_STATUS.md`;新术语先更新 `CONTEXT.md`。
- 显式 `git add <path>`,禁止 `git add -A`;按领域独立提交,默认不 push。

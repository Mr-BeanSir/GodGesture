# GodGesture — 项目约定(给 AI 协作者)

## 必读文档(按序)

1. `CONTEXT.md` — 领域术语表。所有命名(代码/UI/文档)必须与之一致,新术语敲定后先更新它。
2. `docs/PROJECT_STATUS.md` — 当前实现状态、部件入口、未完成边界、验证基线与接手流程。
3. `docs/HANDOFF.md` — 日常新增功能/修复 Bug 的文档导航、任务路由与当前交接边界。
4. `docs/adr/` — 架构决策记录。改动方向与 ADR 冲突时,先提出并新增/修订 ADR,不要静默偏离。
5. `docs/ROADMAP.md` — 里程碑目标;实际落地状态以 `docs/PROJECT_STATUS.md` 为准。

## 硬约束(来自 ADR,勿"优化"掉)

- Windows + macOS 同版本交付;每个功能双平台验收或显式标注单平台(ADR-0001)。
- 功能对齐基准 = WGestures 1.8.5 出厂行为(参考克隆在 `WGestures/`,不属于本仓库)。
- 轨迹/提示用原生覆盖层,不用 WebView(ADR-0006);脚本引擎 = rquickjs/QuickJS(ADR-0005)。
- 后端只存用户数据;更新/模板走 GitHub 分发(ADR-0008);部署 = 用户 1Panel 手动部署,交付 docker-compose(ADR-0004)。
- 同步 = 整库版本 + 乐观并发 + 后写胜出 + 快照(ADR-0009);离线优先、账户可选、不做长连接(ADR-0010)。
- 不做 uiAccess;提权场景走"以管理员身份运行"开关(ADR-0007)。

## 工程约定

- 与用户用中文交流;commit message 用英文。
- pnpm monorepo;协议改动必须同时更新 `packages/shared` 并保证两端编译通过。
- 界面文案走 vue-i18n(zh-CN + en),禁止硬编码中文串到组件里。
- OAuth(GitHub/Google/微信/QQ)等外部凭证一律留配置位(.env.example 注明),不写死;macOS 免费分发按 ADR-0011,不得重新引入 Apple 付费凭证或公证要求。
- 功能状态、关键入口、已知问题或验证基线发生变化时,在同一文档提交中更新 `docs/PROJECT_STATUS.md`。
- 按受影响领域分别验证、显式暂存并单独提交;禁止 `git add -A`,不自动 push。

# GodGesture — 项目约定(给 AI 协作者)

## 必读文档(按序)
1. `CONTEXT.md` — 领域术语表。所有命名(代码/UI/文档)必须与之一致,新术语敲定后先更新它。
2. `docs/adr/` — 架构决策记录。改动方向与 ADR 冲突时,先提出并新增/修订 ADR,不要静默偏离。
3. `docs/ROADMAP.md` — 里程碑;当前进度见文件内标记。

## 硬约束(来自 ADR,勿"优化"掉)
- Windows + macOS 同版本交付;每个功能双平台验收或显式标注单平台(ADR-0001)。
- 功能对齐基准 = WGestures 1.8.5 出厂行为(参考克隆在 `WGestures/`,不属于本仓库)。
- 轨迹/提示用原生覆盖层,不用 WebView(ADR-0006);脚本引擎 = rquickjs/QuickJS(ADR-0005)。
- 后端只存用户数据;更新/模板走 GitHub 分发(ADR-0008);部署 = 用户 1Panel 手动部署,交付 docker-compose(ADR-0004)。
- 同步 = 整库版本 + 乐观并发 + 后写胜出 + 快照(ADR-0009);离线优先、账户可选、不做长连接(ADR-0010)。
- 不做 uiAccess;提权场景走"以管理员身份运行"开关(ADR-0007)。

## 工程约定
- pnpm monorepo;协议改动必须同时更新 `packages/shared` 并保证两端编译通过。
- 界面文案走 vue-i18n(zh-CN + en),禁止硬编码中文串到组件里。
- Apple Developer / OAuth(GitHub/Google/微信/QQ)等外部凭证一律留配置位(.env.example 注明),不写死。
- 提交信息用英文;不自动 push。

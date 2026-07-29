# GodGesture 开发交接入口

本文面向后续新增功能与 Bug 修复。当前没有进行中的开发任务;stable
`v0.1.0` 已发布,M8 已结束。实际实现、部件入口、锁定语义、已知问题和
验证基线统一以 `docs/PROJECT_STATUS.md` 为准,不要从旧里程碑提交推断当前
状态。

## 文档导航

按 `AGENTS.md` 和 `CLAUDE.md` 的顺序读取项目上下文。进入具体任务后再按
受影响领域读取下列资料,不要为每个窄任务加载所有历史文档。

| 需要了解的内容 | 权威入口 |
| --- | --- |
| 协作规则与必读顺序 | `AGENTS.md`, `CLAUDE.md` |
| 领域术语与命名 | `CONTEXT.md` |
| 当前实现、项目划分、代码入口、未完成边界、测试命令 | `docs/PROJECT_STATUS.md` |
| 不得静默改变的架构决策 | `docs/adr/0001~0011` |
| 已完成里程碑与未来范围 | `docs/ROADMAP.md` |
| 产品安装和使用 | `README.md`, `docs/USER_GUIDE.md` |
| Desktop 开发入口 | `apps/desktop/README.md` |
| Server 开发和部署 | `apps/server/README.md`, `apps/server/README-DEPLOY.md` |
| Desktop 双平台发布 | `docs/DESKTOP_RELEASE.md`, `docs/MACOS_RELEASE.md` |
| 仍需真实 Mac 的设备验收 | `docs/qa/M4_MACOS_SMOKE.md` |
| stable `v0.1.0` 的正式发布证据 | `docs/qa/M8_RELEASE_ACCEPTANCE.md` |

已完成里程碑的阶段性 `docs/superpowers/specs` 与
`docs/superpowers/plans` 已从当前文档集删除。它们不是当前行为的权威来源;
确需追溯设计过程时使用 Git 历史,实现事实仍回到代码、ADR 和
`docs/PROJECT_STATUS.md` 核对。

## 新任务路由

1. 先运行 `git status --porcelain=v1` 和 `git log --oneline -12`,保护用户
   已有改动。用户自有未跟踪 `接手提示词.md` 不得读取、修改、暂存或提交。
2. 根据 `docs/PROJECT_STATUS.md` 的“部件地图”确定任务影响 Desktop Rust、
   Desktop Vue、shared、Server、Web Console、部署或发布中的哪些边界。
3. Bug 从日志和稳定复现开始,再定位最小修复面;新增功能先确认术语、双平台
   完成定义和是否触及 ADR。协议改动必须同时更新 `packages/shared` 及全部消费方。
4. 前端文案必须走 vue-i18n 的 zh-CN/en;轨迹和命令提示保持原生覆盖层;
   macOS 免费 ad-hoc 分发、离线优先同步和后端只存用户数据等边界不得静默改变。
5. 按风险补测试并只运行受影响领域的验证。功能状态、关键入口、已知问题或
   验证基线变化时,同一提交更新 `docs/PROJECT_STATUS.md`。
6. 显式 `git add <path>` 并使用英文 commit message;禁止 `git add -A`,默认
   不 push。

## 当前边界

- M0~M8 的开发与 M8 发布任务均已收尾;后续工作从新的功能请求或可复现 Bug
  开始,不继续执行旧 M7/M8 计划。
- M4 代码与 runner 可验证项已经完成,但真实 Mac 的 Gatekeeper、TCC、全局
  手势运行时和已安装升级仍为 `DEFERRED (owner-approved)`。只有取得物理设备
  观察后才能更新 `docs/qa/M4_MACOS_SMOKE.md` 和项目状态。
- Windows 无 Authenticode,macOS 为 ad-hoc 且未公证;不得声称 Microsoft 或
  Apple 信任。Updater 密钥不得在没有迁移设计时再次轮换。
- 本机可能已有 Desktop Vite 开发服务。启动新会话前按
  `docs/PROJECT_STATUS.md` 检查固定端口和精确进程树,不要批量终止 Node/Cargo。

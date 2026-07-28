# GodGesture 当前交接

生成日期:2026-07-29。本文记录 M7 结束时的可操作交接摘要;实际功能状态仍以 `docs/PROJECT_STATUS.md` 为准,未来范围以 `docs/ROADMAP.md` 为准。

## 当前结论

- M7 Web 控制台与分发已全部完成,`docs/PROJECT_STATUS.md` 与 `docs/ROADMAP.md` 已同步为完成状态。
- 最终审计基于 `main@ba92709`;产品行为基线止于 `aaf3e42`,之后的提交只更新状态文档。
- M7 完成定义中的代码、静态分发合同、模板种子、自动化测试与浏览器视觉验收均有证据。不应在没有具体回归证据时重新打开 M7。
- 本轮未 push。

## M7 交付面

- shared:手势模板协议、严格校验、风险分类、冲突规划、AUMID 应用解析、UUID/顺序生成与 256 KiB 限制。
- 模板分发:`distribution/gesture-templates` 提供独立仓库种子,当前 2 个低风险包通过校验。
- Desktop Rust:固定公钥、HTTPS-only endpoint、操作串行化、进度事件、稳定错误映射、安装与重启的 Tauri Updater。
- Desktop Vue:模板/更新 store、原子配置采纳 barrier、自动/手动更新检查、安装前配置 flush、顶层模板界面和真实 About/更新界面,zh-CN/en 对齐。
- 发布:Windows x64 NSIS、macOS universal ad-hoc DMG/Updater、签名更新包、SHA-256 和确定性 `latest.json`。
- 视觉验收:中/英文、明/暗主题、`980x700` 与 `800x560` 已覆盖;截图保留在 `%TEMP%\godgesture-m7-qa`。

## 最终验证

2026-07-29 在 Windows 工作区重跑:

```text
shared tests/build       90/90, passed
desktop tests            83/83, passed
desktop typecheck/build  passed
Rust lib tests           152 passed, 1 ignored
Rust clippy              passed with one documented existing warning
template seed            2 packages validated
release validation       8/8 plus workflow static contract, passed
git diff --check         06374ac..HEAD, passed
```

Clippy 唯一警告仍是 `apps/desktop/src-tauri/src/platform/windows/overlay.rs:202 while_let_loop`;Desktop build 仅有已记录的 VueUse PURE 注释与大 chunk 警告。

## 明确边界

- M4 真实 macOS 运行时验收仍未完成,与 M7 的静态发布实现分开跟踪。
- 首个真实 tag 发布、Windows/macOS 已安装旧版到新版的 Updater smoke、快速引导与最终发布验收属于 M8。
- Windows 无 Authenticode,可能显示 SmartScreen;macOS 是 ad-hoc 签名且未公证,必须保持 ADR-0011 的诚实说明。
- 自建 Server 不得代理 Updater 或手势模板分发。
- `godgesture/gesture-templates` 公开仓库尚未创建/推送;仓库内只有已验证的独立种子。

## 发布前必做

1. 将 Updater 私钥备份到加密离线存储;不得打印、提交或放入构建产物。
2. 配置 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`;仅在私钥设有密码时配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
3. 将 `distribution/gesture-templates` 发布到独立公开仓库。
4. 未经迁移发布设计不得轮换 Updater 密钥。

## 接手起点

- 先按 `CLAUDE.md` 的顺序读取 `CONTEXT.md`、`docs/PROJECT_STATUS.md`、相关 ADR 与 `docs/ROADMAP.md`,然后重新检查 Git 状态和近期历史。
- 关键 M7 文档:`docs/superpowers/specs/2026-07-28-m7-distribution-design.md`、`docs/superpowers/plans/2026-07-28-m7-distribution-plan.md`、`docs/DESKTOP_RELEASE.md`。
- 关键提交:`9e5f3d7`、`94c9c6e`、`8ac71ec`、`df87a0c`、`60ec982`、`8939894`;后续审计修复:`50771fe`、`5a26b43`、`42d4fd2`、`aaf3e42`。
- 下一个开发任务应从 M8 规划开始;外部发布准备可按上述清单独立执行。
- 交接时工作区仅有用户自有的未跟踪 `接手提示词.md`;不要读取、修改、暂存或提交它。

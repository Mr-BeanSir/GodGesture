# GodGesture 当前交接

生成日期:2026-07-29。本文记录 M8 完成后的可操作交接摘要;实际功能状态以 `docs/PROJECT_STATUS.md` 为准,完整发布证据见 `docs/qa/M8_RELEASE_ACCEPTANCE.md`。

## 当前结论

- M8 打磨与发布已完成。stable `v0.1.0` 指向 `5b812458cea69c2d6cf6a2da111647fb5dac6b31`,GitHub Release 为 Latest、非 prerelease。
- Windows x64 NSIS 与 macOS universal ad-hoc DMG/Updater 已由同一 successful workflow `30437621772` 发布。Windows RC.2 已通过应用内原生 Updater 下载、minisign 验证、覆盖安装和重启到 `0.1.0`。
- 快速入门、公开模板仓库、用户文档、生产坐标、prerelease/stable 发布合同、Actions Rust cache 和最终自动化基线均已验收。
- M4 真实 Mac Gatekeeper、TCC、全局手势运行时和已安装升级仍未执行,统一状态为 `DEFERRED (owner-approved)`。GitHub macOS runner 的 codesign/lipo/DMG 通过不能替代这些设备观察。

## 发布身份

```text
RC.1:   v0.1.0-rc.1 -> 880f1178e44410aaa59acadf6454da82eca93417
RC.2:   v0.1.0-rc.2 -> ff50456360790f531bd31a0e0c318aa6e17c669b
Stable: v0.1.0      -> 5b812458cea69c2d6cf6a2da111647fb5dac6b31
```

- Stable workflow: `https://github.com/Mr-BeanSir/GodGesture/actions/runs/30437621772`,success,6m53s。
- Stable Release: `https://github.com/Mr-BeanSir/GodGesture/releases/tag/v0.1.0`,10 个用户资产加 GitHub 生成的两个 source archive。
- 模板 Release: `https://github.com/Mr-BeanSir/gesture-templates/releases/tag/v1.0.0`。
- stable `latest.json` 映射 `windows-x86_64` 与 `darwin-universal`,evidence 记录 exact tag/commit/stable mode。

## Updater 密钥

- 旧私钥未备份且 GitHub Secret 不可读回,已在任何 stable 客户端发布前完成替换。RC.2 与 stable 均使用 replacement key。
- GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 已更新;不得尝试读取或记录 Secret 值。
- 两份仓库外、字节一致、受 ACL 保护的备份已建立;私钥自身有 Tauri 密码保护,另有通过完整解密测试的 AES-256/header-encrypted 7-Zip 归档。
- 公钥 SHA-256:`450FA06E125EC1955F65AA98192FD4DFFE40E4F420FDE5D8CA219F56601AB616`。加密归档 SHA-256:`70E8F999C4FEF809E518824B9D86733617C394BAE128373F9E732D4E77791875`。
- 后续发布必须同时保持提交公钥、GitHub Secret 和离线私钥一致。已发布客户端不能无迁移地再次轮换 Updater key。

## Stable 验收摘要

- Windows installer SHA-256:`b0a14b544101ba8ee9b668f0fa18a05de7b30814f4da772502dfec0e3b312da3`;解包应用为 x64 PE `0x8664`,版本 `0.1.0`,按设计 `NotSigned`。
- macOS updater SHA-256:`0f951abac77b545bac1cd73872faf7b45a4ed1a715bca3632799ecedafa1b05f`;DMG SHA-256:`dc7a6ade30e4784cad30f2d53ef2372a27bd2fe989689a82386b70bce6b15467`。
- 两个平台 updater payload 均用提交公钥和 Tauri 同款 `minisign_verify` 算法独立验签。macOS executable 含 x86_64 `0x01000007` 与 arm64 `0x0100000C`;runner strict ad-hoc codesign、app layout 与 `hdiutil verify` 均通过。
- Windows 升级后配置 SHA-256 保持 `24038F06DE27BCAC8945B6476E9779DFD2F56A796128B70BFB6B6BDE449CC024`;9 条全局手势、本机设置、托盘设置、快速入门 dismissal 与零计划任务状态保持不变。

## Actions 缓存

`.github/workflows/desktop-release.yml` 使用 `Swatinem/rust-cache@v2`。stable run 的 Windows 约 951 MB 与 macOS 约 667 MB cache 均为 exact hit (`full match: true`);Windows job 从 RC.2 冷构建 13m46s 降至 6m09s,macOS 从 10m12s 降至 4m25s,总 run 从 14m17s 降至 6m53s。

## 最终验证

2026-07-29 在 `5b81245` 重跑:

```text
shared tests/build       90/90, passed
desktop tests            88/88, passed
desktop typecheck/build  passed
Rust lib tests           152 passed, 1 ignored
Rust clippy              passed with one documented existing warning
template seed            2 packages validated
release validation       10/10 plus workflow static contract, passed
```

Clippy 唯一警告仍是 `apps/desktop/src-tauri/src/platform/windows/overlay.rs:202 while_let_loop`;Desktop build 仅有已记录的 VueUse PURE 注释和大 chunk 警告。

## 后续边界

- M4 设备清单仍在 `docs/qa/M4_MACOS_SMOKE.md`;runner/Release 项已有 M8 证据并已勾选,得到真实 Mac 后只继续未勾选的设备项,不得把 deferred 改成 PASS 而没有观察证据。
- Windows/macOS 发布模型仍分别接受无 Authenticode SmartScreen 警告与 ad-hoc 未公证的手动放行;不得宣称 Apple 或 Microsoft 信任。
- 自建 Server 只承载用户数据,不得代理 Updater 或模板分发。
- 接手时按 `AGENTS.md`/`CLAUDE.md` 重新读上下文并检查 Git 状态。用户自有未跟踪 `接手提示词.md` 不得读取、修改、暂存或提交。

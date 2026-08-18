# Desktop Release Automation Design

**Status:** Approved for implementation

**Date:** 2026-08-18

## Goal

为 GodGesture Desktop 建立一个可审计的手动版本发布流程：维护者明确指定
`patch`、`minor`、`major` 或完整 SemVer 版本，release-it 只负责版本文件、
发布提交和 tag；GitHub 根据合并 PR 自动生成带章节、PR 链接和作者信息的
Release 正文。仓库不再维护 `docs/CHANGELOG.md`，也不使用 Changesets 文件。

## Confirmed Decisions

- PR/commit 使用 Conventional Commits 类型，类型只用于发布日志分类，不参与
  版本号推导。
- 发布版本由维护者显式指定，例如 `pnpm release patch` 或
  `pnpm release 0.2.0`。
- GitHub Release 页面是唯一发布日志来源；现有
  `generate_release_notes: true` 保留。
- GitHub Release 的自定义安装和签名说明继续放在自动生成正文之前。
- PR 标题类型由自动化映射为 `type: <type>` label，GitHub Release 配置按 label
  生成中英文章节。
- `apps/server` 是独立私有子项目。根仓发布不读取、修改或校验其版本，也不提交
  其子模块内部改动。
- 根 package、Desktop package、Tauri 配置和 Cargo manifest 是同一个 Desktop
  产品版本的四个构建清单，发布时必须保持一致。
- `packages/shared`、`packages/ui` 和 `packages/sdk` 独立维护版本，不随 Desktop
  产品发布 bump。
- release-it 不在本流程中创建 GitHub Release，避免与现有 tag workflow 竞争。

## Architecture

### Root release-it orchestration

根 workspace 安装 release-it 和 `@release-it/bumper`。根目录只运行一次
release-it；不采用逐 workspace 执行 release-it 的通用 monorepo recipe，因为
Server 是 Git submodule，且本项目不是 npm package 发布仓库。

release-it 使用根 `package.json` 作为版本来源，并通过 bumper 的多个输出清单
同步以下四个文件：

| 文件 | 更新字段 | 参与 Desktop release |
| --- | --- | --- |
| `package.json` | `version` | 是 |
| `apps/desktop/package.json` | `version` | 是 |
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | 是 |
| `apps/desktop/src-tauri/Cargo.toml` | `[package].version` | 是 |
| `apps/server/package.json` | `version` | 否，独立发布 |
| `packages/shared/package.json` | `version` | 否 |
| `packages/ui/package.json` | `version` | 否 |
| `packages/sdk/package.json` | `version` | 否 |

现有 `scripts/desktop-release.mjs` 的 `readProjectVersion()` 继续只验证
Desktop 的 Tauri、Desktop package 和 Rust package 一致性；不把 Server 加入校验。
发布配置必须显式禁用 release-it 的 npm publish/version 插件，因为这些 package
都是应用构建清单或私有 workspace，不进行 npm 发布。

### Manual version selection

根 package 提供 `release` script，使用一个薄包装保证发布命令包含显式版本参数：

```powershell
pnpm release patch
pnpm release minor
pnpm release major
pnpm release 0.2.0
```

包装器将参数传给 release-it，并在执行前检查工作区干净、当前 Desktop 版本
一致、目标 tag 不存在且参数是合法的 SemVer increment 或完整版本。缺少参数时
直接失败，不能回退到基于 Conventional Commits 的自动版本推荐。

release-it 生成：

- `chore: release v${version}` 类型的 release commit；
- `v${version}` tag；
- 只包含上述四个 Desktop 版本文件的版本改动。

release-it 的 git push 行为必须通过现有交互确认执行；实现提供 dry-run/预览命令
以便维护者在真正提交和推送前检查版本与文件范围。

### PR title classification

PR 标题必须使用以下 Conventional Commits 类型之一，scope 和 breaking marker
可选：

```text
feat(ui): add template search
fix: prevent overlay flicker
docs: update release guide
```

PR 自动化只读取 PR 标题，不 checkout 或执行不受信任的 PR 代码。它将标题的基础
type 映射为同名 label：

```text
feat     -> type: feat
fix      -> type: fix
chore    -> type: chore
docs     -> type: docs
style    -> type: style
refactor -> type: refactor
perf     -> type: perf
test     -> type: test
revert   -> type: revert
build    -> type: build
ci       -> type: ci
config   -> type: config
```

同一个 PR 只保留一个 `type:` label。标题类型不合法时，PR 检查失败并提示允许的
类型；不能静默落入错误章节。breaking marker 只保留在标题语义中，因为版本号
始终由维护者显式指定。

### GitHub generated release notes

新增 `.github/release.yml`，将 `type:` label 映射为 GitHub Release 章节：

```text
type: feat     -> ✨ Features | 新功能
type: fix      -> 🐛 Bug Fixes | Bug 修复
type: chore    -> 🎫 Chores | 其他更新
type: docs     -> 📝 Documentation | 文档
type: style    -> 💄 Styles | 风格
type: refactor -> ♻ Code Refactoring | 代码重构
type: perf     -> ⚡ Performance Improvements | 性能优化
type: test     -> ✅ Tests | 测试
type: revert   -> ⏪ Reverts | 回退
type: build    -> 👷 Build System | 构建
type: ci       -> 🔧 Continuous Integration | CI 配置
type: config   -> 🔨 CONFIG | 配置
```

现有 `.github/workflows/desktop-release.yml` 的 tag release job 继续使用
`generate_release_notes: true`。根据 `softprops/action-gh-release` 的行为，已有
`body` 会被添加到 GitHub 自动生成正文之前，因此安装、签名、权限和校验和说明
仍然可见，后面接 GitHub 自动生成的 PR 章节。

GitHub 的自动日志范围由 tag comparison 决定，正常情况下只包含上一个 release
到当前 release 之间的合并 PR。没有关联 PR 的直接 commit 不保证出现在按 PR 分组
中；项目发布流程应继续通过 PR 合并进入 `main`。

### Server submodule boundary

根仓 release 脚本不进入 `apps/server`，不执行其 package version 写入，也不解析
其版本。根仓仍要求顶层 Git 工作区干净，因此一个未提交的 Server gitlink 状态会
阻止 Desktop 发布，但不会检查 Server 内部版本是否与 Desktop 相同。Server 维护者
在私有子项目中独立运行自己的发布流程；根仓 Desktop tag workflow 只需要 Server
submodule 能够被 CI 按已记录 gitlink 检出。

## Error Handling

- 根仓存在未提交改动时，release command 在修改任何文件前失败。
- 四个 Desktop 版本清单不一致时，release command 在修改任何文件前失败。
- 目标版本不是合法 SemVer、版本没有实际前进或对应 `v${version}` tag 已存在时
  失败。
- Server 版本与 Desktop 版本不同不报错，也不会被 release-it 改写；Server gitlink
  未提交则按根仓脏工作区处理并阻止发布。
- PR 标题无法解析为允许的 type 时，PR classification check 失败且不创建错误
 章节 label。
- GitHub Release 继续要求 `contents: write`，构建 job 只保留 read 权限。
- GitHub 自动生成日志失败时，release job 失败并保留已构建 artifacts；不静默生成
  一个缺少变更正文的“成功” Release。

## Testing and Verification

实现必须补充以下定向验证：

- release version wrapper：验证 `patch`、完整 `0.2.0`、缺少参数、非法版本、
  版本不一致、脏工作区和已有 tag；测试使用临时 fixture，不修改真实 tag。
- bumper/release config contract：验证四个 Desktop 文件被更新，Server、shared、
  UI 和 SDK 文件保持原版本，`npm` publish/version 路径关闭，tag 格式为 `vX.Y.Z`。
- PR title classifier：验证 12 个 type、scope、breaking marker、非法 type 和
  同 PR 旧 type label 清理。
- GitHub workflow contract：验证 `generate_release_notes: true`、安装说明仍在
  body、release job 仍只由 `v*` tag 触发，并验证 `.github/release.yml` 覆盖 12 个
  label 分类。
- 运行现有 Desktop release contract tests、仓库布局测试和 release dry-run；不把
  GitHub live Release 或真实 Windows/macOS 构建伪装成可以在本地完成的测试。

## Out of Scope

- 不引入 Changesets 文件或 Changesets GitHub Action。
- 不维护仓库内 `docs/CHANGELOG.md`。
- 不根据 `feat` / `fix` 自动选择 patch/minor/major。
- 不自动提交或发布 `apps/server` 子模块。
- 不修改 `packages/shared`、`packages/ui`、`packages/sdk` 的版本策略。
- 不改变现有 Windows/macOS 构建、签名、更新器和 GitHub artifact 校验逻辑。

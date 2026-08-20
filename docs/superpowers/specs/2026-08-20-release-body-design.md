# GitHub Release Body Design

**Status:** Approved for implementation, revised after v0.2.1 live verification

**Date:** 2026-08-20

## Goal

让 GodGesture 的 GitHub Release 页面同时显示固定发布说明、按提交和 PR 自动
分类的 Release Notes，以及指向上一个发布版本到当前版本的 `Full Changelog`
对比链接。不维护仓库内的 `docs/CHANGELOG.md`。

## Decision

- GitHub 原生 `generate_release_notes` 只按合并 PR 生成；v0.2.1 的 live API
  body 已验证仓库无 PR 时不会把直接提交放进分类章节。
- 保留现有 Windows、macOS、校验和、安装指南等固定说明。
- Release job checkout 当前 tag 的受信任脚本，使用 GitHub API 找到最近的非 draft
  Release、比较 tag 提交并读取合并 PR。
- `scripts/generate-release-notes.mjs` 按 PR title 或 type label、直接提交的
  Conventional Commit 前缀归入 `.github/release.yml` 的 12 个分类；PR 内的提交
  被排除以避免重复。
- 如果没有上一个 Release，`Full Changelog` 回退到当前 tag 的 commits 页面。
- `softprops/action-gh-release` 的 `generate_release_notes` 保持 `false`，因为自定义
  生成器已经同时覆盖提交和 PR；开启原生生成会追加重复的 PR-only 区块。
- GitHub Release 仍只由 `v*` tag 触发，并继续使用 `contents: write`。

## Data Flow

```text
tag push
  -> assemble artifacts
  -> checkout trusted release-notes generator
  -> GitHub API reads previous release, compare commits, and merged PRs
  -> generator formats fixed notes, 12 sections, and Full Changelog
  -> softprops/action-gh-release publishes the body and assets
```

The API lookup excludes draft releases and the current tag. The workflow uses an
explicit `github.token` for checkout and API requests, and does not initialize
submodules in the release job.

## Verification

- Release contract tests assert the explicit checkout token, generator step,
  `generate_release_notes: false`, and the generated-body output reference.
- Generator tests cover direct commits, PR title grouping, PR commit de-duplication,
  no-previous-release fallback, and a fake GitHub API/$GITHUB_OUTPUT flow.
- The standalone desktop release validator enforces the same contract.
- Existing release, repository-layout, and full workspace tests remain required.

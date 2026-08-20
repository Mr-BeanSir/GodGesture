# GitHub Release Body Design

**Status:** Approved for implementation

**Date:** 2026-08-20

## Goal

让 GodGesture 的 GitHub Release 页面使用固定的发布说明，并在末尾显示一个
指向上一个发布版本到当前版本的 `Full Changelog` 对比链接。Release 页面不再
追加 GitHub 自动生成的分类章节。

## Decision

- 将 `softprops/action-gh-release` 的 `generate_release_notes` 设置为 `false`。
- 保留现有 Windows、macOS、校验和、安装指南等固定说明。
- Release job 在发布前通过 GitHub Releases API 找到最近一个非 draft Release，
  生成 `previousTag...currentTag` 的 compare 链接。
- 如果没有上一个 Release，链接回退到当前 tag 的 commits 页面。
- `.github/release.yml` 和 PR title/type label workflow 保留，但不再参与这个
  Release body 的自动拼接。
- GitHub Release 仍只由 `v*` tag 触发，并继续使用 `contents: write`。

## Data Flow

```text
tag push
  -> assemble artifacts
  -> GitHub Releases API resolves previous release tag
  -> workflow constructs Full Changelog markdown link
  -> softprops/action-gh-release publishes fixed body and assets
```

The API lookup excludes draft releases and the current tag. The workflow uses the
runner's GitHub token and does not checkout repository code in the release job.

## Verification

- Release contract tests assert `generate_release_notes: false`, the resolver step,
  and the body output reference.
- The standalone desktop release validator enforces the same contract.
- Existing release, repository-layout, and full workspace tests remain required.

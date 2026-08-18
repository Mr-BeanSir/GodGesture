# Task 3 Report: GitHub Release Category Configuration

**Status:** COMPLETE

**Fix base:** `c8b91992a0eee1f897bb0c896d7a7c4a818c1d18`

**Commit message:** `ci: fix GitHub release notes schema`

## TDD RED

Updated the release-notes contract test before implementation changes. It now requires the official `changelog.categories[*].labels` schema, exactly twelve entries, exactly one unique label per entry, exact mappings, and rejects the legacy top-level `categories` schema.

Command:

```text
node --test scripts/__tests__/release.test.mjs scripts/__tests__/desktop-release.test.mjs
```

RED result:

```text
ℹ tests 23
ℹ pass 22
ℹ fail 1
AssertionError: 0 !== 12
```

This was the expected failure because `.github/release.yml` did not exist yet; the existing Desktop and release tests continued to pass.

## TDD GREEN

Replaced `.github/release.yml` with GitHub's official `changelog.categories[*].labels` schema containing exactly twelve bilingual mappings. Strengthened the validator with schema, count, one-label-per-category, uniqueness, and exact-map assertions.

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

Extended `scripts/validate-desktop-release.mjs` to parse and enforce the exact category map. It now also gives focused contract failures for drift in the `v*` tag trigger, `release` job tag guard, `assemble` dependency, `contents: write` scope, `softprops/action-gh-release@v2`, generated notes, and the existing installation/signing/permissions/checksum/body link text.

The existing `.github/workflows/desktop-release.yml` was not modified. Its Windows/macOS build and signing steps, artifact assembly, `generate_release_notes: true`, custom body, tag trigger, and release permissions remain unchanged. No second GitHub Release path was introduced; `.release-it.json` remains `github.release: false` and `npm: false`.

## Changed Files

- `.github/release.yml`: corrected GitHub generated release notes category configuration.
- `scripts/__tests__/release.test.mjs`: focused YAML/workflow/release-it contract coverage.
- `scripts/validate-desktop-release.mjs`: runtime repository validator coverage for the same release contracts.

No `packages/shared` protocol or Desktop build/signing source was changed. No workflow file change was necessary. No `apps/server` internal version was read, modified, or validated.

## Verification

Focused test command after implementation/refactor:

```text
node --test scripts/__tests__/release.test.mjs scripts/__tests__/desktop-release.test.mjs
```

Actual result:

```text
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

Validator command:

```text
node scripts/validate-desktop-release.mjs
```

Actual result:

```text
Validated signed desktop release workflow for GodGesture 0.1.0 (GodGesture_0.1.0_x64-setup.exe, GodGesture_0.1.0_x64-setup.exe.sig, GodGesture_0.1.0_x64-setup.exe.sha256, GodGesture_0.1.0_universal.app.tar.gz, GodGesture_0.1.0_universal.app.tar.gz.sig, GodGesture_0.1.0_universal.app.tar.gz.sha256, GodGesture_0.1.0_universal.dmg, GodGesture_0.1.0_universal.dmg.sha256)
```

Repository release validation:

```text
pnpm validate:release
```

Actual result:

```text
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.onlyBuiltDependencies".
ℹ tests 32
ℹ pass 32
ℹ fail 0
Validated signed desktop release workflow for GodGesture 0.1.0 (...8 expected artifacts...)
```

The pnpm warning is pre-existing package-manager configuration drift and is unrelated to this Task 3 change. The command exited with code `0`.

Formatting/staging checks:

```text
git diff --check           -> exit code 0
git diff --cached --check  -> exit code 0
```

The fix commit contains the corrected configuration, focused test, validator, task report, and ledger. `git diff --check` passed.

## Self-Review

- The twelve category labels exactly match Task 2's approved `type: feat` through `type: config` labels; no valid type is excluded and no invalid label is silently classified.
- The release job still depends on `assemble`, is guarded by `startsWith(github.ref, 'refs/tags/v')`, and is the only job with `contents: write`.
- `generate_release_notes: true` and the pre-existing custom body remain on `softprops/action-gh-release@v2`; the body still documents unsigned Windows installers, ad-hoc/non-notarized macOS distribution, separate Accessibility/Input Monitoring permissions, SHA-256 files, and `docs/USER_GUIDE.md`.
- No `release-it` GitHub publication path, live API call, tag creation, or push was added or executed.
- Existing Windows/macOS build, signing, artifact, and `assemble` behavior was left untouched.
- The implementation does not alter `readProjectVersion(root)` or add Server version coupling.

## Live GitHub / Platform Boundary

No live GitHub Release API was called. No tag was created and nothing was pushed. Local YAML parsing and contract assertions prove the checked-in configuration shape, but they do not prove GitHub's hosted renderer will accept or display the generated sections exactly as expected. A maintainer still needs to validate the first real tag-triggered release in GitHub and confirm that merged PRs with each `type:*` label appear in the intended bilingual section and that the custom body precedes the generated notes.

The real Windows 2025 and macOS 15 build/signing runners were not executed locally. This Task 3 verification preserves and checks their workflow contract but does not replace the required dual-platform release acceptance.

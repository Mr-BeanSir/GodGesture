# Desktop Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 GodGesture Desktop 建立一个由维护者显式指定版本、由 release-it 同步四个 Desktop 版本清单并创建 release commit/tag、由 GitHub 自动生成 PR 分类发布正文的 v0.2.0 发布流程。

**Architecture:** 根 workspace 只运行一次 release-it，根 `package.json` 是版本来源，`@release-it/bumper` 将版本写入根 package、Desktop package、Tauri 配置和 Cargo manifest。一个 Node 包装器在 release-it 前解析显式版本选择器并检查根工作区、Desktop 版本一致性和目标 tag；release-it 不发布 npm 包也不创建 GitHub Release，现有 tag workflow 继续负责构建和发布。GitHub `pull_request_target` workflow 将 Conventional Commit PR 标题转换为唯一 `type:*` label，`.github/release.yml` 再按这些 label 生成章节化 Release Notes。

**Tech Stack:** Node.js 22 ESM、pnpm 10、release-it、`@release-it/bumper`、`semver`、Node built-in test runner、GitHub Actions、GitHub Release Notes configuration。

## Global Constraints

- 版本必须由维护者显式指定：`patch`、`minor`、`major` 或完整 SemVer；`feat` / `fix` 不得自动决定版本。
- Desktop 发布只同步 `package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json` 和 `apps/desktop/src-tauri/Cargo.toml`；`apps/server`、`packages/shared`、`packages/ui`、`packages/sdk` 不得被读取、修改或参与版本一致性校验。
- 根 release 仍要求顶层 Git 工作区干净；包括 Server gitlink 在内的未提交顶层状态都必须阻止发布，但不检查 Server 子仓库内部版本。
- release-it 生成 `chore: release v${version}` 提交和 `v${version}` tag，push 继续走 release-it 的交互确认；不得让 release-it 创建第二个 GitHub Release。
- GitHub Release 页面是唯一发布日志来源；不新增 Changesets 文件，不维护 `docs/CHANGELOG.md`。
- GitHub Release 正文必须保留现有安装、签名、权限和校验和说明，并在其后接 `generate_release_notes: true` 生成的 PR 章节。
- PR 分类只允许 `feat`、`fix`、`chore`、`docs`、`style`、`refactor`、`perf`、`test`、`revert`、`build`、`ci`、`config` 十二种类型；同一个 PR 最终只保留一个 `type:*` label。
- GitHub Actions 的 PR 自动化必须运行在 `pull_request_target`，只 checkout base branch 的受信代码，不能执行不受信任 PR 的代码。
- Windows 与 macOS 的实际构建、签名、安装和升级验收仍是独立验收；本地契约测试不得声称完成真实平台或 live GitHub Release 验证。
- 遵守仓库规则：使用 `pnpm`，Python（如未来需要）只能通过 `uv run`，显式 `git add <path>`，commit message 使用英文，默认不 push。

## File Map

### New files

- `.release-it.json`: 根 release-it 配置，关闭 npm 发布/GitHub Release，声明 Git 操作和四个 bumper 输出清单。
- `scripts/release.mjs`: 发布命令包装器，解析显式版本选择器、读取版本发布状态、执行 release-it。
- `scripts/__tests__/release.test.mjs`: 发布参数、版本状态和 release 配置契约测试。
- `scripts/pr-title.mjs`: 十二种 PR 类型的解析器和 label 映射常量。
- `scripts/__tests__/pr-title.test.mjs`: PR 标题和标签分类测试。
- `.github/workflows/pr-title.yml`: 受信 PR 标题检查与 `type:*` label 同步 workflow。
- `.github/release.yml`: GitHub generated release notes 的 label-to-section 配置。
- `docs/superpowers/plans/2026-08-18-desktop-release-automation.md`: 本实施计划。

### Modified files

- `package.json`: 增加 `release`、扩展 `validate:release`，加入 release-it、bumper 和 semver 开发依赖。
- `pnpm-lock.yaml`: 由 `pnpm install --lockfile-only` 更新新增依赖锁定内容。
- `scripts/validate-desktop-release.mjs`: 增加 Release Notes 配置和现有 tag release workflow 的契约断言。
- `scripts/__tests__/desktop-release.test.mjs`: 保留现有 Desktop artifact 测试并补充四清单和 release workflow 相关契约测试，或将新增断言放入新的 release 测试以保持职责清晰。
- `.github/workflows/desktop-release.yml`: 只在需要时调整 release step 的 `generate_release_notes`/body 配置；保持 tag-only 触发和现有构建签名行为。
- `docs/DESKTOP_RELEASE.md`: 改为使用 release-it 的 dry-run、校验和显式版本命令，说明四文件同步及 GitHub Release Notes 来源。
- `docs/MACOS_RELEASE.md`: 更新 tag 与四个 Desktop 版本清单的关系，删除三文件手工编辑表述。
- `docs/PROJECT_STATUS.md`: 记录新发布入口、验证基线和仍需真实 Windows/macOS 验收的边界。

---

### Task 1: Root release-it version orchestration

**Files:**
- Create: `.release-it.json`
- Create: `scripts/release.mjs`
- Create: `scripts/__tests__/release.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `parseReleaseArguments(args: string[]): { selector: string; releaseItArgs: string[] }`.
- Produces `resolveReleaseVersion(currentVersion: string, requested: string): string`.
- Produces `readReleaseState(root: string): Promise<{ rootVersion: string; desktopVersion: string; tauriVersion: string; cargoVersion: string; targetTag: string; worktreeClean: boolean }>`.
- The executable path calls `readReleaseState`, resolves the target version, then invokes the local `release-it` binary with the resolved version and any dry-run flag. It must not invoke workspace package release commands or enter `apps/server`.

- [ ] **Step 1: Add failing tests for explicit selector parsing and SemVer resolution**

  In `scripts/__tests__/release.test.mjs`, import the pure functions from `../release.mjs` and cover the exact accepted interface:

  ```js
  test("resolves patch, minor, major, and explicit versions", () => {
    assert.equal(resolveReleaseVersion("0.1.0", "patch"), "0.1.1");
    assert.equal(resolveReleaseVersion("0.1.0", "minor"), "0.2.0");
    assert.equal(resolveReleaseVersion("0.1.0", "major"), "1.0.0");
    assert.equal(resolveReleaseVersion("0.1.0", "0.2.0"), "0.2.0");
  });

  test("requires exactly one selector", () => {
    assert.throws(() => parseReleaseArguments([]), /version selector/i);
    assert.throws(() => parseReleaseArguments(["patch", "minor"]), /one version selector/i);
  });

  test("rejects invalid, non-forward, and unsupported selectors", () => {
    assert.throws(() => resolveReleaseVersion("0.1.0", "wat"), /valid release selector/i);
    assert.throws(() => resolveReleaseVersion("0.1.0", "0.1.0"), /greater than/i);
    assert.throws(() => resolveReleaseVersion("0.1.0", "0.0.9"), /greater than/i);
    assert.throws(() => resolveReleaseVersion("0.1.0", "01.2.3"), /SemVer/i);
  });
  ```

  Keep `--dry-run` as an optional release-it passthrough flag while still requiring one version selector, so `pnpm release patch --dry-run` is accepted and `pnpm release --dry-run` is rejected.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```powershell
  node --test scripts/__tests__/release.test.mjs
  ```

  Expected: FAIL because `scripts/release.mjs` and its exported functions do not yet exist.

- [ ] **Step 3: Implement the pure version wrapper and release state reader**

  Implement `scripts/release.mjs` using `node:child_process`, `node:fs/promises`, `node:path`, `node:url`, and `semver`:

  - `parseReleaseArguments` must accept one positional selector from `patch|minor|major|<valid full SemVer>`, plus release-it flags such as `--dry-run`; reject zero or more than one selector before any file or Git mutation.
  - `resolveReleaseVersion` must use `semver.inc(currentVersion, selector)` for the three increment selectors and `semver.valid(requested)` for explicit versions; require `semver.gt(target, current)` and return a normalized version without a leading `v`.
  - `readReleaseState` must read only the root package, Desktop package, Tauri JSON, and the `[package]` version from Cargo. It must obtain Cargo’s version from the manifest text or a narrowly scoped manifest parser without invoking a command that traverses `apps/server`; it must read `apps/server/package.json` neither directly nor indirectly.
  - The state reader must compare all four Desktop values and report a mismatch before release-it runs. It must obtain top-level worktree status with `git status --porcelain=v1`; any output, including a changed Server gitlink, means `worktreeClean: false`.
  - The wrapper must inspect `git tag --list v<target>` and fail if the tag already exists. The check is performed before invoking release-it. It must not alter any file itself.
  - For the actual invocation, resolve the package manager executable from the current platform and invoke the local `release-it` CLI through pnpm with the resolved version as the positional release-it version argument. Pass through `--dry-run` and other supported release-it flags, and preserve release-it’s interactive confirmation for push. Use an environment guard or explicit CLI configuration so release-it cannot create a GitHub Release or npm publication.

- [ ] **Step 4: Run focused tests and add fixture coverage for boundaries**

  Extend `scripts/__tests__/release.test.mjs` with temporary fixture directories and stub Git commands where needed. The tests must prove:

  ```js
  test("reads four Desktop manifests and ignores independent package versions", async () => {
    // Fixture root contains Desktop files at 0.2.0, Server/shared/ui/sdk at unrelated values.
    // Assert readReleaseState returns the four Desktop values and never requires equality with the other packages.
  });

  test("rejects a Desktop version mismatch before release", async () => {
    // Change only Cargo.toml to 0.1.1 and assert readReleaseState rejects with all mismatched fields named.
  });

  test("rejects a dirty worktree and an existing target tag", async () => {
    // Feed deterministic git status/tag responses and assert each condition fails before invocation.
  });
  ```

  Do not create or modify a real Git tag in tests. The fixture test must include an `apps/server/package.json` with a different version and assert the release-state result does not expose it as a comparison input.

- [ ] **Step 5: Add release-it configuration and package scripts**

  Create `.release-it.json` with these behavioral values:

  ```json
  {
    "$schema": "https://unpkg.com/release-it@21/schema/release-it.json",
    "npm": false,
    "git": {
      "requireCleanWorkingDir": true,
      "commitMessage": "chore: release v${version}",
      "tagName": "v${version}",
      "push": true
    },
    "github": {
      "release": false
    },
    "plugins": {
      "@release-it/bumper": {
        "in": "package.json",
        "out": [
          "package.json",
          "apps/desktop/package.json",
          "apps/desktop/src-tauri/tauri.conf.json",
          {
            "file": "apps/desktop/src-tauri/Cargo.toml",
            "path": "package.version"
          }
        ]
      }
    }
  }
  ```

  Add root `"release": "node scripts/release.mjs"`, add `release-it`, `@release-it/bumper`, and `semver` to `devDependencies`, and extend `validate:release` to run the release, PR-title, and existing Desktop contract suites. Use the repository’s pnpm version and update only the lockfile records needed by these dependencies.

- [ ] **Step 6: Run release configuration tests and a no-mutation dry run**

  Run:

  ```powershell
  pnpm install --frozen-lockfile
  node --test scripts/__tests__/release.test.mjs
  pnpm release patch --dry-run
  git diff -- package.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml
  ```

  Expected: tests pass; dry-run reports a target of `0.1.1` from the current `0.1.0` state and leaves all four manifest files unchanged. Do not run a non-dry release or push from this task.

- [ ] **Step 7: Commit the root release orchestration**

  ```powershell
  git add .release-it.json package.json pnpm-lock.yaml scripts/release.mjs scripts/__tests__/release.test.mjs
  git commit -m "feat: add desktop release version orchestration"
  ```

### Task 2: PR title parser and label workflow

**Files:**
- Create: `scripts/pr-title.mjs`
- Create: `scripts/__tests__/pr-title.test.mjs`
- Create: `.github/workflows/pr-title.yml`
- Modify: `package.json`

**Interfaces:**
- Produces `PR_TYPES: readonly string[]` containing the twelve approved base types.
- Produces `TYPE_LABELS: Readonly<Record<string, string>>` mapping each type to `type: <type>`.
- Produces `parsePrTitle(title: string): { type: string; label: string; scope: string | null; breaking: boolean }`.

- [ ] **Step 1: Write failing parser tests for all accepted title forms**

  In `scripts/__tests__/pr-title.test.mjs`, cover every approved type and the optional syntax:

  ```js
  test("parses the twelve allowed types", () => {
    for (const type of PR_TYPES) {
      const parsed = parsePrTitle(`${type}: update release tooling`);
      assert.equal(parsed.type, type);
      assert.equal(parsed.label, `type: ${type}`);
      assert.equal(parsed.scope, null);
      assert.equal(parsed.breaking, false);
    }
  });

  test("accepts scope and breaking markers", () => {
    assert.deepEqual(parsePrTitle("feat(ui): add template search"), {
      type: "feat", label: "type: feat", scope: "ui", breaking: false,
    });
    assert.deepEqual(parsePrTitle("fix(overlay)!: restore trail"), {
      type: "fix", label: "type: fix", scope: "overlay", breaking: true,
    });
  });

  test("rejects missing, malformed, or unsupported types", () => {
    for (const title of ["add feature", "unknown: change", "feat : bad", "feat(): bad", "feat: "]) {
      assert.throws(() => parsePrTitle(title), /allowed Conventional Commit type/i);
    }
  });
  ```

- [ ] **Step 2: Run the parser test and verify it fails**

  Run:

  ```powershell
  node --test scripts/__tests__/pr-title.test.mjs
  ```

  Expected: FAIL because the parser module has not been implemented.

- [ ] **Step 3: Implement the parser with one canonical type-to-label map**

  Implement `scripts/pr-title.mjs` with a strict Conventional Commit header expression. It must accept `type: description`, `type(scope): description`, and either form with `!` immediately before the colon; scope must contain at least one non-whitespace character and description must contain non-whitespace text. Export the constants as frozen values so the workflow and tests cannot diverge in their list of types. Error messages must include the allowed type names.

- [ ] **Step 4: Run parser tests and add label reconciliation tests**

  Run:

  ```powershell
  node --test scripts/__tests__/pr-title.test.mjs
  ```

  Add pure helper coverage if the workflow implementation uses one: given existing labels `type: feat`, `type: fix`, and `bug`, the reconciliation must remove both stale `type:` labels, preserve `bug`, and add exactly the parsed label. Invalid titles must return a non-zero check result without adding a fallback label.

- [ ] **Step 5: Implement the trusted GitHub Actions workflow**

  Create `.github/workflows/pr-title.yml` with the following contract:

  - Trigger on `pull_request_target` for `opened`, `edited`, `synchronize`, and `reopened`.
  - Set permissions exactly to `contents: read`, `issues: write`, and `pull-requests: write`.
  - Checkout only the base branch/ref, not the PR merge ref; invoke the parser from the trusted base checkout. Do not install dependencies or execute code from the PR head.
  - Read the title from the event payload, parse it, list current PR labels through the GitHub API, remove every existing label whose name starts with `type: `, preserve all unrelated labels, and add the one canonical label for a valid title.
  - On invalid title, print the allowed types and exit non-zero before adding any type label. Use the workflow token for GitHub API calls and quote title/label values safely.
  - Make the check name stable and ensure reruns are idempotent.

  If an action implementation needs a small inline Node invocation, pass only event JSON values and trusted base source; do not interpolate untrusted title text into shell source. Keep parser policy in `scripts/pr-title.mjs` so local tests and CI share the same behavior.

- [ ] **Step 6: Wire the parser test into the root validation script**

  Update `package.json` so `validate:release` runs `scripts/__tests__/pr-title.test.mjs` alongside `scripts/__tests__/release.test.mjs`, `scripts/__tests__/desktop-release.test.mjs`, and `scripts/validate-desktop-release.mjs`. Run:

  ```powershell
  pnpm exec eslint scripts/pr-title.mjs scripts/release.mjs
  pnpm validate:release
  ```

  If the repository has no eslint command, omit only that unavailable command and rely on the Node test plus YAML contract tests; do not add an unrelated lint framework.

- [ ] **Step 7: Commit PR title classification**

  ```powershell
  git add .github/workflows/pr-title.yml package.json scripts/pr-title.mjs scripts/__tests__/pr-title.test.mjs
  git commit -m "feat: classify pull requests for release notes"
  ```

### Task 3: GitHub Release category configuration

**Files:**
- Create: `.github/release.yml`
- Modify: `scripts/validate-desktop-release.mjs`
- Modify: `scripts/__tests__/desktop-release.test.mjs` only if a focused test is more appropriate there
- Modify: `.github/workflows/desktop-release.yml` only if required to preserve the existing custom body plus generated notes contract

**Interfaces:**
- `.github/release.yml` is the single source of label-to-section mappings consumed by GitHub generated release notes.
- Existing `readProjectVersion(root)` continues to validate only Tauri, Desktop package, and Rust package; do not add Server to it. Task 1’s release-state reader owns the additional root package check.

- [ ] **Step 1: Write the release notes configuration contract test**

  Add a test path in `scripts/__tests__/release.test.mjs` or the existing `scripts/__tests__/desktop-release.test.mjs` that parses `.github/release.yml` with the existing `yaml` dependency and asserts the exact twelve mappings under GitHub's `changelog.categories[*].labels` schema:

  ```js
  const expected = {
    "type: feat": "✨ Features | 新功能",
    "type: fix": "🐛 Bug Fixes | Bug 修复",
    "type: chore": "🎫 Chores | 其他更新",
    "type: docs": "📝 Documentation | 文档",
    "type: style": "💄 Styles | 风格",
    "type: refactor": "♻ Code Refactoring | 代码重构",
    "type: perf": "⚡ Performance Improvements | 性能优化",
    "type: test": "✅ Tests | 测试",
    "type: revert": "⏪ Reverts | 回退",
    "type: build": "👷 Build System | 构建",
    "type: ci": "🔧 Continuous Integration | CI 配置",
    "type: config": "🔨 CONFIG | 配置",
  };
  const categories = releaseConfig.changelog?.categories ?? [];
  assert.equal(categories.length, 12);
  assert.deepEqual(
    Object.fromEntries(
      categories.map(({ labels, title }) => {
        assert.deepEqual(labels?.length, 1);
        return [labels[0], title];
      }),
    ),
    expected,
  );
  ```

  Also assert that the existing release job has `generate_release_notes: true`, still contains the installation/signing text in its body, still depends on the `assemble` job, and still runs only for `v*` tags. Assert the release-it config has `github.release === false` so no second GitHub Release is created.

- [ ] **Step 2: Run the new contract test and verify it fails**

  Run:

  ```powershell
  node --test scripts/__tests__/release.test.mjs scripts/__tests__/desktop-release.test.mjs
  ```

  Expected: FAIL because `.github/release.yml` and the new assertions do not yet exist.

- [ ] **Step 3: Add `.github/release.yml` with the approved twelve sections**

  Use GitHub's generated release notes configuration format with a `changelog.categories` list. Each entry must use a `labels` array containing the label generated by Task 2 and the exact bilingual title above. Add an `exclude` section only for labels that are explicitly outside the twelve type labels; do not exclude valid typed PRs or silently classify invalid PRs. The final YAML must use the hosted GitHub schema, not a locally invented shorthand.

- [ ] **Step 4: Preserve and validate the tag workflow behavior**

  Inspect `.github/workflows/desktop-release.yml` before editing. Keep `generate_release_notes: true` on `softprops/action-gh-release@v2`, keep its existing body text before generated notes, keep `push.tags: ["v*"]`, and keep release permissions at `contents: write` only where needed. If no edit is necessary, leave the workflow unchanged and enforce the behavior through `scripts/validate-desktop-release.mjs` and its tests. The validator should parse YAML and report a focused assertion when any of these contracts drift.

- [ ] **Step 5: Run the release notes and existing Desktop contracts**

  Run:

  ```powershell
  node --test scripts/__tests__/desktop-release.test.mjs scripts/__tests__/release.test.mjs
  node scripts/validate-desktop-release.mjs
  ```

  Expected: all local contract tests pass; output names the current Desktop version and expected artifacts. No live GitHub API call is required or implied.

- [ ] **Step 6: Commit generated release notes configuration**

  ```powershell
  git add .github/release.yml scripts/validate-desktop-release.mjs scripts/__tests__/desktop-release.test.mjs
  git commit -m "ci: configure categorized GitHub release notes"
  ```

### Task 4: Documentation and project status

**Files:**
- Modify: `docs/DESKTOP_RELEASE.md`
- Modify: `docs/MACOS_RELEASE.md`
- Modify: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Documentation must describe the commands and boundaries implemented by Tasks 1-3, not a second release mechanism.
- `docs/PROJECT_STATUS.md` records the current verification baseline and unresolved real-platform/live-service acceptance limits.

- [ ] **Step 1: Update the Desktop release guide around the actual command sequence**

  Replace manual three-file version editing instructions with this sequence:

  ```powershell
  pnpm install --frozen-lockfile
  pnpm release patch --dry-run
  pnpm validate:release
  pnpm release 0.2.0
  ```

  Explain that `patch`, `minor`, `major`, and full SemVer are explicit maintainer input; `feat` and `fix` only affect Release Notes sections. Explain that a real release creates `chore: release vX.Y.Z`, tag `vX.Y.Z`, and triggers `.github/workflows/desktop-release.yml`, while release-it itself does not create a GitHub Release or publish npm packages. State that the four Desktop version files are synchronized, Server is an independent private subproject, and shared/UI/SDK versions are independent.

- [ ] **Step 2: Document the generated Release Notes and PR title policy**

  State that the GitHub Release page is the only release log and the repository does not maintain `docs/CHANGELOG.md` for this workflow. Describe accepted PR titles with these examples:

  ```text
  feat(ui): add template search
  fix: prevent overlay flicker
  fix(overlay)!: restore trail
  ```

  Explain that the PR workflow maintains one `type:*` label and GitHub uses `.github/release.yml` to generate bilingual sections containing merged PR links and authors. Do not promise that direct commits without merged PRs appear in a typed section.

- [ ] **Step 3: Update the macOS guide without changing platform claims**

  Change only version/tag instructions: the release tag is produced by the root release command and must correspond to all four Desktop manifests. Keep macOS-specific universal bundle, ad-hoc signing, artifact, updater, and real-device acceptance requirements unchanged. Do not imply that Windows automation proves macOS acceptance.

- [ ] **Step 4: Record the release automation state in project status**

  Add a dated entry under the current status/history area that names the new release-it wrapper, PR label workflow, generated Release Notes configuration, and local validation commands. Record that live GitHub generated-body inspection and real Windows/macOS v0.2.0 artifact acceptance remain pending until a maintainer performs the tagged release and platform checks. Do not remove existing pending items or rewrite historical evidence.

- [ ] **Step 5: Check documentation and diff hygiene**

  Run:

  ```powershell
  rg -n "manual|three|CHANGELOG|release patch|release 0\.2\.0|Server|shared|GitHub Release" docs/DESKTOP_RELEASE.md docs/MACOS_RELEASE.md docs/PROJECT_STATUS.md
  git diff --check
  ```

  Confirm no guide instructs maintainers to manually edit only three Desktop files, no new `docs/CHANGELOG.md` content is introduced, and no claim describes local tests as a live GitHub or cross-platform release acceptance.

- [ ] **Step 6: Commit documentation and status updates**

  ```powershell
  git add docs/DESKTOP_RELEASE.md docs/MACOS_RELEASE.md docs/PROJECT_STATUS.md
  git commit -m "docs: document desktop release automation"
  ```

### Task 5: Release readiness verification

**Files:**
- Modify: none unless a preceding verification reveals a concrete contract defect; any such fix must be committed in the owning task’s domain.

**Interfaces:**
- Consumes the scripts, workflow files, package metadata, and documentation from Tasks 1-4.
- Produces an evidence-backed local readiness result; it does not create a release, tag, GitHub Release, Windows artifact, or macOS artifact.

- [ ] **Step 1: Install exactly from the lockfile**

  Run:

  ```powershell
  pnpm install --frozen-lockfile
  ```

  Expected: pnpm 10.34.5 completes without changing `pnpm-lock.yaml`; inspect `git status --porcelain=v1` if pnpm reports lockfile changes.

- [ ] **Step 2: Run focused release and repository contract tests**

  Run:

  ```powershell
  pnpm validate:release
  pnpm test:repository-layout
  ```

  Expected: release wrapper, PR parser, Desktop release workflow, Release Notes configuration, and repository layout contracts pass. Do not broaden this into unrelated full-repository tests solely because release tooling changed.

- [ ] **Step 3: Verify dry-run output and no version mutation**

  Run:

  ```powershell
  pnpm release patch --dry-run
  git diff -- package.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml
  git status --porcelain=v1
  ```

  Expected: the dry-run resolves `0.1.1` from the current `0.1.0` manifests, reports the `v0.1.1` tag/commit plan, and leaves the four files and worktree unchanged. Do not run `pnpm release 0.2.0` in local verification because that would create release state.

- [ ] **Step 4: Run affected package and Rust verification**

  Run:

  ```powershell
  pnpm --filter @godgesture/shared build
  pnpm --filter @godgesture/desktop typecheck
  pnpm --filter @godgesture/desktop test
  cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
  ```

  Record exact pass/fail results. A pre-existing Desktop typecheck failure must be identified as such with its existing error locations; do not call the release automation complete if a new release-tooling error is mixed into the result. Cargo and package commands must be run with the repository’s available toolchains.

- [ ] **Step 5: Inspect final scope and hand off release instructions**

  Run:

  ```powershell
  git status --porcelain=v1
  git log --oneline -12
  git diff HEAD~3..HEAD --stat
  ```

  Confirm every changed path belongs to this release automation effort and that all commits use English messages. Final handoff must include the dry-run and validation evidence, the exact command for the maintainer to publish v0.2.0 (`pnpm release 0.2.0`), and the fact that live tagged GitHub/Windows/macOS acceptance remains a separate step.

## Self-Review Checklist

- [x] The plan covers explicit `patch`/`minor`/`major`/full SemVer selection and rejects missing, invalid, equal, lower, and already-tagged releases.
- [x] The plan synchronizes root, Desktop package, Tauri, and Cargo versions while leaving Server/shared/UI/SDK versions independent.
- [x] The plan preserves a clean top-level worktree check and does not inspect Server’s internal package version.
- [x] The plan configures release-it to create only the release commit/tag and leaves GitHub Release creation to the existing tag workflow.
- [x] The plan covers all twelve PR types, accepted scope/breaking syntax, invalid-title failure, stale-label removal, and idempotent label assignment.
- [x] The plan uses `pull_request_target`, base-branch trusted code, and the required GitHub permissions.
- [x] The plan covers all twelve exact bilingual GitHub Release categories and preserves the existing custom release body plus generated notes.
- [x] The plan updates both release guides and `docs/PROJECT_STATUS.md` without changing historical changelog material.
- [x] Placeholder scan performed after writing: no `TBD`, `TODO`, “handle errors”, or undefined neighboring interfaces remain in the task steps.
- [x] Verification commands explicitly distinguish local contract checks from live GitHub and real Windows/macOS acceptance.

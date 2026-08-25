# Cargo.lock Release Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Desktop releases update `Cargo.lock` after `Cargo.toml`, and make every CI Cargo/build path reproducibly use `--locked`.

**Architecture:** Keep release-it as the release orchestrator. Its `after:bump` hook runs one unlocked Cargo check after the bumper updates `Cargo.toml`; release-it then commits the resulting lockfile with the other release files. CI remains read-only with explicit `--locked` flags, including forwarding `-- --locked` through Tauri CLI to Cargo.

**Tech Stack:** Node.js ESM tests with `node:test`, release-it 21, `@release-it/bumper`, Cargo/Tauri CLI, GitHub Actions YAML, Markdown project documentation.

## Global Constraints

- Do not rewrite the existing `v0.2.6` commit or tag.
- Synchronize the current main-branch `Cargo.lock` root package to `0.2.6` in this maintenance change.
- The release synchronization command must be `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` without `--locked`.
- All CI Cargo checks, tests, and clippy invocations must use `--locked`.
- Tauri release builds must forward `--locked` to Cargo using `-- --locked`.
- Do not modify `apps/server`, shared protocol files, database schema, or migrations.
- Use explicit `git add <path>` and English commit messages; do not push or create a release tag.

---

### Task 1: Add failing release and CI contract tests

**Files:**
- Modify: `scripts/__tests__/release.test.mjs:304-447`

**Interfaces:**
- Consumes: `.release-it.json`, `.github/workflows/desktop-release.yml`, `.github/workflows/macos-ci.yml`.
- Produces: Contract assertions that fail against the current configuration because the hook and locked flags are absent.

- [ ] **Step 1: Write the failing tests**

Extend the existing release configuration test to assert:

```js
assert.equal(
  config.hooks["after:bump"],
  "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib",
);
```

Update the Windows release test expected command to:

```js
"cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --release --locked"
```

Add a workflow contract test that parses both workflow files and asserts these exact commands:

```js
"cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked"
"cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --locked -- -D warnings"
"cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --target aarch64-apple-darwin --locked"
"cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-apple-darwin --locked"
```

Also assert the release build run strings contain `-- --locked` after the Tauri options.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```powershell
pnpm exec node --test scripts/__tests__/release.test.mjs
```

Expected: FAIL only because the current release config has no `after:bump` hook and the current workflow commands do not include the required locked arguments.

- [ ] **Step 3: Commit the red tests**

```powershell
git add scripts/__tests__/release.test.mjs
git commit -m "test: require locked Cargo release workflows"
```

### Task 2: Implement release hook and locked CI commands

**Files:**
- Modify: `.release-it.json:14-27`
- Modify: `.github/workflows/desktop-release.yml:59,75,188`
- Modify: `.github/workflows/macos-ci.yml:49-79`

**Interfaces:**
- Consumes: Task 1 contract assertions.
- Produces: A release-it hook that synchronizes the lockfile before the release commit, and locked Cargo invocations for Windows/macOS CI and release builds.

- [ ] **Step 1: Add the release-it hook**

Add this configuration beside the existing plugin configuration:

```json
"hooks": {
  "after:bump": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib"
}
```

The command must remain unlocked so Cargo can update the root package version in `Cargo.lock` after `Cargo.toml` is bumped.

- [ ] **Step 2: Add `--locked` to explicit Cargo CI commands**

Update the Windows release Rust test, all macOS CI test/check/clippy/performance commands, and both release workflow Tauri builds. Use `--locked` as a Cargo argument; for Tauri builds use the runner argument separator:

```text
pnpm --filter @godgesture/desktop tauri build --ci --target ... --bundles ... -- --locked
```

- [ ] **Step 3: Run the focused tests and verify they pass**

Run:

```powershell
pnpm exec node --test scripts/__tests__/release.test.mjs
```

Expected: PASS with the existing release tests and the new release/CI contract assertions.

- [ ] **Step 4: Commit the implementation**

```powershell
git add .release-it.json .github/workflows/desktop-release.yml .github/workflows/macos-ci.yml scripts/__tests__/release.test.mjs
git commit -m "fix: synchronize Cargo lock during releases"
```

### Task 3: Synchronize the current lockfile and update release documentation

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.lock:root godgesture package entry`
- Modify: `docs/DESKTOP_RELEASE.md:83-125`
- Modify: `docs/PROJECT_STATUS.md:current conclusion and recent verification`

**Interfaces:**
- Consumes: Task 2 release hook and locked CI contract.
- Produces: A main branch that passes locked Cargo validation and documents the five-file release flow.

- [ ] **Step 1: Run the same unlocked Cargo synchronization command**

Run:

```powershell
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

Expected: exit code 0 and `apps/desktop/src-tauri/Cargo.lock` root package `godgesture` version changes from `0.2.5` to `0.2.6`; no unrelated dependency changes are expected.

- [ ] **Step 2: Update the release guide**

Replace the statement that release synchronizes four Desktop version files with the five-file flow: the four manifests plus `Cargo.lock`. Document that release-it bumps `Cargo.toml`, runs the unlocked Cargo hook, and commits the generated lockfile; document that CI and Tauri release builds use `--locked`.

- [ ] **Step 3: Update project status**

Update the release capability statement from four Desktop version files to the Cargo.toml/Cargo.lock synchronized flow. Add a dated `2026-08-25` verification entry recording the current lockfile repair, release hook, locked CI contract, and any validation evidence available at that point. Preserve existing v0.2.6 history and state that its tag was not rewritten.

- [ ] **Step 4: Check the diff and commit the lock/documentation changes**

Run:

```powershell
git diff --check
git diff -- apps/desktop/src-tauri/Cargo.lock docs/DESKTOP_RELEASE.md docs/PROJECT_STATUS.md
```

Then commit explicitly:

```powershell
git add apps/desktop/src-tauri/Cargo.lock docs/DESKTOP_RELEASE.md docs/PROJECT_STATUS.md
git commit -m "docs: record Cargo lock release workflow"
```

### Task 4: Run fresh release and Cargo verification

**Files:**
- Read: `scripts/__tests__/release.test.mjs`
- Read: `.github/workflows/desktop-release.yml`
- Read: `.github/workflows/macos-ci.yml`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: Fresh evidence that release contracts and the current lockfile are valid.

- [ ] **Step 1: Run release validation**

Run:

```powershell
pnpm validate:release
```

Expected: all release contract tests pass and the repository release validator exits 0.

- [ ] **Step 2: Run locked Cargo validation**

Run:

```powershell
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked
```

Expected: both commands exit 0 without changing `Cargo.lock`.

- [ ] **Step 3: Verify repository state and scope**

Run:

```powershell
git status --porcelain=v1
git log --oneline -12
git diff HEAD~3..HEAD --stat
git tag --points-at HEAD
```

Expected: only the design, release tooling/CI/tests, lockfile, and documentation commits are present; no release tag is created and no server submodule change appears.

- [ ] **Step 4: Request code review before final handoff**

Provide the reviewer the base SHA immediately before Task 1 and the current HEAD, with the requirements that the hook runs after bumper, the hook is unlocked, every CI Cargo path is locked, the current lockfile matches `Cargo.toml`, and `v0.2.6` remains unchanged.

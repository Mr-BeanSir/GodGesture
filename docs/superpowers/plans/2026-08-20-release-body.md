# GitHub Release Body Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a fixed GitHub Release body with generated 12-category notes for direct commits and merged PRs, plus a `Full Changelog` compare link.

**Architecture:** The tag-only release job checks out the trusted repository script, queries the GitHub API for the previous non-draft release, compare commits, and merged PRs, and writes one generated notes body to `$GITHUB_OUTPUT`. The release action keeps `generate_release_notes: false` because the script covers both direct commits and PRs, avoiding a duplicate PR-only block.

**Tech Stack:** GitHub Actions YAML, `actions/github-script@v7`, `softprops/action-gh-release@v3`, Node.js built-in test runner, YAML contract validation.

## Global Constraints

- The release job remains tag-only for `v*` refs.
- The release job retains `contents: write` and adds `pull-requests: read`; build and assembly jobs keep their existing permissions.
- Windows/macOS assets, signing, checksums, install instructions, and artifact validation remain unchanged.
- No repository `docs/CHANGELOG.md` is introduced or maintained.
- `.github/release.yml` and PR title/type label automation remain unchanged in this task; the generator uses the same 12 approved types.
- Direct commits are classified by Conventional Commit prefix; PRs are classified from their title first, then their canonical `type:*` label.
- Commits listed on a merged PR and its `merge_commit_sha` are omitted from direct-commit sections so a change appears once.
- `scripts/generate-release-notes.mjs` uses only the workflow `github.token` and never writes a repository changelog.
- Update `docs/PROJECT_STATUS.md` and `docs/DESKTOP_RELEASE.md` because release body behavior changes.
- Do not push or stage unrelated existing worktree changes.

---

### Task 1: Lock the desired release workflow contract

**Files:**
- Modify: `scripts/__tests__/release.test.mjs`

**Interfaces:**
- Consumes: `.github/workflows/desktop-release.yml` parsed through the existing YAML test helper.
- Produces: A failing contract that requires the explicit release checkout, the notes generator step, `generate_release_notes: false`, and a body reference to its `body` output.

- [ ] **Step 1: Change the existing expectation first**

  In the existing release workflow contract test, keep the `generate_release_notes`
  assertion at `false`. Assert that the release job checks out with
  `token: ${{ github.token }}`, runs
  `node scripts/generate-release-notes.mjs --output "$GITHUB_OUTPUT"` with id
  `release-notes`, and passes `steps.release-notes.outputs.body` to the release action.

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

  ```powershell
  node --test scripts/__tests__/release.test.mjs
  ```

  Expected result: the workflow contract fails because the current workflow still
  uses the old `actions/github-script` previous-release resolver.

### Task 2: Implement the commit and PR Release Notes generator

**Files:**
- Create: `scripts/generate-release-notes.mjs`
- Test: `scripts/__tests__/release-notes.test.mjs`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `scripts/validate-desktop-release.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: The contract from Task 1 and the 12 type whitelist in `scripts/pr-title.mjs`.
- Produces: A testable generator that formats direct commits and merged PRs into
  categorized Markdown, de-duplicates PR commits, and writes a complete body output.

- [ ] **Step 1: Write the failing generator tests**

  Add tests for direct commit and PR title classification, unknown commits falling
  into Chores, no-previous-release commits fallback, and a fake API flow that verifies
  PR commits are removed from direct commit output.

- [ ] **Step 2: Run the generator tests to verify the expected RED failure**

  ```powershell
  node --test scripts/__tests__/release-notes.test.mjs
  ```

  Expected result: the test fails because `scripts/generate-release-notes.mjs` does
  not yet exist.

- [ ] **Step 3: Implement the pure formatter**

  Export `formatReleaseNotes({ repository, previousTag, currentTag, commits, pullRequests })`.
  It must emit `## 自动生成的 Release Notes`, omit empty categories, retain unknown
  commits in Chores, and finish with the compare or commits `Full Changelog` URL.

- [ ] **Step 4: Run the formatter tests to verify GREEN**

  ```powershell
  node --test scripts/__tests__/release-notes.test.mjs
  ```

- [ ] **Step 5: Add GitHub API collection and `$GITHUB_OUTPUT` writing**

  Query releases, compare commits, closed merged PRs, and each selected PR's commits
  with the workflow token. Include both each PR's commit SHAs and `merge_commit_sha`
  in the de-duplication set. Write the complete formatted body as a multiline `body`
  output. Filter `chore: release vX.Y.Z` from direct commit entries.

- [ ] **Step 6: Add checkout, artifact download, and generator workflow steps**

  Use `actions/checkout@v7` with `token: ${{ github.token }}`, `submodules: false`,
  and `fetch-depth: 1` before `actions/download-artifact@v8` so checkout cleanup
  cannot delete the downloaded artifacts. Then run the generator with
  `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, and `GITHUB_API_URL`.

- [ ] **Step 7: Update the standalone validator**

  Require the explicit checkout token, generator id/run/env, no previous-release
  resolver, `generate_release_notes === false`, and `steps.release-notes.outputs.body`.

- [ ] **Step 8: Run focused tests and verify GREEN**

  ```powershell
  node --test scripts/__tests__/release.test.mjs
  node scripts/validate-desktop-release.mjs
  ```

  Expected result: all focused release assertions pass.

### Task 3: Synchronize release documentation

**Files:**
- Modify: `docs/DESKTOP_RELEASE.md`
- Modify: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Consumes: The fixed-body workflow behavior.
- Produces: Documentation that no longer promises categorized generated sections
  in the tag release body and explains the `Full Changelog` link.

- [ ] **Step 1: Update the release notes section**

  State that the GitHub Release page uses fixed operational notes plus generated
  commit/PR categories and a compare link; explain why native GitHub generation is
  disabled and why no changelog file is maintained.

- [ ] **Step 2: Record the verification baseline**

  Add a dated project status entry describing the v0.2.1 root cause, generator tests,
  and the remaining live GitHub release verification boundary.

### Task 4: Run final verification

**Files:**
- Test: `scripts/__tests__/release.test.mjs`
- Verify: `pnpm validate:release`, `pnpm test:repository-layout`, `pnpm test`, `git diff --check`

**Interfaces:**
- Consumes: All workflow, validator, test, and documentation changes.
- Produces: Fresh evidence that the new body contract passes without regressions.

- [ ] **Step 1: Run the release contract**

  ```powershell
  pnpm validate:release
  ```

- [ ] **Step 2: Run the focused generator test**

  ```powershell
  node --test scripts/__tests__/release-notes.test.mjs
  ```

- [ ] **Step 3: Run repository layout and workspace tests**

  ```powershell
  pnpm test:repository-layout
  pnpm test
  ```

- [ ] **Step 4: Check whitespace and scoped files**

  ```powershell
  git diff --check
  git status --short
  ```

  Confirm no unrelated files are staged or modified by this task.

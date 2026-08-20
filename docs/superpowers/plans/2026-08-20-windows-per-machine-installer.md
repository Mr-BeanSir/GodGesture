# Windows Per-Machine Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows NSIS installer use one elevated per-machine installation mode with a `Program Files\GodGesture` default and a clean default after uninstall.

**Architecture:** Configure Tauri's NSIS target as `perMachine`, which supplies the `Program Files` default and `RequestExecutionLevel admin`. Add a small NSIS post-uninstall hook that removes the per-machine install-location registry record for real uninstalls while preserving it during `/UPDATE` runs. Do not inspect or migrate legacy `currentUser`/`HKCU` installations.

**Tech Stack:** Tauri 2.11 NSIS bundler, NSIS hook macros, JSON configuration, Node.js built-in test runner, pnpm release validation.

## Global Constraints

- Windows and macOS remain same-version release targets; this change is Windows installer behavior only and must not alter macOS configuration.
- The installer must request administrator permission because its default destination is `C:\Program Files\GodGesture`.
- Existing `currentUser` installations are intentionally out of scope and are not automatically migrated.
- A normal uninstall must clear the install-location metadata; an installer invoked with `/UPDATE` must preserve it.
- User data and runtime configuration must not be deleted by the install-location cleanup hook.
- Update `docs/PROJECT_STATUS.md` in the same change because the installation entry point and verification boundary change.
- Use explicit `git add <path>` if staging is later requested; do not push in this task.

---

### Task 1: Add the Windows installer contract test

**Files:**
- Create: `scripts/__tests__/windows-installer.test.mjs`

**Interfaces:**
- Consumes: `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/installer-hooks.nsh`.
- Produces: A repeatable repository contract that fails unless the NSIS target is `perMachine`, points at the hook, and the hook preserves install metadata only during updates.

- [ ] **Step 1: Write the failing test**

  Read the Tauri config and hook as text. Assert that `bundle.windows.nsis.installMode` is `perMachine`, that `installerHooks` equals `installer-hooks.nsh`, that the hook defines `NSIS_HOOK_POSTUNINSTALL`, that it guards cleanup with `$UpdateMode <> 1`, and that it deletes the per-machine `MANUPRODUCTKEY` registry key. Also assert that the hook does not contain `HKCU` or recursive removal commands so it cannot silently migrate or delete user data.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run:

  ```powershell
  node --test scripts/__tests__/windows-installer.test.mjs
  ```

  Expected result before implementation: the test fails because `bundle.windows` and/or `installer-hooks.nsh` do not exist in the current configuration.

### Task 2: Configure and implement the per-machine NSIS behavior

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/installer-hooks.nsh`
- Modify: `package.json`

**Interfaces:**
- Consumes: The contract from `scripts/__tests__/windows-installer.test.mjs`.
- Produces: A Tauri NSIS bundle with `RequestExecutionLevel admin`, a `Program Files\GodGesture` default, and uninstall metadata cleanup that is skipped for `/UPDATE`.

- [ ] **Step 1: Add the minimal Tauri configuration**

  Add this object under `bundle` without changing the macOS override:

  ```json
  "windows": {
    "nsis": {
      "installMode": "perMachine",
      "installerHooks": "installer-hooks.nsh"
    }
  }
  ```

- [ ] **Step 2: Add the post-uninstall hook**

  Create `installer-hooks.nsh` with this behavior:

  ```nsh
  !macro NSIS_HOOK_POSTUNINSTALL
    ${If} $UpdateMode <> 1
      DeleteRegKey HKLM "${MANUPRODUCTKEY}"
    ${EndIf}
  !macroend
  ```

  This removes only the per-machine install-location metadata after a real uninstall. It does not remove application data, and `/UPDATE` retains the location for the next installer invocation.

- [ ] **Step 3: Run the focused test and verify it passes**

  Run:

  ```powershell
  node --test scripts/__tests__/windows-installer.test.mjs
  ```

  Expected result: all Windows installer contract assertions pass.

- [ ] **Step 4: Include the contract in release validation**

  Add `scripts/__tests__/windows-installer.test.mjs` to the existing `validate:release` Node test command so every release candidate checks the installer mode and hook.

### Task 3: Record the new release and platform boundary

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/DESKTOP_RELEASE.md`

**Interfaces:**
- Consumes: The implemented Tauri/NSIS configuration.
- Produces: Current project status and release instructions that state the actual Windows install mode and its intentional legacy-install boundary.

- [ ] **Step 1: Update project status**

  Add a dated status entry stating that Windows NSIS now uses per-machine installation, defaults to `C:\Program Files\GodGesture`, requests UAC, clears install-location metadata on normal uninstall, and does not auto-migrate old `currentUser` installations. Keep macOS native installation verification marked pending where it already is.

- [ ] **Step 2: Update desktop release documentation**

  Add a Windows installer subsection explaining that new releases install per-machine, future per-machine upgrades reuse the recorded directory, and users with pre-existing legacy `currentUser` installs must uninstall that legacy copy before installing the per-machine release. State that user data is outside this installer-path cleanup.

### Task 4: Verify the release boundary

**Files:**
- Test: `scripts/__tests__/windows-installer.test.mjs`
- Test: `scripts/__tests__/desktop-release.test.mjs`
- Test: `scripts/__tests__/repository-layout.test.mjs`
- Verify: `pnpm validate:release`, `pnpm test:repository-layout`, `pnpm test`, `git diff --check`

**Interfaces:**
- Consumes: All configuration, hook, and documentation changes.
- Produces: Fresh evidence that the Windows release contract still passes and no unrelated repository layout or test regressions were introduced.

- [ ] **Step 1: Run the focused contract test**

  ```powershell
  node --test scripts/__tests__/windows-installer.test.mjs
  ```

- [ ] **Step 2: Run release and repository contract validation**

  ```powershell
  pnpm validate:release
  pnpm test:repository-layout
  ```

- [ ] **Step 3: Run the repository test suite**

  ```powershell
  pnpm test
  ```

  Record any pre-existing failures separately; do not attribute unrelated failures to this installer change without evidence.

- [ ] **Step 4: Check the final diff for whitespace errors and scope**

  ```powershell
  git diff --check
  git status --short
  ```

  Confirm only the planned installer, contract-test, plan, and documentation files changed.

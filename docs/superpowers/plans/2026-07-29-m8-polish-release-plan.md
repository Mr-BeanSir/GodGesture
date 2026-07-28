# M8 Polish And Release Implementation Plan

Date: 2026-07-29
Design: `docs/superpowers/specs/2026-07-29-m8-polish-release-design.md`

## 1. Production Coordinates And Release Contract

Files:

- update `apps/desktop/src-tauri/tauri.conf.json`;
- update `apps/desktop/src-tauri/src/updater.rs`;
- update `apps/desktop/src/templates/source.ts`;
- update `apps/desktop/src/views/AboutView.vue` and `TemplatesView.vue`;
- update `distribution/gesture-templates/catalog.json` and its README;
- extend `scripts/validate-desktop-release.mjs` and focused tests.

Work:

- replace every production placeholder with `Mr-BeanSir/GodGesture` or
  `Mr-BeanSir/gesture-templates` while preserving build-time overrides;
- statically reject the old `github.com/godgesture/*` coordinates in product
  configuration, runtime defaults, template assets, and user-facing links;
- add pure release-mode derivation for manual, prerelease, and stable refs;
- add deterministic `release-evidence.json` assembly with repository, commit,
  version, ref, release mode, asset names, and verified SHA-256 values;
- cover RC/stable mode, evidence determinism, missing commit, and coordinate
  drift in release tests.

Verify:

```powershell
pnpm validate:release
pnpm validate:templates
pnpm --filter @godgesture/desktop test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

Commit: `build: prepare M8 production release contract`

## 2. Pre-release-aware GitHub Workflow

Files:

- update `.github/workflows/desktop-release.yml`;
- update `scripts/desktop-release.mjs`;
- update `scripts/__tests__/desktop-release.test.mjs`;
- update `docs/DESKTOP_RELEASE.md`.

Work:

- pass the exact Git commit into release assembly and publish the evidence file;
- mark SemVer-suffixed tags such as `v0.1.0-rc.1` as prereleases and never
  latest, while stable tags remain normal latest Releases;
- retain the same asset, signature, checksum, permission, platform, and tag
  gates for both release modes;
- link release notes to the user guide and preserve truthful Windows/macOS
  signing and permission warnings;
- statically verify job ordering, permissions, expressions, evidence fields,
  platform assets, and absence of Apple credentials.

Verify:

```powershell
pnpm validate:release
```

Commit: `build: distinguish prerelease desktop builds`

## 3. Quick Guide State And Navigation

Files:

- add `apps/desktop/src/onboarding/quick-guide.ts`;
- add `apps/desktop/src/onboarding/__tests__/quick-guide.test.ts`;
- update `apps/desktop/src/App.vue`;
- update `apps/desktop/src/views/OptionsView.vue`;
- update `apps/desktop/src/views/AboutView.vue`.

Work:

- implement a versioned, injected-storage quick-guide state helper that fails
  open when local storage is unavailable;
- show the guide only after configuration loads on first interactive use;
- allow `?guide=1` in browser preview for deterministic QA and allow About to
  reopen the guide permanently;
- centralize the existing WGestures import dialog at the App shell so both
  Options and the guide can open the same component instance;
- route guide actions to Gestures, Templates, or WGestures import without
  duplicating feature editors or mutating configuration.

Verify:

```powershell
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
```

Commit: `feat(desktop): add quick guide navigation`

## 4. Quick Guide UI And Localization

Files:

- add `apps/desktop/src/components/QuickStartDialog.vue`;
- update `apps/desktop/src/App.vue`;
- update `apps/desktop/src/locales/zh-CN.ts` and `en.ts`;
- extend locale parity tests.

Work:

- implement Ready, Try, and Personalize steps with a stable dialog footprint;
- show real platform/gesture-engine readiness through the existing backend;
- reuse macOS permission request and System Settings commands;
- derive Try examples from current Global App intents and render existing
  gesture mnemonics without starting capture or changing configuration;
- provide direct Gestures, Templates, and WGestures import commands;
- support keyboard dismissal, minimum viewport, Chinese/English, and light/dark
  themes with no nested cards, horizontal overflow, or hard-coded UI strings.

Verify:

```powershell
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
```

Commit: `feat(desktop): complete first-run quick guide`

## 5. Final User Documentation

Files:

- rewrite `README.md` as the public product entry point;
- replace the template text in `apps/desktop/README.md`;
- add `docs/USER_GUIDE.md`;
- add `docs/qa/M8_RELEASE_ACCEPTANCE.md`;
- update `docs/DESKTOP_RELEASE.md` and `docs/MACOS_RELEASE.md` where needed.

Work:

- document download, installation, first gesture, quick guide, App intents,
  templates, import, pause, optional account/sync, updates, logs, and uninstall;
- distinguish updater minisign verification from Authenticode and Apple trust;
- document SmartScreen, ad-hoc DMG, Finder Open/Open Anyway, and separate TCC
  permissions accurately;
- create an evidence table whose rows require exact commands, URLs, hashes,
  observations, and pass/fail/deferred status;
- pre-mark only owner-approved physical-Mac observations as deferred and leave
  all runtime/release rows unclaimed until observed.

Verify:

```powershell
rg -n "godgesture/godgesture|godgesture/gesture-templates" README.md apps docs distribution
git diff --check
```

Commit: `docs: add M8 user and acceptance guides`

## 6. Browser Visual Acceptance And Product Regression

Evidence:

- store screenshots and DOM measurements under
  `%TEMP%\godgesture-m8-qa\quick-guide`;
- record exact preview commit and commands in the acceptance document.

Work:

- start one Desktop preview session after checking the fixed ports and exact
  GodGesture/Node process tree;
- open the forced guide state and About reopen path in Chinese/English and
  light/dark at `980x700` and `800x560`;
- exercise all three destinations, Back/Next/close, macOS mock readiness, and
  WGestures import opening;
- inspect screenshots, DOM bounds, page/dialog overflow, translations, focus,
  and stable dimensions;
- rerun affected Desktop, Rust, template, and release validation.

Verify:

```powershell
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
pnpm validate:templates
pnpm validate:release
```

Commit: `docs: record M8 product acceptance`

## 7. Template Repository Publication

External state:

- create public `Mr-BeanSir/gesture-templates`;
- publish the validated seed on its default branch;
- create an initial tagged Release with exactly `catalog.json`,
  `global-window-basics.json`, and `browser-window-basics.json`.

Work:

- validate the seed immediately before publication;
- use browser-authenticated GitHub operations without exposing credentials;
- fetch the public release catalog and packages through their production URLs;
- parse and verify them with the same shared protocol used by Desktop;
- record repository, commit, tag, Release, asset URLs, and live validation
  output in `docs/qa/M8_RELEASE_ACCEPTANCE.md`.

Verify:

```powershell
pnpm validate:templates
```

Commit after evidence: `docs: record template repository publication`

## 8. Updater Key And Manual Workflow Rehearsal

Files and external state:

- create a password-protected private key outside the repository;
- replace only the public key in `apps/desktop/src-tauri/tauri.conf.json`;
- configure `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository Secrets;
- update the acceptance record without secret values or sensitive paths.

Work:

- generate a fresh key because no public release or installed public client
  exists for the old unreleased public key;
- restrict local private-key access to the current user and establish an
  encrypted recoverable copy outside the working tree;
- run release validation and commit the public-key change;
- push only the reviewed commits required for GitHub Actions;
- dispatch the release workflow manually, require all build/assembly jobs to
  pass, download the combined artifact, and independently verify all assets,
  signatures, hashes, PE x64 architecture, macOS runner evidence, and manifest.

Verify:

```powershell
pnpm validate:release
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

Commit: `build: install production updater key`

## 9. RC Release And Windows Installation

Files and external state:

- set `0.1.0-rc.1` in Tauri, npm, and Cargo metadata;
- update lockfile metadata only if Cargo requires it;
- push the reviewed commit and annotated `v0.1.0-rc.1` tag;
- update the acceptance record after observations.

Work:

- run the complete affected baseline before tagging;
- require the GitHub Release to be prerelease, not latest, and to contain the
  exact deterministic assets plus `latest.json` and release evidence;
- independently verify public download hashes and URLs;
- install the public Windows NSIS package and record SmartScreen, launch,
  version, default gestures, settings persistence, tray, quick guide, and
  administrator-start behavior;
- retain installed RC configuration as the stable updater source and clean
  only temporary acceptance files that are not evidence.

Verify:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm validate:templates
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
pnpm validate:release
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
```

Commits: `build: prepare GodGesture 0.1.0-rc.1`, then
`docs: record 0.1.0 release candidate acceptance`

## 10. Stable Release And Installed Updater Smoke

Files and external state:

- set `0.1.0` in Tauri, npm, and Cargo metadata;
- include only RC defect fixes and final release notes;
- push the reviewed commit and annotated `v0.1.0` tag;
- finalize `docs/qa/M8_RELEASE_ACCEPTANCE.md`.

Work:

- rerun the complete baseline and release contract before tagging;
- require stable GitHub Release/latest state and exact public artifacts;
- from the installed RC, check for `0.1.0`, download/install in-app, observe
  restart, and confirm version, configuration, tray, quick guide state, and
  gesture behavior survived;
- independently verify stable public checksums, updater signatures, manifest,
  evidence JSON, Windows PE x64, macOS slices/ad-hoc/DMG runner results, and
  all asset URLs;
- record physical-Mac Gatekeeper/TCC/installed-update rows as
  `DEFERRED (owner-approved)` with the M4 checklist link, not as passed.

Verify:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm validate:templates
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
pnpm validate:release
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
```

Commits: `build: release GodGesture 0.1.0`, then
`docs: record stable updater acceptance`

## 11. Completion Audit And Handoff

Files:

- update `docs/PROJECT_STATUS.md`;
- update `docs/ROADMAP.md`;
- replace `docs/HANDOFF.md` with the final M8 handoff;
- finalize the acceptance record.

Work:

- audit every M8 design and roadmap requirement against repository, workflow,
  Release, asset, checksum, screenshot, test, and runtime evidence;
- update test counts only from actual final reruns;
- mark M8 complete only if every non-deferred row is proved;
- preserve the M4 boundary and identify every remaining physical-Mac item;
- verify the worktree contains only the owner's untouched untracked file;
- do not push the final documentation commit unless another workflow run
  genuinely requires it.

Verify:

```powershell
git diff --check c7de3ee..HEAD
git status --porcelain=v1
git log --oneline -12
```

Commit: `docs: complete M8 release handoff`

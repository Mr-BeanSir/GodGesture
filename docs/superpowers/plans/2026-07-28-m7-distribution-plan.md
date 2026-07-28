# M7 Desktop Distribution Implementation Plan

Date: 2026-07-28
Design: `docs/superpowers/specs/2026-07-28-m7-distribution-design.md`

## 1. Shared Template Protocol And Adoption Planner

Files:

- add `packages/shared/src/templates/protocol.ts`;
- add `packages/shared/src/templates/adoption.ts`;
- add focused tests under `packages/shared/src/templates/__tests__/`;
- export the public contract from `packages/shared/src/index.ts`.

Work:

- define strict, bounded catalog, package, localized metadata, target, and
  template-intent schemas;
- enforce pre-parse UTF-8 byte limits and HTTPS-only package URLs;
- implement package/catalog identity verification and command-risk summaries;
- implement pure App target resolution, gesture conflict detection, fresh UUID
  allocation, keep/replace policies, deterministic ordering, complete-document
  validation, and 256 KiB rejection;
- cover valid data and every fail-closed branch with unit tests.

Verify:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
```

Commit: `feat(shared): define gesture template distribution`

## 2. Standalone Template Repository Seed

Files:

- add `distribution/gesture-templates/README.md`;
- add catalog and package JSON under `distribution/gesture-templates/`;
- add a validator script under `scripts/`;
- add root package scripts only where needed for repeatable validation.

Work:

- seed one low-risk global package and one dual-platform App package;
- make catalog URLs match the default independent repository release layout;
- validate every source file through the built shared schemas and cross-check
  catalog/package identity and versions;
- keep the seed self-contained enough to initialize the independent repository
  without introducing a nested Git repository.

Verify:

```powershell
pnpm validate:templates
pnpm --filter @godgesture/shared test
```

Commit: `feat(templates): seed gesture template repository`

## 3. Native Updater Boundary

Files:

- add `apps/desktop/src-tauri/src/updater.rs` and unit tests;
- update `apps/desktop/src-tauri/src/lib.rs`, `Cargo.toml`, and `Cargo.lock`;
- update Tauri configuration for updater artifacts and the public key;
- update `apps/desktop/src/api/backend.ts` and browser mock behavior.

Work:

- register `tauri-plugin-updater` with a fixed public verification key;
- expose typed check, cancel, and install commands with progress events;
- serialize check/install operations and preserve one pending update;
- select Windows x64 and universal macOS manifest targets deterministically;
- enforce HTTPS endpoints, structured stable errors, and bounded progress;
- generate the release signing key outside the repository, commit only its
  public key, and document the private-key handoff path.

Verify:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop test
```

Commit: `feat(desktop): add signed native updater`

## 4. Desktop Template And Update State

Files:

- add focused modules under `apps/desktop/src/templates/`;
- add `apps/desktop/src/stores/templates.ts` and `stores/update.ts`;
- extend `apps/desktop/src/stores/config.ts` with an atomic template barrier;
- add corresponding unit tests and fixture adapters.

Work:

- fetch catalog/packages with timeouts, byte limits, redirect/HTTPS checks, and
  shared-schema parsing;
- use local validated fixture data in browser preview;
- model list, filter, detail, adoption plan, conflict choice, confirmation,
  retry, update check, update progress, and failure states;
- deduplicate automatic/manual update checks and flush config before install;
- ensure an adopted template follows normal M6 local-save and sync behavior.

Verify:

```powershell
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
```

Commit: `feat(desktop): add template and update state`

## 5. Desktop UI And Localization

Files:

- add `apps/desktop/src/views/TemplatesView.vue` and focused components;
- update `apps/desktop/src/App.vue` and `views/AboutView.vue`;
- update both locale files and locale parity tests;
- add environment examples for configurable public origins.

Work:

- add a compact top-level Template Library navigation item;
- implement catalog filtering, rows, empty/loading/error states, detail preview,
  risk disclosure, conflict selection, and atomic adoption confirmation;
- replace the About placeholder with current/update states, release notes,
  progress, retry, and install controls;
- trigger one delayed automatic check only when the synced preference is on;
- preserve existing Element Plus conventions and responsive minimum-window
  behavior without nested cards or hard-coded visible strings.

Verify:

```powershell
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
```

Commit: `feat(desktop): complete M7 distribution UI`

## 6. Cross-Platform Release Workflow

Files:

- replace the macOS-only release workflow with a desktop release workflow;
- add a deterministic manifest assembly/validation script and focused tests;
- update release documentation and environment/secret guidance.

Work:

- build Windows x64 NSIS and macOS universal app/DMG/updater artifacts;
- retain all existing free macOS ad-hoc, dual-architecture, DMG, and checksum
  checks;
- require updater signing secrets and validate `.sig` contents;
- aggregate deterministic assets into Tauri v2 `latest.json` with complete
  Windows and custom universal-macOS platform entries;
- publish only for matching `v*` tags and retain artifacts for manual runs;
- statically test triggers, permissions, version gates, platform keys, secret
  use, release conditions, and the absence of Apple credentials.

Verify:

```powershell
pnpm validate:release
pnpm --filter @godgesture/desktop build
```

Commit: `build: publish signed desktop updates`

## 7. Visual Acceptance, Regression, And Status

Files:

- update `docs/PROJECT_STATUS.md`, `docs/ROADMAP.md`, and release guidance;
- add a compact final handoff only after the completion audit.

Work:

- run browser preview against the validated local template catalog;
- inspect Template Library and About/update states in Chinese and English,
  light and dark, at 980x700 and 800x560;
- verify screenshots and DOM dimensions show no overflow, overlap, clipping,
  inaccessible commands, translation-key leakage, or nested-card composition;
- run every affected shared, Desktop, Rust, template, and workflow check;
- audit M7 requirements against implementation evidence, retain M4 boundaries,
  and record first tagged/live installed-update smoke as M8 acceptance.

Verify:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
pnpm validate:templates
pnpm validate:release
git diff --check 06374ac..HEAD
```

Commit: `docs: record M7 distribution completion`

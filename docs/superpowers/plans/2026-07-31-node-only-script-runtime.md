# Node-only Script Runtime Implementation Plan

## Scope

Implement the approved design in
`docs/superpowers/specs/2026-07-31-node-only-script-runtime-design.md` while
preserving unrelated working-tree edits. QuickJS remains executable until the
Node performance gate passes on Windows and macOS.

## 1. Persistent Host Prototype and Performance Gate

- Add a minimal Node supervisor and persistent Worker using a framed JSON
  protocol over stdio.
- Add a Rust client that starts the host once, preloads a no-op plugin, dispatches
  ordered events, handles host calls and shuts down cleanly.
- Add protocol tests for partial frames, invalid messages, request correlation,
  ordering, timeout, worker crash and host restart.
- Add a release-mode benchmark command that records cold start, warm no-op and
  representative host-call percentiles for 10,000 events.
- Record Windows evidence immediately. Add the same benchmark to the macOS CI
  and real-device acceptance path; do not remove QuickJS before both platforms
  meet the approved p95/p99 limits.

## 2. Shared Plugin Protocol

- Add bounded Node plugin, source-file, manifest, lockfile and command schemas.
- Raise the whole-document limit to 4 MiB and add at most 32 plugins, 64 files,
  256 KiB per file and 1 MiB source per plugin.
- Update Rust mirrors, config migration, mocks, templates, sync validation,
  OpenAPI artifacts and all consumers in the same protocol change.
- Convert legacy JavaScript command slots into generated Node modules only after
  a successful test; preserve Lua as non-executable source.

## 3. Production Node Host and SDK

- Turn the prototype into the supervised Desktop service and route all five
  lifecycle handlers through per-plugin persistent Workers.
- Implement `@godgesture/sdk` async input, window, clipboard, status and context
  APIs with no native handle exposure.
- Keep native hooks non-blocking, bound event queues, serialize per plugin and
  recover from worker/host failure with stable diagnostics.
- Add Windows and macOS host adapters and contract tests.

## 4. Bundled Toolchain and Package Management

- Pin Node.js LTS and pnpm versions, verify downloaded release hashes and bundle
  platform/architecture sidecars in Desktop artifacts.
- Use only the bundled runtime and pnpm; ignore PATH and global npm state.
- Add deterministic install/update/remove operations, exact lockfiles, local
  cache keys, offline readiness and explicit lifecycle-script approval.
- Verify pure JS/WASM packages and report native-addon prebuild incompatibility
  without requiring a compiler toolchain.

## 5. Plugin Editor

- Add a dedicated plugin workspace with file tree, Monaco tabs, Node and SDK
  types, Problems, output and package management.
- Add gesture command selection by plugin and export, plus one-click conversion
  from the existing script editor.
- Keep the one-file path compact and reveal manifests/dependencies only when
  required.
- Add bilingual copy, minimum-window layout checks and browser/Tauri behavior
  tests.

## 6. Migration, QuickJS Removal and Documentation

- Run the approved Windows and macOS performance/behavior acceptance matrix.
- Make Node the only executable JavaScript runtime only after both gates pass;
  then remove rquickjs, the old host adapters and obsolete Monaco declarations.
- Complete automatic config migration and actionable handling for unconverted
  legacy scripts.
- Publish `docs/SCRIPTING.md` covering project structure, Node/npm, SDK,
  lifecycle, debugging, distribution, trust, examples and migration.
- Update `CONTEXT.md`, `docs/PROJECT_STATUS.md`, ADR status and release/QA
  documentation with observed evidence.

## Verification Baseline

- shared tests, build and API drift checks;
- Desktop tests, typecheck and production build;
- Rust library/integration tests and clippy with warnings denied;
- Node host protocol tests and release benchmark artifacts;
- package installation/offline cache tests;
- Windows runtime smoke and macOS CI plus real-device smoke;
- targeted formatting and `git diff --check`.

## Commit Boundaries

1. `docs: plan node runtime implementation`
2. `feat: prototype persistent node script host`
3. `feat: add node plugin configuration`
4. `feat: run scripts in bundled node host`
5. `feat: manage node plugin dependencies`
6. `feat: add node plugin workspace`
7. `refactor: remove quickjs script runtime`
8. `docs: publish node scripting guide`

Every commit uses explicit path staging and excludes the maintainer's existing
deleted documents, `.superpowers/` directory and unrelated Rust formatting.
No push is performed.

# M8 Release Acceptance

Last updated: 2026-07-29.

This document records observed M8 evidence. `PASS` requires the exact command,
URL, artifact, or runtime observation named in the row. `DEFERRED
(owner-approved)` is allowed only for the physical-macOS boundary described in
the M8 design; it is not a pass.

## Release Identity

| Field | Evidence |
| --- | --- |
| Product implementation commit | `99f5b65` (quick guide), `4038551` (visual and modal acceptance fixes); later release commits pending |
| RC tag / commit | NOT RUN |
| Stable tag / commit | NOT RUN |
| Manual workflow run | NOT RUN |
| RC workflow run / Release | NOT RUN |
| Stable workflow run / Release | NOT RUN |
| Template repository commit / Release | NOT RUN |

## Local Automated Baseline

| Check | Evidence | Status |
| --- | --- | --- |
| Desktop tests | `pnpm --filter @godgesture/desktop test`: 88/88 on 2026-07-29 | PASS |
| Desktop typecheck | `pnpm --filter @godgesture/desktop typecheck` on 2026-07-29 | PASS |
| Desktop build | `pnpm --filter @godgesture/desktop build` on 2026-07-29; existing VueUse/chunk warnings only | PASS |
| Release validation | `pnpm validate:release`: 10/10 plus static workflow contract on 2026-07-29 | PASS |
| Template validation | `pnpm validate:templates`: 2 packages on 2026-07-29 | PASS |
| Rust updater tests | `cargo test ... --lib updater::tests`: 6/6 on 2026-07-29 | PASS |
| Product acceptance regression | Desktop 88/88 + typecheck/build; release 10/10 + workflow contract; templates 2/2; Rust library 152 passed + 1 ignored on 2026-07-29 at `4038551` | PASS |
| Final full affected baseline | NOT RUN | NOT RUN |

## Quick Guide Visual Acceptance

Evidence directory: `%TEMP%\godgesture-m8-qa\quick-guide`.

| View | Locale / theme / viewport | Evidence | Status |
| --- | --- | --- | --- |
| Ready | zh-CN + en, light + dark, 980x700 + 800x560 | 8 `*-step1.png` captures; compact right-aligned Next button and runtime-ready state visually inspected | PASS |
| Try | zh-CN + en, light + dark, 980x700 + 800x560 | 8 `*-step2.png` captures; stable dialog footprint and reachable Back/Next controls | PASS |
| Personalize | zh-CN + en, light + dark, 980x700 + 800x560 | 8 `*-step3.png` captures; three entry points and Back/Finish controls visible | PASS |
| About reopen and all destinations | minimum viewport | `%TEMP%\godgesture-m8-qa\quick-guide\acceptance-summary.json`: About reopen, Gestures, Templates, WGestures import, Back/Next, and Escape close observed; automatic update prompt waited for the guide/import dialog and appeared after import closed | PASS |
| DOM overflow / overlap / translation scan | all captures | `%TEMP%\godgesture-m8-qa\quick-guide\dom-report.json`: 24/24 cases, one visible overlay, zero page overflow, zero out-of-viewport dialog descendants, and zero translation-key leaks; dialog `620x501`, positioned at `(180, 99.5)` or `(90, 29.5)` | PASS |

## Template Repository

| Requirement | Evidence | Status |
| --- | --- | --- |
| Public `Mr-BeanSir/gesture-templates` repository | NOT RUN | NOT RUN |
| Tagged Release with exactly three assets | NOT RUN | NOT RUN |
| Live catalog HTTPS/schema validation | NOT RUN | NOT RUN |
| Live package identity/risk validation | NOT RUN | NOT RUN |

## Updater Key And Manual Rehearsal

| Requirement | Evidence | Status |
| --- | --- | --- |
| New public key committed before any public release | NOT RUN | NOT RUN |
| Private key and password installed as GitHub Secrets | NOT RUN; never record values | NOT RUN |
| Encrypted recoverable backup confirmed outside worktree | NOT RUN; never record sensitive path or value | NOT RUN |
| Manual workflow all build/assembly jobs | NOT RUN | NOT RUN |
| Downloaded combined artifact independently verified | NOT RUN | NOT RUN |

## RC Release And Windows Installation

| Requirement | Evidence | Status |
| --- | --- | --- |
| `v0.1.0-rc.1` is prerelease and not latest | NOT RUN | NOT RUN |
| Exact assets, checksums, signatures, manifest, evidence JSON | NOT RUN | NOT RUN |
| Windows x64 PE and NSIS SHA-256 | NOT RUN | NOT RUN |
| SmartScreen observation | NOT RUN | NOT RUN |
| Installed version and launch | NOT RUN | NOT RUN |
| Quick guide, default gestures, config persistence, tray | NOT RUN | NOT RUN |
| Windows administrator-start boundary | NOT RUN | NOT RUN |

## Stable Release And Windows Updater

| Requirement | Evidence | Status |
| --- | --- | --- |
| `v0.1.0` is stable and latest | NOT RUN | NOT RUN |
| Exact assets, checksums, signatures, manifest, evidence JSON | NOT RUN | NOT RUN |
| Installed RC discovers stable `0.1.0` | NOT RUN | NOT RUN |
| In-app download, signature verification, install, restart | NOT RUN | NOT RUN |
| Version, config, tray, quick-guide state, gestures preserved | NOT RUN | NOT RUN |

## macOS Release Evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| RC/stable universal `arm64` + `x86_64` slices | NOT RUN | NOT RUN |
| Strict ad-hoc `codesign` verification | NOT RUN | NOT RUN |
| DMG `hdiutil verify` and app layout | NOT RUN | NOT RUN |
| Updater archive, minisign, SHA-256, manifest mapping | NOT RUN | NOT RUN |
| Physical-Mac Gatekeeper manual approval | No physical Mac in this run; see `docs/qa/M4_MACOS_SMOKE.md` | DEFERRED (owner-approved) |
| Physical-Mac TCC and gesture runtime | No physical Mac in this run; see `docs/qa/M4_MACOS_SMOKE.md` | DEFERRED (owner-approved) |
| Installed macOS RC-to-stable updater | No physical Mac in this run | DEFERRED (owner-approved) |

## Cleanup And Completion

| Requirement | Evidence | Status |
| --- | --- | --- |
| Temporary installers/config/tasks cleaned or retained explicitly | NOT RUN | NOT RUN |
| User-owned `接手提示词.md` untouched | Worktree audit required at completion | NOT RUN |
| `docs/PROJECT_STATUS.md`, `ROADMAP.md`, `HANDOFF.md` finalized | NOT RUN | NOT RUN |
| Requirement-by-requirement completion audit | NOT RUN | NOT RUN |

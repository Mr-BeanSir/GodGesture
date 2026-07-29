# M8 Release Acceptance

Last updated: 2026-07-29.

This document records observed M8 evidence. `PASS` requires the exact command,
URL, artifact, or runtime observation named in the row. `DEFERRED
(owner-approved)` is allowed only for the physical-macOS boundary described in
the M8 design; it is not a pass.

## Release Identity

| Field | Evidence |
| --- | --- |
| Product implementation commit | `99f5b65` (quick guide), `4038551` (visual and modal acceptance fixes), `cc2fcb6` (cross-platform corner command dispatch), `ac31e42` / `c849d10` (macOS updater verification and executable casing) |
| RC tag / commit | Annotated `v0.1.0-rc.1` -> `880f1178e44410aaa59acadf6454da82eca93417` |
| Stable tag / commit | NOT RUN |
| Manual workflow run | `30423484884` at `ac31e422b6620cd07890390f981db4d6f9338ab9`; workflow dispatch; success; `https://github.com/Mr-BeanSir/GodGesture/actions/runs/30423484884` |
| RC workflow run / Release | `30425222307` at `880f1178e44410aaa59acadf6454da82eca93417`; success in 23m12s; `https://github.com/Mr-BeanSir/GodGesture/releases/tag/v0.1.0-rc.1` |
| Stable workflow run / Release | NOT RUN |
| Template repository commit / Release | `788993230bfcb767f8a3d030bb70c3c410ff18e7`; `v1.0.0`; `https://github.com/Mr-BeanSir/gesture-templates/releases/tag/v1.0.0` |

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
| Public `Mr-BeanSir/gesture-templates` repository | Public `main` at `788993230bfcb767f8a3d030bb70c3c410ff18e7` contains README, catalog, and both package files at repository root | PASS |
| Tagged Release with exactly three assets | Stable/latest `v1.0.0` has the three required user-uploaded assets, plus only GitHub-generated source archives | PASS |
| Live catalog HTTPS/schema validation | `https://github.com/Mr-BeanSir/gesture-templates/releases/latest/download/catalog.json`; HTTP 200; SHA-256 `9de42b7b40bd632392cc2972110d5cf3d784d39202297d3d5327808fabc1c783`; 2 entries parsed by shared production protocol | PASS |
| Live package identity/risk validation | `global-window-basics.json` SHA-256 `3f3552a72cb5f5008e78694576cd26c1da4eb3ee0e595633a5e8e0cbd2fa7657`; `browser-window-basics.json` SHA-256 `3147aa3d7067fd85fcab35afe507344aee9ad6dc86b7ff3feef4320f7b63bdf5`; both byte-identical to seed and passed identity/target/risk verification. Report: `%TEMP%\godgesture-m8-qa\template-live\template-live-report.json` | PASS |

## Updater Key And Manual Rehearsal

| Requirement | Evidence | Status |
| --- | --- | --- |
| New public key committed before any public release | `82fa6198e3625dbcd4c50d6813c55c10d33a50f5`; predates the RC tag; only the public key changed | PASS |
| Private key and password installed as GitHub Secrets | Authenticated repository settings show `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; successful signed manual/RC artifacts prove the configured key matches the committed public key. Values were never read or recorded | PASS |
| Encrypted recoverable backup confirmed outside worktree | Owner confirmation still required; never record a sensitive path or value | NOT RUN |
| Manual workflow all build/assembly jobs | Run `30423484884`: Windows job `90484839768` 19m40s, macOS job `90484839856` 7m28s, assembly `90487725375` 18s all succeeded; publish `90487791841` skipped by the manual-run contract | PASS |
| Downloaded combined artifact independently verified | GitHub artifact `GodGesture-desktop-release` digest `sha256:1c676d0a14d386159a85a525f05a4c6db857ff9e0523102a30f3ec58b08ce578`; `%TEMP%\godgesture-m8-qa\release-run-30423484884` contains the independently extracted 10-file contract, matching hashes/manifest/evidence, verified updater signatures, x64 installed executable, and universal Mach-O slices | PASS |

Failed rehearsal runs were retained rather than hidden: `30385641064` exposed the
missing shared build, `30386079135` exposed Windows-only command dispatch on
macOS, and `30387500137` exposed hard-coded macOS executable casing. Their
fixes are the release commits named above; run `30423484884` is the successful
manual rehearsal.

## RC Release And Windows Installation

| Requirement | Evidence | Status |
| --- | --- | --- |
| `v0.1.0-rc.1` is prerelease and not latest | GitHub Release `361531707` is published, non-draft, `prerelease=true`; the release page has the Pre-release badge and no Latest badge; public `releases/latest` returned HTTP 404 while only the RC existed | PASS |
| Exact assets, checksums, signatures, manifest, evidence JSON | 10 user-uploaded assets plus GitHub's two source archives. Public downloads under `%TEMP%\godgesture-m8-qa\rc-v0.1.0-rc.1` match GitHub asset digests and all three payload checksum files. `latest.json` maps `darwin-universal` and `windows-x86_64`; `release-evidence.json` records version `0.1.0-rc.1`, prerelease mode, exact tag, commit, two targets, and eight platform files | PASS |
| Windows x64 PE and NSIS SHA-256 | Installer SHA-256 `ff4b2b4e2a47851c9fb64a534c64977eb2a6b83d6386b2a62783b2ae9732d0fd`; Authenticode `NotSigned`; the NSIS outer stub is PE `0x014C`, while installed `godgesture.exe` is the required x64 PE `0x8664` | PASS |
| SmartScreen observation | Chrome required the explicit unverified-download choice; interactive installer launch showed `smartscreen.exe`; the public installer remained byte-identical and `NotSigned` | PASS |
| Installed version and launch | Public, signature-verified installer installed with exit code 0 into `%TEMP%\godgesture-m8-qa\installed-rc`; HKCU uninstall metadata and executable FileVersion/ProductVersion are `0.1.0-rc.1`; PID `34288` launched and responded normally | PASS |
| Quick guide, default gestures, config persistence, tray | Real installed WebView showed all three quick-guide steps; screenshots `installed-quick-guide-step1.png` through `step3.png`; Finish stored `godgesture.quickGuide.completed=1`; About reopened the guide. Nine global default gestures were present. Config SHA-256 stayed `24038F06DE27BCAC8945B6476E9779DFD2F56A796128B70BFB6B6BDE449CC024`. Closing hid the window while PID `34288` remained; relaunch reused the same process and restored the window | PASS |
| Windows administrator-start boundary | Normal process was medium integrity with an elevatable split token. With `autoStart=false`, enabling `runAsAdmin` persisted the setting and displayed the writable-location warning without creating a task. Relaunch produced a real Windows UAC prompt; approval started elevated PID `34224`. The exact process was stopped, `runAsAdmin=false` restored, normal PID `33940` relaunched, config hash remained unchanged, and GodGesture scheduled-task count returned to zero | PASS |

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
| RC universal `arm64` + `x86_64` slices | Public RC updater archive extracted on Windows: fat Mach-O magic `0xCAFEBABE`, 2 slices, CPU types `0x01000007` (`x86_64`) and `0x0100000C` (`arm64`) | PASS |
| RC strict ad-hoc `codesign` verification | RC macOS job `90490122202` passed recursive strict verification in 6m43s | PASS |
| RC DMG `hdiutil verify` and app layout | RC macOS job `90490122202` passed DMG verification and extracted-app layout checks | PASS |
| RC updater archive, minisign, SHA-256, manifest mapping | Public updater SHA-256 `7a72c9d21839b71e8b714337f64639d820487f837292c17a8e04e2cde184ce54`; public DMG SHA-256 `6d8afef5f66480b422ae08bd0e724f73debedac5b56a2ce651ee18c5de420487`; both checksum files match. The decoded Tauri signature passed independent minisign verification and `latest.json` maps the archive to `darwin-universal` | PASS |
| Stable runner-verifiable macOS release evidence | NOT RUN | NOT RUN |
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

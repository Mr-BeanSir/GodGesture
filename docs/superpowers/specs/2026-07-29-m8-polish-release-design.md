# M8 Polish And Release Design

Date: 2026-07-29

## Goal

Complete M8 as a real release milestone rather than a code-only readiness
claim. GodGesture will gain a focused first-run guide and final user-facing
documentation, publish its template repository, rehearse the production
pipeline with `v0.1.0-rc.1`, publish stable `v0.1.0`, and record acceptance
evidence from the resulting GitHub assets.

The owner has explicitly deferred physical-macOS acceptance for this run.
macOS artifacts must still build and pass runner-verifiable universal,
ad-hoc-signature, DMG, updater-signature, checksum, and manifest checks.
Gatekeeper, TCC, login-item, gesture-engine, and installed macOS updater
observations remain unverified until a real Mac is available. Documentation
must state this boundary without converting missing evidence into a pass.

## Starting Evidence

At design time:

- `main` is at `c7de3ee`; M7 product behavior ends at `aaf3e42`;
- the only worktree change is the owner's untracked `接手提示词.md`, which is
  outside this work;
- `Mr-BeanSir/GodGesture` has no Actions run, tag, Release, or Actions Secret;
- `Mr-BeanSir/gesture-templates` does not exist;
- production URLs still point to the placeholder `godgesture/*` organization;
- the application version is `0.1.0` in Tauri, npm, and Cargo metadata;
- only the updater public key is present. No matching private key is available
  in the process environment or workspace.

Because no public Release or installed public build exists, replacing the
pre-release updater key cannot strand an existing installation. M8 will create
a new key pair before the RC, commit only the public key, and install the
private key as a GitHub Actions Secret. Private material must never be printed,
committed, attached to a Release, or copied into workflow artifacts.

## Chosen Release Strategy

Use one prerelease followed by one stable release:

1. `v0.1.0-rc.1` is the production-pipeline rehearsal and installed old
   version for updater acceptance.
2. `v0.1.0` is the first stable release and updater target.
3. GitHub marks the RC as a prerelease and never as latest. Stable `v0.1.0`
   becomes latest.
4. The RC uses the same updater public key, repository coordinates, feature
   set, and asset contract as stable. The stable commit changes only version,
   release documentation, and defects found during RC acceptance.

This is preferred over publishing `0.1.0` and an artificial `0.1.1` patch,
and over declaring M8 complete without a real tag.

## Scope

### In Scope

- first-run quick guide and a permanent entry point to reopen it;
- final Chinese-first user documentation with an English application UI;
- production GitHub coordinates for releases, homepage, and templates;
- standalone public template repository and its first release;
- pre-release-aware desktop release workflow and release evidence capture;
- updater-key creation, repository Secret configuration, and recoverability
  instructions;
- RC and stable tags, GitHub Actions runs, assets, checksums, and manifests;
- installed Windows RC-to-stable updater smoke;
- runner-verifiable macOS release evidence and an explicit physical-Mac deferral;
- focused automated, build, visual, and release acceptance checks;
- current-state, roadmap, release, and handoff documentation updates.

### Out Of Scope

- M4 physical-Mac gesture-engine acceptance;
- Apple Developer ID, notarization, staple, or paid Apple credentials;
- Authenticode, `uiAccess`, or suppressing SmartScreen;
- Server-hosted update or template mirrors;
- feature tours, sample-data mutation, telemetry, or mandatory accounts;
- changing gesture recognition, command semantics, sync protocol, or database
  behavior unless a release-blocking defect is found.

## Production Coordinates

All user-facing and runtime defaults will use the repositories that the owner
controls:

- application and updater: `https://github.com/Mr-BeanSir/GodGesture`;
- template catalog: `https://github.com/Mr-BeanSir/gesture-templates`.

The existing build-time overrides remain available. Tests and release
validation scan the relevant runtime constants, Tauri configuration,
homepage links, seed catalog, and documentation so placeholder organization
URLs cannot silently return.

## Quick Guide

The guide is a compact modal workflow inside the existing settings window,
not a landing page and not a separate WebView. It appears after configuration
loads on the first interactive launch for the current installation and can be
reopened from About.

The guide contains three actionable steps:

1. **Ready:** show platform and gesture-engine readiness. On macOS, expose the
   existing permission request and System Settings actions. On Windows, show
   the current engine state without inventing a permission step.
2. **Try:** identify the existing default right-button gestures and ask the
   user to perform one. This step is instructional only and does not start the
   recorder or alter configuration.
3. **Personalize:** offer direct navigation to Gestures, Gesture Templates, or
   WGestures import. These actions close the guide and open the existing
   destination; they do not duplicate editors inside the dialog.

Completion is machine-local UI state. It does not enter `ConfigDocument`,
cloud sync, or the Rust machine-settings contract. A versioned local-storage
key records dismissal so future guide revisions can deliberately reappear.
Browser preview can force the guide open for deterministic visual acceptance.

The guide follows the current Element Plus density, uses existing icons and
tokens, stays within the `800x560` minimum viewport, and supports Chinese,
English, light, and dark modes. Escape/close counts as dismissal; all real
setup actions remain reachable later from Options or About.

## User Documentation

The root README becomes the public product entry point rather than a developer
stub. It covers supported platforms, download links, security/distribution
warnings, first gesture, permissions, update behavior, local-first accounts,
templates, development entry points, and links to detailed documentation.

`apps/desktop/README.md` becomes a concise desktop-development guide. A new
user guide covers:

- Windows NSIS installation and expected SmartScreen handling;
- macOS ad-hoc DMG installation, manual Open/Open Anyway, and separate TCC
  permissions;
- first gesture, App-specific intents, templates, WGestures import, pause,
  account/sync, updates, logs, and uninstall behavior;
- truthful limitations, including unsigned Windows packages, non-notarized
  macOS packages, non-executing imported Lua, and deferred physical-Mac
  acceptance.

Release instructions separate repeatable commands from release-specific
evidence. Secrets and backup locations are referenced by purpose, never by
value.

## Template Repository Publication

Create `Mr-BeanSir/gesture-templates` as a public repository from
`distribution/gesture-templates`. Its default branch contains the README,
catalog, and package JSON files at repository root. A tagged release attaches
`catalog.json` and both package files with their deterministic names.

Before publication, update every catalog/package URL to the real repository
and run the existing shared build and template validator. After publication,
perform live HTTPS fetches of the catalog and each package, verify schema and
identity with the production parser, and record the release/tag URLs. The
account Server remains uninvolved.

## Signing-Key Boundary

Generate one password-protected Tauri updater key pair before the RC. The
public key replaces the unreleased placeholder in Tauri configuration. The
private key and password are installed as GitHub Actions Secrets named by the
existing workflow contract.

The local private-key file must be outside the repository with filesystem
permissions limited to the current user. Before the stable tag, record that an
encrypted recoverable copy exists outside the working tree. If that backup
cannot be established, code and RC work may continue, but stable publication
must stop. The acceptance record never contains the private key, password, or
secret value.

## Release Workflow

The existing four-job workflow remains the owner of builds. M8 adds explicit
release metadata and evidence:

- version/tag validation accepts SemVer prereleases;
- tags containing a prerelease suffix create a GitHub prerelease and do not
  set `make_latest`;
- stable tags create a normal Release and set `make_latest`;
- release notes link to the user guide and retain the exact SmartScreen,
  ad-hoc, Gatekeeper, TCC, and checksum statements;
- the assembly output includes a machine-readable evidence summary containing
  version, commit, tag, target names, asset names, and SHA-256 values;
- validation rejects placeholder repository URLs, mismatched release mode,
  missing evidence fields, missing assets, or drift between checksums and
  artifacts.

The updater manifest always points to the exact tagged asset URLs. RC and
stable assets use identical platform keys: `windows-x86_64` and
`darwin-universal`.

## Acceptance Sequence

### Before RC

1. Complete code, documentation, tests, and browser visual acceptance.
2. Publish and live-validate the template repository.
3. Generate the updater key, update the public key, configure GitHub Secrets,
   and run a manual workflow build.
4. Download the manual-run artifact and independently verify names,
   signatures, checksums, PE x64, macOS slices, and manifest URLs.

### RC

1. Set all three application versions to `0.1.0-rc.1` and tag the exact
   reviewed commit.
2. Require all four jobs to pass and verify the GitHub prerelease state.
3. Download the public Windows installer, verify its SHA-256, install it, and
   record version, launch, default gestures, settings persistence, tray,
   SmartScreen observation, and administrator-start boundary.
4. Preserve the installed RC as the updater source.

### Stable

1. Fix release-blocking RC defects; otherwise change only version and
   acceptance documentation.
2. Set all versions to `0.1.0`, run the full affected baseline, commit, and tag.
3. Require the stable Release, assets, checksums, signatures, `latest.json`,
   and `make_latest` state to match the contract.
4. From installed RC, check for `0.1.0`, download and install through the
   application UI, observe restart, confirm version/config/tray/gesture state,
   and verify no unsigned payload bypass is possible.
5. Re-download public assets and independently verify all checksums and
   manifest URLs.

The Windows smoke may install/uninstall GodGesture and create its owned startup
task. It must not terminate unrelated Node, Cargo, browser, or user processes.
Any test task, temporary configuration, installer, or log copy created solely
for acceptance is removed or explicitly retained with its path documented.

## macOS Evidence Boundary

GitHub's macOS runner must prove:

- universal `arm64` and `x86_64` slices;
- strict ad-hoc code-sign verification;
- DMG verification and expected app layout;
- updater archive content and minisign signature;
- SHA-256 files and `darwin-universal` manifest mapping;
- RC and stable artifact availability from public Release URLs.

These are build and distribution facts, not substitutes for Gatekeeper, TCC,
login-item, gesture input, overlay, or installed updater observations. The M8
acceptance record marks those physical-Mac rows `DEFERRED (owner-approved)` and
links them to the existing M4 smoke checklist. M8 can close under this explicit
exception only if Windows release acceptance and all runner-verifiable macOS
checks pass.

## Testing

Focused automated coverage includes:

- quick-guide visibility, versioned dismissal, reopen, destination actions,
  and platform readiness mapping;
- Chinese/English message parity and absence of leaked translation keys;
- release-mode derivation for RC and stable SemVer versions;
- production repository coordinate validation;
- deterministic evidence JSON, checksums, manifest, and asset contracts;
- existing Desktop update-store, template, config, Rust updater, shared, and
  release tests.

Required local verification for the final stable commit:

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

Browser visual acceptance covers the guide, About entry point, and destination
transitions at `980x700` and `800x560`, Chinese and English, light and dark.
Screenshots must show no overlap, clipping, inaccessible controls, horizontal
overflow, nested-card layout, or translation-key leakage.

## Failure Semantics

- A missing or unrecoverable signing key blocks stable publication.
- A failed template release blocks the RC because production defaults would
  point to unavailable content.
- A failed platform build, signature, checksum, manifest, or release-state
  check blocks that tag from acceptance.
- A failed Windows RC installation blocks stable tagging.
- A failed RC-to-stable updater smoke leaves the stable Release available for
  diagnosis but keeps M8 incomplete until corrected and rerun.
- Network failure never disables local gestures, settings, or account-free use.
- Deferred macOS physical observations are reported as deferred, never passed.

## Completion Evidence

M8 is complete only when repository state, GitHub state, public assets, local
test output, screenshots, Windows installed-updater observations, template
live fetches, and the final acceptance record collectively prove every
non-deferred item above. `docs/PROJECT_STATUS.md` and `docs/ROADMAP.md` change
to completed only in the final evidence commit. The handoff must name exact
commits, tags, workflow runs, Releases, asset hashes, test counts, retained
evidence paths, and the remaining owner-approved physical-Mac deferral.

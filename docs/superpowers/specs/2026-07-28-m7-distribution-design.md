# M7 Desktop Distribution Design

Date: 2026-07-28

## Goal

Complete M7 without reopening M4 or expanding the self-hosted Server. The
existing Web Console remains the completed account-management surface. This
work adds a signed Tauri updater backed by GitHub Releases and a desktop
Gesture Template library backed by a separate public GitHub repository.

M7 implementation is complete when the application, static distribution
contracts, release workflow, template repository seed, automated tests, and
browser visual acceptance are in place. Creating or pushing either public
GitHub repository is excluded because this run must not push. The first tagged
production release and installed-version upgrade smoke remain M8 release
acceptance; they do not justify leaving the M7 product paths as placeholders.

The default public locations follow the names already present in the project:

- application releases: `https://github.com/godgesture/godgesture`;
- template catalog: `https://github.com/godgesture/gesture-templates`.

Both locations must be build-time configurable so an eventual organization or
repository rename does not require product-code changes.

## Scope

### In scope

- a Tauri 2 updater boundary for checking, downloading, verifying, installing,
  reporting progress, and restarting;
- automatic checks controlled by the existing synced
  `preferences.autoCheckForUpdate` setting and a manual About-page action;
- Windows x64 NSIS updater assets and a universal macOS updater archive in the
  existing free, ad-hoc, non-notarized distribution model;
- a tagged GitHub Release workflow that emits signed assets and `latest.json`;
- a versioned, untrusted-input Gesture Template catalog and package contract;
- browsing, filtering, previewing, and atomically adopting templates into the
  current configuration;
- a standalone template-repository seed with initial catalog content and a
  validation command;
- focused unit, compile, workflow-contract, and visual acceptance coverage;
- current-state documentation updates.

### Out of scope

- M4 physical-Mac gesture-engine or DMG acceptance;
- publishing or pushing GitHub repositories and creating GitHub secrets;
- Apple Developer ID, notarization, staple, or Authenticode signing;
- Server routes, database tables, proxying, mirroring, telemetry, or template
  ownership by the Server;
- template editing, ratings, submissions, remote code sandboxing, channels,
  downgrade support, or background update installation;
- onboarding and the first formal public release, which remain M8 work.

## Architecture

### Updater ownership

Rust owns the updater because update objects are stateful native resources and
installation can terminate or restart the process. A focused updater module
registers `tauri-plugin-updater`, stores at most one pending update, and exposes
typed commands through the existing `api/backend.ts` gateway:

- `update_check`: replace any stale pending update and return serializable
  version, notes, publication date, and current-version metadata;
- `update_install`: consume the pending update, download and install it, emit
  bounded progress events, then restart where the platform permits;
- `update_cancel`: discard a pending update without affecting a transfer that
  has already entered native installation.

Only one check or install may run at a time. A generation token prevents a late
check from replacing newer state. The frontend never receives artifact URLs,
signatures, or a native update handle and cannot override the verification key.

The updater uses one committed minisign public key. The corresponding private
key never enters the repository. CI receives its content through
`TAURI_SIGNING_PRIVATE_KEY` and, if configured, its password through
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Losing or rotating this key is a release
event and requires an explicit migration design; M7 does not add silent key
rotation.

Production uses HTTPS only. The default static endpoint is the application's
latest GitHub Release `latest.json`; a compile-time release-origin setting may
override it. Development and browser previews return deterministic mock update
states rather than weakening production transport policy.

### Desktop update experience

A small Pinia update store owns the session state: idle, checking, available,
downloading, ready/restarting, current, and failed. It deduplicates concurrent
automatic and manual checks and presents a single update prompt per discovered
version in one application session.

After configuration and account initialization, the app performs one delayed
check when `autoCheckForUpdate` is enabled. Automatic checks never download or
install. The About page always provides a manual action and shows the current
version, discovered version, release notes, progress, retry, and install
controls. Before installation, the UI flushes pending configuration saves so a
Windows installer-triggered process exit cannot lose edits.

Errors are stable codes mapped through vue-i18n. Network and endpoint failures
do not affect gestures, local settings, or sync. Signature, malformed manifest,
unsupported platform, missing pending update, concurrent operation, download,
and installation failures remain distinct. No raw remote error is rendered as
HTML.

### Release workflow

The current macOS release workflow becomes a desktop release workflow with
separate Windows and macOS build jobs plus a release-assembly job.

The Windows job builds a release-mode x64 NSIS bundle without Authenticode,
checks the executable and updater signature, and retains deterministic asset
names. The macOS job preserves the current universal app and DMG checks, builds
the Tauri updater archive from the same ad-hoc application bundle, and verifies
both architecture slices, the ad-hoc envelope, DMG integrity, updater
signature, and SHA-256 checksum.

The assembly job runs only after both platform jobs. It validates that the tag,
Tauri version, desktop package version, and Rust package version agree; embeds
the signature file contents in a static Tauri v2 `latest.json`; maps Windows to
`windows-x86_64` and the universal macOS artifact to the updater module's custom
target; and uploads the manifest and assets together. `workflow_dispatch`
retains Actions artifacts. A `v*` tag creates the GitHub Release with the
existing truthful macOS manual-approval warning. A missing secret, artifact,
signature, checksum, platform entry, or version match fails before publication.

### Gesture Template contract

`packages/shared` owns strict Zod schemas and inferred TypeScript types for
untrusted template data. This is a distribution protocol, not part of
`ConfigDocument`, so adopting a template does not bump
`CONFIG_FORMAT_VERSION`.

The catalog has a format version, generation timestamp, and bounded entries.
Each entry carries a stable slug, semantic content version, localized title and
summary (`zh-CN` and `en`), author, bounded tags, target metadata, risk summary,
and a package URL. A package repeats its identity and version and contains one
target:

- `global`: gesture intents merge into the Global App;
- `app`: an App name, optional Windows binding, optional macOS binding, inherit
  and enabled defaults, and gesture intents for that App.

Template intents omit configuration UUIDs and order values. Their gesture,
command, name, and execute-on-modifier fields reuse the existing shared command
and gesture schemas. A package cannot modify preferences, machine-local
settings, pause state, hot corners, rub edges, account state, or sync metadata.

Catalog and package byte limits are checked before JSON parsing. Zod schemas
are strict, collection sizes are bounded, all URLs must be HTTPS, and package
identity/version must match the selected catalog entry. Redirects must remain
HTTPS. Unknown format versions and malformed content fail closed.

### Browsing and adoption

The Desktop adds a top-level Template Library section rather than nesting a
second tool inside the existing Gestures page. The view is an unframed,
work-focused catalog with compact filters, status/error states, and repeated
template rows. Selecting an entry opens a detail dialog with target bindings,
gesture/command preview, localized metadata, and risk disclosures.

Package fetching is explicit when details are opened and is cached only for the
current session. The default catalog URL points at the independent repository's
latest release asset and is build-time configurable. Browser preview uses the
same parser against local fixture data and never depends on GitHub.

Adoption runs as a pure planning step before any mutation:

1. Parse and clone the current `ConfigDocument`.
2. Resolve the target. Global packages use the Global App. App packages match
   existing Apps by normalized Windows exe/AUMID and macOS Bundle ID. One
   unique match is reused, no match creates an App, and bindings that resolve
   to different existing Apps are rejected as ambiguous.
3. Detect gesture identity conflicts using trigger button, strokes, and
   modifier. The user must choose either keep existing or replace existing for
   all reported conflicts; there is no implicit overwrite.
4. Generate fresh UUIDs, append deterministic order values, and preserve all
   unrelated user content.
5. Validate the complete document and its 256 KiB synchronized-size limit.
6. Show the exact add/replace/skip counts and require confirmation.
7. Apply the validated document once through a dedicated config-store barrier.

The barrier follows the existing synchronized-document/import pattern: flush
older saves, write the whole document once, update the in-memory baseline, and
resume watchers. Failure leaves or reloads the previous authoritative document
instead of exposing a partially adopted package. Once committed, the ordinary
M6 debounce and sync engine treat the adopted content as user data.

Commands that can execute arbitrary or externally directed behavior require a
stronger confirmation. At minimum this includes JavaScript/Lua scripts,
command-line commands, file/program launches, and URL/Web Search commands. The
dialog identifies counts and command names; it does not claim that public
templates are trusted or audited.

### Template repository seed

Because this run cannot push, the main repository contains a clearly isolated
standalone-repository seed rather than a nested Git repository. It includes the
catalog source, package files, initial low-risk examples, a README describing
the independent repository/release layout, and a validation script that imports
the shared schemas. The client never reads these source paths in production.

Initial examples cover a global navigation set and at least one dual-platform
App package without scripts or shell commands. Fixtures used by tests and
browser preview are generated or imported from the same validated content so
the examples cannot drift from the public contract. Publishing this seed to
`godgesture/gesture-templates` is an external no-push handoff, not a hidden
Server dependency.

## Testing And Acceptance

Shared tests cover catalog/package acceptance and rejection, byte and count
limits, strictness, HTTPS constraints, identity/version matching, App target
resolution, conflict planning, UUID regeneration, ordering, ambiguity,
document-size rejection, and preservation of unrelated configuration.

Desktop tests cover catalog transport outcomes, mock behavior, update-store
deduplication and state transitions, automatic-check preference handling,
config-store atomic adoption, risk classification, and localized error-key
parity. Rust tests cover target selection, endpoint validation, stable error
mapping, pending-update concurrency, and progress calculations without
requiring a live release.

Static workflow verification covers triggers, permissions, required secrets,
version gates, platform assets, updater signatures, `latest.json` keys,
ad-hoc-only macOS policy, checksums, and release conditions. The affected shared,
Desktop TypeScript, Desktop Rust, and release-validation baselines must pass.

Browser acceptance uses the existing preview backend and validates the Template
Library and About/update states in Chinese and English, light and dark themes,
at the normal 980x700 settings size and the 800x560 minimum. Screenshots must
show no overlap, clipped commands, horizontal page overflow, inaccessible
adoption controls, translation-key leakage, or nested-card layout.

The final documentation update records M7 product implementation as complete
while retaining two external observations: the first real tagged GitHub Release
and an installed old-to-new update on Windows and macOS. Those observations are
part of M8 release acceptance and do not reopen M4's separate gesture-engine and
physical-Mac checklist.

## Failure Semantics

- Update checks and template fetches are optional network operations. Failure
  never disables local gestures or account-independent use.
- Updater verification cannot be bypassed, downgraded to HTTP, or accepted with
  a missing signature.
- Installation is explicit and never starts from an automatic check.
- A failed template parse or plan mutates nothing. A failed apply restores or
  reloads the previous authoritative configuration.
- GitHub unavailability is shown with retry and repository-link actions; the
  Server is not used as a fallback.
- A future mirror requires a new explicit trusted-origin design and must retain
  signature/schema verification. M7 does not silently add mirrors.

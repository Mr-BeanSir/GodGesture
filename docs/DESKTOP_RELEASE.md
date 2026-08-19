# Signed Desktop Release

GodGesture publishes Windows x64 and universal macOS packages from one GitHub
Actions workflow. Native updater packages are signed with the Tauri updater
minisign key. This signature is independent of platform publisher signing:

- Windows packages are not Authenticode signed and may trigger SmartScreen.
- macOS packages are ad-hoc signed and are not notarized by Apple.

The committed updater public key lets an installed GodGesture version reject
modified updater packages. It does not identify the publisher to Windows or
macOS. SHA-256 files are provided for people downloading packages manually.

## Updater Signing Key

The updater private key is release-critical material. It must never be added to
Git, workflow artifacts, logs, issue attachments, or release assets. Before the
first public release, make an encrypted offline backup in a separate location
and verify that the backup can be restored. Losing the only copy prevents
existing installations from accepting future updates. Rotating the key
requires an explicit migration release; replacing it silently will strand old
installations.

Configure these GitHub Actions repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY` (required): the complete updater private-key
  content;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional): the private-key password,
  when the key was generated with one.

Both Windows and macOS build jobs require the same private key. The public key
is committed in `apps/desktop/src-tauri/tauri.conf.json`; do not regenerate or
replace either side as routine release housekeeping.

## Desktop Production API

Configure this GitHub Actions repository variable before building a release:

- `GODGESTURE_API` (required): the deployed official Server HTTPS origin, for
  example `https://api.example.com`.

The value is public client configuration, not a secret. Both platform jobs
inject it while Vite builds the Desktop frontend, so the resulting application
does not load or ship an external `.env` file. The workflow rejects a missing
value and any URL that is not an HTTPS origin without credentials, a path,
query parameters, or a fragment. Changing the official origin requires a new
Desktop build.

`VITE_GODGESTURE_REPOSITORY_URL` and
`VITE_GODGESTURE_PLUGIN_CATALOG_URL` remain optional build-time overrides. The
official repository and plugin catalog URLs already have matching defaults in
the Desktop source and do not need GitHub repository variables for the official
release.

## Workflow

`.github/workflows/desktop-release.yml` has two entry points:

- `workflow_dispatch` builds and retains an Actions artifact without creating
  a public GitHub Release;
- a `v*` tag builds the same files and publishes them to the matching GitHub
  Release.

SemVer prerelease tags such as `v0.1.0-rc.1` create a GitHub prerelease and do
not become latest. Stable tags such as `v0.1.0` create a normal Release and
become latest. This allows an installed RC to exercise the real updater against
the first stable release without publishing an artificial patch version.

Maintainers create a Desktop release from the repository root with an explicit
version request:

```powershell
pnpm install --frozen-lockfile
pnpm release patch --dry-run
pnpm validate:release
pnpm release 0.2.0
```

`patch`, `minor`, `major`, and a complete SemVer are explicit maintainer input.
Commit message prefixes such as `feat` and `fix` only affect the Release Notes
section; they do not choose a version automatically. A real release creates a
`chore: release vX.Y.Z` commit and `vX.Y.Z` tag, which triggers
`.github/workflows/desktop-release.yml`. `release-it` does not create a GitHub
Release and does not publish npm packages.

The release command synchronizes these four Desktop version files:

- the root `package.json`;
- `apps/desktop/src-tauri/tauri.conf.json`;
- `apps/desktop/package.json`;
- `apps/desktop/src-tauri/Cargo.toml`.

The Server is an independent private subproject: its internal version is not
read, modified, or validated by this release flow. `packages/shared`,
`packages/ui`, and `packages/sdk` also keep independent versions.

The tag must be exactly `v<version>`, for example `v0.1.0`. The assembly job
fails on a version mismatch, missing or extra asset, malformed updater
signature, invalid checksum, or unexpected tag. Run the local contract check
before tagging:

```powershell
pnpm validate:release
```

The Windows and macOS jobs have read-only repository permissions. Only the
tag-only release job receives `contents: write`.

## Release Notes

The GitHub Release page is the only release log for this workflow. The
repository does not maintain `docs/CHANGELOG.md` for these releases. Accepted
pull request title examples are:

```text
feat(ui): add template search
fix: prevent overlay flicker
fix(overlay)!: restore trail
```

The pull request workflow maintains one `type:*` label per pull request.
PR titles may use only these 12 types, which are the complete whitelist enforced
by `.github/workflows/pr-title.yml` and categorized by `.github/release.yml`:

```text
feat, fix, chore, docs, style, refactor, perf, test, revert, build, ci, config
```

No other PR title type or `type:*` label is allowed. The workflow rejects a
title outside this whitelist and reconciles the pull request to its one
canonical `type: <type>` label.
GitHub uses `.github/release.yml` to generate bilingual sections with links to
merged pull requests and their authors. Direct commits without merged pull
requests are not promised to appear in a typed section.

## Release Assets

For version `0.1.0`, the deterministic assets are:

```text
GodGesture_0.1.0_x64-setup.exe
GodGesture_0.1.0_x64-setup.exe.sig
GodGesture_0.1.0_x64-setup.exe.sha256
GodGesture_0.1.0_universal.app.tar.gz
GodGesture_0.1.0_universal.app.tar.gz.sig
GodGesture_0.1.0_universal.app.tar.gz.sha256
GodGesture_0.1.0_universal.dmg
GodGesture_0.1.0_universal.dmg.sha256
latest.json
release-evidence.json
```

`latest.json` maps the updater packages to `windows-x86_64` and
`darwin-universal`. The NSIS installer and macOS application archive are the
native updater payloads. The DMG remains the macOS manual-install package.

Manual workflow runs retain the assembled `GodGesture-desktop-release` Actions
artifact for 14 days. Tag runs attach the same contents to the public release.
`release-evidence.json` records the repository, exact commit, version, ref,
release mode, platform targets, asset names, and verified package hashes. It
contains no secret or private-key material.

## Platform Boundaries

Windows uses an x64 NSIS installer without Authenticode. A SmartScreen warning
on initial manual installation is expected under ADR-0007. The native updater
still verifies the minisign signature before installation; do not describe
that updater signature as Authenticode or publisher verification.

macOS uses a universal `arm64` + `x86_64` app, ad-hoc signature, and DMG. It
does not use an Apple certificate, Developer ID, notarization, or stapling.
Users may need Finder **Open** or **System Settings > Privacy & Security > Open
Anyway**. See `docs/MACOS_RELEASE.md` for installation and TCC details.

## Acceptance Boundary

Static workflow validation, deterministic manifest assembly, and local builds
are M7 implementation evidence. The first tagged production workflow run and
an installed old-to-new updater smoke on both Windows and macOS are M8 release
acceptance. They must be recorded from real release assets and cannot be
replaced with fixture manifests or development mocks.

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

Before creating a tag, set the same semantic version in all three files:

- `apps/desktop/src-tauri/tauri.conf.json`;
- `apps/desktop/package.json`;
- `apps/desktop/src-tauri/Cargo.toml`.

The tag must be exactly `v<version>`, for example `v0.1.0`. The assembly job
fails on a version mismatch, missing or extra asset, malformed updater
signature, invalid checksum, or unexpected tag. Run the local contract check
before tagging:

```powershell
pnpm validate:release
```

The Windows and macOS jobs have read-only repository permissions. Only the
tag-only release job receives `contents: write`.

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

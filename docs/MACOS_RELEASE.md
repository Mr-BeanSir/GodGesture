# Free macOS DMG Distribution

GodGesture publishes a free, open-source macOS DMG without an Apple Developer account. The application is ad-hoc signed and is not notarized by Apple. Ad-hoc signing does not identify the publisher or make Gatekeeper trust the download; users must approve the application manually on first launch when macOS blocks it.

The bundle identifier is `com.godgesture.desktop` and the minimum supported system is macOS 13. The default artifact is universal and contains Apple Silicon (`arm64`) and Intel (`x86_64`) executable slices. No Apple certificate, Apple ID, Team ID, app-specific password, notarization profile, or Mac App Store account is used.

## GitHub Actions

The `macOS free DMG release` workflow has two entry points:

- Run it manually with `workflow_dispatch` to build a downloadable Actions artifact without creating a public release.
- Push a tag matching `v*`, such as `v0.1.0`, to build the same artifact and attach it to a GitHub Release.

For a tag build, the version after `v` must exactly match both `apps/desktop/package.json` and `apps/desktop/src-tauri/tauri.conf.json`. A mismatch fails before packaging.

The workflow:

1. Runs the focused desktop frontend and Rust library tests.
2. Builds the universal application and DMG with the free ad-hoc identity `-`.
3. Verifies the application signature envelope with `codesign`.
4. Verifies the `arm64` and `x86_64` executable slices with `lipo`.
5. Verifies the DMG filesystem with `hdiutil`.
6. Publishes the DMG with a SHA-256 checksum.

Manual and tag runs always retain `GodGesture-macOS-universal-ad-hoc` as a workflow artifact. Tag runs additionally create or update the matching GitHub Release. Only the tag release job receives `contents: write`; the build job remains read-only.

## Local Packaging

On a Mac with the repository toolchain installed, run:

```bash
pnpm install --frozen-lockfile
APPLE_SIGNING_IDENTITY=- pnpm --filter @godgesture/desktop tauri build --ci --target universal-apple-darwin --bundles app,dmg
```

This produces the application and DMG below `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle`. A local build is not a substitute for the tagged workflow when producing an official project release.

## Download Verification

Download the DMG and its adjacent `.sha256` file into the same directory, then run:

```bash
shasum -a 256 -c GodGesture_0.1.0_universal.dmg.sha256
```

Use the actual release version in the filename. Continue only when the command reports `OK`.

## Installation And First Launch

1. Mount the DMG and copy GodGesture to `/Applications`.
2. Try to open GodGesture from `/Applications`.
3. If macOS blocks it, Control-click GodGesture in Finder and choose **Open**, then confirm **Open** when that option is available.
4. If Finder does not offer the approval, open **System Settings > Privacy & Security**, find the blocked GodGesture message, choose **Open Anyway**, and confirm the prompt.
5. After GodGesture launches, grant Accessibility, Input Monitoring, and event-posting access through the in-app permission controls and System Settings.

Gatekeeper approval and TCC permission grants are separate. Entering an administrator password does not make GodGesture run as root and does not grant Accessibility or Input Monitoring access. Do not launch the GUI with `sudo`.

An update may require the manual launch approval or TCC permissions to be confirmed again. The on-device M4 checklist requires this behavior to be observed rather than assumed.

## Security Boundary

- The project does not remove `com.apple.quarantine`, disable Gatekeeper, call `spctl --master-disable`, or automate any security bypass.
- `codesign --verify` proves only that the ad-hoc signature envelope is internally consistent. It does not prove Apple trust or publisher identity.
- The artifact is not submitted to notarytool, has no stapled ticket, and is expected not to pass the normal notarized Gatekeeper assessment.
- The checked-in entitlement set remains deliberately empty. Global input capture and posting are controlled by TCC, not granted by an entitlement.

Developer ID signing, Apple notarization, stapling, warning-free first launch, and Mac App Store submission are outside the accepted distribution model in ADR-0011.

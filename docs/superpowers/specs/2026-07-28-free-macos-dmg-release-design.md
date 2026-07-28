# Free macOS DMG Release Design

Date: 2026-07-28

## Goal

Distribute GodGesture as a free, open-source macOS DMG without joining the paid Apple Developer Program. The repository must build the macOS application on GitHub-hosted macOS runners, apply an ad-hoc signature that requires no certificate, and publish a downloadable DMG. Users explicitly accept that macOS will not recognize the application as notarized and may require manual approval before first launch or after an upgrade.

This decision replaces M4's Developer ID signing and notarization requirement. It does not change the native gesture engine, TCC permission model, application identifier, or the decision not to run the GUI application as root.

## Distribution Contract

- GodGesture does not require an Apple Developer account, Developer ID certificate, Apple ID, Team ID, app-specific password, notarization, or Mac App Store submission.
- The public artifact is an ad-hoc-signed DMG. An ad-hoc signature provides a consistent code-signing envelope for the bundle but does not establish publisher identity or Apple trust.
- The DMG and application are not notarized. Documentation and release notes must never imply Apple verification, Gatekeeper approval, or a warning-free first launch.
- Users install by mounting the DMG and copying GodGesture to `/Applications`. If macOS blocks the first launch, users approve it through Finder's Open action when available or System Settings > Privacy & Security > Open Anyway.
- Accessibility, Input Monitoring, and event-posting consent remain separate TCC approvals. Manual Gatekeeper approval and an administrator password do not grant those permissions. Upgrades may require permission confirmation again.
- The project does not automatically remove quarantine attributes or bypass system security policy.

## Artifact Architecture

The default artifact remains `universal-apple-darwin`, containing Apple Silicon (`arm64`) and Intel (`x86_64`) slices. Existing code and cross-target checks already cover both architectures, so retaining Intel support currently adds no product-code scope.

If a real GitHub macOS build demonstrates that Intel support requires new platform behavior, architecture-specific product code, or a separate maintenance path, the release target will be reduced to Apple Silicon instead of adding that scope. Ordinary build-tool or dependency configuration fixes do not by themselves justify dropping Intel.

## Workflow

`.github/workflows/macos-release.yml` remains the single macOS packaging workflow but is renamed in the Actions UI to describe a free DMG release. It supports:

- `workflow_dispatch`: build and validate the DMG, then retain it as a GitHub Actions artifact.
- pushes of tags matching `v*`: build and validate the same artifact, then attach the DMG and SHA-256 checksum to the corresponding GitHub Release.

The workflow performs these stages:

1. Check out the exact commit and install the pinned Node, pnpm, and Rust toolchains.
2. Install dependencies from the lockfile and run the focused desktop frontend and Rust tests.
3. For a tag build, verify that the tag version matches the Tauri application version before packaging.
4. Set the macOS signing identity to `-` and build `app,dmg` for `universal-apple-darwin`. No Apple credential environment variables are read.
5. Verify that the application and DMG exist, `codesign --verify` accepts the application envelope, the main executable contains both required architecture slices, and `hdiutil verify` accepts the DMG.
6. Produce a SHA-256 checksum next to the DMG.
7. Upload the bundle as a workflow artifact. On `v*` tags, publish the DMG and checksum to GitHub Releases with release text that discloses the ad-hoc, non-notarized status and manual first-launch procedure.

The job has read-only repository access during ordinary/manual builds and the minimum content-write permission needed to create a tagged GitHub Release. Missing Apple secrets are no longer an error because no Apple secrets are part of this release model.

## Tauri Configuration

The macOS bundle keeps:

- identifier `com.godgesture.desktop`;
- minimum macOS version 13;
- `Info.plist` usage descriptions;
- the current empty entitlement set, because TCC event access is not granted by an entitlement;
- hardened runtime when compatible with Tauri's ad-hoc packaging path.

The workflow supplies the ad-hoc identity explicitly. If real macOS packaging proves hardened runtime incompatible with the ad-hoc bundle, the project may disable hardened runtime for this free distribution mode and record the observed failure. It must not invent entitlements or add Apple credentials to work around the issue.

## Documentation And Decision Records

Implementation updates all documents that currently require Developer ID signing or notarization:

- add an ADR that supersedes the paid-signing paragraph of ADR-0007 while preserving ADR-0007's Windows `runAsAdmin` and no-`uiAccess` decisions;
- update the M4 macOS design and roadmap to define the free, non-notarized DMG as the accepted distribution target;
- rewrite `docs/MACOS_RELEASE.md` as the build, release, installation, manual-approval, checksum, and known-limitations guide;
- update `docs/qa/M4_MACOS_SMOKE.md` to validate the ad-hoc DMG and manual approval path instead of Developer ID, notarization, stapling, and warning-free launch;
- update `docs/PROJECT_STATUS.md` so M4's remaining boundary is real-Mac functional and free-DMG acceptance, not Apple credentials.

The historical commits remain intact, but current documents must not contain contradictory active requirements.

## QA And Completion Definition

Windows-side and static verification covers workflow syntax, Tauri merged configuration, explicit absence of Apple secret requirements, tag/release conditions, and unchanged desktop regression tests as appropriate. A Windows host cannot prove that the DMG packages or runs.

The macOS workflow and on-device smoke test must establish:

- the expected DMG and checksum are produced by both supported workflow paths;
- the packaged executable contains the promised architectures, or the documented Apple Silicon-only target if the fallback decision is exercised;
- the ad-hoc signature envelope and DMG filesystem verify successfully;
- a downloaded, quarantined artifact follows the documented manual approval path;
- after approval, TCC prompts, gesture functionality, native overlay, commands, QuickJS, Bundle ID matching, and login startup pass the existing M4 on-device checklist;
- an upgrade exercises the documented permission recheck behavior;
- the checksum published on GitHub matches the downloaded DMG.

M4 is formally complete when this revised checklist passes and the evidence is recorded. Developer ID, notarization, stapling, Gatekeeper's normal no-warning assessment, and Mac App Store submission are explicitly outside the completion definition.

## Failure Handling

- A packaging, architecture, signature-envelope, DMG, checksum, or version/tag mismatch fails the workflow and publishes nothing.
- A tag release never falls back silently to an unsigned or partially built artifact.
- If manual approval behavior changes in a newer macOS version, documentation and the smoke checklist are updated from observed behavior; the project does not bypass the security control automatically.
- Functional failures discovered on a physical Mac are fixed and the affected automated and smoke checks are rerun. They are not reclassified as expected consequences of free distribution.

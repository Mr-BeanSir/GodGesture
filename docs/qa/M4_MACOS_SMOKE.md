# M4 macOS On-Device Smoke Checklist

Use a physical Mac running macOS 13 or newer. Record the macOS version, CPU architecture, display layout, application commit, ad-hoc signature status, and workflow run URL with the results. A checked item requires observed behavior; configuration or compilation alone is not evidence.

M8 completed the runner-, Release-, and downloaded-artifact checks below with
direct workflow logs and public payloads. All unchecked on-device items remain
`DEFERRED (owner-approved)` until a physical Mac is available; runner evidence
does not satisfy them.

## Permission Lifecycle

- [ ] With Accessibility, Input Monitoring, and event-posting access absent, GodGesture opens its settings window without crashing and reports each missing permission.
- [ ] “Request access” invokes the macOS prompts. “Open System Settings” opens Privacy & Security > Accessibility.
- [ ] After all permissions are granted, the UI reports the engine running, either immediately or after one documented restart.
- [ ] Revoking access makes the failure actionable and does not make the settings window unusable.

## Capture And Suppression

- [ ] Right, middle, X1, and X2 trigger buttons enter and leave gesture capture correctly.
- [ ] A recognized gesture suppresses the physical trigger click. A normal click and cancelled gesture pass through exactly once.
- [ ] Wheel-forward/backward and button modifiers execute once according to configuration.
- [ ] Synthetic input does not re-enter the gesture tracker. A forced tap timeout recovers without duplicate input.
- [ ] Pause works from the tray, configured global hotkey, left+middle chord, and Pause command.

## Overlay And Displays

- [ ] Trail and command hint are click-through, do not steal focus, and use the configured colors and visibility settings.
- [ ] Fade, recognized/unrecognized color changes, and cancellation match Windows behavior.
- [ ] The overlay follows the gesture origin across a Retina/non-Retina multi-display layout without an offset or scale jump.
- [ ] The overlay remains visible above a full-screen application and across Spaces.

## Application And Window Identity

- [ ] The pointer picker fills the target application's display name and Bundle ID and rejects GodGesture's own window.
- [ ] Dropping a valid `.app` bundle fills its localized name and Bundle ID; a non-app directory is rejected.
- [ ] Global, inherited, overridden, and blacklisted application intentions match by Bundle ID.
- [ ] Window minimize, close, zoom/restore, activate, dock left, and dock right work on the selected target. Toggle-topmost reports unsupported without crashing.

## Commands And Script Runtimes

- [ ] Hotkey, Web search, selected-text capture, URL, open file, key sequence, command line (hidden and Terminal), Mission Control, pause, and volume commands are exercised.
- [ ] Clipboard contents, items, and formats survive selected-text capture when no concurrent clipboard owner changes them.
- [ ] QuickJS persistent context, all lifecycle slots, host input/window/clipboard calls, exception recovery, and the 200 ms infinite-loop interrupt are exercised.

QuickJS remains a migration fallback until every Node plugin item below passes
on a physical Mac. GitHub runner results are supporting CI evidence, not a
substitute for these observations.

- [x] Record the `macOS CI` workflow run and its `node-host-performance-macos-*` artifact. Run `30709559609` on commit `9881fe4` completed the release gate with 10,000 ordered no-op events and 10,000 ordered representative host-call events; artifact `node-host-performance-macos-ARM64` has SHA-256 `07f6629ff141a537bcaa0a1e9c19cc49a6ca919747710b1d30ba8675458ba766`. The runner reported macOS 15.7.7 arm64, Node `v24.18.1`, cold start `263.573375 ms`, no-op p95/p99 `0.122083/0.18425 ms`, and host-call p95/p99 `0.350167/0.614709 ms`. This is CI evidence only and does not check the physical-Mac items below.
- [ ] On the physical Mac, run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --release engine::node_host::tests::node_host_performance_gate -- --ignored --exact --nocapture`; record cold startup plus no-op and host-call p95/p99. No-op p95 is at most 5 ms, host-call p95 is at most 8 ms, and both p99 values are at most 16 ms.
- [ ] A preloaded Node plugin handles the first gesture without starting another process, loading its entry module, installing dependencies, or accessing the package registry on the gesture path.
- [ ] A plugin imports `node:fs/promises`, uses global `fetch`, imports `@godgesture/sdk`, and exercises input, window, clipboard, and status calls through the async SDK.
- [ ] A plugin with multiple source files and an npm dependency runs from its exact lockfile. After the package store is warm, rebuilding the same plugin revision succeeds with network access disabled.
- [ ] Forcing a plugin Worker to exit or time out produces a bounded diagnostic; the next invocation reloads the Worker, reruns `init`, and succeeds without interrupting the native mouse hook.
- [ ] Forcing the Node supervisor to exit does not block or crash the native mouse hook. The service restarts it, reloads enabled plugins, and later gestures execute in order.

## Machine Settings And Distribution

- [ ] Start at login registers through `SMAppService`, survives logout/login, and unregisters when disabled. A requires-approval state is shown clearly.
- [ ] Run as administrator is disabled and explained on macOS. Tray visibility applies and persists.
- [x] Manual run `30423484884` produced the ad-hoc universal DMG, adjacent SHA-256 checksum, and `GodGesture-macOS-universal-ad-hoc` artifact; its publish job skipped by contract.
- [x] Stable macOS job `90528991414` accepted strict/deep `codesign`, reported `Signature=adhoc`, required both `arm64` and `x86_64`, validated the updater app layout, and reported the DMG checksum VALID from `hdiutil verify`.
- [x] Matching tag `v0.1.0` created the stable/latest Release at commit `5b81245` with the DMG and checksum; release validation 10/10 plus the workflow contract rejects a mismatched tag before the publish job.
- [x] The browser-downloaded stable DMG matched its adjacent checksum and Release evidence at SHA-256 `dc7a6ade30e4784cad30f2d53ef2372a27bd2fe989689a82386b70bce6b15467` (PowerShell `Get-FileHash` was the Windows equivalent of `shasum -a 256 -c`).
- [ ] With download quarantine intact, the first normal launch is blocked as expected and the documented Finder Open or Privacy & Security > Open Anyway flow permits launch. No quarantine removal or Gatekeeper disable command is used.
- [ ] After manual launch approval, Accessibility, Input Monitoring, and event-posting are granted separately and the engine runs. An upgrade records whether launch approval or TCC consent must be confirmed again.

# M4 macOS Engine Design

Date: 2026-07-28

## Goal

Complete the native macOS half of the desktop gesture engine without weakening the Windows behavior already accepted in M1-M3. The macOS build must capture and synchronously suppress global mouse input, feed the existing platform-neutral tracker and intent engine, render a native click-through trail and hint overlay, execute the 12 command categories and QuickJS host APIs where macOS provides an equivalent, resolve applications by Bundle ID, manage login startup, and expose Accessibility permission state clearly.

M4 also supplies a reproducible free DMG workflow. Per ADR-0011, the application uses ad-hoc signing without Apple credentials or notarization, and users explicitly follow macOS's manual approval path on first launch.

## Scope

### Included

- A `platform::macos` implementation based on generated `objc2` bindings for CoreGraphics, CoreFoundation, AppKit, ApplicationServices, and QuartzCore.
- CGEventTap input capture, synchronous suppression, synthetic-event tagging, timeout re-enable, and panic containment.
- Accessibility trust status, an explicit prompt request, and a direct route to the relevant System Settings pane.
- Bundle ID and target application resolution for the foreground application and, when configured, the application under the pointer.
- A native `NSWindow` plus layer-backed AppKit view overlay. `tiny-skia` remains the shared rasterizer; no WebView is used for the trail or hint label.
- macOS command, input, clipboard, window, task-switcher, and QuickJS host implementations.
- macOS application acquisition from the pointer target and dropped `.app` bundles.
- macOS login-item reconciliation for `autoStart`; `runAsAdmin` remains a Windows-only setting and is reported as unsupported on macOS instead of being silently applied.
- Tauri entitlements/configuration plus a no-credential ad-hoc DMG workflow for manual artifacts and tagged GitHub Releases.
- Focused unit tests, Windows regression tests, macOS cross-target compile checks, and a documented on-device smoke checklist.

### Excluded

- Cloud account/sync, updater, template distribution, onboarding, and general M8 packaging polish.
- `uiAccess`, privileged macOS helpers, root execution, or attempts to bypass Transparency, Consent, and Control (TCC).
- Replacing the shared configuration schema. Existing `MacBinding.bundleId` is sufficient.
- Reproducing Windows-only behavior such as the Windows-key trigger or Task Scheduler elevation.

## Architecture

### Shared desktop consumption

The engine tracker remains unchanged. A small desktop platform facade owns services used after `EngineMsg` leaves the hook thread:

- overlay commands (`begin`, `grow`, `recognized`, `finish`, `cancel`, `status`);
- command execution and task-switcher lifecycle;
- construction of the platform `ScriptHost`;
- platform status and application acquisition.

The current Windows implementation is adapted to the facade without changing its algorithms. The consumer and QuickJS lifecycle become desktop-common code, eliminating the current large `cfg(windows)` island in `lib.rs`. Platform-native operations stay under `platform/windows` and `platform/macos`.

### Threading and ownership

- The CGEventTap owns a dedicated run-loop thread. Its callback performs only event mapping, tracker dispatch, and the synchronous return/drop decision.
- The existing engine worker continues to perform command and script work.
- AppKit objects are created and mutated only on the Tauri main thread. The macOS overlay sends value-only commands through `AppHandle::run_on_main_thread`; non-`Send` AppKit state lives in main-thread-local storage.
- Every native callback catches Rust panics. A panic fails open by returning the original event, matching the Windows FFI boundary policy.
- Synthetic events carry a GodGesture marker in `kCGEventSourceUserData`. The tap passes marked events through without feeding them back into the tracker.

## Input Capture

The tap listens at `kCGSessionEventTap`/head insertion for mouse moved/dragged, button down/up (left, right, middle, other), and scroll wheel events. It uses a default tap so returning null suppresses an event. Mapping rules are:

- CoreGraphics buttons 0/1/2/3/4 map to left/right/middle/X1/X2.
- Scroll delta sign maps to wheel forward/backward; zero deltas pass through.
- Disabled-by-timeout and disabled-by-user-input pseudo-events re-enable the tap and pass through.
- Coordinates are normalized to the engine's global top-left physical-pixel space before creating `Point` values.

The startup path checks Accessibility trust before installing the tap. If trust is absent, the settings window remains usable, platform status reports the problem, and prompting is explicit and repeatable. Granting permission can start the engine without rewriting configuration; a process restart remains an acceptable fallback if macOS does not activate the new trust in place.

## Application And Window Identity

`NSWorkspace.frontmostApplication` supplies the normal target. Pointer targeting uses the ordered on-screen CoreGraphics window list and selects the topmost eligible non-desktop window containing the gesture origin. The owner PID resolves through `NSRunningApplication` to a Bundle ID.

The engine's `native_window` field is treated as an opaque platform target identifier, not universally as a raw handle. On macOS it is a retained registry token associated with PID/window identity for the life of the command dispatch. The registry is bounded and expires old entries; consumers never reconstruct an Objective-C object from an unowned integer pointer.

Application acquisition returns a platform-neutral payload containing display name and Bundle ID. Dropped `.app` directories are validated through `NSBundle`; Windows `.exe`/`.lnk` behavior remains unchanged. The frontend fills the existing macOS binding field and does not alter the sync schema.

## Overlay

The macOS overlay uses one borderless, non-opaque, shadowless `NSWindow` per active screen. It ignores mouse events, joins all Spaces, participates as a full-screen auxiliary window, and is ordered above ordinary application windows without taking focus. A layer-backed content view receives raster frames rendered by `tiny-skia`.

Screen selection follows the gesture origin. Geometry conversion is isolated because CoreGraphics and AppKit use different vertical coordinate conventions. Trail colors, recognition color changes, label text, visibility switches, and fade behavior reuse the existing engine messages and Windows rendering semantics.

## Command Capability Matrix

| Command | macOS behavior |
| --- | --- |
| Do nothing / Pause | Shared behavior |
| Hotkey | CGEvent keyboard events with Command/Control/Option/Shift mapping |
| Web search / URL | Selected text via pasteboard-preserving Command-C; open via `NSWorkspace` |
| Window control | Accessibility actions/attributes for minimize, close, zoom, raise, move/resize; topmost is explicitly unsupported when the target does not expose an equivalent |
| Task switcher | Mission Control through the documented Control-Up keyboard path; no persistent modifier lifecycle |
| Open file | `NSWorkspace.openURL` |
| Key sequence | Shared parser semantics, emitted with CGEvent key/unicode events |
| Command line | `/bin/zsh -lc`; `showWindow` opens Terminal, otherwise detached; WGestures context variables are preserved |
| Script | Existing QuickJS runtime with a macOS `ScriptHost` |
| Audio volume | AppleScript-free media-key events where available; otherwise a stable unsupported error/log rather than silent success |

Unsupported sub-capabilities are explicit and do not crash the worker. Shell execution never interpolates untrusted configuration into an extra shell layer beyond the command text the user deliberately configured.

## Machine Settings And Permissions UI

The existing General section gains a compact macOS-only Accessibility alert with current status and two commands: request permission and open System Settings. It uses Element Plus alert/button patterns already present and all text is added to both locales.

`autoStart` is reconciled with `SMAppService.mainApp` on supported macOS versions. When unavailable, the backend returns a stable `login_item_unavailable` error. `runAsAdmin` is disabled with a macOS-specific explanation. Tray visibility continues through Tauri's tray API.

## Free DMG Distribution

The Tauri bundle includes a hardened-runtime entitlement file with only capabilities actually required. A macOS release workflow builds universal Apple Silicon/Intel artifacts and applies an ad-hoc signature without a certificate. Manual runs retain workflow artifacts; `v*` tags attach the DMG and SHA-256 checksum to a GitHub Release. The workflow verifies the signature envelope, executable architecture slices and DMG filesystem, but does not notarize, staple or claim Apple trust. Users manually approve the downloaded application through Finder or Privacy & Security before granting the separate TCC permissions.

Universal output remains the default while it needs no Intel-specific product code. If real macOS packaging proves Intel requires architecture-specific behavior or an independent maintenance path, the target narrows to Apple Silicon instead of expanding M4 scope.

## Error Handling

- Permission absence is a healthy, actionable platform state, not a process crash.
- Tap creation/run-loop failures are surfaced through platform status and logs.
- Event callbacks and Objective-C boundaries fail open on panic.
- Overlay failures hide the overlay but leave gesture recognition and command execution alive.
- Command and script host failures return stable errors/logs and do not terminate the engine worker.
- Login-item mutation follows the existing machine-setting transaction shape so file, tray, and platform effects either apply together or report incomplete rollback.

## Verification

Automated verification covers:

- Existing Windows Rust tests and clippy baseline.
- macOS event mapping, marker filtering, coordinate conversion, command planning, key mapping, Bundle ID selection, registry expiry, and machine-policy tests.
- `cargo check`/tests on a macOS target and desktop frontend tests/typecheck/build.
- Configuration validation for entitlements and the no-credential release workflow.

On-device macOS acceptance must exercise manual approval of the downloaded ad-hoc DMG, permission denial/grant/recheck, right/middle/X-button capture and click passthrough, event suppression, multi-display trail placement, full-screen overlay behavior, Bundle ID matching, each supported command, QuickJS persistence/timeout recovery, login start, upgrade permission behavior and checksum verification. M4 is not recorded as fully complete until this evidence exists; when no macOS host is available, documentation must state that exact boundary instead of claiming completion. Developer ID, notarization, stapling and warning-free Gatekeeper launch are outside the completion definition under ADR-0011.

## Decision Record

Pure Rust generated bindings were selected over a Swift helper and generic cross-platform input libraries. This keeps one signed desktop artifact, preserves direct synchronous control over event suppression, and matches the repository's existing platform-native Rust approach. The added unsafe code is confined to macOS modules with explicit callback, ownership, and main-thread boundaries.

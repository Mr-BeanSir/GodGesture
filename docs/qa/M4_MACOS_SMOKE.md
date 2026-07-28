# M4 macOS On-Device Smoke Checklist

Use a physical Mac running macOS 13 or newer. Record the macOS version, CPU architecture, display layout, application commit, signing identity, and workflow run URL with the results. A checked item requires observed behavior; configuration or compilation alone is not evidence.

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

## Commands And QuickJS

- [ ] Hotkey, Web search, selected-text capture, URL, open file, key sequence, command line (hidden and Terminal), Mission Control, pause, and volume commands are exercised.
- [ ] Clipboard contents, items, and formats survive selected-text capture when no concurrent clipboard owner changes them.
- [ ] QuickJS persistent context, all lifecycle slots, host input/window/clipboard calls, exception recovery, and the 200 ms infinite-loop interrupt are exercised.

## Machine Settings And Distribution

- [ ] Start at login registers through `SMAppService`, survives logout/login, and unregisters when disabled. A requires-approval state is shown clearly.
- [ ] Run as administrator is disabled and explained on macOS. Tray visibility applies and persists.
- [ ] The GitHub workflow produces a universal application and DMG signed by the expected Developer ID identity.
- [ ] `codesign --verify`, `xcrun stapler validate`, and both Gatekeeper assessments pass for downloaded workflow artifacts.
- [ ] A clean Mac launches the downloaded DMG application without a Gatekeeper bypass.

# M2 Application Acquisition Completion Design

Date: 2026-07-27

## Goal

Close the remaining Windows M2 application-acquisition gaps without pulling the M3 QuickJS runtime or M8 packaging work forward. Users must be able to create a Windows application binding by dragging a picker from the settings window onto a target window or by dropping an executable/shortcut into the application dialog.

M2 treats the Script command schema, editor, persistence, and WGestures source preservation as complete. Executing JavaScript remains exclusively in M3, as defined by `docs/ROADMAP.md` and ADR-0005.

## Scope

Included:

- Replace the foreground-window polling picker with a press-drag-release picker that resolves the root window under the cursor on release.
- Keep packaged-app AUMID propagation and the existing matching priority unchanged.
- Accept a single dropped `.exe` or `.lnk` in the application dialog and resolve it to a canonical executable binding in Rust.
- Expose picker/drop state and localized errors in the existing Vue dialog through `api/backend.ts`.
- Add focused Rust and Desktop tests and update M2 status documentation after verification.

Excluded:

- QuickJS execution, Monaco, or any other M3 work.
- macOS Bundle ID acquisition, CGEventTap, or other M4 work.
- Elevated Explorer-to-WebView drag-and-drop bypasses using message-filter exceptions; the existing manual fields and window picker remain available when Windows UIPI blocks a drop into an elevated settings window.
- Installer cleanup, updater, onboarding, or other M7/M8 work.
- Application-list reordering or changes to the persisted `AppEntry` schema.

## Considered Approaches

### Native cursor acquisition with the existing dialog event surface (selected)

Begin the backend picker from a pointer-down gesture, observe the physical left button until release, then resolve the root window at the final cursor position. Use Tauri's WebView drag-drop event to receive paths and a Rust command to validate/resolve them. This meets the M2 interaction while preserving the existing platform boundary and has a focused blast radius.

### Keep foreground polling and add visual instructions

This is smaller, but selecting a foreground window after an arbitrary click is not a crosshair picker and can select the wrong window under focus races. It does not satisfy the stated M2 requirement.

### Full-screen native selection overlay and raw `WM_DROPFILES` bridge

This can highlight targets and may support more elevated drag scenarios, but it creates another native window lifecycle and expands the Windows message-filter attack surface. M2 does not require those costs.

## Design

### Window picker lifecycle

`AppDialog.vue` starts selection on pointer down from an icon control and holds browser pointer capture for the gesture. The backend command waits for a genuine left-button release with a finite timeout and supports Escape cancellation. On release it reads the cursor position, resolves `WindowFromPoint` to the root ancestor, and returns the same `PickedWindow` payload already used by the dialog.

The picker rejects GodGesture's own process and windows that cannot produce a process identity. Cancellation is a normal `null` result, not an error. The dialog always clears its pending state in `finally`; successful selection fills exe name, canonical path, optional AUMID, and a default display name exactly as today.

No hover polling or target highlight is required for M2. The crosshair control, cursor state, pointer capture, and release-at-target behavior provide the acquisition contract while avoiding another overlay window.

### Dropped application files

The Desktop backend gateway owns registration for Tauri WebView drag-drop events so components do not import Tauri APIs directly. While the application dialog is open, the first path from a drop is sent to a Rust resolver command.

The resolver accepts regular `.exe` files and `.lnk` shortcuts whose resolved target is an `.exe`. It canonicalizes and verifies the final file before returning a `PickedWindow`-shaped payload with a lowercase exe name, canonical path, no synthetic AUMID, and a display name based on the dropped shortcut or executable. Unsupported types, missing targets, directories, and malformed shortcuts return stable error codes; Vue maps those codes to zh-CN/en messages. Packaged apps should be acquired through the window picker so their AUMID is preserved.

Only one path is consumed per drop. Additional paths are ignored rather than creating multiple application entries behind the modal form.

### Error and compatibility behavior

- Existing manual Windows and macOS binding fields remain available.
- Browser mock mode keeps a deterministic sample picker and exposes a no-op drop subscription.
- Non-Windows builds keep returning no window selection and reject Windows file resolution through their existing conditional boundary.
- Picker timeout, Escape, own-window release, or inaccessible target all leave form values unchanged.
- Drop errors are visible but do not close or partially save the dialog.
- No shared schema or persisted-document migration is required.

## Tests and Acceptance

- Rust tests cover picker decision helpers, own-process rejection, timeout/cancel outcomes, extension validation, canonical executable payload construction, and shortcut resolution error mapping where it can be isolated.
- Desktop tests cover drop subscription cleanup, successful form population, cancellation, localized failure, and picker pending-state cleanup.
- Shared tests/build remain unnecessary because the protocol schema does not change; Desktop typecheck/test/build and Rust library tests/clippy are required.
- Windows runtime QA verifies drag-from-picker release over a Win32 window, packaged app AUMID retention when available, `.exe` drop, `.lnk` drop, cancellation, and no regression to gesture hooks.
- M2 can be marked complete only after the automated checks pass and the Windows acquisition smoke is recorded. QuickJS remains listed under M3 rather than as an M2 defect.

## Ownership and Commits

- Rust acquisition domain: `apps/desktop/src-tauri/src/lib.rs`, `src/platform/windows/window.rs`, and any required Windows crate feature updates.
- Desktop IPC/UI domain: `apps/desktop/src/api/backend.ts`, `src/api/mock.ts`, `src/components/AppDialog.vue`, tests, and both locale files.
- Status domain: `docs/PROJECT_STATUS.md` and, only if needed to remove ambiguity, `docs/ROADMAP.md`.
- Use explicit paths and separate commits. Do not stage or modify `接手提示词.md`, do not run repository-wide `cargo fmt`, and do not push.

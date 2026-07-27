# AUMID Application Binding Design

Date: 2026-07-27

## Goal

Complete the Windows M2 application-binding path for packaged Windows apps without changing the existing binding schema or matching semantics. A foreground packaged app should expose its AppUserModelID (AUMID) to the runtime matcher, and the settings window's existing window picker should preserve that identifier when creating an app binding.

## Scope

Included:

- Query a process AUMID with `GetApplicationUserModelId` using the existing limited-information process handle.
- Carry the optional AUMID through `WindowAppInfo`, foreground-app resolution, and the `pick_window` Tauri IPC payload.
- Have `AppDialog.vue` retain the picked AUMID when saving the existing `WindowsBinding`.
- Add unit coverage for the AUMID buffer/error path and the existing matcher priority.
- Verify normal unpackaged Win32 apps still match by exact path or exe name when no AUMID exists.

Excluded:

- Drag-and-drop application discovery.
- Reworking the current foreground-window picker into a visual crosshair.
- Changes to the shared schema, macOS Bundle ID handling, Task Scheduler, QuickJS, sync, or release packaging.

## Design

### Windows identity lookup

Add the `Win32_Storage_Packaging_Appx` Windows crate feature and isolate the two-call `GetApplicationUserModelId` protocol in `platform/windows/window.rs`. The first call obtains the required UTF-16 buffer length; the second fills the buffer. Strip the terminating NUL and return `None` for ordinary unpackaged processes or any non-success Windows error. A missing AUMID is normal and must not prevent exe/path identity from being returned.

Extend the per-PID identity cache from `(exe_name, exe_path)` to `(exe_name, exe_path, aumid)`. `resolve_foreground_app` forwards the cached optional AUMID into the existing `ForegroundApp`; `IntentFinder` already implements the locked priority `AUMID -> exact path -> exe name -> Bundle ID`, so no matcher algorithm change is needed.

`WindowAppInfo` gains `aumid: Option<String>`. The same value is returned by `foreground_window_info` for the settings picker and by runtime resolution. The Tauri `PickedWindow` payload serializes it as camelCase `aumid`, with `null` when unavailable.

### Settings picker propagation

Extend the typed `PickedWindow` interface and browser mock with `aumid: string | null`. When `AppDialog.vue` receives a picked window, it sets the existing local AUMID ref to the payload value and leaves it undefined when the value is null. No new visible control or localization is needed; the current save path already persists `WindowsBinding.aumid`.

### Error and compatibility behavior

- AUMID lookup failure is fail-open for application identity: exe name/path and gesture handling continue unchanged.
- No schema or persisted-document migration is required.
- The API payload remains backward tolerant because older callers that omit AUMID still produce an undefined local binding value.
- macOS builds remain unaffected through existing `cfg(windows)` boundaries and the current `null`/no-op picker behavior.

## Tests and Acceptance

- Rust unit tests cover AUMID buffer decoding/two-call behavior, non-success/empty results, and `IntentFinder` AUMID priority over path and exe matching.
- Desktop TypeScript typecheck and build pass with the new IPC field and mock payload.
- Rust library tests and clippy pass with no new warning beyond the accepted `overlay.rs:202 while_let_loop` warning.
- On Windows, runtime smoke confirms an ordinary Win32 foreground app still resolves and gestures remain responsive; when a packaged app is available, its AUMID can be picked and its app-specific intent shadows the same exe/path binding.

## Ownership and Commit

- Rust domain: `apps/desktop/src-tauri/Cargo.toml`, `src/platform/windows/window.rs`, `src/engine/intents.rs`, and relevant `src/lib.rs` tests.
- Desktop IPC/UI domain: `apps/desktop/src/api/backend.ts`, `src/api/mock.ts`, and `src/components/AppDialog.vue`.
- Use separate domain commits with explicit paths after each domain's verification. Do not modify the user's untracked `接手提示词.md`, do not run repository-wide `cargo fmt`, and do not push.

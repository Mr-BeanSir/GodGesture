# Windows startup and administrator-run integration

Date: 2026-07-27

## Goal and scope

Implement the existing machine-local `autoStart` and `runAsAdmin` settings on Windows. The feature uses Windows Task Scheduler for login startup and `runas` for elevated manual launches, keeps login startup silent, and makes system changes participate in the existing configuration transaction and rollback model.

This work does not change the shared configuration schema. It does not implement macOS startup, release signing, a complete installer/uninstaller flow, or `uiAccess`.

## Locked product decisions

`autoStart` and `runAsAdmin` remain independent booleans with these semantics:

| `autoStart` | `runAsAdmin` | Login behavior | Manual launch behavior |
| --- | --- | --- | --- |
| `false` | `false` | No login task | Start normally |
| `true` | `false` | Start silently with the current user's standard token | Start normally |
| `false` | `true` | No login task | Relaunch through Windows `runas`; UAC may appear |
| `true` | `true` | Start silently through a highest-available login task; no login-time UAC prompt | Relaunch through Windows `runas`; UAC may appear |

The user explicitly decided that `runAsAdmin` must be available from every executable location. GodGesture therefore does not reject development, portable, per-user, or otherwise user-writable paths.

This decision has a security consequence: a highest-privilege task that points to an executable replaceable by a standard user can become a local privilege-escalation path. Moving or deleting the executable also leaves the task action invalid. These conditions are diagnosed and documented but do not block the setting.

## Architecture

Add `apps/desktop/src-tauri/src/platform/windows/startup.rs`. It owns all Windows-specific startup behavior and exposes narrow operations to the Tauri lifecycle and configuration transaction:

- derive a `StartupPolicy` from `MachineLocalSettings`;
- derive the current user's stable task identity from the Windows user SID;
- query and snapshot the GodGesture-owned task;
- reconcile, restore, or delete that task;
- detect whether the current process is elevated and whether the current account owns an elevatable split token;
- parse internal startup modes;
- invoke the current executable through `runas` and wait for elevated helper operations when necessary.

Task Scheduler is accessed through the native Windows COM API. The implementation must not shell out to `schtasks.exe`, parse localized command output, or construct a task action through command-line quoting.

The task name is namespaced by the current user SID because the Task Scheduler namespace is machine-wide. A registration marker identifies tasks owned by GodGesture. Query, update, rollback, and deletion refuse to replace an unowned task even if its name collides.

The task definition uses:

- an interactive-token logon principal for the current user;
- a logon trigger;
- `LeastPrivilege` or `HighestAvailable` according to `runAsAdmin`;
- the canonical current executable as the action path;
- a fixed `--autostart` argument;
- the executable's parent directory as the working directory;
- no battery-start restriction and no finite execution time limit;
- single-instance-compatible behavior.

No task is registered when `autoStart` is false. `runAsAdmin` without `autoStart` is implemented only by manual-launch self-elevation, not by a triggerless persistent task.

## Internal helper and UAC

Task changes first run directly on a blocking worker. If Windows rejects a change because elevation is required, GodGesture launches the same executable with the `runas` verb in an internal task-helper mode and waits for its process result. A cancelled UAC prompt and an unsuccessful helper return distinct stable failures.

The helper is handled before constructing the Tauri builder, registering the single-instance plugin, creating a WebView, installing hooks, or creating a tray icon. It only derives the current executable, current SID, and requested GodGesture policy, performs the owned-task operation, and exits. It cannot accept an arbitrary executable action from the caller.

Manual startup follows the same early-bootstrap boundary. When persisted `runAsAdmin` is true and the process is not elevated, a normal launch starts the current executable through `runas` and exits only after the elevated process was created successfully. An elevated process and all internal modes bypass this relay so elevation cannot loop. Cancelling UAC aborts that manual launch rather than silently violating the setting.

`runAsAdmin` requires the current Windows account to own an elevatable split token. A standard account that would need credentials for a different administrator is rejected with `admin_account_required` before the setting is persisted. This prevents the elevated process and helper from silently switching to another user's configuration directory and Task Scheduler identity.

Task Scheduler and UAC waits must not block the Tauri/WebView event loop. Configuration IPC performs the blocking work on a worker while preserving the single `ConfigTransaction` serialization boundary.

## Window and single-instance lifecycle

The main window is initially hidden. After setup completes:

- a normal interactive launch explicitly shows and focuses the settings window;
- `--autostart` keeps the window hidden while the engine and tray remain active;
- a second normal launch asks the existing instance to show and focus the window;
- a second `--autostart` launch exits without making the existing instance visible.

The existing close-to-tray behavior is unchanged. Startup task ownership is tied to application configuration, not window close or WebView destruction.

## Machine-settings transaction

System startup state, tray visibility, and `machine.json` form one process-level transaction under `ConfigTransaction`. The coordinator snapshots the persisted machine file, actual owned task, and tray state before applying a change.

`machine.json` is the desired-state authority. The normal apply order is:

1. validate and snapshot;
2. atomically save the requested `machine.json`;
3. reconcile the owned startup task;
4. apply tray visibility;
5. report success.

Saving desired state first avoids showing UAC before discovering a file-write failure. If a later step fails, completed steps are restored in reverse order. A complete restoration returns `apply_failed`; any restoration failure returns `rollback_incomplete` with individual rollback diagnostics.

Task Scheduler and the file system cannot form a crash-atomic transaction. Forced termination between steps may temporarily leave the task and `machine.json` inconsistent. Every full application start reconciles the owned task to `machine.json`, updating a stale executable path or privilege level and repairing missing or surplus tasks. Reconciliation failure is logged and stored in a non-persistent `MachineRuntimeStatus` managed state without preventing the gesture engine from starting.

## WGestures import integration

WGestures import can change `autoStart` and preserves the current `runAsAdmin`. It must therefore use the same startup-task effects as ordinary machine-settings saves.

Extend the existing legacy-import snapshot, progress tracking, and rollback sequence to include the owned task. A task registration failure prevents the import from committing. A later failure restores the previous task alongside both configuration files, pause hotkey, tray visibility, and engine state. Existing `apply_failed` and `rollback_incomplete` contracts remain stable.

Importing `autoStart=true` while the preserved `runAsAdmin` is true may require UAC. Cancellation is treated as a normal apply failure and restores the pre-import state.

## Frontend state and errors

The machine-setting switches use an explicit store update operation instead of relying solely on an unobservable deep-watch save. This lets the UI associate a system request with the value that caused it and show a pending state while UAC or Task Scheduler work completes.

The store keeps machine writes serialized. On success it records the normalized persisted value. On `apply_failed`, it restores the last confirmed value only if no newer edit superseded the failed request; otherwise the newer value remains queued. On `rollback_incomplete`, it reloads backend state before accepting another edit. Document saves cannot clear or hide a machine-settings error.

The Tauri backend normalizes machine-setting errors into the same structured `BackendError` mechanism used by legacy import. Localized UI messages distinguish UAC cancellation, Task Scheduler access/service failures, task ownership collision, apply failure, and incomplete rollback. Browser mock behavior remains all-or-nothing and never invokes platform capabilities.

A read-only `machine_status` IPC returns the current non-persistent `MachineRuntimeStatus`, including any startup reconciliation failure. It does not enter `MachineLocalSettings` or cloud synchronization. The browser mock returns a healthy status. The Options view shows a localized actionable error when the interactive window is opened with an unhealthy status.

The `runAsAdmin` hint continues to state that the current process privilege changes only after restart. A separate localized warning explains the accepted arbitrary-location risk without disabling the control.

## Platform behavior

This implementation is Windows-only. Non-Windows builds retain the schema and compile with unsupported/no-op platform boundaries as appropriate; they do not create startup state. Full macOS startup integration remains part of the macOS milestone and must be designed against that platform's login-item and authorization model.

## Testing

Rust unit tests cover:

- all four setting combinations and derived task policies;
- task name derivation and ownership checks;
- least/highest principals, logon trigger, action, argument, and working directory;
- no-op reconciliation and executable-path refresh;
- early-mode parsing and elevation-loop prevention;
- split-token account validation and `admin_account_required` mapping;
- UAC cancellation and helper exit mapping;
- every machine transaction failure point and reverse rollback;
- rollback failure promotion to `rollback_incomplete`;
- legacy-import task failure and restoration paths.

Desktop tests cover:

- serialized explicit machine updates;
- pending state during backend work;
- complete-failure value restoration;
- a newer edit surviving an older failed request;
- incomplete-rollback reload;
- machine errors remaining independent from document save state;
- browser mock atomicity;
- import of `autoStart` with preservation of `runAsAdmin`.

Windows runtime QA covers:

- normal launch shows the window;
- `--autostart` keeps it hidden while the tray, engine, and process remain alive;
- both second-instance cases;
- least-privilege task create/query/update/delete;
- highest-available task create/query/update/delete with explicit UAC interaction;
- manual self-elevation and UAC cancellation;
- task action repair after the executable path changes.

Runtime QA uses a uniquely named test task and always cleans up that task. It does not reuse or mutate the user's production GodGesture task unless the user explicitly exercises the real settings.

## Deferred boundaries

- NSIS uninstall cleanup and upgrade migration remain part of installer/release work. Until then, uninstalling or moving the executable may leave an inert task that must be removed manually or repaired by a later GodGesture launch.
- No `uiAccess` manifest or certificate strategy is introduced.
- No persistent journal is added for cross-resource crash recovery; startup reconciliation is the accepted recovery mechanism.
- The feature does not automatically restart the currently running process when `runAsAdmin` changes.

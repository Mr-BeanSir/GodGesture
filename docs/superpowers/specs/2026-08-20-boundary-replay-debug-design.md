# Boundary Replay Diagnostics Design

**Goal:** Make the Windows boundary-click replay path observable enough to distinguish cursor restoration failure, replay queue delay, `SendInput` failure, and slow target-menu response without changing input behavior in this iteration.

**Scope:** Desktop Rust logging and test-only observability around the existing boundary replay path.

**Non-goals:** Do not change `SetCursorPos` behavior, replace it with absolute `SendInput` movement, change the replay queue/thread, alter event swallowing, retry clicks, or claim the Windows runtime issue is fixed before a real reproduction is reviewed.

## Current Path

When a configured non-empty boundary sequence starts with the physical right button, `runtime.rs` consumes the original `ButtonDown`. If the sequence is cancelled before completion, it records a `BoundaryReplay::Click`; the platform queues that replay to the Windows hook thread. The hook message pump dequeues it and calls `input::synthesize_click`, which currently attempts `SetCursorPos` and then sends a tagged mouse down/up pair.

The existing dispatch log measures only queue enqueue-to-message-pump dequeue time. It does not measure cursor restoration, `SendInput`, or the time at which the target application displays its menu.

## Design

Keep the existing message-pump replay architecture and add a correlation id and stage logs. Every replay gets a short-lived monotonic id that is local to the process and carries no user data.

The diagnostic stages are:

1. `boundary replay requested`: boundary hit, button, target point, and cancellation reason or result context.
2. `platform.windows replay enqueued`: replay id, queue depth after enqueue, hook thread availability, and enqueue elapsed time.
3. `platform.windows replay dispatched`: replay id, queue depth after dequeue, and queue wait time.
4. `platform.windows replay cursor`: replay id, target point, cursor point before recovery, raw `SetCursorPos` result, immediate Win32 error code, cursor point after recovery, and cursor recovery elapsed time.
5. `platform.windows replay send input`: replay id, requested event count, inserted event count, short-write status, and injection elapsed time.
6. `platform.windows replay completed`: replay id and total time from dequeue through the end of the click injection call.

The cursor stage must capture the Win32 result immediately and then read the actual cursor position. A `SetCursorPos` failure with error code `0` must remain visible as a raw result, while a target that was already at the requested point must be distinguishable from a failed move. This is diagnostic classification only in this iteration; it must not skip or retry the existing call.

The `SendInput` stage must preserve the current short-write cleanup and tagged-event behavior. It only exposes the requested and inserted counts and the elapsed time. Queue-full, wake failure, and missing-hook-thread errors remain errors and receive replay correlation data where available.

Logs use the existing local JSONL logger and `debug` level for normal stage records. Existing warning/error levels remain for actual failures. Messages must not include window titles, paths, clipboard content, credentials, tokens, or plugin source. Coordinates, button names, queue counts, durations, and Win32 numeric error codes are acceptable diagnostics.

## Testing

- Extend queue tests to verify correlation ids are preserved FIFO and queue depth is reported consistently.
- Add pure helper tests for classifying cursor recovery observations, including target-already-current, successful move, Win32 failure with code `0`, and failure with a non-zero code.
- Add tests for the replay timing record so a future refactor cannot silently collapse queue wait and injection time into one value.
- Keep the existing runtime boundary tests for cancellation and replay unchanged in behavior.
- Run focused Rust library tests and clippy for the Desktop crate. Final acceptance requires a Windows debug-log reproduction at each relevant screen edge; automated tests cannot prove Explorer's menu-paint latency.

## Evidence Review Gate

After this diagnostic change is built and run, reproduce the right-click case at the bottom-right tray and at the four screen edges with the first boundary sequence enabled. Export logs containing `boundary`, `platform.windows`, and the replay id. Review the stage timings before proposing any behavioral repair. A later repair, if needed, must be a separate change with its own failing regression test and platform evidence.

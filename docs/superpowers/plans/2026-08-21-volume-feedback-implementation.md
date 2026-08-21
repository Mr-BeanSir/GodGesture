# Volume Feedback Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful volume command, show the actual final system volume or a localized mute label through the existing native overlay, using one platform-independent feedback API for ordinary gestures, modifiers, corners, and edges.

**Architecture:** Move the overlay command model and label-feedback sender into `platform/overlay.rs`, while keeping the Windows and macOS `Overlay` implementations responsible only for native windows, scheduling, rasterization, and fade mechanics. Platform command executors return an optional `AudioVolumeState` only after they mutate and re-read the system endpoint; `lib.rs` formats that state once, applies the existing display preferences, and sends the independent label command through the shared overlay API.

**Tech Stack:** Rust 2021, Tauri 2, `crossbeam-channel`, `tiny-skia`, `ab_glyph`, Windows Core Audio via the `windows` crate, macOS `osascript` volume settings, and the existing pnpm/Vitest/Vue toolchain.

## Global Constraints

- Windows and macOS must expose the same user-visible volume feedback semantics; platform-only live validation must be marked explicitly.
- Gesture trails and command labels remain native self-drawn overlays; do not add a WebView or frontend toast.
- The shared configuration protocol remains unchanged; do not modify `packages/shared`, Server, Web Console, or the v8 document shape.
- The existing `show_command_name` preference controls volume feedback visibility and `fade_out` controls its native overlay lifecycle.
- Feedback uses the post-command system state, never a calculated target or stale value; command or readback failure sends no label.
- `Locale::ZhCn` formats mute as `静音`; `Locale::En` formats it as `Muted`; `Locale::Auto` is resolved from the platform system locale before formatting.
- Use the default Windows `eRender/eMultimedia` endpoint and the macOS `get volume settings` output as the source of truth.
- New Rust tests follow TDD: write the failing test, run the narrow test and record the expected failure, then implement the smallest passing change.
- Preserve all unrelated existing worktree changes; use explicit `git add <path>` lists and never `git add -A`.

---

### Task 1: Create the Shared Native Overlay Command API

**Files:**
- Create: `apps/desktop/src-tauri/src/platform/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/platform/mod.rs`
- Modify: `apps/desktop/src-tauri/src/platform/windows/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/platform/macos/overlay.rs`

**Interfaces:**
- `platform::overlay::TrailColors { main: u32, unrecognized: u32 }`
- `platform::overlay::OverlayCommand` with the existing `Begin`, `Grow`, `Recognized`, `End`, and `Cancel` variants plus:

```rust
ShowLabelFeedback {
    origin: Point,
    text: String,
    fade_out: bool,
}
```

- `platform::overlay::OverlaySink`:

```rust
pub trait OverlaySink {
    fn send(&self, command: OverlayCommand);
}
```

- `platform::overlay::show_label_feedback`:

```rust
pub fn show_label_feedback(
    sink: &impl OverlaySink,
    origin: Point,
    text: impl Into<String>,
    fade_out: bool,
)
```

Each platform `Overlay` implements `OverlaySink`. The platform files consume the shared `OverlayCommand` type instead of declaring a second `OverlayCmd` and a second `TrailColors`.

- [ ] **Step 1: Write the failing shared API test**

Add a `RecordingSink` test double in `platform/overlay.rs` and test that the helper sends an independent label command without a preceding `Begin`:

```rust
#[test]
fn label_feedback_helper_sends_one_independent_command() {
    let sink = RecordingSink::default();
    show_label_feedback(&sink, Point { x: 10, y: 20 }, "42%", true);

    assert_eq!(sink.commands(), vec![OverlayCommand::ShowLabelFeedback {
        origin: Point { x: 10, y: 20 },
        text: "42%".into(),
        fade_out: true,
    }]);
}
```

Run from `apps/desktop/src-tauri`:

```powershell
cargo test --lib --no-default-features platform::overlay::tests::label_feedback_helper_sends_one_independent_command
```

Expected: FAIL because `platform/overlay.rs`, `OverlayCommand`, and `show_label_feedback` do not exist yet.

- [ ] **Step 2: Implement the common command model and helper**

Create the module, derive the same debug/clone traits needed by both existing platform queues, add `OverlaySink`, and add the helper shown above. Register the module unconditionally from `platform/mod.rs` so the API is available to the platform-independent engine consumer on both supported targets.

- [ ] **Step 3: Migrate both platform overlays to the shared type**

Remove the duplicate `TrailColors` and `OverlayCmd` declarations, import `OverlayCommand` and `TrailColors` from `crate::platform::overlay`, and update all queue, state, match, and test references from `OverlayCmd` to `OverlayCommand`. Implement `OverlaySink` for each platform `Overlay` by forwarding to its existing `send` method.

- [ ] **Step 4: Run the shared and existing overlay tests**

```powershell
cargo test --lib --no-default-features platform::overlay
cargo test --lib --no-default-features platform::current::overlay
```

Expected: PASS for the common helper and the existing platform overlay tests on the host target; no behavior change for `Begin`, `Grow`, `Recognized`, `End`, or `Cancel`.

- [ ] **Step 5: Commit the isolated API migration**

```powershell
git add apps/desktop/src-tauri/src/platform/overlay.rs apps/desktop/src-tauri/src/platform/mod.rs apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs
git commit -m "refactor: share native overlay command model"
```

### Task 2: Add Final Audio State and Localized Formatting

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/audio.rs`
- Modify: `apps/desktop/src-tauri/src/engine/runtime.rs`

**Interfaces:**
- `engine::audio::AudioVolumeState`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioVolumeState {
    Muted,
    Percent(u8),
}
```

- `AudioVolumeState::from_scalar(muted: bool, scalar: f32) -> AudioVolumeState`, which returns `Muted` when `muted` is true and otherwise clamps a finite scalar to `0.0..=1.0`, rounds to the nearest integer percentage, and returns `Percent(0..=100)`.
- `resolve_feedback_locale(configured: Locale, system: Locale) -> Locale`, which resolves `Auto` to the supplied concrete system locale.
- `format_volume_feedback(state: AudioVolumeState, locale: Locale) -> String`, which accepts only a concrete locale and returns `"静音"`, `"Muted"`, or an ASCII percentage.
- `PlatformServices::system_locale(&self) -> Locale`, with a default `Locale::En` implementation for test doubles and unsupported platforms.
- `EngineShared::command_feedback_preferences(&self) -> (Locale, bool, bool)`, returning the resolved locale, `gesture_view.show_command_name`, and `gesture_view.fade_out`.

- [ ] **Step 1: Write failing state and formatting tests**

Add tests covering mute precedence, lower/upper scalar bounds, nearest-integer conversion, both mute strings, and `Auto` resolution:

```rust
#[test]
fn final_audio_state_clamps_and_rounds_percent() {
    assert_eq!(AudioVolumeState::from_scalar(false, -0.2), AudioVolumeState::Percent(0));
    assert_eq!(AudioVolumeState::from_scalar(false, 0.424), AudioVolumeState::Percent(42));
    assert_eq!(AudioVolumeState::from_scalar(false, 1.4), AudioVolumeState::Percent(100));
    assert_eq!(AudioVolumeState::from_scalar(true, 0.75), AudioVolumeState::Muted);
}

#[test]
fn final_audio_state_formats_for_each_locale() {
    assert_eq!(format_volume_feedback(AudioVolumeState::Muted, Locale::ZhCn), "静音");
    assert_eq!(format_volume_feedback(AudioVolumeState::Muted, Locale::En), "Muted");
    assert_eq!(format_volume_feedback(AudioVolumeState::Percent(42), Locale::En), "42%");
    assert_eq!(resolve_feedback_locale(Locale::Auto, Locale::ZhCn), Locale::ZhCn);
}
```

Run:

```powershell
cargo test --lib --no-default-features engine::audio::tests::final_audio_state
```

Expected: FAIL because the state and formatting functions are not defined.

- [ ] **Step 2: Implement the pure audio state and formatting functions**

Keep the existing `AudioVolumeAction`, increment semantics, and target calculation unchanged. Add the state conversion and formatting functions to `engine/audio.rs`; import `Locale` from `engine::config`. Return `Locale::En` for any unresolved `Auto` only inside the formatter as a defensive assertion boundary; normal calls must pass the resolved locale from `EngineShared`.

- [ ] **Step 3: Add platform-locale resolution at the engine boundary**

Add `system_locale` to `PlatformServices` with the default implementation above. In `EngineShared::command_feedback_preferences`, read the current config under the existing finder lock and call `resolve_feedback_locale` with `self.platform.system_locale()`. Do not change serialized preferences or the shared package. Add a pure `system_locale_from_tag(&str) -> Locale` helper if the platform implementations need to normalize tags, recognizing `zh` case-insensitively and treating all other tags as English.

- [ ] **Step 4: Run the narrow tests and runtime compile check**

```powershell
cargo test --lib --no-default-features engine::audio
cargo check --lib --no-default-features
```

Expected: PASS for all audio tests and PASS for the library compile; existing runtime test doubles continue to compile through the default trait method.

- [ ] **Step 5: Commit the shared state boundary**

```powershell
git add apps/desktop/src-tauri/src/engine/audio.rs apps/desktop/src-tauri/src/engine/runtime.rs
git commit -m "feat: define final audio feedback state"
```

### Task 3: Resolve the System Locale on Windows and macOS

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/mod.rs`
- Modify: `apps/desktop/src-tauri/src/platform/macos/mod.rs`
- Modify: `apps/desktop/src-tauri/src/platform/windows/window.rs` only if the Windows locale API helper is kept beside other Win32 process helpers
- Modify: `apps/desktop/src-tauri/src/platform/macos/commands.rs` only if the macOS locale query is kept beside its existing process-backed command helpers

**Interfaces:**
- `WindowsPlatform` and `MacPlatform` implement `PlatformServices::system_locale() -> Locale`.
- Windows obtains the user locale through `GetUserDefaultLocaleName`, normalizes the returned tag with the pure audio helper, and falls back to English if the API fails.
- macOS reads `AppleLocale` once per process from `/usr/bin/defaults read -g AppleLocale`, normalizes it with the same helper, and falls back to English if the command fails or returns an empty tag. The query must be cached so a volume feedback label does not spawn a process repeatedly.

- [ ] **Step 1: Write the failing platform-locale contract tests**

Extend the pure audio tests with representative tags:

```rust
#[test]
fn system_locale_tags_use_chinese_only_for_zh() {
    assert_eq!(system_locale_from_tag("zh-CN"), Locale::ZhCn);
    assert_eq!(system_locale_from_tag("zh-Hans-CN"), Locale::ZhCn);
    assert_eq!(system_locale_from_tag("en-US"), Locale::En);
    assert_eq!(system_locale_from_tag(""), Locale::En);
}
```

Run:

```powershell
cargo test --lib --no-default-features engine::audio::tests::system_locale_tags
```

Expected: FAIL until the normalizer exists.

- [ ] **Step 2: Implement the pure tag normalizer**

Normalize leading/trailing whitespace and compare the first locale component case-insensitively. Keep this helper platform-independent so it can be tested on any host.

- [ ] **Step 3: Implement Windows locale lookup**

Use a fixed UTF-16 buffer sized for `LOCALE_NAME_MAX_LENGTH`, convert the successful result to a Rust string, and pass it to `system_locale_from_tag`. Never log or expose a locale lookup failure as a command failure.

- [ ] **Step 4: Implement cached macOS locale lookup**

Use `OnceLock<Locale>` around the `/usr/bin/defaults` lookup, trim stdout, and pass it to `system_locale_from_tag`. Treat a failed subprocess as an English fallback without affecting audio execution.

- [ ] **Step 5: Run target-appropriate checks**

```powershell
cargo test --lib --no-default-features engine::audio
cargo check --lib --no-default-features
```

On Windows, additionally run `cargo check --lib` with the normal Windows target. On macOS, run the corresponding native `cargo check --lib`. Expected: PASS; cross-platform target checks that are unavailable locally must be recorded as unavailable rather than claimed.

- [ ] **Step 6: Commit the platform locale adapters**

```powershell
git add apps/desktop/src-tauri/src/platform/windows/mod.rs apps/desktop/src-tauri/src/platform/macos/mod.rs apps/desktop/src-tauri/src/engine/audio.rs
git commit -m "feat: resolve automatic feedback locale"
```

### Task 4: Return Windows’ Post-Command Audio State

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/commands.rs`

**Interfaces:**
- Change `platform::windows::commands::execute(...)` to return `Option<AudioVolumeState>`.
- Change `audio_volume(...)` to return `Result<AudioVolumeState, String>`.
- Add a private `read_audio_volume_state(&IAudioEndpointVolume) -> Result<AudioVolumeState, String>` that reads `GetMute` first and reads `GetMasterVolumeLevelScalar` only when the endpoint is not muted.

- [ ] **Step 1: Write failing Windows state-read tests**

Add a pure command-module test for the endpoint value mapping if the mapping is kept private, or expose only a `pub(crate)` test helper:

```rust
#[test]
fn endpoint_values_map_to_final_audio_state() {
    assert_eq!(audio_state_from_endpoint_values(true, 0.8), AudioVolumeState::Muted);
    assert_eq!(audio_state_from_endpoint_values(false, 0.58), AudioVolumeState::Percent(58));
}
```

Run on Windows:

```powershell
cargo test --lib platform::windows::commands::tests::endpoint_values_map_to_final_audio_state
```

Expected: FAIL until the command boundary returns the shared state.

- [ ] **Step 2: Implement post-mutation readback**

For `AudioVolumeAction::Mute`, read the current mute bit, set its inverse, then call `read_audio_volume_state`. For scalar changes, read the current scalar, calculate the existing bounded target, set it, then call the same read helper. Do not return the calculated target. Preserve the current error messages and log errors in `execute` while returning `None` on any failure.

- [ ] **Step 3: Make every non-volume command return no feedback**

Keep the existing command behavior unchanged and return `None` for `DoNothing`, input commands, window commands, shell commands, and unexpected `NodePlugin` dispatch. Return `Some(AudioVolumeState)` only when the volume mutation and readback both succeed.

- [ ] **Step 4: Run Windows command tests and compile**

```powershell
cargo test --lib platform::windows::commands
cargo check --lib
```

Expected: PASS on Windows, with no new feedback on failed Core Audio initialization, mutation, or readback.

- [ ] **Step 5: Commit the Windows command boundary**

```powershell
git add apps/desktop/src-tauri/src/platform/windows/commands.rs
git commit -m "feat: read back Windows volume state"
```

### Task 5: Return macOS’ Post-Command Audio State

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/macos/commands.rs`

**Interfaces:**
- Change `platform::macos::commands::execute(...)` to return `Option<AudioVolumeState>` while preserving existing error logging.
- Change `audio_volume(...)` to return `Result<AudioVolumeState, String>`.
- Add `parse_volume_state_output(output: &str) -> Result<AudioVolumeState, String>` for the stable `osascript` output format `"<output volume>|<output muted>"`.

- [ ] **Step 1: Write failing AppleScript output tests**

```rust
#[test]
fn parses_final_macos_volume_state() {
    assert_eq!(parse_volume_state_output("42|false\n").unwrap(), AudioVolumeState::Percent(42));
    assert_eq!(parse_volume_state_output("0|true\n").unwrap(), AudioVolumeState::Muted);
    assert!(parse_volume_state_output("not-a-state").is_err());
    assert!(parse_volume_state_output("101|false").is_err());
}
```

Run on macOS:

```powershell
cargo test --lib platform::macos::commands::tests::parses_final_macos_volume_state
```

Expected: FAIL because the parser and state return type do not exist.

- [ ] **Step 2: Extend the AppleScript to mutate and report in one invocation**

Keep the current mute toggle and increment/decrement expressions. Append:

```applescript
set finalSettings to get volume settings
return ((output volume of finalSettings) as text) & "|" & ((output muted of finalSettings) as text)
```

Parse stdout only after the process exits successfully. Require an integer volume in `0..=100` and a boolean mute token; return an error for empty, malformed, or out-of-range output.

- [ ] **Step 3: Return no feedback on any script or parse failure**

Map successful parsed state to `Some(AudioVolumeState)` in `execute`; keep all other commands at `None` and retain the current `macOS command ... failed` log path.

- [ ] **Step 4: Run parser tests and macOS compile**

```powershell
cargo test --lib platform::macos::commands
cargo check --lib
```

Expected: PASS on macOS, including invalid output coverage; a failed `osascript` process produces no label.

- [ ] **Step 5: Commit the macOS command boundary**

```powershell
git add apps/desktop/src-tauri/src/platform/macos/commands.rs
git commit -m "feat: read back macOS volume state"
```

### Task 6: Implement Independent Label Rendering in Both Native Overlays

**Files:**
- Modify: `apps/desktop/src-tauri/src/platform/windows/overlay.rs`
- Modify: `apps/desktop/src-tauri/src/platform/macos/overlay.rs`

**Interfaces:**
- `OverlayCommand::ShowLabelFeedback` works without an active path or prior `Begin`.
- The command stops an existing fade, clears old points and old label state, selects the display from `origin`, sets the label text, renders with `show_path = false` and `show_label = true`, and follows `fade_out` using the platform’s existing fade timer/scheduler.
- A new label replaces any previous label and cannot leave the previous text in the pixel buffer.

- [ ] **Step 1: Write failing platform overlay tests**

Add one test per platform state machine asserting that the command is accepted while inactive and that it replaces stale label data:

```rust
#[test]
fn independent_label_feedback_does_not_require_active_trail() {
    let mut state = test_state_without_display_side_effects();
    state.apply(OverlayCommand::ShowLabelFeedback {
        origin: Point { x: 100, y: 200 },
        text: "42%".into(),
        fade_out: true,
    });
    assert_eq!(state.label.as_deref(), Some("42%"));
    assert!(state.points.is_empty());
}
```

Use the existing state-test helpers or extract a small state transition helper so the test does not require a real monitor/window. Run the platform-specific test on its native target and record the compile limitation on other hosts.

Expected before implementation: FAIL because both state machines reject or do not recognize `ShowLabelFeedback`.

- [ ] **Step 2: Implement Windows independent-label lifecycle**

In `drain_commands`, handle `ShowLabelFeedback` by stopping the timer, hiding/clearing the old surface state, calling `ensure_surface_for(origin)`, resetting points and recognition state, assigning the new label and feedback display flags, restoring alpha, and rendering the label without a trail. Start the existing fade timer after the label has been presented when `fade_out` is true; follow the existing immediate-hide branch when it is false.

- [ ] **Step 3: Implement macOS independent-label lifecycle**

In `OverlayState::apply`, add a branch that ensures the origin display exists before setting the label, clears points, sets the label-only flags, restores alpha, and returns the existing `ApplyEffect` shape so the main-thread drain renders before spawning the existing fade worker. Increment the generation for this command so a prior fade cannot hide the replacement label. Mirror the Windows immediate-hide behavior when `fade_out` is false.

- [ ] **Step 4: Run native overlay regressions**

```powershell
cargo test --lib platform::current::overlay
cargo fmt --check
```

Expected: PASS for the new inactive-label and replacement-label tests plus all existing trail, recognition, queue, and fade tests.

- [ ] **Step 5: Commit the independent label lifecycle**

```powershell
git add apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs
git commit -m "feat: add native label feedback command"
```

### Task 7: Connect Volume Results to All Command Entry Points Once

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- `execute_intent(...)` accepts the current platform `Overlay` reference and, after native execution returns `Some(AudioVolumeState)`, calls one private `show_volume_feedback(...)` helper.
- `show_volume_feedback(...)` reads `shared.command_feedback_preferences()`, returns immediately when `show_command_name` is false, formats with `format_volume_feedback`, and calls the common `show_label_feedback` helper with `invocation.gesture.origin` and the configured `fade_out`.
- Node plugin execution and all non-volume commands never send a volume label.

- [ ] **Step 1: Write the failing consumer-helper test**

Add a test double implementing `OverlaySink` and test the private helper at the formatting boundary:

```rust
#[test]
fn volume_feedback_helper_honors_visibility_and_uses_origin() {
    let sink = RecordingSink::default();
    show_volume_feedback(
        &sink,
        AudioVolumeState::Percent(42),
        Locale::En,
        true,
        true,
        Point { x: 300, y: 400 },
    );
    assert!(matches!(sink.commands()[0], OverlayCommand::ShowLabelFeedback {
        origin: Point { x: 300, y: 400 },
        ref text,
        fade_out: true,
    } if text == "42%"));

    let hidden = RecordingSink::default();
    show_volume_feedback(&hidden, AudioVolumeState::Muted, Locale::ZhCn, false, true, Point { x: 0, y: 0 });
    assert!(hidden.commands().is_empty());
}
```

Run:

```powershell
cargo test --lib --no-default-features volume_feedback_helper_honors_visibility_and_uses_origin
```

Expected: FAIL because the unified consumer helper is not present.

- [ ] **Step 2: Implement the single feedback path in `lib.rs`**

Import `AudioVolumeState`, `format_volume_feedback`, `OverlayCommand`, `OverlaySink`, and `show_label_feedback` from their shared modules. Change the native platform `execute` call to return an optional state, then pass the state to `show_volume_feedback`. Keep the Node plugin branch unchanged except for its explicit no-feedback return.

- [ ] **Step 3: Thread the overlay reference through every current native execution call**

Update the existing calls under `EngineMsg::ModifierFired`, `EngineMsg::PathEnded` (both direct Node/native handling paths), and `EngineMsg::CornerEdgeFired`. Because all four user-visible routes call `execute_intent`, no branch may construct a separate label string or send a platform-specific command. Keep `OverlayCommand::End` before deferred ordinary command execution so the label feedback replaces the ended trail after the command returns.

- [ ] **Step 4: Test visibility, mute text, and non-volume behavior**

```powershell
cargo test --lib --no-default-features volume_feedback
cargo test --lib --no-default-features engine::runtime
cargo check --lib --no-default-features
```

Expected: PASS for the helper and existing runtime tests; volume feedback is suppressed only by `show_command_name`, and command execution still occurs when the label is hidden.

- [ ] **Step 5: Commit the engine-consumer integration**

```powershell
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: show final volume in native overlay"
```

### Task 8: Update Project Status and Complete Verification

**Files:**
- Modify: `CONTEXT.md` only if the shared `ShowLabelFeedback` term is not already documented there
- Modify: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Project status records the new public native overlay feedback boundary, the audio readback behavior on both platforms, automated test evidence, and any remaining native-device acceptance gap.
- No historical changelog entry is added for ordinary development work.

- [ ] **Step 1: Run the focused Rust verification**

From `apps/desktop/src-tauri`:

```powershell
cargo fmt --check
cargo test --lib --no-default-features
cargo clippy --lib --no-default-features -- -D warnings
```

Expected: PASS with the existing baseline tests plus the new audio, command parser, overlay, and consumer tests. If a platform-specific module cannot compile on the current host, run it on its native target and document the unavailable target instead of weakening the tests.

- [ ] **Step 2: Run desktop integration checks**

From the repository root:

```powershell
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop test -- --run
git diff --check
```

Expected: PASS; the frontend should have no behavior changes, but typecheck and existing UI tests guard the unchanged Tauri boundary.

- [ ] **Step 3: Perform native-device acceptance**

On Windows, execute a volume-up, volume-down, and mute gesture against the default output endpoint and verify the overlay shows the post-command integer percentage or `静音`/`Muted` according to the configured locale. Repeat on macOS and verify the same three operations. Repeat through an ordinary path, modifier, trigger corner, and friction edge. Toggle `show_command_name` off and verify commands still run without a label; toggle `fade_out` and verify the existing native lifecycle.

- [ ] **Step 4: Record verification and status**

Update `docs/PROJECT_STATUS.md` with exact command results and clearly separate Windows/macOS live acceptance from host-only automated tests. Add the term to `CONTEXT.md` only when it is absent; do not alter unrelated user changes in either file.

- [ ] **Step 5: Review the final diff and commit only owned paths**

```powershell
git status --porcelain=v1
git diff --stat -- apps/desktop/src-tauri/src/engine/audio.rs apps/desktop/src-tauri/src/engine/runtime.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/platform/overlay.rs apps/desktop/src-tauri/src/platform/mod.rs apps/desktop/src-tauri/src/platform/windows/commands.rs apps/desktop/src-tauri/src/platform/windows/mod.rs apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/commands.rs apps/desktop/src-tauri/src/platform/macos/mod.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs CONTEXT.md docs/PROJECT_STATUS.md
git diff --check
git add CONTEXT.md docs/PROJECT_STATUS.md apps/desktop/src-tauri/src/engine/audio.rs apps/desktop/src-tauri/src/engine/runtime.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/platform/overlay.rs apps/desktop/src-tauri/src/platform/mod.rs apps/desktop/src-tauri/src/platform/windows/commands.rs apps/desktop/src-tauri/src/platform/windows/mod.rs apps/desktop/src-tauri/src/platform/windows/overlay.rs apps/desktop/src-tauri/src/platform/macos/commands.rs apps/desktop/src-tauri/src/platform/macos/mod.rs apps/desktop/src-tauri/src/platform/macos/overlay.rs
git commit -m "feat: add final volume overlay feedback"
```

Expected: only the listed feature files are staged; all pre-existing worktree changes remain unstaged and untouched.

## Plan Self-Review

- **Spec coverage:** final state readback, mute wording, percentage bounds, `show_command_name`, `fade_out`, `Locale::Auto`, four command entry points, shared overlay API, independent label lifecycle, Windows Core Audio, macOS AppleScript parsing, failure behavior, tests, and native acceptance are covered by Tasks 1-8.
- **Placeholder scan:** the plan contains no unresolved placeholder or deferred implementation step; unavailable cross-platform checks are explicitly recorded as verification conditions.
- **Type consistency:** all later tasks use `OverlayCommand`, `OverlaySink`, `show_label_feedback`, `AudioVolumeState`, `format_volume_feedback`, `PlatformServices::system_locale`, and `EngineShared::command_feedback_preferences` exactly as introduced in earlier tasks.
- **Scope check:** no shared JSON protocol, frontend component, Server module, Web Console module, or unrelated platform refactor is included.

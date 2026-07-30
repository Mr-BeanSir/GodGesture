# Unified Actions and Hotkey Recording Design

Date: 2026-07-30
Status: Approved in conversation

## Goal

Resolve three related Desktop UX gaps:

1. Keep the application list in the Gestures workbench on a white surface.
2. Make hotkey recording replace the previous value, capture modifier-only
   combinations, and finish without requiring an outside click.
3. Move hot corners and rub edges into the Gestures workbench and support a
   bounded action sequence after a boundary is reached, rather than one command
   per corner or edge.

The feature remains cross-platform. Windows and macOS share the synced model and
platform-independent matchers; native hook integration remains platform-specific.

## Product Model

### Action

The Gestures workbench manages two kinds of actions:

- Gesture intent: the existing trigger button, stroke sequence, optional
  modifier, and command mapping. Application scopes continue to support these.
- Boundary intent: a global-only mapping from a hot corner or rub edge, followed
  by an optional event sequence, to a command.

Boundary intents are global because a corner or edge has no stable application
ownership and the existing corner/edge configuration is already global. A
boundary intent is visible only while the Global App is selected.

### Boundary Sequence

A boundary intent contains:

- an origin: one of four hot corners or four rub edges;
- zero to twelve ordered input tokens;
- a name, command, and display order.

Supported tokens are deliberately bounded to input that both native hooks can
observe consistently:

- wheel forward or backward;
- left, middle, right, X1, or X2 button down;
- an existing stroke direction.

An empty sequence executes as soon as the origin detector fires. A non-empty
sequence opens a short-lived matching session and executes when the sequence is
complete. This covers existing one-command corner/edge settings and the useful
WGestures 2 patterns of boundary then wheel, mouse button, or continued stroke,
without turning the mature gesture parser into an unrestricted event language.

## Gestures Workbench

The left application pane keeps its current structure and uses a white
background as requested. The existing user edit in `GesturesView.vue` is the
source of that change and must be preserved.

The right-side list is generalized from gesture intents to actions:

- when Global App is selected, it contains global gesture intents and boundary
  intents;
- when an application is selected, it contains only that application's gesture
  intents;
- each row identifies its kind and displays a compact mnemonic;
- both kinds reuse the existing command editor and name editor;
- re-record and delete act on the selected kind.

The primary button changes from "Record new gesture" to "Add new action". It
opens a two-step dialog matching the existing onboarding dialog rhythm:

1. Choose "Record gesture" or "Boundary action".
2. Complete the selected recorder and confirm.

The separate Hot Corners & Rub Edges navigation item and page are removed.
Their global enabled toggles move into the Global App action area. The page
component may be deleted only after all behavior and translations are routed to
the unified workbench.

## Boundary Recorder

The recorder first presents a stable monitor-shaped picker with eight origins:
four corners and four edges. It then records the optional event sequence.

Recording behavior:

- entering the recorder does not mutate saved configuration;
- the chosen origin and captured tokens are held as a draft;
- live mnemonic feedback uses the same visual vocabulary as the action list;
- Removing draft tokens retains the chosen origin;
- Cancel discards the draft;
- Confirm atomically adds or replaces the intent;
- exact duplicates are conflicts and offer overwrite;
- if one sequence is a prefix of another at the same origin, the recorder
  requires the user to keep recording or replace the conflicting action rather
  than creating an ambiguous pair.

The recorder uses an explicit picker for the origin and appends normalized
wheel, mouse-button, or stroke tokens from bounded selectors. This keeps the
draft deterministic in both Tauri and browser preview without opening a second
global native capture session.

## Hotkey Recording

`HotkeyInput` becomes a transaction-oriented recorder with a small internal
state machine instead of binding each keydown directly to configuration.

### Lifecycle

1. Focus or click starts a fresh draft and snapshots the current committed
   value.
2. Keydown updates the draft. Ctrl, Shift, Alt, and Meta are displayed
   immediately and are valid even without a main key.
3. Keyup tracks which physical keys remain pressed.
4. When all keys from the current chord have been released, the draft is
   committed once and recording stops automatically.
5. Escape cancels and restores the snapshot.
6. The Clear command is the only action that intentionally commits an empty
   value.
7. Blur cancels an incomplete draft; it is no longer required to finish a valid
   recording.

Every new recording replaces the previous value. In multi-key command mode,
main keys pressed during the same chord form the new `keys` array; existing keys
are never appended. Auto-repeat and duplicate left/right variants of the same
logical modifier are deduplicated.

Windows displays Meta as Win; macOS displays it as Cmd. The stored canonical
name remains `meta`.

Pure modifier commands remain valid. Both native input implementations already
support pressing and releasing modifiers when the main-key array is empty; tests
will lock this behavior on both platforms.

## Synced Schema and Migration

The synced configuration format advances from version 1 to version 2.

Version 2 adds a bounded global `boundaryIntents` collection and replaces the
legacy command maps as the runtime source of truth. Shared Zod schemas,
TypeScript consumers, Rust mirrors, generated API artifacts, browser fixtures,
template planning, and legacy importers must move in the same protocol change.

On reading version 1:

- each `hotCorners.commands[corner]` entry becomes a boundary intent with the
  corresponding hot-corner origin and an empty sequence;
- each `rubEdges.commands[edge]` entry becomes a boundary intent with the
  corresponding rub-edge origin and an empty sequence;
- enabled flags retain their values;
- generated identifiers are stable for the migrated document so repeated reads
  do not churn configuration;
- the next successful save writes version 2.

No migration silently drops commands. Invalid or over-limit data follows the
existing structured validation and import-diagnostic paths.

## Runtime Architecture

The existing `CornerEdgeDetector` remains responsible only for detecting a hot
corner or completed rub edge. A new platform-independent boundary sequence
matcher consumes the detected origin and subsequent normalized hook events.

The matcher:

- selects candidates for the detected origin;
- executes an empty-sequence candidate immediately;
- narrows candidates by ordered token prefix;
- has explicit size and time bounds;
- cancels on timeout, pause, capture mode, configuration replacement, or an
  impossible next token;
- never executes more than one intent for one completed sequence.

Native hook adapters normalize Windows and macOS mouse events into the same
matcher tokens. Potentially consumed mouse buttons or wheel input are buffered
only while at least one configured candidate can match. On mismatch, timeout,
or cancellation, unmatched input is restored through the platform's existing
synthetic-input boundary. GodGesture's synthetic marker prevents replay from
re-entering recognition. Failure paths remain fail-open and log a stable error.

Ordinary gesture recognition and boundary sequence recognition remain separate
state machines coordinated by the runtime. This avoids changing established
gesture uniqueness, PathEnd, modifier execution, capture, and script lifecycle
semantics.

## Error and Conflict Handling

- The recorder prevents additions after the twelve-token limit while keeping
  the existing draft editable.
- Exact or prefix boundary conflicts are resolved before configuration mutation.
- Schema migration errors do not overwrite the source document.
- Runtime replay failure is logged; the matcher is reset so it cannot remain
  stuck in a consuming state.
- Removing the dedicated page must not remove the global enable switches.

## Verification

Focused verification includes:

- shared schema tests for version 2, capacity limits, and deterministic v1
  migration;
- importer and template tests for boundary intents;
- Desktop tests for the two-step dialog, Global App visibility rules, action
  list editing, bilingual copy, and minimum `800x560` layout;
- hotkey recorder tests for modifiers, modifier-only chords, replacement,
  multi-key chords, auto-repeat, Escape, blur, clear, and automatic completion;
- Rust matcher tests for empty sequences, every token kind, exact completion,
  prefixes, timeout, cancellation, configuration replacement, and replay;
- Windows and macOS native adapter tests where platform APIs can be isolated;
- targeted TypeScript builds/tests, Rust library tests, clippy with warnings
  denied, and `git diff --check`;
- Windows runtime smoke for modifier-only hotkeys and representative boundary
  sequences;
- macOS source/build validation where available, with real-device behavior left
  explicitly pending until observed on a Mac.

`CONTEXT.md` and `docs/PROJECT_STATUS.md` are updated in the implementation
commit because the new terms, feature status, entry points, migration behavior,
and verification baseline become current only when the code lands.

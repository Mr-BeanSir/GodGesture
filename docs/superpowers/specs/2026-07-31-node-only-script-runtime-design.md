# Node-only Script Runtime Design

Date: 2026-07-31
Status: Approved in conversation; implementation gated by performance prototype

## Goal

Move GodGesture's executable JavaScript model to a bundled Node.js runtime so
scripts can use the real Node platform and npm ecosystem, including `fetch`,
ES modules, `node:fs`, `node:path`, `node:crypto`, and `child_process`. The
runtime must remain responsive for global mouse gestures and must not require a
system-wide Node or npm installation.

The existing QuickJS implementation remains the compatibility baseline during
the prototype and migration period. It is removed only after the performance
gate in this document passes on Windows and macOS.

## Principles

- One executable JavaScript runtime is the long-term product direction: Node.js.
- Node is launched once and kept warm; a gesture never launches a process or
  installs a package.
- Package source and lockfiles are user data; installed packages are a local
  cache and are recreated per machine.
- The native input hook never waits for network or arbitrary plugin work.
- Existing scripts migrate automatically; users do not rewrite five lifecycle
  fields by hand.
- Open source improves auditability but does not make dependencies trustworthy.
  Package installation and imported plugins therefore retain explicit trust
  and lifecycle-script controls.

## Runtime Architecture

The Tauri process owns the native hook, gesture matcher, configuration and
window/input APIs. A bundled Node.js LTS sidecar is started during application
startup and supervised by Tauri.

The sidecar has a persistent supervisor and one preloaded Worker per enabled
plugin. Rust and the supervisor communicate through a length-prefixed message
protocol over the platform's private local process channel. JSON is used for
the first protocol revision because payloads are small and inspectable; the
framing layer prevents partial reads from becoming protocol messages.

Each plugin worker loads its project once and exposes named async lifecycle
exports. The supervisor serializes events per plugin, applies cancellation and
timeouts, and returns host calls to Rust. A worker crash removes only that
plugin from the active set; the supervisor can restart it without restarting
the native hook.

The input hook returns immediately after recognition and queues a script event.
Commands such as `Input.keyCombo` are executed through the host-call channel.
Network and filesystem operations complete asynchronously and report failures
to the plugin event result or the command hint, never by blocking the hook
callback.

## Plugin Model

Plugins become first-class synced user data. A plugin contains:

- stable id, display name, entry module and exported handlers;
- a bounded map of source files, including `index.mjs` (maximum 64 files,
  256 KiB per file and 1 MiB total source per plugin);
- `package.json` and an exact lockfile when dependencies are used (64 KiB and
  512 KiB maximum respectively);
- requested package metadata and a local-only installation status.

The gesture command references a plugin id and export name. A simple one-file
script is represented by a generated plugin project and displayed as one editor
file. Adding a dependency transparently reveals the manifest and dependency
views; the user does not have to understand the underlying JSON shape.

Installed `node_modules` content is never synced. It lives under the GodGesture
application-data directory, keyed by plugin id, platform, architecture and
lockfile hash. Offline execution uses an existing cache; a missing cache makes
the plugin unavailable with a stable error rather than silently installing
packages during a gesture.

The configuration document limit is raised from the current `256 KiB` to
`4 MiB` in the plugin protocol revision. The existing whole-document optimistic
sync and last-write-wins rules remain unchanged. A document may contain at most
32 Node plugins; source, manifests and lockfiles count toward the 4 MiB limit.

## SDK and Lifecycle

GodGesture ships an npm package named `@godgesture/sdk` with TypeScript
declarations and runtime helpers. The SDK mirrors the existing host contract:

```js
export async function execute(context) {
  const response = await fetch("https://example.com/data");
  const value = await response.json();
  await context.input.sendText(String(value.result));
}
```

The supported handlers are `init`, `execute`, `gestureRecognized`,
`modifierTriggered`, and `gestureEnded`. They receive a serializable context
with origin, endpoint, trigger button, modifier and target-window operations.
The SDK exposes input, window, clipboard and status methods as async functions;
the implementation may complete a local operation immediately but keeps one
consistent async surface for Node code.

The host does not expose Rust pointers, HWNDs, Objective-C objects, or generic
native handles. Path, process and network APIs are the real Node APIs. Their use
is shown in the plugin manifest and editor diagnostics as a trust summary, not
as a security sandbox or capability restriction.

## Package Management

The desktop bundle includes a pinned Node.js LTS binary and a pinned pnpm CLI.
The user's PATH, global npm and global package directory are not consulted.

Install flow:

1. Validate and normalize `package.json` and the requested dependency range.
2. Resolve and write an exact lockfile in the plugin project.
3. Install into the plugin-local cache using the bundled pnpm.
4. Run a typecheck/import smoke before marking the plugin ready.

Lifecycle scripts are disabled by default for imported packages and require an
explicit plugin-level approval. Native addons are supported only when the npm
package supplies a prebuilt artifact for the current OS and architecture; the
application does not ship a compiler toolchain.

## Editor and User Workflow

The Gestures workbench keeps its existing command editor for lightweight
actions. A Node command shows the selected plugin and exported handler plus an
`Open plugin editor` command.

The plugin editor is a dedicated workspace with:

- a file tree and multiple Monaco tabs;
- Node.js and `@godgesture/sdk` completion, diagnostics and hover;
- package search, install, update and removal;
- manifest/lockfile diff and local cache state;
- Problems, typecheck output and a bounded test/run console.

The first-run conversion command creates `index.mjs`, package metadata and the
handler mapping from the existing QuickJS fields. The old command remains
available until the converted plugin is successfully tested and selected.

## Migration and Compatibility

Existing `script` commands are read without changing their stored meaning.
Migration creates a Node plugin with equivalent lifecycle exports and preserves
the original source in a migration note until the user confirms conversion.
Lua imports remain non-executable and are not converted automatically.

During the migration release, QuickJS and Node commands can coexist, but no new
standard library features are added to QuickJS. The final release removes the
QuickJS engine and rejects only configurations that still contain an unconverted
legacy script, with an actionable conversion path.

## Performance Gate

Before removing QuickJS, a real end-to-end benchmark runs on Windows and macOS
with a warm sidecar and preloaded plugin:

- no-op handler dispatch p95 <= 5 ms;
- a representative `Input` host call p95 <= 8 ms;
- p99 <= 16 ms for both cases;
- no process launch, module load or package install on the first gesture;
- 10,000 sequential events preserve ordering and show no unbounded queue;
- sidecar restart and worker crash recover without losing the native hook.

The benchmark records cold startup separately. If the gate fails, the project
does not silently ship Node-only; QuickJS remains the low-latency fallback and
the failing evidence is recorded in `docs/PROJECT_STATUS.md`.

## Trust and Distribution

Plugins from the user's machine are trusted according to the user's normal
process permissions. Plugins imported from a template or repository display
their source, dependency list and requested capabilities before activation.
Template packages remain plain source and metadata in the GitHub distribution
repository; no executable package cache is downloaded as part of a template.

## Verification

The implementation plan must add:

- shared schema, migration, size-limit and sync round-trip tests;
- Node protocol framing, ordering, cancellation, timeout and restart tests;
- plugin package installation, offline cache and lockfile tests;
- Monaco multi-file editor and type declaration tests;
- Windows and macOS host-call contract tests;
- the end-to-end performance benchmark and evidence artifact;
- a real Windows smoke and a real macOS smoke before declaring Node-only done.

The user-facing `docs/SCRIPTING.md` is generated only after the SDK, manifest
schema and editor workflow are implemented and tested.

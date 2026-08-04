# Filesystem Node Plugin Workspace Design

## Decision

GodGesture will use external Node.js/TypeScript projects as the source of truth
for Node plugins. The desktop app will no longer provide an in-app source editor
or support registering arbitrary external project directories. It will scan one
user-writable plugin workspace and expose a dedicated Plugins page for discovery,
status, reload, and opening that folder in the system file manager.

The application install directory is explicitly not a user plugin location. On
Windows it may be read-only (`Program Files`) and on macOS changing an `.app`
bundle invalidates the signed package and risks updater conflicts.

## Plugin Project Contract

Each immediate child directory in the plugin workspace is a plugin project. Its
`package.json` is both the npm manifest and the GodGesture manifest via a
`godgesture` field:

```json
{
  "name": "gesture-demo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "godgesture": {
    "id": "io.github.example.gesture-demo",
    "apiVersion": 1,
    "entry": "dist/index.mjs",
    "actions": [{ "id": "default", "name": "执行", "export": "onExecute" }]
  },
  "devDependencies": { "@godgesture/sdk": "^0.1.0" }
}
```

The stable plugin ID and action IDs are stored by gesture commands. Plugin source,
`package.json`, and lockfile are local project files managed by the user and Git;
they are no longer embedded in or synchronized as part of `ConfigDocument`.

## Development Package

Publish `@godgesture/sdk` as the public developer package containing the SDK
types, lifecycle contracts, and the runtime-neutral `defineHandler` helper. The
desktop bundle embeds the matching runtime and declaration files, so production
execution remains offline and does not depend on npm. A separate executable entry
in the same package provides:

```text
npx @godgesture/plugin create <directory>
npx @godgesture/plugin validate
```

`create` writes a TypeScript-ready project with all five `onXxxx` lifecycle
templates, package scripts, and a pinned SDK dev dependency. `validate` checks the
manifest, entry, action exports, lifecycle names, and lockfile without executing
host side effects.

## Desktop Plugin Page

Add a `插件` navigation item with a folder/code icon. The page is a dense two-zone
workbench:

```text
┌──────────────────────┬────────────────────────────────────┐
│ Plugins               │ gesture-demo                       │
│  [打开插件目录]       │ ● 已加载        [重新加载] [打开目录] │
│                      │                                    │
│ ● gesture-demo       │ 入口       dist/index.mjs          │
│   已加载 · 3 actions  │ 版本       0.1.0                   │
│ ! broken-plugin       │ API        1                       │
│   manifest 错误       │                                    │
│                      │ Actions                            │
│                      │  default      onExecute            │
│                      │                                    │
│                      │ Output / Problems                  │
└──────────────────────┴────────────────────────────────────┘
```

The page never embeds a code editor. It shows project health, manifest metadata,
declared actions, last reload time, bounded output, and structured errors. The
primary action is opening the workspace; the secondary action rescans/reloads.
All copy is provided through zh-CN/en locales.

## Runtime and Hot Reload

The Rust service watches the default workspace recursively with a debounced,
cross-platform file watcher. It ignores `node_modules`, VCS metadata, and cache
directories. A change produces a candidate snapshot:

1. Wait for a stable write and parse/validate `package.json`.
2. Verify portable paths, entry existence, action exports, API version, and exact
   lockfile when dependencies are present.
3. Materialize the candidate into an OS/architecture/revision-isolated cache.
4. Reuse or prepare the dependency layer outside the gesture path. Lifecycle
   scripts remain disabled unless explicitly trusted.
5. Import the entry and start a replacement Worker. Run `onInit` before activating
   it.
6. Atomically switch future invocations to the replacement. Keep the last known
   good Worker active when validation, import, dependency preparation, or init
   fails, and surface the bounded diagnostic on the Plugins page.

Code-only saves therefore reload quickly, while a broken save cannot take down the
currently working gesture. New projects require an explicit trust/enable action
before their code is executed.

## Configuration and Migration

`ConfigDocument` stores only `pluginId` and `actionId` references. Missing local
plugins produce a stable `plugin_not_installed` status and no-op execution with a
visible diagnostic. A one-time v6 migration exports legacy embedded plugins into
the default workspace before removing their source from the synchronized document.
This is an explicit data migration, not a compatibility runtime.

The new filesystem source boundary supersedes the plugin-source synchronization
consequence in ADR-0012 and must be recorded there before implementation lands.

## Verification

- Shared schema tests cover package metadata, action references, API versions, and
  removal of embedded plugin source.
- Rust tests cover workspace discovery, debounce/fingerprint behavior, staged
  reload rollback, path validation, and missing-plugin errors on Windows and macOS
  builds.
- Desktop tests cover Plugins navigation, empty/broken/ready states, localized
  actions, and bounded output rendering at `800x560`.
- CLI tests cover `create`, `validate`, lifecycle templates, and dry-run import.
- Release checks confirm no user plugin files are placed inside Windows or macOS
  install resources.

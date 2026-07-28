# GodGesture Gesture Templates

This directory is the source seed for the standalone public repository at
`https://github.com/Mr-BeanSir/gesture-templates`. It is kept in the application
repository until that repository is created; it is not a runtime asset and must
not be served by the GodGesture account Server.

## Release Layout

Each release publishes these files without renaming them:

```text
catalog.json
global-window-basics.json
browser-window-basics.json
```

The Desktop reads the latest release catalog from:

```text
https://github.com/Mr-BeanSir/gesture-templates/releases/latest/download/catalog.json
```

Every `packageUrl` in `catalog.json` points to another asset in the same latest
release. Catalog and package format version 1 are defined and validated by
`@godgesture/shared`; the public repository must not maintain a divergent copy
of the schema.

## Updating Content

1. Add or update a package under `packages/`.
2. Update the matching catalog identity, metadata, target summary, risks, and
   release URL.
3. Run `pnpm validate:templates` from the GodGesture application repository.
4. Review all executable commands as untrusted public content. Script,
   command-line, file/program, URL, and Web Search commands require matching
   risk declarations and stronger confirmation in the Desktop.
5. Publish all files together in one GitHub Release. Never publish a catalog
   before every referenced package asset is available.

The initial packages intentionally contain only native window-control commands.
They do not execute scripts, command lines, programs, files, searches, or URLs.

## Repository Boundary

When the standalone repository is initialized, copy this README, `catalog.json`,
and the contents of `packages/` into its root release source. The application
repository retains this seed as the reviewed source of its browser fixtures and
contract tests. Creating the public repository and pushing these files are
external release operations and are not performed by Codex automatically.

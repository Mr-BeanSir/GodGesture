# Project Status Handoff Design

Date: 2026-07-27

## Goal

Provide a concise, durable repository entry point that lets a new AI collaborator understand GodGesture's implemented subsystems, unfinished boundaries, critical semantics, validation commands, and safe working practices before adding a feature or fixing a bug.

## Decision

Add `docs/PROJECT_STATUS.md` as the authoritative description of current implementation status. Keep the existing documentation responsibilities separate:

- `CONTEXT.md` owns domain terminology.
- `docs/adr/` owns architectural decisions and their rationale.
- `docs/ROADMAP.md` owns milestone intent and future scope.
- `docs/PROJECT_STATUS.md` owns what exists now, where it lives, how it is verified, and what remains incomplete.

Codex does not rely on `CLAUDE.md` as its automatic repository instruction surface. Add a root `AGENTS.md` as a small Codex entry point that directs Codex to the shared project rules in `CLAUDE.md` and the required reading order. Keep `CLAUDE.md` as the common detailed rule source instead of duplicating its constraints in both files.

## Files

### `AGENTS.md`

Create a short root-level adapter for Codex. It will:

- require reading `CLAUDE.md` before project work;
- state that `CLAUDE.md` constraints apply to Codex;
- list `docs/PROJECT_STATUS.md` in the required context path;
- avoid repeating detailed engineering rules that could drift.

### `CLAUDE.md`

Insert `docs/PROJECT_STATUS.md` into the required reading order after `CONTEXT.md` and before relevant ADRs and `docs/ROADMAP.md`. Add a maintenance rule requiring status and validation changes to update the project-status document.

### `docs/PROJECT_STATUS.md`

Keep the document concise, targeting roughly 150 lines. Organize it for task-oriented reading:

1. Scope, authority, last verified date, branch baseline, and document maintenance rule.
2. Current phase summary using `completed`, `partial`, and `not started`, without percentage estimates.
3. Component map covering desktop Rust, desktop Vue, shared schemas, server, web console, deployment, and external WGestures reference code.
4. Key entry points and ownership boundaries for each component.
5. Cross-component data flow and the rule that protocol changes update `packages/shared` plus all consumers.
6. Explicit incomplete boundaries, especially desktop account/sync mock logic, QuickJS, macOS, updater/templates, and release packaging.
7. Locked runtime semantics that must not regress.
8. Development startup details, reserved-port configuration, process-tree precautions, and stable log locations without transient PIDs.
9. Validation matrix and known accepted warnings or expected test output.
10. A short feature/bug workflow: inspect current state, reproduce bugs, identify affected domains, test proportionally, stage explicit files, commit each domain separately, and never push automatically.

## Current-State Claims To Capture

- M0 is complete.
- Windows M1 is implemented and covered by Rust tests and runtime smoke checks.
- Windows M2's principal engine and settings surfaces are implemented, including all command models, application matching, legacy import, capture, hot corners, and rub edges.
- The shared package contains configuration, auth, sync, limits, PKCE, hotkey normalization, and WGestures import contracts.
- The NestJS backend contains password/OAuth auth, device-scoped refresh tokens, device management, whole-document sync, snapshot restore, Prisma/PostgreSQL, and deployment artifacts.
- The web console contains login/OAuth, read-only configuration, devices, snapshots, and security surfaces.
- Desktop account and sync remain a local mock and are not connected to the backend.
- QuickJS execution, the macOS native engine, desktop cloud sync, updater/template distribution, and release hardening are not implemented.
- The committed Windows mouse-hook reentrancy fix and the development ports `14200`/`14201` must remain intact.

## Verification

This is a documentation-only change. Verify by:

- scanning all new and changed Markdown for placeholders and contradictions;
- checking every referenced repository path exists;
- checking command names against package manifests;
- comparing status claims with source entry points and Git history;
- running repository Prettier only if Markdown is covered by the existing configuration;
- confirming `git diff --check` and a clean status after the documentation commit.

No product build or test suite is required because no runtime, schema, or UI behavior changes.

## Commit Strategy

Commit the design specification separately, then implement and commit the handoff documentation as one documentation domain. Use explicit paths with `git add`; never use `git add -A` and never push.

# Official Template Service and Private App Submodules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Page work must first invoke `superpowers:brainstorming`, `frontend-design`, and `design-guide`; also invoke `web-design-guidelines` if it is available in the execution environment.

**Goal:** Replace the GitHub-hosted gesture-template catalog with an official authenticated-submission, moderated public-directory, PostgreSQL + RustFS service while preserving anonymous browsing/adoption, and move `apps/server` and `apps/web-console` into private Git submodules without breaking the pnpm workspace.

**Architecture:** The official catalog is anonymously readable from the fixed official API origin; only a session authenticated against that origin can submit. PostgreSQL owns metadata, immutable versions, moderation, quotas, live author relations, and aggregate download metrics. RustFS stores normalized immutable package objects addressed by server-generated UUIDs and hashes. Templates reference only approved `pluginId` values; the official plugin catalog maps IDs to `subdirectory` within the fixed `Mr-BeanSir/GodGesture-Plugins` `main` branch.

**Tech Stack:** pnpm workspace, Tauri 2 + Rust + Vue 3 + Element Plus, NestJS 11, Prisma 6, PostgreSQL 17, RustFS S3 API, REST/OpenAPI, Zod, Git submodules, GitHub Actions, 1Panel docker-compose.

## Execution Status (2026-08-09)

Tasks 0-7 and 10 are implemented and verified. Task 11 seed handling, API artifact
regeneration, documentation reconciliation, and targeted/full verification are also
complete. Tasks 8 and 9 remain at the UI design gate: the required brainstorming
visual-companion approval has not been explicitly granted, so no new submission-review
or moderation-detail layout has been implemented.

---

## Locked product decisions

- Anonymous users can browse, search, preview, download, and adopt public templates.
- The catalog always uses the official origin; custom sync endpoints never serve catalog reads or submissions.
- Desktop shows “提交到公共目录” only for a signed-in official-endpoint session. Never call publishing “同步”.
- Template identity is a server UUID. Remove template `slug`. Titles may repeat and never form URLs or object keys.
- Template and plugin-catalog `title`/`summary` are single plain strings, not `zh-CN/en` objects. UI chrome remains vue-i18n bilingual.
- Users never type `author`. Public responses join live `User.displayName` and fall back to required non-empty `User.email`.
- `User.email` and `emailVerifiedAt` become required. OAuth registration/linking completes only after GodGesture email-code verification.
- No account deletion/cancellation endpoint exists. Disabled accounts cannot log in, link OAuth, or submit.
- Published versions are immutable. Every content or metadata change creates a reviewed version.
- Authors may withdraw; admins may approve, reject, suspend, restore, and change quotas, but never edit package content.
- High-risk commands and Node plugins remain allowed with server-recomputed risks and explicit confirmation.
- Plugins always come from `https://github.com/Mr-BeanSir/GodGesture-Plugins`, ref `main`. The catalog owns `pluginId -> subdirectory`. Latest content remains installable without commit pinning.
- Show template download counts and support `newest`, `downloads`, and `trending` sorts; never create an author leaderboard or user download history.
- Defaults: 5 submissions/day, 20 pending versions, 100 published templates, 256 KiB package. Admin can change global defaults and per-user overrides within hard maxima.

## Private repository decision

Create:

- `https://github.com/Mr-BeanSir/GodGesture-Server.git` (private)
- `https://github.com/Mr-BeanSir/GodGesture-Web-Console.git` (private)

The superproject tracks only gitlinks at `apps/server` and `apps/web-console`. Both remain pnpm workspace members and are normally built inside the superproject so `workspace:*` Shared dependencies and OpenAPI generation continue to work.

---

### Task 0: Preserve the dirty worktree and split private repositories

**Files:**
- Create/modify: `.gitmodules`
- Create in each private repo: `AGENTS.md` and scoped `README.md`
- Modify: `.github/workflows/*.yml`, root `README.md`, `apps/server/README-DEPLOY.md`
- Create: `scripts/__tests__/repository-layout.test.mjs`

- [ ] **Step 1: Reconfirm the protected worktree.**

Run:

```powershell
git status --porcelain=v1
git diff --stat
git -C distribution/templates status --porcelain=v1
```

Expected: preserve all existing Desktop/Shared/template edits and the known dirty `distribution/templates` submodule. Do not reset, clean, restore, or stage them.

- [ ] **Step 2: Write the failing repository-layout test.**

Create assertions that `.gitmodules` contains both paths, both paths are gitlinks, and a recursive checkout produces `package.json` in each path:

```js
assert.match(gitmodules, /path = apps\/server/);
assert.match(gitmodules, /path = apps\/web-console/);
assert.equal(fs.existsSync("apps/server/package.json"), true);
assert.equal(fs.existsSync("apps/web-console/package.json"), true);
```

Run `node --test scripts/__tests__/repository-layout.test.mjs`. Expected: FAIL before the split.

- [ ] **Step 3: Filter histories in temporary clones.**

```powershell
$splitRoot = Join-Path $env:TEMP "godgesture-private-split"
New-Item -ItemType Directory -Force $splitRoot | Out-Null
git clone --no-local . "$splitRoot\server"
git -C "$splitRoot\server" filter-repo --path apps/server --path-rename apps/server:
git clone --no-local . "$splitRoot\web-console"
git -C "$splitRoot\web-console" filter-repo --path apps/web-console --path-rename apps/web-console:
```

Verify each filtered repository contains only its application history and root package files.

- [ ] **Step 4: Add scoped repository rules and push private histories.**

Each private `AGENTS.md` must say it is embedded in GodGesture, protocol changes coordinate with the superproject, credentials stay in environment examples, commits are English, and no push occurs unless explicitly requested.

```powershell
gh repo create Mr-BeanSir/GodGesture-Server --private --source "$splitRoot\server" --remote origin --push
gh repo create Mr-BeanSir/GodGesture-Web-Console --private --source "$splitRoot\web-console" --remote origin --push
```

Expected: both private repositories have a `main` branch before removing tracked directories.

- [ ] **Step 5: Replace tracked directories with submodules.**

```powershell
git rm -r apps/server apps/web-console
git submodule add https://github.com/Mr-BeanSir/GodGesture-Server.git apps/server
git submodule add https://github.com/Mr-BeanSir/GodGesture-Web-Console.git apps/web-console
git submodule update --init --recursive
```

Update CI checkout to `submodules: recursive` with a secret token/deploy key that can read both private repositories. Update clone/deploy docs with `git clone --recurse-submodules` and `git submodule update --init --recursive`.

- [ ] **Step 6: Verify and commit the split only.**

Run the repository-layout test, `pnpm --filter @godgesture/server typecheck`, and `pnpm --filter @godgesture/web-console typecheck`.

Stage explicit paths only and commit:

```powershell
git add .gitmodules apps/server apps/web-console README.md scripts/__tests__/repository-layout.test.mjs .github/workflows
git commit -m "chore: split server and web console into private submodules"
```

---

### Task 1: Record the architecture and deployment boundary

**Files:**
- Create: `docs/adr/0014-server-managed-public-template-catalog.md`
- Modify: `docs/adr/README.md`, `AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/PROJECT_STATUS.md`
- Modify: `apps/server/README-DEPLOY.md`, `apps/server/docker-compose.prod.yml`, `apps/server/Dockerfile`
- Test: `scripts/__tests__/repository-layout.test.mjs` and existing release/deploy contract tests

- [ ] **Step 1: Write ADR-0014 before implementation.**

State that Server now owns public user-generated templates, moderation, quotas, versions, and anonymous aggregate metrics; RustFS owns immutable package objects; the official endpoint is anonymously readable; GitHub Templates is no longer a Desktop runtime source. Supersede ADR-0008 only for template distribution while retaining GitHub updater and official-plugin distribution decisions.

- [ ] **Step 2: Update terms and status.**

Add “官方公共模板目录”, “模板投稿”, “模板审核”, “模板版本”, “模板撤回”, “模板下架”, and “模板下载次数”. Remove runtime claims about GitHub template catalogs and localized template metadata. Preserve macOS pending language.

- [ ] **Step 3: Document private-submodule operations.**

Document recursive checkout for local development, GitHub Actions credentials, and 1Panel deployment. The Server Docker build context remains the superproject root because it builds Shared and Server together.

- [ ] **Step 4: Verify a clean recursive clone.**

Run from a temporary clone:

```powershell
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm --filter @godgesture/shared build
pnpm --filter @godgesture/server typecheck
pnpm --filter @godgesture/web-console typecheck
```

---

### Task 2: Replace Shared template and plugin protocols

**Files:**
- Modify: `packages/shared/src/templates/protocol.ts`
- Modify: `packages/shared/src/templates/adoption.ts`
- Modify: `packages/shared/src/plugins/online.ts`
- Modify: `packages/shared/src/index.ts`
- Modify tests under `packages/shared/src/templates/__tests__/` and `packages/shared/src/plugins/__tests__/`
- Modify Desktop fixtures under `apps/desktop/src/templates/fixtures.ts` and `apps/desktop/src/plugins/fixtures.ts`

- [ ] **Step 1: Write failing protocol tests.**

Test string `title`/`summary`, rejection of localized objects, UUID public identity, absence of template `slug`, duplicate title allowance, 120/512 limits, NFC normalization, rejection of NUL/C0/C1/bidi controls, duplicate tags/gestures, and package size.

```ts
expect(GestureTemplatePackage.parse({
  formatVersion: 2,
  author: "-",
  title: "Window basics",
  summary: "Three window gestures.",
  tags: ["window"],
  targets: [globalTarget],
})).toMatchObject({ title: "Window basics" });

expect(() => GestureTemplatePackage.parse({
  ...validPackage,
  title: { "zh-CN": "窗口", en: "Window" },
})).toThrow();
```

- [ ] **Step 2: Implement plain-text validators.**

Trim, normalize NFC, enforce Unicode-character limits, reject control/bidi characters, but allow quotes, angle brackets, ampersands, and SQL words. SQL injection remains prevented by Prisma/parameter binding; XSS remains prevented by text rendering and no `v-html`.

- [ ] **Step 3: Replace static catalog types.**

Public summaries carry `id`, `versionNumber`, `title`, `summary`, live `author`, tags, target summaries, risks, counts, and timestamps. Packages no longer carry slug/package URL/arbitrary repository/ref. Keep local-export `author` only for standalone JSON; Server ignores/removes it for published RustFS content.

- [ ] **Step 4: Simplify plugin requirements.**

Template commands/config keep only `pluginId`. Resolve `pluginId -> subdirectory` from the official plugin catalog. Reject absent/disabled IDs before installation or configuration writes.

- [ ] **Step 5: Verify Shared.**

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared typecheck
pnpm --filter @godgesture/shared build
```

Commit in the superproject after all current consumers compile:

```text
feat: redefine public template and plugin protocols
```

---

### Task 3: Add PostgreSQL template, moderation, quota, and metric models

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260808090000_public_templates/migration.sql`
- Create: `apps/server/src/templates/templates.types.ts`
- Create tests: `apps/server/src/templates/templates.service.spec.ts` and `template-policy.service.spec.ts`

- [ ] **Step 1: Write failing lifecycle and relation tests.**

Cover UUID creation, non-unique titles, immutable published versions, author ownership, `onDelete: Restrict`, withdrawal, suspension, review transitions, global/per-user quotas, and daily aggregate uniqueness.

- [ ] **Step 2: Add schema models.**

Add `Template`, `TemplateVersion`, `TemplateReview`, `TemplateReport`, `TemplateDailyMetric`, `TemplateDownloadDedup`, `TemplatePolicy`, and `TemplateUserPolicyOverride`. Use enums for `pending_review`, `published`, `rejected`, `withdrawn`, and `suspended`. Store version title/summary as `VarChar(120/512)`, object key/hash/size, version number, risks, timestamps, and author relation. Never store author snapshots.

- [ ] **Step 3: Add indexes.**

Index published status + publish date, download count, trending inputs, author, review status, tag/search support, and unique `templateId/versionNumber`. Enforce one daily aggregate row per template/version/date.

- [ ] **Step 4: Apply and verify migration.**

```powershell
pnpm --filter @godgesture/server exec prisma generate
pnpm --filter @godgesture/server exec prisma migrate dev
pnpm --filter @godgesture/server test -- templates
```

Commit in the Server private repository:

```text
feat: add public template persistence models
```

---

### Task 4: Add RustFS object storage and deployment

**Files:**
- Create: `apps/server/src/templates/rustfs.service.ts` and tests
- Modify: `apps/server/src/config/env.ts`, `apps/server/.env.example`
- Modify: `apps/server/docker-compose.dev.yml`, `apps/server/docker-compose.prod.yml`
- Modify: `apps/server/README-DEPLOY.md`
- Create: `scripts/__tests__/deployment-contract.test.mjs` in the superproject

- [ ] **Step 1: Write failing object-key and failure-transaction tests.**

Assert only server UUIDs/hashes form keys:

```text
templates/{templateId}/versions/{versionId}/{sha256}.json
```

Test that title/summary/client filename never enter object keys, failed uploads create no DB version, failed DB writes leave cleanup work, and hashes are verified.

- [ ] **Step 2: Configure RustFS.**

Add:

```text
RUSTFS_ENDPOINT=http://rustfs:9000
RUSTFS_REGION=us-east-1
RUSTFS_BUCKET=godgesture-templates
RUSTFS_ACCESS_KEY=
RUSTFS_SECRET_KEY=
RUSTFS_PUBLIC_DOWNLOAD_TTL_SEC=300
```

Add RustFS as an internal compose service with a named volume and healthcheck. Do not expose its port publicly.

- [ ] **Step 3: Implement immutable normalized writes.**

Server validates and canonicalizes JSON, computes SHA-256, writes the generated key, verifies metadata, then commits the DB row. Published objects are never overwritten.

- [ ] **Step 4: Implement five-minute presigned package reads.**

Only published/currently downloadable versions receive URLs. Suspended/withdrawn templates receive no new URL. Return expected size and SHA-256 with the URL.

- [ ] **Step 5: Document coordinated PostgreSQL/RustFS backups.**

Require same-window backups, checksum inventory, disposable restore rehearsal, and orphan cleanup. State that restoring DB without matching objects is incomplete.

- [ ] **Step 6: Verify compose and commit.**

```powershell
docker compose -f apps/server/docker-compose.prod.yml config
pnpm --filter @godgesture/server test -- rustfs
node --test scripts/__tests__/deployment-contract.test.mjs
```

Server commit:

```text
feat: store immutable template packages in RustFS
```

---

### Task 5: Implement public template API, submission, review, quotas, and metrics

**Files:**
- Create: `apps/server/src/templates/templates.module.ts`
- Create: `templates.controller.ts`, `templates.service.ts`, `templates.repository.ts`
- Create: `template-policy.service.ts`, `template-metrics.service.ts`
- Create corresponding `*.spec.ts` files
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/openapi/document.ts` and generated OpenAPI artifacts

- [ ] **Step 1: Write failing endpoint tests.**

Cover anonymous list/detail/package, cursor pagination max 50, search/tag/platform/risk filters, sort whitelist, ETag, official-only writes, disabled users, ownership, review status, withdrawals, reports, and admin transitions.

- [ ] **Step 2: Implement anonymous reads.**

Add:

```text
GET /api/v1/public/templates
GET /api/v1/public/templates/:templateId
GET /api/v1/public/templates/:templateId/versions/:versionNumber/package
```

Join live User data and return `displayName.trim() || email`. Never expose a `publicAuthorName` field or author leaderboard.

- [ ] **Step 3: Implement official-only submissions.**

Add create-template and create-version endpoints. Verify official session, verified email, enabled account, ownership, daily/pending/published limits, body size, strict Shared schema, server-recomputed risks, and official plugin-catalog IDs. Server generates IDs/version numbers and ignores client author.

- [ ] **Step 4: Implement moderation.**

Admins approve, reject with reason, suspend, restore, and resolve reports. Every action writes `AdminAuditLog`. Admins cannot alter title/summary/package; corrections require author versions.

- [ ] **Step 5: Implement withdrawal.**

Author withdrawal hides search/detail adoption and stops new signed URLs but retains immutable versions, reviews, counts, and audit evidence.

- [ ] **Step 6: Implement anonymous download metrics.**

Count at most once per template version/day/rotating-HMAC visitor key. Keep dedup rows 48 hours, retain only daily aggregates long term, and provide `newest`, `downloads`, and seven-day-weighted `trending` sorts. Do not retain user/device histories.

- [ ] **Step 7: Verify and commit.**

```powershell
pnpm --filter @godgesture/server test
pnpm --filter @godgesture/server typecheck
pnpm --filter @godgesture/server build
```

Server commit:

```text
feat: add moderated public template API
```

---

### Task 6: Require verified email for OAuth and add displayName profile

**Files:**
- Modify Server auth/OAuth/email-verification files under `apps/server/src/auth/`
- Add profile controller/service and tests
- Modify `apps/server/prisma/schema.prisma` and migration
- Modify `packages/shared/src/auth/protocol.ts` and generated API
- Modify Desktop `stores/account.ts`, account view/API/locales
- Modify Web Console auth/security API/views/locales

- [ ] **Step 1: Write failing auth tests.**

Test provider without email, pending OAuth binding expiry, mandatory GodGesture email code, linking to an existing verified email, disabled-user rejection, required email fields, and displayName validation.

- [ ] **Step 2: Make email invariants non-null.**

Migrate `User.email` and `emailVerifiedAt` to required. No User is created until verification succeeds. Do not create account-deletion routes.

- [ ] **Step 3: Implement OAuth binding.**

OAuth callback creates an expiring pending identity. User supplies email and code. On success, link to an existing enabled User with that email or create a new User; reject disabled users and duplicate provider identities.

- [ ] **Step 4: Implement `GET/PATCH /api/v1/account/profile`.**

Allow empty displayName; otherwise trim/NFC-normalize, max 32, reject controls/bidi. Public template reads use the live relation; account APIs may return private email.

- [ ] **Step 5: Update Desktop/Web flows and verify.**

Add bilingual email-binding/profile screens and `canSubmitPublicTemplate = official && signedIn`. Run auth, Shared API, Desktop store, and Web Console typechecks, then `pnpm check:api`.

Commits:

```text
feat: require verified email for OAuth accounts
feat: add editable account display names
```

---

### Task 7: Replace Desktop GitHub template runtime with paginated official API

**Files:**
- Modify: `apps/desktop/src/templates/source.ts`, `stores/templates.ts`
- Modify: `api/backend.ts`, `api/mock.ts`
- Modify: `views/TemplatesView.vue`
- Modify fixtures/tests under `src/templates` and `src/stores/__tests__`
- Modify bilingual locales
- Remove runtime GitHub Templates URL/release/jsDelivr migration paths

- [ ] **Step 1: Write failing client/store tests.**

Cover fixed official origin, anonymous cursor pages, sorts/filters, ETag/cache fallback, UUID/version detail/package, checksum validation, withdrawn/suspended errors, and custom endpoint isolation.

- [ ] **Step 2: Implement API/cache source.**

Use a fixed official catalog origin separate from account `apiOrigin`. Cache versioned pages/details/packages in the existing Tauri catalog cache area. Network failure uses the last valid cache; malformed responses never overwrite it.

- [ ] **Step 3: Implement adoption.**

Verify size/hash/schema, resolve `pluginId` through the official plugin catalog, require plugin confirmation, atomically install plugins, then apply config. Keep missing-plugin references if local execution is unavailable.

- [ ] **Step 4: Remove GitHub runtime paths.**

Delete catalog/package URL validation and legacy release/raw/jsDelivr fallback code for templates. Browser mode continues deterministic source fixtures.

- [ ] **Step 5: Verify.**

```powershell
pnpm --filter @godgesture/desktop test -- src/templates src/stores/templates
pnpm --filter @godgesture/desktop typecheck
```

Commit:

```text
feat: consume the official public template service
```

---

### Task 8: Redesign export and add official submission

**Files:**
- Modify: `apps/desktop/src/components/GestureExportDialog.vue`
- Modify: `apps/desktop/src/utils/gesture-export.ts` and tests
- Modify: `apps/desktop/src/views/GesturesView.vue`
- Create: `apps/desktop/src/components/TemplateSubmissionReview.vue`
- Modify Desktop stores/API/locales

- [ ] **Step 1: Invoke design skills before page decisions.**

Run `superpowers:brainstorming`, `frontend-design`, and `design-guide`. Produce a compact GodGesture-specific palette/type/layout/signature plan and ASCII wireframe; critique generic choices before coding. Adapt `design-guide` density/status/focus/composition principles to Vue + Element Plus—do not introduce its React/Tailwind stack. Use `web-design-guidelines` too if available.

- [ ] **Step 2: Write failing export/submission tests.**

Assert no slug/author inputs, title/summary single strings, unsigned export author `"-"`, official signed-in export author `displayName || email`, local export remains available, public button gating, and server-side author authority.

- [ ] **Step 3: Implement the export form.**

Remove slug, version, and editable author controls. Keep title, summary, tags, target selection, search, grouping, risk preview, and local JSON export. Generate a neutral UUID filename or timestamped filename without title-derived paths.

- [ ] **Step 4: Implement submission review.**

Show computed risks, selected targets, required official plugins, moderation notice, current quota usage, and “提交到公共目录”. Submission returns `pending_review` and ID. Custom endpoint or signed-out states do not render the action.

- [ ] **Step 5: Render user content safely.**

Use Vue interpolation only; never `v-html`. Keep title single-line, summary plain text, localized validation/errors, visible focus, keyboard navigation, reduced motion, and light/dark verification.

- [ ] **Step 6: Verify Desktop.**

```powershell
pnpm --filter @godgesture/desktop test -- src/utils/gesture-export.test.ts src/stores
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
```

Commit:

```text
feat: submit exported gestures for public review
```

---

### Task 9: Add Web Console moderation, reports, and quota management

**Files:**
- Create: `apps/web-console/src/api/templates.ts`
- Modify: `apps/web-console/src/api/admin.ts`
- Create views/components for moderation queue, review detail/diff, reports, and quota policy
- Modify router/layout/locales
- Add API/component tests

- [ ] **Step 1: Invoke the required design skills.**

Use `superpowers:brainstorming`, `frontend-design`, and `design-guide` before editing Vue. Define the page’s single job as inspecting an immutable version and choosing a status. Use a dense queue, clear status badges, structured command/risk/plugin sections, keyboard focus, and exact empty/error actions. Do not add content editors.

- [ ] **Step 2: Write failing admin tests.**

Test pagination, non-admin denial, required reasons, approve/reject/suspend/restore, report resolution, immutable content, global policy updates, per-user overrides, hard maxima, and audit records.

- [ ] **Step 3: Implement generated-client APIs and views.**

Show string title/summary, live author, target/gesture diff, complete cmd/PowerShell/file/URL details, official plugin subdirectory, risks, hash/size, history, and action reasons. Add global default and per-user quota controls.

- [ ] **Step 4: Verify.**

```powershell
pnpm --filter @godgesture/web-console typecheck
pnpm --filter @godgesture/web-console build
pnpm check:api
```

Web Console commit:

```text
feat: moderate public templates and quotas
```

---

### Task 10: Harden the fixed official plugin path

**Files:**
- Modify: `packages/shared/src/plugins/online.ts`
- Modify Desktop plugin source/store/tests
- Modify Rust plugin download/workspace tests
- Modify `distribution/plugins` validation/catalog content

- [ ] **Step 1: Write failing fixed-source tests.**

Assert only official repo `main` + catalog `subdirectory` resolves; arbitrary repo/ref/path input is rejected; disabled plugin IDs block new installs; existing local plugins are not deleted.

- [ ] **Step 2: Resolve by plugin ID.**

Templates and config store only `pluginId`. Source resolution comes from the official catalog. Installation downloads latest `main` content, validates `package.json.godgesture.id`, runs constrained production-only install, and atomically activates.

- [ ] **Step 3: Add warning and kill switch.**

Show localized text that current official repository contents are installed. Admin-disabled entries stop future installs, while existing local projects remain untouched.

- [ ] **Step 4: Verify.**

```powershell
pnpm validate:plugins
pnpm --filter @godgesture/shared test -- src/plugins
pnpm --filter @godgesture/desktop test -- src/plugins src/stores/plugins.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugin
```

---

### Task 11: Reconcile seeds, docs, APIs, and release verification

**Files:**
- Modify: `scripts/validate-template-seed.mjs`, root `package.json`
- Modify: `CONTEXT.md`, `docs/PROJECT_STATUS.md`, `README.md`
- Modify: Desktop/Server/Web README and QA checklists
- Modify `distribution/templates` only after separate maintainer confirmation

- [ ] **Step 1: Preserve GitHub Templates only as optional seed/import content.**

If retained, add an explicit Server import command that validates seed JSON and creates approved Server records. Desktop must never read the GitHub template catalog at runtime. Do not alter the currently dirty `distribution/templates` submodule without confirming its separate changes.

- [ ] **Step 2: Regenerate API artifacts across repositories.**

Update Server OpenAPI, regenerate `packages/shared/src/api/generated.ts`, update Desktop/Web consumers, and pin Server/Web submodule commits in the superproject so one superproject commit identifies a compatible cross-repo set.

- [ ] **Step 3: Run targeted verification.**

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/server test
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/web-console test
pnpm typecheck
pnpm check:api
pnpm validate:plugins
pnpm validate:release
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib -- -D warnings
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
git diff --check
```

- [ ] **Step 4: Close documentation.**

Record official catalog status, anonymous/offline behavior, private-submodule checkout, RustFS backup evidence, OAuth email binding, live author names, download metrics, latest-main plugin trust, and remaining real-Mac/live-service verification in `docs/PROJECT_STATUS.md`.

- [ ] **Step 5: Commit by domain with explicit paths.**

Use English commits such as:

```text
chore: split server and web console into private submodules
docs: record server-managed public template catalog
feat: redefine public template and plugin protocols
feat: add moderated public template API
feat: require verified email for OAuth accounts
feat: consume the official public template service
feat: submit exported gestures for public review
feat: moderate public templates and quotas
chore: remove GitHub template catalog runtime
test: verify public template and submodule contracts
```

Use `git add <path>` only, never `git add -A`. Do not push implementation commits by default; creating and initially pushing the two authorized private repository histories is the repository-split exception.

---

## Self-review result

- The plan covers the private repository split, recursive checkout, CI credentials, pnpm workspace, OpenAPI, Docker, and 1Panel implications.
- It replaces GitHub template runtime distribution with official anonymous pagination, moderated authenticated submissions, PostgreSQL metadata, and RustFS immutable objects.
- It removes template slug and content localization, derives live author display from User, requires verified OAuth email, and keeps account deletion absent.
- It covers high-risk templates, fixed official latest-main plugins, kill switches, download metrics without author rankings, configurable quotas, and immutable review state.
- All UI tasks explicitly require design skills and adapt the available Paperclip-oriented guide to the existing Vue/Element Plus stack.
- Each implementation task has named files, failing tests, exact commands, expected behavior, and commit boundaries; no unresolved product choice remains.

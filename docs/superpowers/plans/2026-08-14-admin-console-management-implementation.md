# Administrator Console Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime system settings, searchable/paginated account administration with user editing, and accessible tabbed template moderation to the Server-owned Web Console.

**Architecture:** Keep REST ownership in the private `apps/server` submodule and keep shared request/response schemas in the root `packages/shared`. Persist non-secret system settings in a singleton Prisma row, encrypt RustFS credentials with an environment-provided master key, and make the RustFS object-store service read the current effective settings through an invalidatable runtime provider. Extend the existing admin service/controller rather than creating a second admin module; add a business-neutral `AppTabs` primitive to `packages/ui` and compose it in the Server-owned Console.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Zod, OpenAPI generation, Argon2id, Vue 3, Vite, Tailwind v4, vue-i18n, Lucide, Vitest, Jest, pnpm workspace.

## Global Constraints

- Do not run repository-wide `pnpm test` or any full-suite test command; run only focused tests and required typecheck/build commands.
- Preserve `AGENTS.md`, `apps/server/AGENTS.md`, ADR-0014, ADR-0015, ADR-0016, and ADR-0017.
- Keep OAuth, SMTP, JWT, and template-metrics HMAC secrets in deployment environment configuration; never expose them in the system settings API.
- RustFS access and secret keys are encrypted at rest with `SYSTEM_CONFIG_ENCRYPTION_KEY`; never return plaintext keys.
- Keep `/api/v1`, existing template-policy compatibility endpoints, admin guards, immutable template packages, and audit logging semantics.
- All Console user-visible copy uses the Server-owned `zh-CN` vue-i18n locale; no hardcoded screen text.
- Any root protocol/OpenAPI change updates `packages/shared`, Server generated artifacts, all consumers, and typechecks.
- Use explicit `git add <path>` only if committing is requested; do not push.

---

### Task 1: Shared admin protocol contracts

**Files:**
- Modify: `packages/shared/src/api/generated.ts`
- Test: `packages/shared/src/api/__tests__/generated-admin.test.ts`
- Modify: `apps/server/web-console/src/api/admin.ts`

**Interfaces:**
- Produces Zod schemas and inferred types for paged admin users, admin user detail/update, system configuration, RustFS test, and moderation queue pagination.
- Consumes the existing `TemplatePolicy*` and `AdminAccountStateRequest` contracts without removing them.

- [ ] **Step 1: Write failing schema tests**

Add tests that parse:

```ts
expect(AdminUserListResponse.parse({
  page: 2,
  pageSize: 25,
  total: 51,
  totalPages: 3,
  users: [{
    id: crypto.randomUUID(), email: "u@example.com", displayName: null,
    role: "user", emailVerified: true, disabled: false,
    createdAt: new Date().toISOString(), lastLoginAt: null,
    lastUseAt: null, deviceCount: 0,
  }],
})).toMatchObject({ page: 2, totalPages: 3 });

expect(AdminUserUpdateRequest.parse({ displayName: "New name", password: "new-password-123" })).toEqual({
  displayName: "New name", password: "new-password-123",
});
expect(SystemConfigResponse.parse({
  templatePolicy: { dailySubmissionLimit: 10, pendingVersionLimit: 20, publishedTemplateLimit: 30, maxPackageBytes: 262144 },
  rustfs: { endpoint: "http://127.0.0.1:9000", region: "us-east-1", bucket: "templates", publicDownloadTtlSec: 300, accessKeyConfigured: true, secretKeyConfigured: true },
})).toBeTruthy();
```

Run: `pnpm --filter @godgesture/shared exec vitest run src/api/__tests__/generated-admin.test.ts`
Expected: FAIL because the new exports/schemas do not exist.

- [ ] **Step 2: Add the minimal shared schemas and generated API types**

Define strict schemas for:

```ts
export const AdminUserListQuery = z.object({
  email: z.string().trim().max(254).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const AdminUserUpdateRequest = z.object({
  displayName: z.string().trim().max(120).nullable().optional(),
  password: z.string().min(8).max(128).optional(),
  dailySubmissionLimit: z.number().int().min(0).nullable().optional(),
  pendingVersionLimit: z.number().int().min(0).nullable().optional(),
  publishedTemplateLimit: z.number().int().min(0).nullable().optional(),
  maxPackageBytes: z.number().int().min(0).nullable().optional(),
}).strict();
```

Include `SystemConfigUpdateRequest` with redacted RustFS fields and optional
blank-preserving credential fields. Keep the existing policy schemas as aliases
or existing exports so old clients compile.

- [ ] **Step 3: Run focused shared tests and typecheck**

Run: `pnpm --filter @godgesture/shared exec vitest run src/api/__tests__/generated-admin.test.ts && pnpm --filter @godgesture/shared typecheck`

Expected: PASS.

- [ ] **Step 4: Add Console API wrappers**

Implement typed wrappers in `apps/server/web-console/src/api/admin.ts` for list/detail/update users, system config read/update/test, and preserve existing wrappers until views migrate.

### Task 2: Prisma fields and encrypted system configuration

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_admin_management/migration.sql`
- Create: `apps/server/src/admin/system-config.crypto.ts`
- Test: `apps/server/src/admin/system-config.crypto.spec.ts`
- Modify: `apps/server/src/config/env.ts`

**Interfaces:**
- Produces `SystemConfigCrypto.encrypt/decrypt`, a singleton `SystemConfig` row, and `User.lastLoginAt`.
- Consumes the existing `TemplatePolicy` and `Device.lastSeenAt` models.

- [ ] **Step 1: Write failing crypto tests**

Test deterministic behavior without hardcoding ciphertext:

```ts
it("round trips encrypted configuration values", () => {
  const crypto = new SystemConfigCrypto("a".repeat(32));
  const encrypted = crypto.encrypt("secret-value");
  expect(encrypted).not.toContain("secret-value");
  expect(crypto.decrypt(encrypted)).toBe("secret-value");
});

it("rejects tampered ciphertext", () => {
  const crypto = new SystemConfigCrypto("a".repeat(32));
  expect(() => crypto.decrypt(crypto.encrypt("value") + "x")).toThrow();
});
```

Run: `pnpm --filter @godgesture/server exec vitest run src/admin/system-config.crypto.spec.ts`
Expected: FAIL because the crypto helper does not exist.

- [ ] **Step 2: Implement authenticated encryption and environment validation**

Use Node `createCipheriv("aes-256-gcm", key, random 12-byte IV)` with a SHA-256 derived 32-byte key. Encode `version.iv.tag.ciphertext` as base64url. Add `SYSTEM_CONFIG_ENCRYPTION_KEY` as an optional development value but reject its absence in production when a DB secret is configured; do not log the value.

- [ ] **Step 3: Add Prisma schema and migration**

Add nullable `User.lastLoginAt`, and a singleton `SystemConfig` model with plain RustFS fields, encrypted key fields, `updatedAt`, and a unique singleton boolean. The migration must create the singleton row from existing environment bootstrap values only through application initialization, not embed live credentials in SQL.

- [ ] **Step 4: Run Prisma client generation and focused crypto/schema tests**

Run: `pnpm --filter @godgesture/server prisma generate` and `pnpm --filter @godgesture/server exec vitest run src/admin/system-config.crypto.spec.ts src/admin/template-policy.service.spec.ts`

Expected: PASS; do not apply a migration to a shared production database in this task.

### Task 3: Runtime SystemConfig and dynamic RustFS service

**Files:**
- Create: `apps/server/src/admin/system-config.service.ts`
- Test: `apps/server/src/admin/system-config.service.spec.ts`
- Modify: `apps/server/src/admin/admin.controller.ts`
- Modify: `apps/server/src/admin/admin.service.ts`
- Modify: `apps/server/src/admin/admin.module.ts`
- Modify: `apps/server/src/templates/rustfs.service.ts`
- Modify: `apps/server/src/templates/templates.module.ts`

**Interfaces:**
- Produces `SystemConfigService.get`, `update`, `testRustFs`, and `effectiveRustFs`.
- `RustFsService` consumes an injected config provider and refreshes its S3 client/bucket/TTL after invalidation.

- [ ] **Step 1: Write failing service tests**

Cover default bootstrap, redaction, update validation, blank credential preservation, and audit creation:

```ts
expect(await service.get()).toMatchObject({ rustfs: { accessKeyConfigured: true, secretKeyConfigured: true } });
const result = await service.update(actorId, { rustfs: { endpoint: "http://rustfs.internal:9000", accessKey: "", secretKey: "" } });
expect(result.rustfs.endpoint).toBe("http://rustfs.internal:9000");
expect(result.rustfs).not.toHaveProperty("accessKey");
expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "update_system_config" }) }));
```

Run: `pnpm --filter @godgesture/server exec vitest run src/admin/system-config.service.spec.ts`
Expected: FAIL because the service and routes do not exist.

- [ ] **Step 2: Implement singleton bootstrap and redacted updates**

Read the singleton row or create it from validated environment defaults. Validate template policy hard maxima through the existing template policy rules. Encrypt only non-empty credential replacements. Return configured booleans, never values.

- [ ] **Step 3: Implement RustFS connectivity testing**

Build a temporary object-store client from effective or candidate settings, execute bucket head/create capability check, and return `{ ok: true }` or a mapped actionable error. Do not save candidate settings on test failure.

- [ ] **Step 4: Wire controller and dynamic RustFS provider**

Add guarded `GET/PATCH /admin/system-config` and `POST /admin/system-config/rustfs/test`. Keep existing `/admin/template-policy` and `/admin/users/:id/template-policy` routes. Make `RustFsService` resolve current settings before each operation, cache a client until the config version changes, and keep injected fake stores working for existing tests.

- [ ] **Step 5: Run focused Server admin/RustFS tests**

Run: `pnpm --filter @godgesture/server exec vitest run src/admin/system-config.crypto.spec.ts src/admin/system-config.service.spec.ts src/admin/rustfs.service.spec.ts src/admin/admin.service.template-policy.spec.ts`

Expected: PASS.

### Task 4: Paginated account API and user editing

**Files:**
- Modify: `apps/server/src/admin/admin.controller.ts`
- Modify: `apps/server/src/admin/admin.service.ts`
- Modify: `apps/server/src/auth/auth.service.ts`
- Modify: `apps/server/src/auth/oauth/oauth.service.ts`
- Modify: `apps/server/src/auth/password-hash.ts`
- Test: `apps/server/src/admin/admin.service.users.spec.ts`
- Test: `apps/server/src/auth/auth.service.last-login.spec.ts`

**Interfaces:**
- Produces `AdminService.listUsers(query)`, `getUser(id)`, and `updateUser(actorId, id, input)`.
- Consumes `TokenService.revokeUserTokens`, `hashPassword`, `effectiveTemplatePolicy`, and existing audit helper.

- [ ] **Step 1: Write failing account service tests**

Cover email filtering, page metadata, latest device use timestamp, display-name update, password hash update plus session revocation, quota override update, and self-role/state protections.

Run: `pnpm --filter @godgesture/server exec vitest run src/admin/admin.service.users.spec.ts src/auth/auth.service.last-login.spec.ts`

Expected: FAIL because the new query/update methods and `lastLoginAt` writes do not exist.

- [ ] **Step 2: Implement stable server pagination and metadata**

Use `where.email.contains` with `mode: "insensitive"`, order by `createdAt desc, id desc`, `skip/take`, and a transaction for count + page. Compute `lastUseAt` from the newest device `lastSeenAt` in the same query or an aggregate-safe second query.

- [ ] **Step 3: Implement login timestamp updates**

Set `lastLoginAt` in password login and both successful OAuth account/device login paths. Do not alter token payloads or session semantics.

- [ ] **Step 4: Implement user detail/update**

Allow `displayName`, optional password, and template quota override fields. Hash passwords with existing Argon2 settings, revoke all sessions after a password change, validate quota hard maxima, and audit the combined change without exposing secret material.

- [ ] **Step 5: Run focused account tests**

Run: `pnpm --filter @godgesture/server exec vitest run src/admin/admin.service.users.spec.ts src/auth/auth.service.last-login.spec.ts src/auth/oauth/oauth.service.spec.ts`

Expected: PASS.

### Task 5: Shared accessible Tabs primitive

**Files:**
- Create: `packages/ui/src/components/AppTabs.vue`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/AppTabs.test.ts`

**Interfaces:**
- Produces `<AppTabs :tabs="tabs" v-model="active" />` with slots for tab labels/content and optional counts.

- [ ] **Step 1: Write failing component tests**

Mount tabs and assert one `role=tablist`, one selected tab, linked `tabpanel`, count badge, and Arrow/Home/End keyboard changes.

Run: `pnpm --filter @godgesture/ui exec vitest run src/__tests__/AppTabs.test.ts`

Expected: FAIL because `AppTabs` is not exported.

- [ ] **Step 2: Implement semantic tabs**

Use native buttons, stable IDs, `aria-controls`, `aria-labelledby`, roving `tabindex`, and `prefers-reduced-motion` compatible classes. Keep visual tokens from `packages/ui/src/styles.css`; do not add business labels or i18n.

- [ ] **Step 3: Run focused UI test and typecheck**

Run: `pnpm --filter @godgesture/ui exec vitest run src/__tests__/AppTabs.test.ts && pnpm --filter @godgesture/ui typecheck`

Expected: PASS.

### Task 6: Server-owned Console admin views

**Files:**
- Create: `apps/server/web-console/src/views/UserEditView.vue`
- Create: `apps/server/web-console/src/views/SystemConfigView.vue`
- Modify: `apps/server/web-console/src/views/AdminView.vue`
- Modify: `apps/server/web-console/src/views/TemplateModerationView.vue`
- Modify: `apps/server/web-console/src/router/index.ts`
- Modify: `apps/server/web-console/src/layouts/ConsoleLayout.vue`
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`
- Test: `apps/server/web-console/src/views/__tests__/AdminView.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/UserEditView.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/SystemConfigView.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/TemplateModerationView.test.ts`

**Interfaces:**
- Consumes the API wrappers from Task 1 and the `AppTabs` primitive from Task 5.
- Produces routes `admin`, `admin/system`, and `admin/users/:id/edit` with keyboard-accessible workflows.

- [ ] **Step 1: Write failing view tests**

Assert admin search and pagination query calls, edit navigation and password/quota submission, system config redaction/test/save states, and moderation tab labels/selected state/counts.

Run: `pnpm --filter @godgesture/server exec vitest run web-console/src/views/__tests__/AdminView.test.ts web-console/src/views/__tests__/UserEditView.test.ts web-console/src/views/__tests__/SystemConfigView.test.ts web-console/src/views/__tests__/TemplateModerationView.test.ts`

Expected: FAIL because routes/views/controls are absent.

- [ ] **Step 2: Add system and user-edit routes/navigation**

Register `/admin/system` and `/admin/users/:id/edit` with `meta.admin`; add labelled admin navigation entries and route focus behavior consistent with `ConsoleLayout`.

- [ ] **Step 3: Refactor AdminView to search/pagination/list-only**

Add labelled email search with submit/debounce, page-size select, previous/next controls, current total, last-login/use columns, and an edit action. Keep account state/role/session confirmations and move user quota editing into the edit route.

- [ ] **Step 4: Implement UserEditView**

Load detail, render metadata and editable display name/password/quota fields, validate inline, show busy/error/retry states, confirm password reset semantics, save, toast, and return to `/admin` while preserving the query page.

- [ ] **Step 5: Implement SystemConfigView**

Render policy and RustFS fields with labels, redacted credential inputs, test connection action, save action, hard-limit errors, busy states, and translated success/error feedback. Never bind or display returned secrets.

- [ ] **Step 6: Refactor moderation into AppTabs**

Load all-template/pending/report datasets independently, display counts, preserve the existing detail/action rail for template tabs, and render report actions in the report tab. Use stable selectors and no hardcoded Chinese.

- [ ] **Step 7: Run focused Console tests, typecheck, and build**

Run: `pnpm --filter @godgesture/server exec vitest run web-console/src/views/__tests__/AdminView.test.ts web-console/src/views/__tests__/UserEditView.test.ts web-console/src/views/__tests__/SystemConfigView.test.ts web-console/src/views/__tests__/TemplateModerationView.test.ts && pnpm --filter @godgesture/server web:typecheck && pnpm --filter @godgesture/server web:build`

Expected: PASS.

### Task 7: OpenAPI/shared consumer synchronization and documentation

**Files:**
- Modify: `apps/server/openapi.json`
- Modify: `packages/shared/src/api/generated.ts`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `apps/server/.env.example`
- Modify: `apps/server/README.md`

- [ ] **Step 1: Regenerate and check API artifacts**

Run: `pnpm generate:api` followed by `pnpm check:api`.

Expected: generated OpenAPI/shared output is synchronized. If line endings cause a known Windows-only mismatch, inspect the normalized diff and report it rather than silently rewriting unrelated files.

- [ ] **Step 2: Document system-config bootstrap and admin routes**

Document `SYSTEM_CONFIG_ENCRYPTION_KEY`, environment bootstrap precedence, the fact that OAuth/SMTP/JWT/HMAC stay in environment configuration, and the new manual test entry points. Do not include secret values.

- [ ] **Step 3: Update project status**

Record implementation status and focused verification results, while keeping real deployment, live credentials, and manual browser testing pending.

### Task 8: Final focused verification and manual-test handoff

**Files:**
- No new implementation files.

- [ ] **Step 1: Inspect scoped diff and check whitespace**

Run: `git diff --check` and review only files touched by this feature in the root and `apps/server` worktrees.

- [ ] **Step 2: Run the complete focused verification set**

Run the focused package, Server, and Web Console commands from Tasks 1–7. Do not run `pnpm test`, `pnpm -r test`, or any full repository test command.

- [ ] **Step 3: Perform requirement-by-requirement audit**

Verify the API routes, schema responses, redaction, password/session behavior, search/pagination, user edit quota, system config, tab semantics, localized UI states, and admin guards from source/tests/build output.

- [ ] **Step 4: Stop for manual testing**

Do not mark the feature complete until the maintainer manually tests the running console. Report the exact focused verification results, known pending items, and the manual paths to test. Wait for the maintainer's follow-up before any full-suite test run.

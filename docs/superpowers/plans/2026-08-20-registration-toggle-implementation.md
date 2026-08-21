# Registration Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-controlled registration switch that blocks all new-account creation while preserving existing-account login, password reset, bound OAuth login, and OAuth binding to an existing account.

**Architecture:** Persist `registrationEnabled` on the existing `SystemConfig` singleton with a default of `true`. A small Auth-owned policy reader backed by Prisma is injected into email Auth and OAuth services so the Server remains authoritative; the admin system-config service exposes and updates the same field. The Web Console reads an anonymous status endpoint for presentation, hides registration when disabled, and handles stale registration links with a localized notice and login fallback.

**Tech Stack:** pnpm monorepo, `@godgesture/shared` Zod/OpenAPI contracts, NestJS, Prisma/PostgreSQL, Vue 3, Vue i18n, Vitest, Jest.

## Global Constraints

- Registration is enabled by default for existing installations and fresh databases.
- Closed registration blocks email/password account creation and first-time unbound OAuth account creation.
- Existing account login, password reset, bound OAuth login, and binding an unbound OAuth identity to an existing non-disabled account remain available.
- UI copy uses existing Vue i18n locale keys; no hard-coded Chinese component text.
- OAuth credentials and secrets remain outside source, protocol, logs, and documentation.
- Update `docs/PROJECT_STATUS.md` in the same domain change after verification.

---

### Task 1: Shared registration protocol

**Files:**
- Modify: `packages/shared/src/auth/protocol.ts`
- Modify: `packages/shared/src/auth/__tests__/protocol.test.ts`
- Modify: `apps/server/src/openapi/document.ts`
- Modify: `apps/server/src/openapi/document.spec.ts`

**Interfaces:**
- `RegistrationStatusResponse = { enabled: boolean }`.
- `RegistrationDisabledResponse = { error: "registration_disabled" }`.
- `AdminSystemConfigResponse.registrationEnabled: boolean`.
- `AdminSystemConfigUpdateRequest.registrationEnabled?: boolean`.

- [ ] **Step 1: Write the failing protocol tests**

Assert that the status schema accepts booleans only, the stable blocked-operation response accepts only `registration_disabled`, and admin update payloads accept an optional boolean while rejecting unknown fields.

- [ ] **Step 2: Run shared tests to verify they fail**

Run: `pnpm --filter @godgesture/shared test -- --runInBand`

Expected: FAIL because the new schemas and admin field do not exist.

- [ ] **Step 3: Implement shared schemas and OpenAPI registrations**

Export the schemas from the shared auth protocol, register the new schemas in `apps/server/src/openapi/document.ts`, add `GET /auth/registration` to the public operation list, and add the admin response/update field to the existing schemas. Keep blocked-operation responses represented by the generic error envelope plus the stable shared literal schema where the contract uses a concrete error body.

- [ ] **Step 4: Run shared and OpenAPI tests to verify they pass**

Run: `pnpm --filter @godgesture/shared test -- --runInBand` and `pnpm --filter @godgesture/server exec jest src/openapi/document.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the protocol contract**

```powershell
git add packages/shared/src/auth/protocol.ts packages/shared/src/auth/__tests__/protocol.test.ts apps/server/src/openapi/document.ts apps/server/src/openapi/document.spec.ts
git commit -m "feat: define registration policy protocol"
```

### Task 2: Persist and read the registration policy

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260820100000_registration_toggle/migration.sql`
- Create: `apps/server/src/auth/registration-policy.service.ts`
- Modify: `apps/server/src/auth/auth.module.ts`
- Modify: `apps/server/src/admin/system-config.service.ts`
- Modify: `apps/server/src/admin/system-config.service.spec.ts`

**Interfaces:**
- `RegistrationPolicyService.status(): Promise<RegistrationStatusResponse>`.
- `RegistrationPolicyService.assertEnabled(): Promise<void>`.
- `RegistrationPolicyService.assertPendingEmailAllowed(email: string): Promise<void>`.

- [ ] **Step 1: Write failing persistence/policy tests**

Cover missing-row compatibility as enabled, stored false as disabled, unknown pending email rejection, existing enabled user allowance, disabled user rejection, and system-config response/update/audit persistence of the new field.

- [ ] **Step 2: Run Server unit tests to verify they fail**

Run: `pnpm --filter @godgesture/server exec jest src/admin/system-config.service.spec.ts src/auth/registration-policy.service.spec.ts --runInBand`

Expected: FAIL because the service, schema field, and response field do not exist.

- [ ] **Step 3: Add the Prisma field and migration**

Add `registrationEnabled Boolean @default(true)` to `SystemConfig`; create a migration that adds a non-null boolean column with a `true` default so existing rows are backfilled enabled.

- [ ] **Step 4: Implement the policy reader and admin persistence**

Make the policy reader return enabled when a legacy/missing singleton row is absent, throw `registration_disabled` for blocked new-account operations, and preserve existing-account binding semantics. Extend `SystemConfigService` response/update/bootstrap data and audit metadata without exposing secrets.

- [ ] **Step 5: Run policy and system-config tests to verify they pass**

Run: `pnpm --filter @godgesture/server exec jest src/admin/system-config.service.spec.ts src/auth/registration-policy.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit the persisted policy**

```powershell
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260820100000_registration_toggle/migration.sql apps/server/src/auth/registration-policy.service.ts apps/server/src/auth/auth.module.ts apps/server/src/admin/system-config.service.ts apps/server/src/admin/system-config.service.spec.ts
git commit -m "feat: persist administrator registration policy"
```

### Task 3: Enforce the policy in Auth and OAuth

**Files:**
- Modify: `apps/server/src/auth/auth.service.ts`
- Modify: `apps/server/src/auth/auth.controller.ts`
- Modify: `apps/server/src/auth/oauth/oauth.service.ts`
- Modify: `apps/server/src/auth/auth.service.spec.ts`
- Modify: `apps/server/src/auth/oauth/oauth.service.spec.ts`
- Modify: `apps/server/src/auth/auth.controller.spec.ts`

**Interfaces:**
- `GET /api/v1/auth/registration` returns `RegistrationStatusResponse` without authentication.
- `AuthService.register` and registration-code issuance check the policy before consuming/issuing registration codes.
- OAuth pending email-code issuance and completion allow an existing non-disabled account and reject an unknown target email while closed.

- [ ] **Step 1: Write failing enforcement tests**

Test email registration and registration-code rejection before email-code consumption; test OAuth pending-code rejection for unknown email, OAuth new-user completion rejection while closed, existing-user binding while closed, and bound OAuth exchange/login remaining available.

- [ ] **Step 2: Run Auth/OAuth tests to verify they fail**

Run: `pnpm --filter @godgesture/server exec jest src/auth/auth.service.spec.ts src/auth/auth.controller.spec.ts src/auth/oauth/oauth.service.spec.ts --runInBand`

Expected: FAIL because closed-policy checks and the public status handler do not exist.

- [ ] **Step 3: Implement the enforcement and public status endpoint**

Inject `RegistrationPolicyService`, check the policy before registration-code side effects, add the anonymous controller status route, and enforce the policy again during OAuth pending completion after resolving the normalized target email. Do not alter password login, password reset, bound OAuth exchange, or existing-user binding.

- [ ] **Step 4: Run Auth/OAuth tests to verify they pass**

Run: `pnpm --filter @godgesture/server exec jest src/auth/auth.service.spec.ts src/auth/auth.controller.spec.ts src/auth/oauth/oauth.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit Server enforcement**

```powershell
git add apps/server/src/auth/auth.service.ts apps/server/src/auth/auth.controller.ts apps/server/src/auth/oauth/oauth.service.ts apps/server/src/auth/auth.service.spec.ts apps/server/src/auth/auth.controller.spec.ts apps/server/src/auth/oauth/oauth.service.spec.ts
git commit -m "feat: enforce registration policy in authentication"
```

### Task 4: Generate and consume the Web API contract

**Files:**
- Modify: `apps/server/web-console/src/api/auth.ts`
- Modify: `apps/server/web-console/src/api/admin.ts`
- Modify: `apps/server/web-console/src/utils/errors.ts`
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`
- Generated: `apps/server/openapi.json`
- Generated: `packages/shared/src/api/generated.ts`

- [ ] **Step 1: Write failing API tests**

Extend Web API tests to verify the public status call uses `GET /auth/registration`, and admin system-config requests preserve `registrationEnabled` in both response validation and update payloads.

- [ ] **Step 2: Run Web API tests to verify they fail**

Run: `pnpm --filter @godgesture/server web:test -- src/api/__tests__/admin.test.ts`

Expected: FAIL because the API methods and generated schema fields do not exist.

- [ ] **Step 3: Regenerate and implement API methods/messages**

Run `pnpm generate:api` after the Server OpenAPI document is updated. Add `fetchRegistrationStatus`, add the admin field to the API payload flow, map `registration_disabled`, and provide localized closed-registration text.

- [ ] **Step 4: Run Web API tests to verify they pass**

Run: `pnpm --filter @godgesture/server web:test -- src/api/__tests__/admin.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit generated protocol consumers**

```powershell
git add apps/server/openapi.json packages/shared/src/api/generated.ts apps/server/web-console/src/api/auth.ts apps/server/web-console/src/api/admin.ts apps/server/web-console/src/utils/errors.ts apps/server/web-console/src/i18n/locales/zh-CN.ts
git commit -m "feat: expose registration policy to web console"
```

### Task 5: Admin switch and LoginView behavior

**Files:**
- Modify: `apps/server/web-console/src/views/SystemConfigView.vue`
- Modify: `apps/server/web-console/src/views/LoginView.vue`
- Modify: `apps/server/web-console/src/views/__tests__/SystemConfigView.test.ts`
- Modify: `apps/server/web-console/src/views/__tests__/LoginView.test.ts`

- [ ] **Step 1: Write failing view tests**

Cover loading and saving the binary switch, preserving its value while panels collapse, hiding the registration tab when disabled, displaying the localized closed notice and returning to login for a stale `label=register` link, and returning to login when a registration API call reports `registration_disabled`.

- [ ] **Step 2: Run view tests to verify they fail**

Run: `pnpm --filter @godgesture/server web:test -- src/views/__tests__/SystemConfigView.test.ts src/views/__tests__/LoginView.test.ts`

Expected: FAIL because the switch, policy load, and stale-link handling do not exist.

- [ ] **Step 3: Implement the admin switch and login fallback**

Add a public App UI switch/control in the existing system-config form, include its boolean in save/load payloads, fetch registration status on LoginView mount, render only the login tab when closed, and convert stale/blocked registration entry to the localized notice plus login mode. Keep OAuth providers visible and do not affect forgot-password mode.

- [ ] **Step 4: Run view tests to verify they pass**

Run: `pnpm --filter @godgesture/server web:test -- src/views/__tests__/SystemConfigView.test.ts src/views/__tests__/LoginView.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Web Console behavior**

```powershell
git add apps/server/web-console/src/views/SystemConfigView.vue apps/server/web-console/src/views/LoginView.vue apps/server/web-console/src/views/__tests__/SystemConfigView.test.ts apps/server/web-console/src/views/__tests__/LoginView.test.ts
git commit -m "feat: add registration toggle to web console"
```

### Task 6: Project verification and status update

**Files:**
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Run focused Server, Web, and shared verification**

Run: `pnpm check:api`, `pnpm --filter @godgesture/server typecheck`, `pnpm --filter @godgesture/server test`, and `pnpm --filter @godgesture/server web:build`.

Expected: PASS with no stale generated API output.

- [ ] **Step 2: Update project status**

Record the administrator-controlled registration gate, the preserved existing-account flows, and the test baseline in `docs/PROJECT_STATUS.md` without overwriting unrelated user edits already present in that file.

- [ ] **Step 3: Run final repository checks**

Run: `git diff --check` and `git status --porcelain=v1`; review that only scoped files plus the user’s pre-existing documentation changes are present.

- [ ] **Step 4: Commit the status update**

```powershell
git add docs/PROJECT_STATUS.md
git commit -m "docs: record registration policy baseline"
```

# Owned Template Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-enforced owned-template lifecycle management, latest-50 version retention, a two-step Desktop export/submission wizard, and a Web Console page for author templates.

**Architecture:** Keep template ownership, state transitions, version pruning, and RustFS cleanup inside `apps/server`. Define the owner-list contract in `packages/shared` and regenerate the OpenAPI TypeScript artifact so Desktop and Web Console consume the same protocol. Compose the Web page from existing shared UI primitives; keep Desktop fixed-size and use its existing submission review dialog.

**Tech Stack:** pnpm monorepo, Zod, NestJS, Prisma/PostgreSQL, RustFS, OpenAPI generation, Vue 3, Tauri, Pinia, vue-i18n, Tailwind v4, Lucide, Jest, Vitest, Vue Test Utils.

## Global Constraints

- Preserve immutable template versions: updates always create a new version under the same parent UUID.
- Only a template family containing a published version may be withdrawn; rejected and withdrawn families may receive a new version.
- Delete only a family with no published, pending-review, or suspended version; enforce this in Server transactions, not only in UI.
- Retain the 50 highest `versionNumber` values per template family and delete associated relational metadata plus RustFS objects after commit.
- Keep `apps/server` as the REST/OpenAPI/Web Console owner and update `packages/shared` plus every consumer for protocol changes.
- Keep Web Console copy in its `zh-CN` locale and Desktop copy in both `zh-CN` and `en`; do not hardcode user-visible copy in components.
- Run focused tests and typechecks only; do not run repository-wide test commands or long-running template integration tests.
- Use explicit `git add <path>` for commits and do not push unless the user explicitly asks.

---

### Task 1: Shared owned-template protocol and OpenAPI contract

**Files:**
- Modify: `packages/shared/src/templates/protocol.ts`
- Test: `packages/shared/src/templates/__tests__/protocol.test.ts`
- Modify: `apps/server/src/openapi/document.ts`
- Test: `apps/server/src/openapi/document.spec.ts`
- Regenerate: `packages/shared/src/api/generated.ts`

**Interfaces:**
- Produce `PublicTemplateStatus`, `OwnedTemplateVersion`, `OwnedTemplate`, and `OwnedTemplateListResponse` Zod schemas/types.
- Produce `GET /public/templates/mine`, `POST /templates/{id}/withdraw`, and `DELETE /templates/{id}` OpenAPI operations.
- Preserve the existing `PublicTemplateSubmissionResponse` and `PublicTemplateSubmissionPolicy` shapes.

- [ ] **Step 1: Write failing shared schema tests**

Add a fixture with all five statuses and assert that a response with one parent and two versions parses, that version order is not silently transformed, and that invalid status/negative version values fail:

```ts
it("parses an owned template family with immutable version summaries", () => {
  expect(OwnedTemplateListResponse.parse({
    templates: [{
      id: "10000000-0000-4000-8000-000000000001",
      status: "rejected",
      versions: [{
        id: "20000000-0000-4000-8000-000000000001",
        versionNumber: 2,
        title: "Window controls",
        summary: "Safe controls.",
        status: "rejected",
        submittedAt: "2026-08-14T08:00:00.000Z",
        publishedAt: null,
      }],
    }],
  }).templates[0]?.versions[0]?.versionNumber).toBe(2);
});
```

- [ ] **Step 2: Run the focused schema test and observe the expected failure**

Run `pnpm --filter @godgesture/shared exec vitest run src/templates/__tests__/protocol.test.ts`. It must fail because the owned-template schema exports do not exist yet.

- [ ] **Step 3: Add strict shared schemas and register OpenAPI paths**

Use the existing `TemplateStatus` value set in `protocol.ts`, cap `versions` at 50, require UUIDs and offset datetimes, and register the owner-list response in `apps/server/src/openapi/document.ts`. Add authenticated response/error descriptions for the owner list and mutating author routes.

- [ ] **Step 4: Regenerate and check the generated API artifact**

Run `pnpm generate:api`, then run `pnpm --filter @godgesture/shared exec vitest run src/templates/__tests__/protocol.test.ts` and `pnpm --filter @godgesture/shared typecheck`. Confirm `packages/shared/src/api/generated.ts` contains all three new operations and no unrelated generated churn.

- [ ] **Step 5: Run the OpenAPI contract test**

Run `pnpm --filter @godgesture/server exec jest --runInBand openapi/document.spec.ts`. The route inventory must include `get /public/templates/mine`, `post /templates/{id}/withdraw`, and `delete /templates/{id}`.

### Task 2: Server owner APIs, lifecycle guards, and 50-version retention

**Files:**
- Modify: `apps/server/src/templates/templates.controller.ts`
- Modify: `apps/server/src/templates/template-moderation.controller.ts`
- Modify: `apps/server/src/templates/templates.service.ts`
- Test: `apps/server/src/templates/templates.service.api.spec.ts`
- Test: `apps/server/src/templates/template-controllers.validation.spec.ts`
- Test: `apps/server/src/templates/templates.parent-status.integration.spec.ts` only if a focused projection regression requires it

**Interfaces:**
- Produce `TemplatesService.listOwned(userId)`, `TemplatesService.withdraw(userId, templateId)`, `TemplatesService.deleteOwned(userId, templateId)`, and `TemplatesService.submitVersion(userId, templateId, input)` with the existing return contract.
- Produce authenticated `GET /public/templates/mine` and `DELETE /templates/:id` handlers.
- Consume `OwnedTemplateListResponse` for response validation and the existing `RustFsService.discardPackage` compensation path.

- [ ] **Step 1: Add failing service tests for owner listing and legal states**

Cover: owner filtering and version-number descending output; withdrawal rejection without a published version; successful withdrawal of published/rejected/pending versions while preserving suspended versions; deletion rejection for published/pending/suspended families; deletion of rejected/withdrawn families and best-effort object cleanup.

Use service-level Prisma/RustFS fakes already defined in `templates.service.api.spec.ts`, and assert business error payloads such as `{ error: "template_withdrawal_requires_published" }` and `{ error: "template_delete_not_allowed" }`.

- [ ] **Step 2: Run the focused Server tests and verify they fail for missing behavior**

Run `pnpm --filter @godgesture/server exec jest --runInBand templates/templates.service.api.spec.ts templates/template-controllers.validation.spec.ts`. Failures must identify the missing owner list/delete/withdraw guards rather than a test setup error.

- [ ] **Step 3: Implement owner listing and transaction-safe lifecycle operations**

Implement `listOwned` with `template.findMany({ where: { ownerId: userId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], include: { versions: { orderBy: { versionNumber: "desc" }, take: 50 } } })`, map nullable dates to ISO strings, and use `projectTemplateStatus` for the response status.

For withdrawal, authenticate ownership, lock the parent, re-read versions inside the transaction, require at least one `published` version, update only `pending_review`, `published`, and `rejected` rows to `withdrawn`, set `withdrawnAt`, then call `reprojectTemplateStatus`. Leave `suspended` rows untouched.

For deletion, authenticate ownership, lock the parent, re-read all versions, reject any `published`, `pending_review`, or `suspended` status, delete `TemplateReview`, version-linked `TemplateReport`, `TemplateDownloadDedup`, and `TemplateDailyMetric` rows before deleting versions and the parent, then discard every captured RustFS object after the transaction.

- [ ] **Step 4: Add a failing retention test for version 51**

Set up 50 existing versions plus a new stored version and assert that `submitVersion` returns the next version number, deletes exactly the oldest version and its related records, and calls `discardPackage` with the old object key after the transaction.

- [ ] **Step 5: Implement retention inside the locked submit transaction**

After creating the new version, query the family ordered by `versionNumber desc` with `skip: 50`, delete dependent records for the stale IDs, delete stale versions, return their object keys from the transaction callback, and call `discardPackageBestEffort` after commit. Keep the current new-package compensation when the transaction itself fails.

- [ ] **Step 6: Add controller validation tests and handlers**

Add tests for `GET /public/templates/mine`, `POST /templates/:id/withdraw`, and `DELETE /templates/:id` with malformed UUIDs. Wire the owner list before the public `/:id` route and add the delete handler under the existing authenticated `templates` controller.

- [ ] **Step 7: Run the focused Server tests**

Run `pnpm --filter @godgesture/server exec jest --runInBand templates/templates.service.api.spec.ts templates/template-controllers.validation.spec.ts templates/templates.service.spec.ts`. Confirm the owner list, lifecycle guards, retention, and existing moderation behaviors pass.

### Task 3: Desktop two-step export and submission flow

**Files:**
- Modify: `apps/desktop/src/stores/account.ts`
- Modify: `apps/desktop/src/components/GestureExportDialog.vue`
- Modify: `apps/desktop/src/components/TemplateSubmissionReview.vue`
- Test: `apps/desktop/src/components/__tests__/GestureExportDialog.test.ts`
- Modify: `apps/desktop/src/locales/zh-CN.ts`
- Modify: `apps/desktop/src/locales/en.ts`

**Interfaces:**
- Produce `account.ownedPublicTemplates()`, `account.submitPublicTemplateVersion(templateId, templatePackage)`, and preserve `account.submitPublicTemplate(templatePackage)`.
- Consume `OwnedTemplateListResponse` from `@godgesture/shared` and the existing `TemplateSubmissionReview` confirmation event.

- [ ] **Step 1: Add failing account/store and component tests**

Extend the existing mocked account contract and tests to assert:

```ts
expect(account.ownedPublicTemplates).toHaveBeenCalledOnce();
expect(account.submitPublicTemplateVersion).toHaveBeenCalledWith(
  "50000000-0000-4000-8000-000000000010",
  expect.objectContaining({ title: "Window controls" }),
);
```

Also assert the first-step cards, the new/update choice, the disabled pending choice, and the review text showing the selected parent/version.

- [ ] **Step 2: Run the focused Desktop test and observe the expected failure**

Run `pnpm --filter @godgesture/desktop exec vitest run src/components/__tests__/GestureExportDialog.test.ts`. The new selectors and mocked store methods must fail before production changes.

- [ ] **Step 3: Implement authenticated Desktop account methods**

Add a schema-checked `GET /public/templates/mine` request and a schema-checked `POST /public/templates/{id}/versions` request. Reuse `normalizeCloudError`, official endpoint checks, and the existing `CloudError` behavior.

- [ ] **Step 4: Implement the fixed-size two-step dialog**

Add `deliveryMode: "server" | "json"`, `serverSubmissionMode: "new" | "update"`, owner-template loading/error state, and a selected parent ID. Reset them on open. Render step 1 delivery cards, step 2 metadata/targets, and the server-only update selector. Keep JSON export behavior unchanged. Only load owner templates when the server path is selected, and prevent update submission without a legal selected parent.

Use Lucide icons and existing `AppButton`, `AppBadge`, `AppAlert`, and `AppDialog`; use CSS grid `align-items: stretch` and a smaller form-column gap so both metadata columns remain equal height.

- [ ] **Step 5: Connect review confirmation to new/update submission**

Pass `submissionMode` and `targetVersion` props into `TemplateSubmissionReview`. In `confirmPublicSubmission`, call the new-version method for update mode and the existing method for new mode, then keep the current success toast/close behavior.

- [ ] **Step 6: Add zh-CN/en copy and run focused Desktop tests**

Add every wizard, status, loading, validation, review, and error key to both locale files. Run the focused component test again and then `pnpm --filter @godgesture/desktop typecheck` if the existing unrelated `GesturesView` errors do not prevent useful output; report any pre-existing failure separately.

### Task 4: Web Console author template page

**Files:**
- Modify: `apps/server/web-console/src/api/templates.ts`
- Create: `apps/server/web-console/src/views/MyTemplatesView.vue`
- Create: `apps/server/web-console/src/views/__tests__/MyTemplatesView.test.ts`
- Modify: `apps/server/web-console/src/router/index.ts`
- Modify: `apps/server/web-console/src/layouts/ConsoleLayout.vue`
- Modify: `apps/server/web-console/src/layouts/__tests__/ConsoleLayout.test.ts`
- Modify: `apps/server/web-console/src/router/__tests__/navigation.test.ts`
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`

**Interfaces:**
- Produce typed `listOwnedTemplates`, `withdrawOwnedTemplate`, and `deleteOwnedTemplate` API wrappers.
- Produce `/templates` as an authenticated user route and navigation item; admins see it as a normal user page too.
- Consume the existing shared UI primitives, `errorMessageKey`, `formatDateTime`, and toast/confirmation patterns.

- [ ] **Step 1: Add failing API schema and view tests**

Test the owner-list response schema, the legal action matrix, confirmation cancellation, successful withdrawal/deletion refresh, error presentation, and a 50-item version timeline. Mock only the API boundary as existing Web Console view tests do.

- [ ] **Step 2: Run the focused Web Console tests and observe the expected failure**

Run `pnpm --filter @godgesture/server exec vitest run --config web-console/vite.config.mts src/views/__tests__/MyTemplatesView.test.ts`. It must fail because the API wrappers and route/view do not exist.

- [ ] **Step 3: Implement the API wrappers and route/navigation entry**

Parse `OwnedTemplateListResponse` from `@godgesture/shared`; use `apiRequest` for the list and `apiRequestVoid` for `POST /templates/:id/withdraw` and `DELETE /templates/:id`. Add the `PackageOpen` user navigation item and `/templates` route without changing the admin-only guard.

- [ ] **Step 4: Implement the author page states and actions**

Render a compact `max-w-[1120px]` work surface with loading, empty, error/retry, and mutation-busy states. Show latest version summary and an expandable version timeline. Show withdraw only when `status === "published"`; show delete only when every version is `rejected` or `withdrawn`; show a read-only status notice for pending/suspended families. Use confirmation dialogs and one success/error toast per operation.

- [ ] **Step 5: Add Chinese locale copy and run focused Web tests**

Add navigation, page, status, action, confirmation, error, version retention, and empty-state keys to `zh-CN`. Run the new view test plus the existing navigation/layout tests with the focused Web Console command.

### Task 5: Documentation, generated contract verification, and handoff

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `CONTEXT.md` only if a new stable user-facing term is introduced by the final implementation

- [ ] **Step 1: Update project status with the implemented lifecycle and verification baseline**

Record the owner list, Web actions, Desktop wizard, 50-version retention, focused test commands, and any environment/manual-test limitations in the current status section. Do not add a daily development diary.

- [ ] **Step 2: Run the final focused verification set**

Run only the changed-area commands:

```text
pnpm --filter @godgesture/shared exec vitest run src/templates/__tests__/protocol.test.ts
pnpm --filter @godgesture/server exec jest --runInBand templates/templates.service.api.spec.ts templates/template-controllers.validation.spec.ts openapi/document.spec.ts
pnpm --filter @godgesture/server exec vitest run --config web-console/vite.config.mts src/views/__tests__/MyTemplatesView.test.ts src/layouts/__tests__/ConsoleLayout.test.ts src/router/__tests__/navigation.test.ts
pnpm --filter @godgesture/desktop exec vitest run src/components/__tests__/GestureExportDialog.test.ts
pnpm check:api
pnpm --filter @godgesture/server web:typecheck
```

If a focused command is blocked by an existing unrelated error, report the exact command and output instead of claiming it passed.

- [ ] **Step 3: Inspect the final diff and worktree**

Run `git diff --check`, `git status --porcelain=v1`, and `git diff --stat`. Verify no generated lockfile churn, secrets, hardcoded locale copy, or unrelated refactor entered the change.

- [ ] **Step 4: Stop for manual acceptance**

Hand the maintainer the Desktop export dialog and Web `/templates` URL to test. Do not start a second app instance to replace an existing reproduction, and do not push without a separate explicit request.


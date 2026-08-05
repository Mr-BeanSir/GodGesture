# Grouped Config and Snapshot Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show synchronized application groups in Web Console and paginate snapshot metadata consistently across Server, Web Console, and Desktop with a server-enforced page-size limit.

**Architecture:** The shared Zod sync protocol defines pagination query/response schemas and limits, and the generated OpenAPI contract carries those types to the Desktop transport. Server performs count plus bounded metadata queries; Web Console and Desktop keep page state and request only the visible page. Web Console derives its read-only group tree directly from the existing config v7 document.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, NestJS, Prisma, OpenAPI, Vue 3, Pinia, Element Plus, vue-i18n, Jest, Vitest.

---

### Task 1: Shared Snapshot Pagination Contract

**Files:**
- Modify: `packages/shared/src/sync/protocol.ts`
- Test: `packages/shared/src/sync/__tests__/protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Add tests that define the desired public contract:

```ts
expect(ListSnapshotsQuery.parse({})).toEqual({ page: 1, pageSize: 10 });
expect(ListSnapshotsQuery.parse({ page: "2", pageSize: "50" })).toEqual({
  page: 2,
  pageSize: 50,
});
expect(() => ListSnapshotsQuery.parse({ pageSize: 51 })).toThrow();
expect(ListSnapshotsResponse.parse({
  snapshots: [], page: 1, pageSize: 10, total: 0, totalPages: 1,
})).toMatchObject({ total: 0, totalPages: 1 });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run `pnpm --filter @godgesture/shared exec vitest run src/sync/__tests__/protocol.test.ts`.

Expected: import/schema failures because pagination constants, query schema, and response metadata do not exist.

- [ ] **Step 3: Implement the minimal shared contract**

Export `DEFAULT_SNAPSHOT_PAGE_SIZE = 10`, `MAX_SNAPSHOT_PAGE_SIZE = 50`, and:

```ts
export const ListSnapshotsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive()
    .max(MAX_SNAPSHOT_PAGE_SIZE)
    .default(DEFAULT_SNAPSHOT_PAGE_SIZE),
});

export const ListSnapshotsResponse = z.object({
  snapshots: z.array(SnapshotMeta),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(MAX_SNAPSHOT_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
});
```

- [ ] **Step 4: Run the focused shared test and verify GREEN**

Run the same Vitest command. Expected: all sync protocol tests pass.

### Task 2: Bounded Server Query and OpenAPI

**Files:**
- Modify: `apps/server/src/sync/sync.controller.ts`
- Modify: `apps/server/src/sync/sync.service.ts`
- Test: `apps/server/src/sync/sync.service.spec.ts`
- Modify: `apps/server/src/openapi/document.ts`
- Test: `apps/server/src/openapi/document.spec.ts`
- Generate: `apps/server/openapi.json`
- Generate: `packages/shared/src/api/generated.ts`

- [ ] **Step 1: Write failing service and OpenAPI tests**

Replace the all-record service expectation with page-aware behavior:

```ts
prisma.configSnapshot.count.mockResolvedValue(23);
const result = await service.listSnapshots("user-1", { page: 2, pageSize: 10 });
expect(prisma.configSnapshot.findMany).toHaveBeenCalledWith(
  expect.objectContaining({ skip: 10, take: 10, orderBy: { version: "desc" } }),
);
expect(result).toMatchObject({ page: 2, pageSize: 10, total: 23, totalPages: 3 });
```

Add an overflow-page case that expects the last page and an empty-list case that expects page 1. In the OpenAPI test, assert `page` and `pageSize` query parameters exist and `pageSize.maximum` is 50.

- [ ] **Step 2: Run focused Server tests and verify RED**

Run `pnpm --filter @godgesture/server exec jest src/sync/sync.service.spec.ts src/openapi/document.spec.ts --runInBand`.

Expected: service mock/signature and OpenAPI query assertions fail because the endpoint is not paginated.

- [ ] **Step 3: Implement controller, service, and OpenAPI pagination**

Inject the complete query object through the shared Zod pipe:

```ts
listSnapshots(
  @CurrentUser() userId: string,
  @Query(new ZodValidationPipe(ListSnapshotsQuery)) query: ListSnapshotsQuery,
): Promise<ListSnapshotsResponse> {
  return this.sync.listSnapshots(userId, query);
}
```

In the service, call `count`, calculate `totalPages = Math.max(1, Math.ceil(total / pageSize))`, clamp `page`, then query metadata with `skip` and `take`. Register `ListSnapshotsQuery` in OpenAPI and add it as `request.query` for `/sync/snapshots`.

- [ ] **Step 4: Run focused Server tests and verify GREEN**

Run the same Jest command. Expected: all focused tests pass.

- [ ] **Step 5: Regenerate API artifacts**

Run `pnpm generate:api`. Expected: `apps/server/openapi.json` and `packages/shared/src/api/generated.ts` contain typed snapshot query parameters and pagination response metadata.

### Task 3: Web Console Group Tree and Remote Snapshot Paging

**Files:**
- Modify: `apps/web-console/src/api/client.ts`
- Modify: `apps/web-console/src/api/sync.ts`
- Modify: `apps/web-console/src/views/ConfigView.vue`
- Modify: `apps/web-console/src/views/SnapshotsView.vue`
- Modify: `apps/web-console/src/i18n/locales/zh-CN.ts`
- Modify: `apps/web-console/src/i18n/locales/en.ts`

- [ ] **Step 1: Add typed query support to the Web Console API wrapper**

Extend `RequestOptions` with a `query` record and append defined values with `URLSearchParams`. Make `listSnapshots(query)` validate via `ListSnapshotsQuery.parse` before requesting `/sync/snapshots?page=...&pageSize=...`.

- [ ] **Step 2: Render config applications by group**

Derive stable sorted groups and a local unassigned bucket. Keep the existing global button first, then render group headers and each group's app buttons. Add only localized `config.groups` and `config.unassignedGroup` labels and theme-token CSS.

- [ ] **Step 3: Use Server pagination on the snapshot page**

Store `page`, `pageSize`, `total`, and `totalPages`; request only the visible page; add Element Plus pagination with `[10, 20, 50]`; reset to page 1 on refresh, page-size change, restore success, and restore conflict.

- [ ] **Step 4: Verify Web Console**

Run `pnpm --filter @godgesture/web-console typecheck` and `pnpm --filter @godgesture/web-console build`.

Expected: Vue TypeScript and production build pass with no hardcoded visible Chinese text.

### Task 4: Desktop Remote Snapshot Paging

**Files:**
- Modify: `apps/desktop/src/cloud/api.ts`
- Modify: `apps/desktop/src/cloud/sync-engine.ts`
- Test: `apps/desktop/src/cloud/__tests__/sync-engine.test.ts`
- Modify: `apps/desktop/src/stores/account.ts`
- Test: `apps/desktop/src/stores/__tests__/account.test.ts`
- Modify: `apps/desktop/src/views/AccountView.vue`

- [ ] **Step 1: Write failing engine and store tests**

Assert that `engine.listSnapshots({ page: 2, pageSize: 20 })` forwards the query and returns the full response. Add a store test whose engine returns page metadata and assert snapshots, page, page size, total, and total pages update together; stopping synchronization resets them.

- [ ] **Step 2: Run focused Desktop tests and verify RED**

Run `pnpm --filter @godgesture/desktop exec vitest run src/cloud/__tests__/sync-engine.test.ts src/stores/__tests__/account.test.ts`.

Expected: signature and pagination-state assertions fail because Desktop currently returns an all-record array.

- [ ] **Step 3: Implement typed transport and store paging**

`CloudApi.listSnapshots(query)` parses with `ListSnapshotsQuery` and passes `params: { query }` to the generated client. `CloudSyncEngine.listSnapshots(query)` returns `ListSnapshotsResponse`. The account store owns pagination metadata, accepts optional page/page-size inputs, and keeps generation checks around the full response update.

- [ ] **Step 4: Replace local slicing in AccountView**

Remove `getPageItems`/`getPageCount`; bind the table directly to `account.snapshots`, bind pagination to server metadata, and call `account.loadSnapshots(page, pageSize)` on pagination events.

- [ ] **Step 5: Run focused tests and Desktop checks**

Run the focused Vitest command, `pnpm --filter @godgesture/desktop typecheck`, and `pnpm --filter @godgesture/desktop build`.

Expected: tests, Vue TypeScript, and production build pass.

### Task 5: Status Documentation and Final Verification

**Files:**
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Update project status**

Record the Web Console grouped config view, bounded snapshot pagination contract, remote paging in both clients, and the actual verification baseline. Do not alter historical roadmap entries.

- [ ] **Step 2: Run affected validation**

Run:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm --filter @godgesture/server test -- --runInBand
pnpm --filter @godgesture/server typecheck
pnpm --filter @godgesture/web-console build
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop build
pnpm check:api
git diff --check
```

Expected: every command succeeds and generated API artifacts are current.

- [ ] **Step 3: Review and commit explicit paths**

Review `git diff --stat`, `git diff`, and `git status --porcelain=v1`. Stage only task files with explicit `git add <path>` commands; leave `.superpowers/` untracked and do not push.

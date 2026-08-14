# Template Moderation Detail Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Put admin template review actions in the requested bordered header and show complete per-target gesture details instead of raw JSON or enabled-status badges.

**Architecture:** Keep the public catalog targetSummaries unchanged. Add a verified server-side RustFS object read for moderation details, parse the immutable package with GestureTemplatePackage, and return its targets as targetDetails. The Web Console validates that field and renders it through a reusable target-detail component that shares the existing mnemonic components and Config i18n keys.

**Tech Stack:** NestJS, AWS S3-compatible RustFS, Zod/OpenAPI, Vue 3 script setup, Tailwind semantic tokens, Vitest, Jest, vue-tsc, pnpm workspace.

## Global Constraints

- Web Console remains a high-density operations console with the existing queue/detail/action-rail layout.
- The public catalog continues to use targetSummaries; no template package or database schema migration is introduced.
- RustFS bytes must match the stored sizeBytes and packageHash before parsing.
- Template data must pass the existing GestureTemplatePackage schema before reaching the Web Console.
- Use existing GestureMnemonic, AppButton, AppBadge, gg-table, --gg-* tokens, and vue-i18n keys; add no hardcoded Chinese copy.
- Do not render enabled, gesturingEnabled, inheritGlobalGestures, or an “已启用” status column.
- Run only RustFS, template service/OpenAPI, Web Console schema/view tests and type checks, not the full monorepo suite.
- Preserve unrelated root worktree changes and use explicit git add <path> commands.

## File Map

- Modify apps/server/src/templates/rustfs.service.ts and rustfs.service.spec.ts for verified object reads.
- Modify apps/server/src/templates/templates.service.ts and templates.service.api.spec.ts for targetDetails mapping.
- Modify apps/server/src/openapi/document.ts and document.spec.ts; regenerate apps/server/openapi.json and packages/shared/src/api/generated.ts.
- Modify apps/server/web-console/src/api/template-schemas.ts and its API test.
- Create apps/server/web-console/src/components/TemplateTargetDetails.vue.
- Modify TemplateModerationView.vue and TemplateModerationView.test.ts for the detail component and action header.
- Inspect docs/PROJECT_STATUS.md and update only an existing matching verification baseline, preserving unrelated user edits.

---

### Task 1: Add Verified RustFS Package Reads

Files:
- Modify: apps/server/src/templates/rustfs.service.ts
- Test: apps/server/src/templates/rustfs.service.spec.ts

Interfaces:
- Consumes: RustFsObjectStore, objectKey, packageHash, and sizeBytes.
- Produces: RustFsObjectStore.read(key: string): Promise<Buffer> and RustFsService.readPackage(input: { objectKey: string; packageHash: string; sizeBytes: number }): Promise<Buffer>.

- [ ] Step 1: Add the failing RustFS tests.

Extend FakeStore with an in-memory read method. Add one test that stores a Buffer and expects readPackage with matching length and SHA-256 to return it, plus a parameterized test that mismatched length and mismatched hash reject with an integrity error:

~~~ts
it('returns a package only when size and sha256 match', async () => {
  const body = Buffer.from('{"formatVersion":2}');
  const hash = createHash('sha256').update(body).digest('hex');
  store.objects.set(objectKey, { body, sha256: hash });
  await expect(service.readPackage({ objectKey, packageHash: hash, sizeBytes: body.length })).resolves.toEqual(body);
});
~~~

- [ ] Step 2: Run the RustFS test and verify the expected red failure.

Run:

~~~powershell
pnpm --filter @godgesture/server exec jest --runInBand src/templates/rustfs.service.spec.ts
~~~

Expected: the new test fails because readPackage is not implemented, while the file loads without fixture errors.

- [ ] Step 3: Implement the minimal read path.

Add read(key): Promise<Buffer> to RustFsObjectStore. Implement S3ObjectStore.read with GetObjectCommand, reject a missing body, and convert the SDK body with transformToByteArray(). Add RustFsService.readPackage, call refreshStore(), read the object, compare body.length with sizeBytes, calculate SHA-256 with createHash, compare packageHash, and return only the verified Buffer. Do not parse JSON in RustFsService.

- [ ] Step 4: Run the focused RustFS test and verify green.

Run the same Jest command. Expected: all tests in rustfs.service.spec.ts pass.

- [ ] Step 5: Commit the Server subtask.

~~~powershell
git -C apps/server add src/templates/rustfs.service.ts src/templates/rustfs.service.spec.ts
git -C apps/server commit -m "feat: add verified template package reads"
~~~

### Task 2: Return Structured Moderation Targets and Document the API

Files:
- Modify: apps/server/src/templates/templates.service.ts
- Test: apps/server/src/templates/templates.service.api.spec.ts
- Modify: apps/server/src/openapi/document.ts
- Test: apps/server/src/openapi/document.spec.ts
- Regenerate: apps/server/openapi.json and packages/shared/src/api/generated.ts

Interfaces:
- Consumes: RustFsService.readPackage from Task 1 and GestureTemplatePackage from @godgesture/shared.
- Produces: moderationDetail(...).targetDetails: GestureTemplateTarget[], while retaining targetSummaries.

- [ ] Step 1: Write the failing TemplatesService test.

Add readPackage: jest.fn() to the RustFS mock. Build a valid package fixture with one global intent and one App target intent, including name, gesture, and command. Make readPackage return its JSON bytes. Extend the existing moderation-detail test to expect the read call, unchanged targetSummaries, and targetDetails containing the global intent named Copy and the App intent named Search:

~~~ts
expect(rustfs.readPackage).toHaveBeenCalledWith({
  objectKey: 'templates/object.json',
  packageHash: 'a'.repeat(64),
  sizeBytes: 128,
});
expect(result.targetSummaries).toEqual([{ scope: 'global' }]);
expect(result.targetDetails).toEqual(expect.arrayContaining([
  expect.objectContaining({ scope: 'global', intents: [expect.objectContaining({ name: 'Copy' })] }),
  expect.objectContaining({ scope: 'app', name: 'Browser', intents: [expect.objectContaining({ name: 'Search' })] }),
]));
~~~

Add a test where readPackage rejects or returns invalid JSON and assert moderationDetail rejects rather than returning only targetSummaries. Configure a valid package for every existing moderation-detail fixture.

- [ ] Step 2: Run the focused Server test and verify red.

Run:

~~~powershell
pnpm --filter @godgesture/server exec jest --runInBand src/templates/templates.service.api.spec.ts
~~~

Expected: the new assertions fail because moderationDetail does not read the package or return targetDetails.

- [ ] Step 3: Implement the moderation detail mapping.

In TemplatesService.moderationDetail, call rustfs.readPackage with the row object metadata, parse its UTF-8 JSON, validate it with GestureTemplatePackage.parse, and return targetDetails: parsed.targets. Keep targetSummaries from the database. Do not fall back to targetSummaries when reading or parsing fails.

- [ ] Step 4: Add the failing OpenAPI contract assertion.

In document.spec.ts, inspect GET /admin/templates/versions/{id}. Assert its 200 JSON response references a named schema and that the referenced schema has a required targetDetails array.

- [ ] Step 5: Implement and regenerate the API contract.

Import GestureTemplateTarget into document.ts. Register TemplateModerationDetailResponse as z.object({ targetDetails: z.array(GestureTemplateTarget) }).passthrough() and use it for the moderation-detail 200 response. Run the generators; do not hand-edit generated output:

~~~powershell
pnpm --filter @godgesture/server openapi:document
pnpm generate:api
~~~

- [ ] Step 6: Run the focused Server/API checks.

Run:

~~~powershell
pnpm --filter @godgesture/server exec jest --runInBand src/templates/templates.service.api.spec.ts src/openapi/document.spec.ts
pnpm check:api
~~~

Expected: both Jest files pass and check:api confirms generated types are current.

- [ ] Step 7: Commit Server and generated contract changes separately.

~~~powershell
git -C apps/server add src/templates/templates.service.ts src/templates/templates.service.api.spec.ts src/openapi/document.ts src/openapi/document.spec.ts openapi.json
git -C apps/server commit -m "feat: expose verified template moderation targets"
git add apps/server packages/shared/src/api/generated.ts
git commit -m "chore: refresh template moderation API types"
~~~

### Task 3: Validate the Web Console Detail Contract

Files:
- Modify: apps/server/web-console/src/api/template-schemas.ts
- Test: apps/server/web-console/src/api/__tests__/templates.test.ts

Interfaces:
- Consumes: GestureTemplateTarget from @godgesture/shared and targetDetails from Task 2.
- Produces: ModerationDetail.targetDetails typed as GestureTemplateTarget[].

- [ ] Step 1: Add the failing schema assertions.

Extend the API fixture with valid global and App targets containing intents. Assert safeParse accepts the field and keeps intent name and gesture. Assert removing targetDetails makes safeParse return success: false.

- [ ] Step 2: Run the schema test and verify red.

Run:

~~~powershell
pnpm --filter @godgesture/server web:test -- src/api/__tests__/templates.test.ts
~~~

Expected: the fixture fails because targetDetails is not yet required by the schema.

- [ ] Step 3: Add the shared schema.

Import GestureTemplateTarget and add targetDetails: z.array(GestureTemplateTarget) beside targetSummaries in ModerationDetailSchema. Keep all other fields unchanged.

- [ ] Step 4: Run the schema test and verify green.

Run the same Vitest command. Expected: both API schema tests pass.

- [ ] Step 5: Commit the Web Console contract change.

~~~powershell
git -C apps/server add web-console/src/api/template-schemas.ts web-console/src/api/__tests__/templates.test.ts
git -C apps/server commit -m "feat: validate moderation target details"
~~~

### Task 4: Build the Config-Style Target Detail Component

Files:
- Create: apps/server/web-console/src/components/TemplateTargetDetails.vue
- Test: apps/server/web-console/src/views/__tests__/TemplateModerationView.test.ts

Interfaces:
- Consumes: targets: GestureTemplateTarget[], GestureMnemonic, AppBadge, Config i18n keys for action kind/name/mnemonic/command type/global app/action count, and command type translations.
- Produces: data-template-target-details with one target group per target and per-intent rows for type, name, mnemonic, and command type, without status fields.

- [ ] Step 1: Add failing view assertions.

Extend the detail fixture with one global and one App targetDetails target. After selecting the queue item, assert that data-template-target-details contains 全局, Browser, Copy, Search, and the translated command type; that it has two mnemonic role images; that its dt labels do not contain 状态; that the view has no pre; and that the target-details text does not contain 已启用. Also assert both a mobile inspector list and a desktop gg-table exist, with overflow confined to the desktop table.

- [ ] Step 2: Run the view test and verify red.

Run:

~~~powershell
pnpm --filter @godgesture/server web:test -- src/views/__tests__/TemplateModerationView.test.ts
~~~

Expected: the target-details selector is missing because the view still renders the JSON pre block.

- [ ] Step 3: Implement TemplateTargetDetails.vue.

Use defineProps with targets: GestureTemplateTarget[] and useI18n(). Derive the target label from config.globalApp for the global scope or the App target name. Render a target heading and translated count, a mobile ol with dl rows for type/name/mnemonic/command type, and a desktop gg-table-wrap/gg-table with the same four columns. Use GestureMnemonic for every intent and translate command.<type> through vue-i18n.

Do not render status, enabled badges, or raw command JSON. Use semantic headings, list/table structure, min-w-0, wrapping names, and existing --gg-* tokens. Keep the component free of API/store/router dependencies.

- [ ] Step 4: Run the view test and verify green.

Run the same Vitest command. Expected: the new target-detail assertions and existing moderation tests pass.

- [ ] Step 5: Commit the reusable component.

~~~powershell
git -C apps/server add web-console/src/components/TemplateTargetDetails.vue web-console/src/views/__tests__/TemplateModerationView.test.ts
git -C apps/server commit -m "feat: render template target gesture details"
~~~

### Task 5: Move Review Actions into the Bordered Header

Files:
- Modify: apps/server/web-console/src/views/TemplateModerationView.vue
- Modify: apps/server/web-console/src/views/__tests__/TemplateModerationView.test.ts

Interfaces:
- Consumes: ModerationDetail.targetDetails and TemplateTargetDetails from Task 4; existing legal status checks, openReview, and AppButton variants.
- Produces: an action rail header with the exact class string border-b border-[var(--gg-border)] px-5 py-3 containing all currently legal review buttons.

- [ ] Step 1: Add failing review-header assertions.

After selecting a pending version, get data-template-actions-header and assert its classes include border-b, border-[var(--gg-border)], px-5, and py-3; assert approve and reject are inside it and it is the direct header of the action aside. Repeat the action-location assertion for published and suspended states so suspend and restore stay in the same header.

- [ ] Step 2: Run the view test and verify red.

Run:

~~~powershell
pnpm --filter @godgesture/server web:test -- src/views/__tests__/TemplateModerationView.test.ts
~~~

Expected: the header selector is missing or does not contain the review buttons.

- [ ] Step 3: Implement the page integration.

Import TemplateTargetDetails. Replace the target JSON pre block with TemplateTargetDetails bound to selected.targetDetails. Replace the action rail's grid content-start gap-4 p-4 content with a header carrying data-template-actions-header and the exact requested classes. Keep the title, immutable note, all conditional legal AppButton elements, data-moderation-review selectors, click handlers, variants, busy state, and confirmation dialog unchanged. Use responsive flex/grid utilities so wrapped buttons remain readable.

- [ ] Step 4: Run focused Web Console tests and typecheck.

Run:

~~~powershell
pnpm --filter @godgesture/server web:test -- src/api/__tests__/templates.test.ts src/views/__tests__/TemplateModerationView.test.ts
pnpm --filter @godgesture/server web:typecheck
~~~

Expected: selected tests pass and vue-tsc exits with code 0.

- [ ] Step 5: Commit the moderation page integration.

~~~powershell
git -C apps/server add web-console/src/views/TemplateModerationView.vue web-console/src/views/__tests__/TemplateModerationView.test.ts
git -C apps/server commit -m "fix: align moderation detail workspace"
~~~

### Task 6: Run Narrow Verification and Prepare Manual Testing

Files:
- Inspect: root and apps/server Git status/diffs.
- Modify: docs/PROJECT_STATUS.md only when its existing Web Console verification baseline requires this route update.

Interfaces:
- Consumes: Tasks 1-5.
- Produces: fresh evidence for RustFS, Server API/OpenAPI, Web Console schema/view, and a manual-test entry point.

- [ ] Step 1: Review diffs and generated files.

Run:

~~~powershell
git status --porcelain=v1
git -C apps/server status --porcelain=v1
git diff --check
git -C apps/server diff --check
git diff --stat
git -C apps/server diff --stat
~~~

Confirm no Desktop files, existing user edits, or unrelated generated files changed.

- [ ] Step 2: Run the affected local test set.

Run:

~~~powershell
pnpm --filter @godgesture/server exec jest --runInBand src/templates/rustfs.service.spec.ts src/templates/templates.service.api.spec.ts src/openapi/document.spec.ts
pnpm --filter @godgesture/server web:test -- src/api/__tests__/templates.test.ts src/views/__tests__/TemplateModerationView.test.ts
pnpm --filter @godgesture/server web:typecheck
pnpm check:api
~~~

Expected: all selected tests pass, Web Console typecheck passes, and generated API types are current. Do not run pnpm test, pnpm typecheck, or other full-repository commands for this narrow UI/API change.

- [ ] Step 3: Start the Web Console dev server only if needed.

Use an unused port if 5181 is occupied:

~~~powershell
pnpm --filter @godgesture/server web:dev -- --host 127.0.0.1 --port 5181
~~~

Open /admin/templates, select a pending version, verify actions are in the bordered header, verify global/App gesture rows show type/name/mnemonic/command type, and verify no JSON block or 已启用 status is visible. Keep the existing authentication/backend environment unchanged.

- [ ] Step 4: Update project status only when required.

If docs/PROJECT_STATUS.md has the current Web Console verification baseline, update only the matching line and preserve unrelated user edits. Otherwise leave it unchanged because this corrects an existing route rather than adding a new product entry point.

- [ ] Step 5: Recheck status and hand off for manual testing.

Run the status commands from Step 1 again, record intentionally uncommitted root changes separately from Server submodule commits, and report the exact local URL and focused verification results. Do not push unless explicitly requested.

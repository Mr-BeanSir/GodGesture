# System Config Collapsible Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the System Config page's panels independently collapsible, with template policy open by default and RustFS closed by default, without changing form state or RustFS behavior.

**Architecture:** Add a business-free `AppCollapsiblePanel` primitive to `@godgesture/ui`. It owns only controlled open/close semantics, accessible structure, slots, visual treatment, and preserved mounted content; `SystemConfigView` owns the two local boolean states and keeps all API, validation, save, toast, and credential behavior unchanged.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest, Vue Test Utils, `lucide-vue-next`, Tailwind v4 utilities, shared `--gg-*` CSS tokens.

## Global Constraints

- Preserve all pre-existing dirty worktree and `apps/server` submodule changes; use no reset, checkout, broad staging, or commit for files that already contain unrelated uncommitted work.
- Keep `AppCollapsiblePanel` public and business-free: it must not import vue-i18n, router, stores, API clients, persistence, or application-local code.
- Use controlled `v-model:open`; do not persist state in localStorage, account data, or the server, and do not add an expand-all command.
- Use a semantic native button with `aria-expanded`, `aria-controls`, a labelled `role="region"`, visible focus feedback, and a Lucide chevron. Keep the slot content mounted while collapsed.
- Retain the Console's existing vue-i18n keys and no hard-coded Chinese text in components. No REST/OpenAPI, Desktop, or Server business logic change is in scope.
- Keep the Console operational and token-based: no raw page colors, gradients, decorative motion, or nested cards; transitions may use only 150-200ms opacity/transform and must respect reduced motion.
- Run only focused UI/Console tests, type checks, build, diff checks, and the local browser validation specified below; do not claim a full-repository test run.

---

## File Structure

- `packages/ui/src/components/AppCollapsiblePanel.vue`: Generic controlled panel, semantic trigger/region relationship, slots, and persistent mounted content.
- `packages/ui/src/__tests__/AppCollapsiblePanel.test.ts`: Component-level contract for state, click behavior, ARIA relationship, and `v-show` persistence.
- `packages/ui/src/index.ts`: Public package export for `AppCollapsiblePanel`.
- `packages/ui/src/styles.css`: Shared `.gg-collapsible-panel*` layout, chevron, transition, and reduced-motion rules.
- `packages/ui/src/__tests__/package-contract.test.ts`: Public-export and stylesheet contract extension.
- `apps/server/web-console/src/views/SystemConfigView.vue`: Two local open-state refs and direct consumption of the shared primitive.
- `apps/server/web-console/src/views/__tests__/SystemConfigView.test.ts`: Default-state and RustFS user-path regression coverage.
- `docs/PROJECT_STATUS.md`: Current workspace behavior and focused verification baseline after results are known.

### Task 1: Add The Shared Controlled Panel Primitive

**Files:**
- Create: `packages/ui/src/components/AppCollapsiblePanel.vue`
- Create: `packages/ui/src/__tests__/AppCollapsiblePanel.test.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/__tests__/package-contract.test.ts`

**Interfaces:**
- Consumes: `open?: boolean`, required `panelId: string`, required `label: string`, named `icon`, `title`, `description`, and `aside` slots, plus default content.
- Produces: `<AppCollapsiblePanel v-model:open="open" panel-id="stable-id" label="accessible name">`; emits `update:open` with a `boolean`; exposes `data-collapsible-panel-trigger` and `data-collapsible-panel-content` selectors.

- [ ] **Step 1: Write the failing component contract tests**

```ts
import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppCollapsiblePanel from "../components/AppCollapsiblePanel.vue";

const PanelHarness = defineComponent({
  components: { AppCollapsiblePanel },
  setup: () => ({ open: ref(false) }),
  template: `
    <AppCollapsiblePanel v-model:open="open" panel-id="policy" label="Template policy">
      <template #title>Template policy</template>
      <template #description>Limits for public templates</template>
      <input data-panel-field value="kept" />
    </AppCollapsiblePanel>
  `,
});

it("links its controlled trigger to a mounted hidden region and opens on click", async () => {
  const wrapper = mount(PanelHarness);
  const trigger = wrapper.get("[data-collapsible-panel-trigger]");
  const content = wrapper.get("[data-collapsible-panel-content]");

  expect(trigger.attributes("aria-expanded")).toBe("false");
  expect(trigger.attributes("aria-controls")).toBe(content.attributes("id"));
  expect(content.attributes("aria-labelledby")).toBe(trigger.attributes("id"));
  expect(content.exists()).toBe(true);
  expect(content.isVisible()).toBe(false);
  expect(wrapper.get("[data-panel-field]").element).toBeInstanceOf(HTMLInputElement);

  await trigger.trigger("click");
  expect(trigger.attributes("aria-expanded")).toBe("true");
  expect(content.isVisible()).toBe(true);
});

it("defaults to an expanded region when open is not supplied", () => {
  const wrapper = mount(AppCollapsiblePanel, {
    props: { panelId: "default-open", label: "Default open" },
    slots: { title: "Default open", default: "Panel body" },
  });

  expect(wrapper.get("[data-collapsible-panel-trigger]").attributes("aria-expanded")).toBe("true");
  expect(wrapper.get("[data-collapsible-panel-content]").isVisible()).toBe(true);
});
```

- [ ] **Step 2: Run the new test to verify it fails because the component does not exist**

Run: `pnpm --filter @godgesture/ui exec vitest run --config vitest.config.ts src/__tests__/AppCollapsiblePanel.test.ts`

Expected: FAIL with a module-resolution error for `../components/AppCollapsiblePanel.vue`; do not write production code until this failure is observed.

- [ ] **Step 3: Implement the smallest public component and package contract**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown } from "lucide-vue-next";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  open?: boolean;
  panelId: string;
  label: string;
}>(), { open: true });
const emit = defineEmits<{ "update:open": [open: boolean] }>();
const triggerId = computed(() => `${props.panelId}-trigger`);
const contentId = computed(() => `${props.panelId}-content`);

function toggle(): void {
  emit("update:open", !props.open);
}
</script>

<template>
  <section v-bind="$attrs" class="gg-panel gg-collapsible-panel">
    <div class="gg-collapsible-panel__header">
      <h3 class="gg-collapsible-panel__heading">
        <button :id="triggerId" type="button" class="gg-collapsible-panel__trigger" :aria-label="label" :aria-expanded="open" :aria-controls="contentId" data-collapsible-panel-trigger @click="toggle">
          <span v-if="$slots.icon" class="gg-collapsible-panel__icon"><slot name="icon" /></span>
          <span class="gg-collapsible-panel__copy"><span class="gg-collapsible-panel__title"><slot name="title" /></span><span v-if="$slots.description" class="gg-collapsible-panel__description"><slot name="description" /></span></span>
          <ChevronDown class="gg-collapsible-panel__chevron" :class="{ 'gg-collapsible-panel__chevron--open': open }" aria-hidden="true" />
        </button>
      </h3>
      <div v-if="$slots.aside" class="gg-collapsible-panel__aside"><slot name="aside" /></div>
    </div>
    <Transition name="gg-panel-collapse">
      <div v-show="open" :id="contentId" class="gg-collapsible-panel__content" role="region" :aria-labelledby="triggerId" data-collapsible-panel-content><div class="gg-collapsible-panel__body"><slot /></div></div>
    </Transition>
  </section>
</template>
```

Add `export { default as AppCollapsiblePanel } from "./components/AppCollapsiblePanel.vue";` to `packages/ui/src/index.ts`. Add the classes to `styles.css` using only `--gg-*` tokens: a two-column header, full-width trigger, 44px minimum trigger target, heading/title/description alignment, right-side aside, 180ms chevron `transform`, 180ms content `opacity` and `translateY(-4px)` transition, and a reduced-motion override. Extend the package contract test with `expect(ui).toHaveProperty("AppCollapsiblePanel")`; the mounted component contract and browser check, rather than a stylesheet-text assertion, validate the visual behavior.

- [ ] **Step 4: Run the component tests and shared UI typecheck to verify they pass**

Run: `pnpm --filter @godgesture/ui exec vitest run --config vitest.config.ts src/__tests__/AppCollapsiblePanel.test.ts src/__tests__/package-contract.test.ts`

Expected: both test files pass, showing `aria-expanded` changes via the parent `v-model:open` state and the concealed input remains mounted.

Run: `pnpm --filter @godgesture/ui typecheck`

Expected: PASS with no Vue/TypeScript errors.

- [ ] **Step 5: Leave changes unstaged while retaining a focused diff**

Run: `pnpm exec prettier --check packages/ui/src/components/AppCollapsiblePanel.vue packages/ui/src/__tests__/AppCollapsiblePanel.test.ts packages/ui/src/index.ts packages/ui/src/styles.css packages/ui/src/__tests__/package-contract.test.ts`

Expected: all five files pass formatting validation. Do not stage or commit: `packages/ui/` is already an untracked user-owned feature directory in this checkout, so staging its modified existing files would capture unrelated work.

### Task 2: Consume The Primitive In System Config

**Files:**
- Modify: `apps/server/web-console/src/views/SystemConfigView.vue`
- Modify: `apps/server/web-console/src/views/__tests__/SystemConfigView.test.ts`

**Interfaces:**
- Consumes: `AppCollapsiblePanel` export from `@godgesture/ui` using `v-model:open`, `panel-id`, `label`, `icon`, `title`, `description`, and `aside` slots.
- Produces: `data-system-panel="policy"` opened by default, `data-system-panel="rustfs"` closed by default, while all existing `data-system-*` form selectors and save/test behavior remain available after expansion.

- [ ] **Step 1: Write the failing System Config interaction test and update the RustFS user path**

```ts
it("opens template policy by default and keeps RustFS closed until its trigger is used", async () => {
  const wrapper = mountView();
  await flushPromises();
  const policyPanel = wrapper.get('[data-system-panel="policy"]');
  const rustfsPanel = wrapper.get('[data-system-panel="rustfs"]');

  expect(policyPanel.get("[data-collapsible-panel-trigger]").attributes("aria-expanded")).toBe("true");
  expect(rustfsPanel.get("[data-collapsible-panel-trigger]").attributes("aria-expanded")).toBe("false");
  expect(rustfsPanel.get("[data-collapsible-panel-content]").isVisible()).toBe(false);

  await rustfsPanel.get("[data-collapsible-panel-trigger]").trigger("click");
  expect(rustfsPanel.get("[data-collapsible-panel-content]").isVisible()).toBe(true);
  expect(rustfsPanel.get('[data-system-rustfs-test]').isVisible()).toBe(true);
  wrapper.unmount();
});
```

Before entering candidate credentials in the existing test-connection test, click the RustFS panel trigger and assert its content is visible. Do the same before setting a RustFS access key in the save test; this proves the real user path instead of relying on hidden DOM nodes.

- [ ] **Step 2: Run the page test to verify it fails because the system panels are not yet collapsible**

Run: `pnpm --filter @godgesture/server exec vitest run --config web-console/vite.config.mts web-console/src/views/__tests__/SystemConfigView.test.ts`

Expected: FAIL because `[data-system-panel="policy"]` and its collapsible trigger do not exist in the current page markup.

- [ ] **Step 3: Add local open-state ownership and slot-based page markup**

```ts
import { AppCollapsiblePanel } from "@godgesture/ui";

const policyPanelOpen = ref(true);
const rustfsPanelOpen = ref(false);
```

Replace each direct `section.gg-panel` inside the form with the shared component. Preserve the existing form fields, labels, validation messages, buttons, and handlers inside the default slots. The two root calls must follow this shape:

```vue
<AppCollapsiblePanel v-model:open="policyPanelOpen" panel-id="system-policy-panel" :label="t('systemConfig.templatePolicyTitle')" data-system-panel="policy">
  <template #icon><ServerCog class="h-5 w-5" aria-hidden="true" /></template>
  <template #title>{{ t("systemConfig.templatePolicyTitle") }}</template>
  <template #description>{{ t("systemConfig.templatePolicyHint") }}</template>
  <div class="grid gap-4">
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="field in POLICY_FIELDS" :key="field" class="grid gap-1.5">
        <label :for="`system-policy-${field}`" class="text-sm font-medium">{{ t(`admin.${field}`) }}</label>
        <input :id="`system-policy-${field}`" v-model.number="policy[field]" :data-system-policy-field="field" class="gg-input font-mono" min="0" step="1" :max="config.templatePolicy[HARD_FIELD_BY_POLICY[field]]" :aria-invalid="Boolean(policyFieldError(field))" type="number" />
        <p class="m-0 text-xs text-[var(--gg-text-muted)]">{{ t("systemConfig.maximum", { count: config.templatePolicy[HARD_FIELD_BY_POLICY[field]] }) }}</p>
        <p v-if="policyFieldError(field)" class="m-0 text-xs text-[var(--gg-danger)]" role="alert">{{ t(policyFieldError(field)!) }}</p>
      </div>
    </div>
  </div>
</AppCollapsiblePanel>

<AppCollapsiblePanel v-model:open="rustfsPanelOpen" panel-id="system-rustfs-panel" :label="t('systemConfig.rustfsTitle')" data-system-panel="rustfs">
  <template #icon><PlugZap class="h-5 w-5" aria-hidden="true" /></template>
  <template #title>{{ t("systemConfig.rustfsTitle") }}</template>
  <template #description>{{ t("systemConfig.rustfsHint") }}</template>
  <template #aside>
    <div class="flex flex-wrap gap-2">
      <AppBadge :variant="config.rustfs.accessKeyConfigured ? 'success' : 'warning'" data-system-rustfs-status="accessKey">{{ t("systemConfig.accessKey") }}：{{ config.rustfs.accessKeyConfigured ? t("systemConfig.configured") : t("systemConfig.notConfigured") }}</AppBadge>
      <AppBadge :variant="config.rustfs.secretKeyConfigured ? 'success' : 'warning'" data-system-rustfs-status="secretKey">{{ t("systemConfig.secretKey") }}：{{ config.rustfs.secretKeyConfigured ? t("systemConfig.configured") : t("systemConfig.notConfigured") }}</AppBadge>
    </div>
  </template>
  <div class="grid gap-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="grid gap-1.5 sm:col-span-2"><label for="system-rustfs-endpoint" class="text-sm font-medium">{{ t("systemConfig.endpoint") }}</label><input id="system-rustfs-endpoint" v-model="rustfs.endpoint" data-system-rustfs-field="endpoint" class="gg-input" type="url" autocomplete="off" :aria-invalid="Boolean(rustfsErrorKey === 'systemConfig.endpointInvalid')" /></div>
      <div class="grid gap-1.5"><label for="system-rustfs-region" class="text-sm font-medium">{{ t("systemConfig.region") }}</label><input id="system-rustfs-region" v-model="rustfs.region" data-system-rustfs-field="region" class="gg-input" autocomplete="off" /></div>
      <div class="grid gap-1.5"><label for="system-rustfs-bucket" class="text-sm font-medium">{{ t("systemConfig.bucket") }}</label><input id="system-rustfs-bucket" v-model="rustfs.bucket" data-system-rustfs-field="bucket" class="gg-input" autocomplete="off" /></div>
      <div class="grid gap-1.5"><label for="system-rustfs-ttl" class="text-sm font-medium">{{ t("systemConfig.ttl") }}</label><input id="system-rustfs-ttl" v-model.number="rustfs.publicDownloadTtlSec" data-system-rustfs-field="publicDownloadTtlSec" class="gg-input font-mono" min="1" max="900" step="1" type="number" /></div>
      <div class="grid gap-1.5"><label for="system-rustfs-access-key" class="text-sm font-medium">{{ t("systemConfig.accessKeyInput") }}</label><input id="system-rustfs-access-key" v-model="rustfs.accessKey" data-system-rustfs-field="accessKey" class="gg-input" type="password" autocomplete="new-password" :placeholder="config.rustfs.accessKeyConfigured ? t("systemConfig.keepCurrent") : t("systemConfig.enterValue")" /></div>
      <div class="grid gap-1.5"><label for="system-rustfs-secret-key" class="text-sm font-medium">{{ t("systemConfig.secretKeyInput") }}</label><input id="system-rustfs-secret-key" v-model="rustfs.secretKey" data-system-rustfs-field="secretKey" class="gg-input" type="password" autocomplete="new-password" :placeholder="config.rustfs.secretKeyConfigured ? t("systemConfig.keepCurrent") : t("systemConfig.enterValue")" /></div>
    </div>
    <p v-if="rustfsErrorKey" class="m-0 text-xs text-[var(--gg-danger)]" role="alert">{{ t(rustfsErrorKey) }}</p>
    <AppAlert v-if="testErrorKey" variant="error">{{ t(testErrorKey) }}</AppAlert>
    <div class="flex flex-wrap justify-end gap-2 border-t border-[var(--gg-border)] pt-4"><AppButton data-system-rustfs-test type="button" variant="secondary" :disabled="!formIsValid" :loading="testing" @click="testConnection"><PlugZap class="h-4 w-4" aria-hidden="true" />{{ t("systemConfig.testConnection") }}</AppButton></div>
  </div>
</AppCollapsiblePanel>
```

Import the shared primitive directly rather than creating a Console adapter because it has no localized labels or Console-specific behavior. Do not modify `assignConfig`, `rustfsPayload`, `testConnection`, `save`, validation computed values, or `pushToast` calls.

- [ ] **Step 4: Run the page regression suite and Web Console typecheck**

Run: `pnpm --filter @godgesture/server exec vitest run --config web-console/vite.config.mts web-console/src/views/__tests__/SystemConfigView.test.ts`

Expected: PASS; the policy panel starts visible, RustFS becomes visible after the trigger, candidate credentials go only to the test endpoint, and success still uses exactly one shared toast rather than a success alert.

Run: `pnpm --filter @godgesture/server web:typecheck`

Expected: PASS with no component prop, slot, or Vue template errors.

- [ ] **Step 5: Check the private Server submodule diff without staging it**

Run: `git -C apps/server diff --check -- web-console/src/views/SystemConfigView.vue web-console/src/views/__tests__/SystemConfigView.test.ts`

Expected: no whitespace errors. Do not stage or commit because `SystemConfigView.vue` and its test are pre-existing untracked user-owned files in the private submodule checkout.

### Task 3: Record The Verification Baseline And Validate The Running Console

**Files:**
- Modify: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Consumes: passing focused component/page tests, UI/Console typechecks, production build, and the existing `http://127.0.0.1:5180/admin/system` development instance.
- Produces: a current handoff note that `@godgesture/ui` includes the collapsible panel primitive and that `/admin/system` defaults only its policy panel to open.

- [ ] **Step 1: Update the current status and baseline with exact final evidence**

Add a concise current-workspace sentence saying that the shared UI package now includes an accessible non-persistent collapsible panel primitive and `/admin/system` opens Template Policy first while RustFS starts collapsed with credential badges visible. Add one dated verification bullet containing the actual passing focused test counts, `@godgesture/ui` typecheck, Web Console typecheck, and Web Console production build results; retain the existing Desktop `GesturesView` typecheck limitation unchanged.

- [ ] **Step 2: Run final targeted automated verification**

Run: `pnpm --filter @godgesture/ui test`

Expected: PASS for the complete shared UI suite including the new component contract.

Run: `pnpm --filter @godgesture/ui typecheck`

Expected: PASS.

Run: `pnpm --filter @godgesture/server web:test`

Expected: PASS for the complete Web Console Vitest suite including System Config regressions.

Run: `pnpm --filter @godgesture/server web:typecheck`

Expected: PASS.

Run: `pnpm --filter @godgesture/server web:build`

Expected: PASS and emit the Web Console production bundle.

Run: `git diff --check` and `git -C apps/server diff --check`

Expected: both commands finish with no output.

- [ ] **Step 3: Validate the live route using the existing instance**

Open `http://127.0.0.1:5180/admin/system` in the in-app browser. Authenticate only if the existing local session requires it; do not manufacture credentials. Verify at desktop width and a narrow viewport that Template Policy is initially expanded, RustFS is initially collapsed, the two RustFS badges remain visible while collapsed, each header has a visible keyboard-focus state and clickable chevron, opening/closing does not clear a typed field, and no page-level horizontal overflow appears. Capture screenshots for the implementation record.

- [ ] **Step 4: Preserve the dirty worktree and report handoff status**

Run: `git status --porcelain=v1` and `git -C apps/server status --porcelain=v1`

Expected: the known unrelated dirty files remain present, plus only the intended panel-plan/component/page/documentation changes. Do not run `git add`, do not create a commit, and report the exact validation evidence and manual test path to the maintainer.

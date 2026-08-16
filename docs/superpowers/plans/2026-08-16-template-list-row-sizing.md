# Template List Row Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep each Desktop template catalog entry at its content height instead of stretching a single entry across the entire scroll viewport.

**Architecture:** Preserve the existing fixed Desktop page grid, card styling, and scrolling container. Make the catalog grid's implicit rows explicitly content-sized and pin the grid content to the top; no store, markup, detail dialog, or shared UI changes are needed.

**Tech Stack:** Vue 3, scoped CSS, Vitest, Vue Test Utils, pnpm monorepo.

## Global Constraints

- Desktop keeps its fixed-size layout; do not add responsive breakpoints.
- UI text remains in the existing vue-i18n messages; this fix adds no text.
- Preserve the existing semantic button rows, keyboard focus behavior, risk badges, and 8px list spacing.
- Use explicit `git add <path>` and an English commit message; do not push.

---

### Task 1: Lock the Catalog Row Contract

**Files:**
- Modify: `apps/desktop/src/views/__tests__/TemplatesView.test.ts`

**Interfaces:**
- Consumes: the mounted `.templates-view__list` rendered by `TemplatesView`.
- Produces: a regression assertion that the catalog uses content-sized implicit rows and top alignment.

- [x] **Step 1: Write the failing test**

Add a test beside the existing template detail layout tests. The Vitest `happy-dom` environment does not inject scoped SFC CSS into `document.head`, so the test mounts the real list and checks the component's narrow CSS layout contract from the source:

```ts
it("keeps catalog rows content-sized when the list has spare height", async () => {
  const { view, confirmHost, toasts } = await mountTemplates();

  try {
    expect(document.querySelector(".templates-view__list")).not.toBeNull();

    const source = await readFile(join(process.cwd(), "src", "views", "TemplatesView.vue"), "utf8");
    const listRuleStart = source.indexOf(".templates-view__list {");
    const listRuleEnd = source.indexOf("}", listRuleStart);
    const listRule = source.slice(listRuleStart, listRuleEnd);

    expect(listRule).toContain("grid-auto-rows: max-content;");
    expect(listRule).toContain("align-content: start;");
  } finally {
    view.unmount();
    confirmHost.unmount();
    toasts.unmount();
  }
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm --filter @godgesture/desktop exec vitest run src/views/__tests__/TemplatesView.test.ts -t "keeps catalog rows content-sized"
```

Expected: the test fails because the current `.templates-view__list` has neither explicit `grid-auto-rows: max-content` nor `align-content: start`.

### Task 2: Apply the Minimal Grid Fix

**Files:**
- Modify: `apps/desktop/src/views/TemplatesView.vue:499`

**Interfaces:**
- Consumes: the existing `.templates-view__list` grid and `.templates-view__row` card layout.
- Produces: content-sized implicit rows with unused vertical space retained below the catalog entries.

- [x] **Step 1: Add the two layout constraints**

Extend the existing one-line rule without changing its other values:

```css
.templates-view__list {
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  overflow-y: auto;
  padding: 1px 2px 4px;
  scrollbar-gutter: stable;
}
```

- [x] **Step 2: Run the focused regression test**

Run:

```powershell
pnpm --filter @godgesture/desktop exec vitest run src/views/__tests__/TemplatesView.test.ts -t "keeps catalog rows content-sized"
```

Expected: PASS.

### Task 3: Verify and Commit

**Files:**
- Verify: `apps/desktop/src/views/TemplatesView.vue`
- Verify: `apps/desktop/src/views/__tests__/TemplatesView.test.ts`

- [x] **Step 1: Run the affected test file**

Run:

```powershell
pnpm --filter @godgesture/desktop exec vitest run src/views/__tests__/TemplatesView.test.ts
```

Expected: 7 tests pass with no failures.

- [x] **Step 2: Check the diff**

Run:

```powershell
git diff --check
git diff -- apps/desktop/src/views/TemplatesView.vue apps/desktop/src/views/__tests__/TemplatesView.test.ts
```

Expected: only the catalog row sizing CSS and its regression test are changed; no detail, store, protocol, or localization files are touched.

- [ ] **Step 3: Commit the focused change**

Run:

```powershell
git add apps/desktop/src/views/TemplatesView.vue apps/desktop/src/views/__tests__/TemplatesView.test.ts
git commit -m "fix: keep template catalog rows content-sized"
```

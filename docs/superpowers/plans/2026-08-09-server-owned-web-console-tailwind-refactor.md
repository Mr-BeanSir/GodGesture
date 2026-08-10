# Server-Owned Web Console Tailwind Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the standalone Web Console Git submodule, make its Vue 3 + Vite
source owned by the private NestJS Server submodule, and replace Element Plus with
a Tailwind v4, project-local, accessible operations-console component system across
every Console route.

**Architecture:** NestJS remains the REST API and authentication boundary; Vue/Vite
remains an independently built browser SPA. `apps/server/web-console/` owns the
Console source, `apps/server/web-console-dist/` is its disposable production output,
and Nest/Express serves that output only for non-API GET requests. `/api/v1`, bearer
token storage, OpenAPI generation, Prisma, RustFS, OAuth, desktop consumers, and
all server-side authorization rules remain unchanged.

**Tech Stack:** NestJS 11, Express static middleware, Vue 3.5, Vite 6,
Tailwind CSS v4 via `@tailwindcss/vite`, Pinia, vue-i18n, Vitest, Lucide Vue,
Prisma/PostgreSQL, pnpm 10.34.5.

---

## Non-Negotiable Decisions

- This is **not** a Next.js migration. Keep the frontend and backend source/runtime
  boundaries separate: Vite develops the SPA, Nest develops the API, and Docker
  builds the SPA before Nest serves its static output.
- `apps/server` remains the private Git submodule. Only `apps/web-console` is
  retired as a submodule. The final Console source lives at
  `apps/server/web-console/` and remains a Vue application.
- Do not change the public REST contract. Desktop and Console continue to call
  `/api/v1`; `pnpm check:api` must remain clean without unrelated `shared` changes.
- Do not delete, overwrite, stage, or commit a maintainer's pre-existing dirty
  changes. This working tree already contains unrelated root, Desktop, Server, and
  documentation changes. Use explicit paths and inspect every affected hunk.
- Use `packages/shared/src/assets/mnemonic.svg` through the Vite filesystem URL.
  Do not duplicate, redraw, or replace the asset.
- `ui-ux-pro-max` is mandatory for Console visual work. The persistent Master is
  `design-system/godgesture-web-console/MASTER.md`; it governs every existing and
  future Console route. It is a design-process contract rather than a runtime
  enforcement mechanism, so the implementer must read it before changing a page.
  Run a task-specific `--stack vue` or UX/domain query before a new page or major
  surface decision, and create `pages/<route>.md` only for a confirmed exception.
- The Console is a quiet, high-density operations tool. It is not a landing page:
  no hero, marketing cards, decorative gradients, bento layout, fabricated metrics,
  scroll reveal, or floating-section-card treatment.

## Target File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Server-owned SPA | `apps/server/web-console/{index.html,tsconfig.json,vite.config.mts,src/**}` | Vue routes, local UI primitives, APIs, i18n, styling, tests |
| Server package | `apps/server/package.json`, `.gitignore`, `src/main.ts`, `Dockerfile` | Unified scripts, static hosting, production artifact |
| Root integration | `.gitmodules`, `scripts/dev-server.mjs`, `package.json`, `pnpm-lock.yaml`, `scripts/__tests__/repository-layout.test.mjs` | Retire the Console gitlink and start/build only the Server-owned SPA |
| Design rules | `design-system/godgesture-web-console/MASTER.md` | Persistent visual, responsive, keyboard, and theme rules for every future Console route |
| Architecture/docs | `docs/adr/0016-web-console-owned-by-server.md`, `docs/adr/README.md`, `README.md`, `apps/server/{AGENTS.md,README.md,README-DEPLOY.md}`, `docs/PROJECT_STATUS.md`, `docs/USER_GUIDE.md` | Record ownership, developer workflow, deployment, and verified status |

## Acceptance Contract

1. `apps/web-console` is no longer a Git submodule and `.gitmodules` has no Web
   Console entry. `apps/server` remains a submodule.
2. All nine Console surfaces use only Vue, Tailwind, native controls, local
   components, and Lucide icons: login/register/reset, OAuth callback, overview,
   read-only config, devices, snapshots, security, administrator, and template
   moderation.
3. `rg -n "element-plus|@element-plus|<el-|--el-" apps/server/web-console
   apps/server/package.json` has no matches. There is no Element Plus or Element
   Plus icon dependency in the Server package or resolved dependency closure.
   Root `pnpm-lock.yaml` entries owned by the still-Element-Plus Desktop package
   are outside this Server Console migration boundary.
4. Light mode is default and dark mode is a complete manual theme. The primary
   desktop workspace starts at `1024px`; `375px` and `768px` retain all routes and
   actions through a compact navigation fallback.
5. Every data view has loading, empty, error/retry, keyboard focus, and destructive
   confirmation behavior. All visible Console text is served by both `zh-CN` and
   `en` vue-i18n messages.
6. Production Docker serves Console deep links such as `/devices` with `index.html`
   without masking `/api/*` or `/docs*`; development continues to proxy `/api` from
   Vite to Nest.

### Task 1: Freeze the Migration Boundary and Reconcile the Partial Worktree

**Files:**
- Modify: `docs/adr/0016-web-console-owned-by-server.md`
- Modify: `docs/adr/README.md`
- Modify: `apps/server/AGENTS.md`
- Test: `scripts/__tests__/repository-layout.test.mjs`

- [ ] **Step 1: Capture root and Server ownership before changing files.**

  Run:

  ```powershell
  git status --porcelain=v1
  git -C apps/server status --porcelain=v1
  git log --oneline -12
  git -C apps/server log --oneline -12
  git diff -- .gitmodules scripts/dev-server.mjs package.json pnpm-lock.yaml
  git -C apps/server diff -- package.json src/main.ts Dockerfile .gitignore
  ```

  Expected: the existing maintainer changes remain visible and the current task's
  partial Console migration is distinguishable. Do not run `git reset`, `git
  checkout`, `git restore` against another person's paths, or `git rm -f
  apps/web-console`.

- [ ] **Step 2: Make ADR-0016 the single source of truth for this migration.**

  Ensure its decision section states all of the following exact boundaries:

  ```markdown
  - `apps/server/web-console/` is a Vue 3 + Vite SPA owned by the Server package.
  - It remains a separately compiled frontend; NestJS continues to own REST,
    authentication, authorization, Prisma, RustFS and OpenAPI.
  - Vite serves the SPA in development and proxies `/api`; Nest serves only the
    built SPA in production and preserves `/api/v1` unchanged.
  - This ADR does not introduce Next.js or merge frontend code into Nest modules.
  ```

  Update the ADR index so `0016` explicitly supersedes only the independent Web
  Console submodule portion of ADR-0015. Preserve the statement that Server is a
  private submodule and retains the root workspace shared dependency.

- [ ] **Step 3: Update the nested engineering rule file.**

  Replace stale wording that calls the Web Console a separate submodule with the
  following operational rule in `apps/server/AGENTS.md`:

  ```markdown
  `web-console/` is the Server-owned Vue/Vite frontend. Before changing any
  Console route, read `design-system/godgesture-web-console/MASTER.md`; preserve
  the `/api/v1` contract, use vue-i18n for all user-visible copy, and keep the
  frontend build/test commands within `@godgesture/server`.
  ```

- [ ] **Step 4: Add the failing repository-layout assertion.**

  In `scripts/__tests__/repository-layout.test.mjs`, remove assumptions that
  `apps/web-console/package.json` exists as a submodule. Add assertions that
  `.gitmodules` does not mention the old path and that the Server owns the Vite
  entrypoint:

  ```js
  assert.doesNotMatch(gitmodules, /path = apps\/web-console/);
  assert.equal(fs.existsSync("apps/server/web-console/vite.config.mts"), true);
  assert.equal(fs.existsSync("apps/server/web-console/src/main.ts"), true);
  assert.equal(fs.existsSync("apps/server/package.json"), true);
  ```

- [ ] **Step 5: Run the targeted layout test and inspect the diff.**

  Run:

  ```powershell
  pnpm test:repository-layout
  git diff --check
  ```

  Expected: the layout test passes and `git diff --check` prints nothing.

### Task 2: Move the Vue Source Under Server Ownership and Unify Build Metadata

**Files:**
- Create or reconcile: `apps/server/web-console/index.html`
- Create or reconcile: `apps/server/web-console/tsconfig.json`
- Create or reconcile: `apps/server/web-console/vite.config.mts`
- Create or reconcile: `apps/server/web-console/src/**`
- Modify: `apps/server/package.json`
- Modify: `apps/server/.gitignore`
- Modify: `.gitmodules`
- Modify: `pnpm-lock.yaml`
- Test: `apps/server/web-console/src/api/__tests__/templates.test.ts`
- Test: `apps/server/web-console/src/utils/__tests__/oauth-callback.test.ts`

- [ ] **Step 1: Materialize the tracked Console source inside the Server submodule.**

  Copy all tracked files from the old Console checkout into
  `apps/server/web-console/`, retaining source, tests, Vite config, i18n, API
  helpers, and components. Do not retain a nested `package.json`, nested
  `.gitignore`, or nested `AGENTS.md`; the Server package is now the only package
  owner. Confirm the migration with file counts rather than relying on an empty
  locked directory:

  ```powershell
  git -C apps/web-console ls-files | Measure-Object
  git -C apps/server ls-files web-console | Measure-Object
  ```

  If the legacy checkout is unavailable or locked, use Git archive/copy semantics
  from its tracked tree. Never force-kill a process merely to remove an empty
  legacy directory.

- [ ] **Step 2: Give the Server package all frontend dependencies and scripts.**

  In `apps/server/package.json`, keep Nest scripts and add these script contracts:

  ```json
  {
    "scripts": {
      "build": "nest build && pnpm web:build",
      "typecheck": "tsc -p tsconfig.json --noEmit && pnpm web:typecheck",
      "test": "jest && pnpm web:test",
      "web:dev": "vite --config web-console/vite.config.mts",
      "web:build": "vue-tsc -p web-console/tsconfig.json --noEmit && vite build --config web-console/vite.config.mts",
      "web:typecheck": "vue-tsc -p web-console/tsconfig.json --noEmit",
      "web:test": "vitest run --config web-console/vite.config.mts",
      "web:preview": "vite preview --config web-console/vite.config.mts"
    }
  }
  ```

  Add Vue, Pinia, vue-i18n, vue-router, Zod, Vite, `@vitejs/plugin-vue`,
  `@tailwindcss/vite`, Tailwind v4, `vue-tsc`, Vitest, and `lucide-vue-next` to
  the Server package. Remove `element-plus` and `@element-plus/icons-vue` from
  the migrated dependency closure. Use the repository's pnpm 10.34.5:

  ```powershell
  pnpm --filter @godgesture/server add -D vue@^3.5 pinia@^2.3 vue-i18n@^11 vue-router@^4.5 zod@^3.24 lucide-vue-next @vitejs/plugin-vue@^5 vite@^6 vitest@^2 vue-tsc@^2 tailwindcss@^4 @tailwindcss/vite@^4
  pnpm install --lockfile-only
  ```

  Do not use a bundled pnpm version that changes the repository's store format.

- [ ] **Step 3: Define Vite's Server-owned root and development proxy.**

  Make `apps/server/web-console/vite.config.mts` resolve all paths from its own
  directory and never hard-code a developer-specific filesystem location:

  ```ts
  const webConsoleRoot = dirname(fileURLToPath(import.meta.url));

  export default defineConfig({
    root: webConsoleRoot,
    plugins: [vue(), tailwindcss()],
    envPrefix: ["GODGESTURE_", "VITE_"],
    build: {
      outDir: resolve(webConsoleRoot, "../web-console-dist"),
      emptyOutDir: true,
    },
    server: {
      host: "127.0.0.1",
      port: Number(process.env.GODGESTURE_WEB_PORT || "5180"),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${Number(process.env.GODGESTURE_SERVER_PORT || "3000")}`,
          changeOrigin: true,
        },
      },
    },
  });
  ```

- [ ] **Step 4: Ignore only disposable frontend output.**

  Add these Server-local paths to `apps/server/.gitignore`:

  ```gitignore
  web-console-dist/
  web-console/.vite/
  ```

  Do not ignore `web-console/src`, tests, `vite.config.mts`, or `index.html`.

- [ ] **Step 5: Remove only the old root gitlink.**

  Delete the `apps/web-console` stanza from `.gitmodules`, then remove the
  gitlink from the root index while preserving any existing local checkout:

  ```powershell
  git update-index --force-remove apps/web-console
  ```

  The expected root status is a staged `D  apps/web-console` plus the new Server
  submodule commit later. An empty physical `apps/web-console` directory is not a
  tracked artifact and may be removed only after any locking process releases it.

- [ ] **Step 6: Prove source compatibility before visual refactoring.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:typecheck
  pnpm --filter @godgesture/server web:test
  ```

  Expected: existing OAuth callback and template API tests pass from the new
  package location. Fix only move-induced aliases, asset paths, test roots, or
  environment issues before beginning the Element replacement.

### Task 3: Serve the Production SPA Without Changing API Semantics

**Files:**
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/Dockerfile`
- Modify: `scripts/dev-server.mjs`
- Modify: `apps/server/docker-compose.dev.yml`
- Modify: `apps/server/docker-compose.prod.yml`
- Test: `apps/server/test/app.e2e-spec.ts`

- [ ] **Step 1: Add a static SPA fallback after Nest API and docs setup.**

  In `apps/server/src/main.ts`, after global prefix, CORS, Swagger, Helmet, and
  exception configuration, use this route exclusion shape:

  ```ts
  const consoleDist = join(__dirname, "..", "web-console-dist");
  const consoleIndex = join(consoleDist, "index.html");
  if (existsSync(consoleIndex)) {
    app.useStaticAssets(consoleDist, { index: false });
    app.use((request, response, next) => {
      if (
        request.method !== "GET" ||
        request.path.startsWith("/api/") ||
        request.path === "/docs" ||
        request.path.startsWith("/docs/")
      ) {
        next();
        return;
      }
      response.sendFile(consoleIndex);
    });
  }
  ```

  Keep `app.setGlobalPrefix("api/v1")`, bearer authentication, OpenAPI document
  generation, and the `helmet` configuration unchanged.

- [ ] **Step 2: Extend the e2e test before shipping the fallback.**

  Add cases that create a temporary `web-console-dist/index.html` fixture or run
  against a compiled fixture, then assert:

  ```ts
  await request(app.getHttpServer()).get("/devices").expect(200);
  await request(app.getHttpServer()).get("/api/v1/health").expect(200);
  await request(app.getHttpServer()).get("/api/v1/not-a-route").expect(404);
  await request(app.getHttpServer()).get("/docs/not-a-route").expect(404);
  ```

  The Console deep link must return the SPA HTML. Unknown API/docs paths must not
  be converted into successful HTML responses.

- [ ] **Step 3: Update the multi-stage Docker build.**

  Build shared first, generate Prisma Client from `apps/server/prisma`, then run
  the unified Server build. In the runtime stage copy `web-console-dist` beside
  `dist`:

  ```dockerfile
  RUN pnpm --filter @godgesture/shared build \
    && pnpm --filter @godgesture/server exec prisma generate \
    && pnpm --filter @godgesture/server build

  COPY --chown=node:node --from=build /repo/apps/server/dist apps/server/dist
  COPY --chown=node:node --from=build /repo/apps/server/web-console-dist apps/server/web-console-dist
  ```

  Retain Node 22, non-root runtime, OpenSSL/CA dependencies, `prisma migrate
  deploy`, the root Docker build context, and the one internal 3000 port.

- [ ] **Step 4: Keep the local developer workflow as two processes.**

  Change `scripts/dev-server.mjs` to prepare Prisma through `@godgesture/server`,
  start `start:dev`, wait for `/api/v1/health`, then start `web:dev` with the two
  selected loopback ports. The frontend start call must be:

  ```js
  frontend = start(
    ["--filter", "@godgesture/server", "web:dev"],
    {
      GODGESTURE_SERVER_PORT: String(backendPort),
      GODGESTURE_WEB_PORT: String(frontendPort),
    },
  );
  ```

  Preserve the signal cleanup that stops both children. Do not merge the Vite
  development server into Nest or make a second backend process.

- [ ] **Step 5: Update compose references only if a path changed.**

  Keep PostgreSQL/RustFS service names, health checks, secrets, ports, and
  environment semantics unchanged. Point production `build.dockerfile` to
  `apps/server/Dockerfile`; do not add a separate Console service. Verify:

  ```powershell
  docker compose -f apps/server/docker-compose.dev.yml config
  docker compose -f apps/server/docker-compose.prod.yml config
  pnpm --filter @godgesture/server test:e2e
  ```

  Expected: both Compose files render successfully and the e2e suite includes the
  explicit fallback exclusions.

### Task 4: Establish the Persistent Tailwind Operations Design System

**Files:**
- Modify: `design-system/godgesture-web-console/MASTER.md`
- Create: `apps/server/web-console/src/ui/AppButton.vue`
- Create: `apps/server/web-console/src/ui/AppBadge.vue`
- Create: `apps/server/web-console/src/ui/AppAlert.vue`
- Create: `apps/server/web-console/src/ui/AppSpinner.vue`
- Create: `apps/server/web-console/src/ui/AppEmptyState.vue`
- Create: `apps/server/web-console/src/ui/AppDialog.vue`
- Create: `apps/server/web-console/src/ui/ToastViewport.vue`
- Create: `apps/server/web-console/src/ui/toast.ts`
- Modify: `apps/server/web-console/src/styles.css`
- Create: `apps/server/web-console/src/theme.ts`
- Modify: `apps/server/web-console/src/main.ts`
- Modify: `apps/server/web-console/src/App.vue`
- Test: `apps/server/web-console/src/ui/__tests__/AppDialog.test.ts`
- Test: `apps/server/web-console/src/ui/__tests__/toast.test.ts`

- [ ] **Step 1: Finalize the persistent design rules before component work.**

  Update `MASTER.md` for Vue rather than Next/React and retain these concrete
  tokens and constraints:

  ```markdown
  Canvas: #f8fafc / #0f172a; surface: #ffffff / #111c2e;
  text: #0f172a / #f8fafc; border: #dbe3ee / #314158;
  primary: #0369a1 / #38bdf8; sidebar: 248px; header: 56px;
  full workspace breakpoint: 1024px; base spacing: 4px.
  ```

  State explicitly that all future Console routes inherit this Master unless an
  approved exception is recorded under `design-system/godgesture-web-console/pages/`.

- [ ] **Step 1a: Make ui-ux-pro-max part of the route-design workflow.**

  Before implementing or materially redesigning a route, first read Master and any
  existing override without treating a missing override as an error:

  ```powershell
  Get-Content -Raw design-system/godgesture-web-console/MASTER.md
  Get-ChildItem design-system/godgesture-web-console/pages -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object { Get-Content -Raw $_.FullName }
  ```

  Use the exact corresponding query below, then apply the result only when it is
  compatible with Master and the confirmed product constraints:

  | Route | Required Vue stack query |
  | --- | --- |
  | Login/register/reset | `authentication form registration password reset quiet high-density operations console` |
  | OAuth callback | `oauth callback pending email binding error recovery operations console` |
  | Overview | `account synchronization overview compact operations dashboard` |
  | Config | `read only configuration inspector semantic data table dense operations console` |
  | Devices | `device inventory rename destructive confirmation accessible operations console` |
  | Snapshots | `version history pagination restore conflict confirmation dense operations console` |
  | Security | `account security session logout oauth identity metadata operations console` |
  | Administrator | `administrator user table quota form destructive action operations console` |
  | Template moderation | `template moderation immutable detail review queue report resolution operations console` |

  For example, the device route requires both of these commands:

  ```powershell
  python C:\Users\JBean\AppData\Roaming\SkillsManager\managed-skills\ui-ux-pro-max-db3df392\scripts\search.py "device inventory rename destructive confirmation accessible operations console" --stack vue
  python C:\Users\JBean\AppData\Roaming\SkillsManager\managed-skills\ui-ux-pro-max-db3df392\scripts\search.py "destructive confirmation dialog focus restoration loading error recovery" --domain ux
  ```

  Treat Master rules as the default. For a reviewed exception such as a
  template-moderation inspector, create a narrowly scoped override with:

  ```powershell
  python C:\Users\JBean\AppData\Roaming\SkillsManager\managed-skills\ui-ux-pro-max-db3df392\scripts\search.py "template moderation inspector quiet professional operations console" --design-system --persist --page "template-moderation" -p "GodGesture Web Console" --output-dir "D:\Development\app\GodGesture"
  ```

  Do not pass `--force`: the existing Master is a confirmed durable decision and
  must not be regenerated or overwritten. Do not create page override files merely
  because a page is new; create one only when its approved requirements genuinely
  depart from Master.

- [ ] **Step 2: Define Tailwind v4 semantic variables and stable primitives.**

  Start `styles.css` with `@import "tailwindcss";` and a `.dark` custom variant.
  Define `--gg-canvas`, `--gg-surface`, `--gg-surface-muted`, `--gg-text`,
  `--gg-text-muted`, `--gg-border`, `--gg-primary`, `--gg-success`,
  `--gg-warning`, `--gg-danger`, and `--gg-ring` in light and dark roots. Add
  semantic classes only, including `.gg-panel`, `.gg-input`, `.gg-textarea`,
  `.gg-select`, `.gg-table-wrap`, `.gg-table`, `.gg-page-heading`, and
  `.gg-page-copy`.

  Apply a visible focus ring, `prefers-reduced-motion` override, a `320px` body
  minimum, 40px desktop compact controls, and 44px mobile hit targets. Do not use
  raw per-screen colors, decorative gradient backgrounds, or an Element CSS
  variable.

- [ ] **Step 3: Write component tests before their implementation.**

  Configure Vitest's DOM environment and write the following minimum assertions:

  ```ts
  it("traps Tab inside a visible modal and restores the opening focus", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(AppDialog, { props: { open: true, title: "Confirm" } });
    await wrapper.get("button[aria-label='Close']").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(document.activeElement).toBe(opener);
  });

  it("announces and removes a toast after its timeout", async () => {
    vi.useFakeTimers();
    pushToast({ kind: "success", message: "Saved", timeout: 1000 });
    expect(toasts.value).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(toasts.value).toHaveLength(0);
  });
  ```

- [ ] **Step 4: Implement the smallest reusable component set.**

  `AppButton` accepts `variant` (`primary`, `secondary`, `danger`, `ghost`),
  `size` (`compact`, `default`), `loading`, and native `disabled`; it keeps a
  stable width while loading and exposes a screen-reader loading label.
  `AppBadge` maps semantic kinds to text plus color. `AppAlert` uses `role="alert"`
  for errors. `AppSpinner` has no decorative animation when reduced motion is
  requested. `AppEmptyState` receives title, body, and optional action slot.

  `AppDialog` must implement Escape, backdrop close only when not busy, labelled
  close button, initial focus, Tab/Shift+Tab cycling, focus restoration, a unique
  title ID, `role="dialog"`, and `aria-modal="true"`. `toast.ts` exposes:

  ```ts
  export type ToastKind = "success" | "warning" | "error" | "info";
  export function pushToast(input: {
    kind: ToastKind;
    message: string;
    timeout?: number;
  }): string;
  export function removeToast(id: string): void;
  ```

  `ToastViewport` renders a polite `aria-live` region at layer 80. Do not retain
  Element `ElMessage`, `ElMessageBox`, `v-loading`, `el-alert`, `el-card`,
  `el-empty`, or `el-dialog` calls.

- [ ] **Step 5: Make theme state deterministic.**

  `theme.ts` must use `localStorage` key `godgesture.console.theme`, default to
  `light`, toggle only the root `.dark` class, and expose a `ref<"light" | "dark">`.
  It must not use a system preference as an implicit dark default. `App.vue` mounts
  `ToastViewport`; `main.ts` imports only `styles.css`, Vue app setup, Pinia,
  router, and i18n, with no Element `app.use` call.

- [ ] **Step 6: Run foundation tests and enforce the dependency ban.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:test
  pnpm --filter @godgesture/server web:typecheck
  rg -n "element-plus|@element-plus|<el-|--el-" apps/server/web-console
  ```

  Expected: tests/typecheck pass and ripgrep exits `1` because it finds no
  prohibited Element reference. Treat exit `0` as a failure requiring migration.

### Task 5: Rebuild Navigation, Session Shell, and Public Authentication Views

**Files:**
- Modify: `apps/server/web-console/src/layouts/ConsoleLayout.vue`
- Modify: `apps/server/web-console/src/router/index.ts`
- Modify: `apps/server/web-console/src/App.vue`
- Modify: `apps/server/web-console/src/views/LoginView.vue`
- Modify: `apps/server/web-console/src/views/OAuthCallbackView.vue`
- Modify: `apps/server/web-console/src/stores/auth.ts`
- Modify: `apps/server/web-console/src/api/client.ts`
- Modify: `apps/server/web-console/src/i18n/locales/en.ts`
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`
- Test: `apps/server/web-console/src/router/__tests__/access.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/LoginView.test.ts`
- Test: `apps/server/web-console/src/utils/__tests__/oauth-callback.test.ts`

- [ ] **Step 1: Preserve existing route contracts in a failing route-access test.**

  Test that `/login` and `/oauth/callback` are public; unauthenticated `/devices`
  redirects to login with the original URL; a non-admin `/admin` redirects to
  overview; and every route moves focus to the page `<h1>` after navigation.
  Required protected routes are:

  ```ts
  ["/", "/config", "/devices", "/snapshots", "/security", "/admin", "/admin/templates"];
  ```

- [ ] **Step 2: Implement one stable navigation framework.**

  `ConsoleLayout.vue` uses a 248px fixed sidebar and 56px header from `1024px` up.
  It contains a skip link, product/route identity, text-labelled navigation using
  Lucide icons, locale selector, theme toggle, account menu, and a confirmed logout
  action. At narrower widths replace the visible sidebar with a labelled menu
  control; do not drop routes. Keep regular and administrator navigation within the
  same shell, only conditionally render admin items by role.

  The active route must use `aria-current="page"`; unfamiliar icon-only controls
  need `aria-label` and native `title`. The main landmark has `id="main-content"`
  and receives focus after every route change.

- [ ] **Step 3: Port login, registration, verification, reset, and OAuth unchanged.**

  Use native `<label>`, `<input>`, `<button>`, inline validation text, `AppAlert`,
  `AppSpinner`, and `pushToast`. Preserve the existing API calls, access token
  memory storage, refresh-token localStorage key, cross-tab refresh coordination,
  PKCE callback exchange, pending OAuth email binding, redirect query handling, and
  local-only logout warning. No cookie session is introduced.

- [ ] **Step 4: Add missing bilingual labels.**

  Add matching `zh-CN` and `en` keys for all new reusable controls, including:

  ```ts
  common: { loading, close, save, previous, next, language, languageZh, languageEn, openNavigation, skipToContent }
  theme: { switchToDark, switchToLight }
  ```

  Do not hard-code Chinese in Vue scripts/templates. Existing provider names,
  API error codes, and user-entered template content remain data rather than
  translated UI keys.

- [ ] **Step 5: Verify critical auth behavior.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:test -- --runInBand
  pnpm --filter @godgesture/server web:typecheck
  ```

  Expected: PKCE/OAuth tests retain their current pass count and new route/login
  tests prove no session or authorization regression.

### Task 6: Port the Read-Only Overview and Configuration Workspace

**Files:**
- Modify: `apps/server/web-console/src/views/OverviewView.vue`
- Modify: `apps/server/web-console/src/views/ConfigView.vue`
- Modify: `apps/server/web-console/src/components/MnemonicIcon.vue`
- Modify: `apps/server/web-console/src/components/MnemonicToken.vue`
- Modify: `apps/server/web-console/src/components/GestureMnemonic.vue`
- Modify: `apps/server/web-console/src/components/BoundaryMnemonic.vue`
- Modify: `apps/server/web-console/src/components/MnemonicTrigger.vue`
- Modify: `apps/server/web-console/src/components/WheelModifierIcon.vue`
- Test: `apps/server/web-console/src/views/__tests__/ConfigView.test.ts`

- [ ] **Step 1: Write failing read-only data-state tests.**

  Cover: overview renders only values returned by `me`/config APIs, configuration
  reports its no-cloud-config state, selecting an app fetches only that scope, an
  invalid configuration response exposes recovery rather than a broken table, and
  no test relies on a fabricated metric.

- [ ] **Step 2: Rebuild the overview without expanding its metrics.**

  Use a page heading plus compact definition list/rows for the existing account and
  synchronization values. Maintain loading/error/empty states and a retry action.
  Do not add charts, activity feeds, KPIs, or backend calls beyond the current
  overview behavior.

- [ ] **Step 3: Rebuild the configuration inspector as semantic workspace markup.**

  Keep global app first, grouped applications in synchronized order, scope-on-
  demand reads, action/boundary rows, platform bindings, preferences summary,
  modifiers, command types, and read-only warning. Use a native table inside
  `.gg-table-wrap`, a structured inspector for narrow viewports, and `AppEmptyState`
  / `AppAlert` for data states. Preserve all current parsing and error semantics.

- [ ] **Step 4: Preserve the shared mnemonic asset URL.**

  In `MnemonicIcon.vue`, the only asset source must be:

  ```ts
  const mnemonicSpriteUrl = new URL(
    "../../../../../packages/shared/src/assets/mnemonic.svg",
    import.meta.url,
  ).href;
  ```

  The relative depth may change only if directory layout changes; Vite must resolve
  it to the shared filesystem asset. Replace any `--el-*` style reference in all
  mnemonic components with a `--gg-*` semantic variable.

- [ ] **Step 5: Run focused visual and unit checks.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:test
  rg -n -- "--el-" apps/server/web-console/src
  ```

  Expected: component tests pass and the CSS-variable scan has no match.

### Task 7: Rebuild Device, Snapshot, and Security Operations

**Files:**
- Modify: `apps/server/web-console/src/views/DevicesView.vue`
- Modify: `apps/server/web-console/src/views/SnapshotsView.vue`
- Modify: `apps/server/web-console/src/views/SecurityView.vue`
- Modify: `apps/server/web-console/src/i18n/locales/en.ts`
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`
- Test: `apps/server/web-console/src/views/__tests__/DevicesView.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/SnapshotsView.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/SecurityView.test.ts`

- [ ] **Step 1: Write the destructive-action test matrix.**

  Add cases for rename validation (`1..64` trimmed characters), cancellation
  without a request, successful rename reload, non-current device removal reload,
  current-device removal clearing local auth and redirecting to login, snapshot
  restore confirmation, restore conflict refreshing without auto-retry, local-only
  logout warning, and Escape/backdrop closure of each confirmation dialog.

- [ ] **Step 2: Implement Devices with native table and dialogs.**

  Render name, current marker, platform, last seen, created date, rename, and kick
  with `AppBadge`, `AppButton`, `AppDialog`, `AppAlert`, `AppSpinner`, and
  `AppEmptyState`. The rename dialog has a visible label, inline invalid-name
  message, confirm disabled until valid, and focus returns to the initiating row.
  The kick dialog states whether it is the current device and preserves the existing
  request/error behavior.

- [ ] **Step 3: Implement Snapshots with controlled pagination.**

  Retain `DEFAULT_SNAPSHOT_PAGE_SIZE`, sizes `[10, 20, 50]`, current server
  version, device/date/note/size columns, and restore baseVersion semantics. Use
  real `<button>` page controls and native `<select>` size selection with stable
  labels. During restore, disable competing restore/pagination actions; on 409
  `version_conflict`, show the translated warning, refresh page one, and require a
  fresh user confirmation.

- [ ] **Step 4: Implement Security as concise, non-card-stacked metadata.**

  Show every known OAuth provider and bound/unbound state in a semantic definition
  list/table. Keep logout as the sole destructive command, with confirmation and
  existing local-only warning behavior. Do not add password change, unlink, account
  deletion, or any unimplemented server capability.

- [ ] **Step 5: Run the focused route suite.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:test
  pnpm --filter @godgesture/server web:typecheck
  ```

  Expected: all destructive paths, pagination, and logout variants pass without
  importing Element components.

### Task 8: Rebuild Administrator and Template Moderation Operations

**Files:**
- Modify: `apps/server/web-console/src/views/AdminView.vue`
- Modify: `apps/server/web-console/src/views/TemplateModerationView.vue`
- Modify: `apps/server/web-console/src/api/admin.ts`
- Modify: `apps/server/web-console/src/api/templates.ts`
- Modify: `apps/server/web-console/src/i18n/locales/en.ts`
- Modify: `apps/server/web-console/src/i18n/locales/zh-CN.ts`
- Test: `apps/server/web-console/src/views/__tests__/AdminView.test.ts`
- Test: `apps/server/web-console/src/views/__tests__/TemplateModerationView.test.ts`

- [ ] **Step 1: Lock administrator permissions and payloads in API tests.**

  Test the existing API wrappers with exact paths and request bodies:

  ```ts
  await setAdminUserState(userId, { disabled: true });
  await setAdminUserRole(userId, { role: "admin" });
  await revokeAdminUserSessions(userId);
  await updateTemplatePolicy({ dailySubmissionLimit: 5, pendingVersionLimit: 20, publishedTemplateLimit: 100, maxPackageBytes: 262144 });
  await updateUserTemplatePolicy(userId, { dailySubmissionLimit: null, pendingVersionLimit: 3, publishedTemplateLimit: null, maxPackageBytes: null });
  ```

  Assert validation errors are passed through `errorMessageKey`, no user config
  body/password/token fields are rendered, and a non-admin receives the router
  redirect before a view request.

- [ ] **Step 2: Build the administrator table and policy forms.**

  Render account email, role, verification, state, devices, created date, and
  actions using a horizontal table wrapper. Use Lucide `RefreshCw`, `KeyRound`,
  `Settings2`, `CircleCheck`, and `CircleX` with accessible names. Confirm account
  disable/enable, role change, and session revocation in `AppDialog`; never permit
  the current administrator to change its own role/state when the API forbids it.

  Global policy uses visible numeric labels and native number inputs. User override
  dialog preserves `null` as "inherit global policy"; it must not coerce null to
  zero. Disable submit while loading and render field-level/server errors.

- [ ] **Step 3: Write a failing moderation workflow suite.**

  Cover: queue loading/empty/error/retry, version selection and detail loading,
  immutable metadata/history/review/report rendering, JSON target output as
  `<pre>`, approve/reject/suspend/restore requests, optional review reason,
  report resolve/dismiss requiring a nonblank resolution, and in-flight action
  disablement.

- [ ] **Step 4: Implement the moderation workspace.**

  Use three responsive regions at desktop: queue, selected immutable detail, and
  action rail; stack them at smaller widths. The queue exposes title/author/status
  and `aria-selected`; detail includes package SHA-256 in monospace, byte size,
  tags, risks, targets JSON, history, reviews, reports, and a download link only
  when the API provides `packageUrl`. Use `AppBadge` for statuses and risk labels.

  For every server mutation, show a confirmation dialog and call the existing API:

  ```ts
  await reviewTemplate(selected.versionId, "approve", { reason });
  await resolveTemplateReport(report.id, "resolved", { resolution });
  ```

  After success, display a translated toast and reload exactly the affected queue,
  detail, or report list. Do not allow editing template bodies, replacing packages,
  changing published content, or inventing approval data.

- [ ] **Step 5: Run admin/moderation tests and a manual keyboard pass.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:test
  pnpm --filter @godgesture/server web:typecheck
  ```

  Manually check Tab order, Escape, focus restoration, disabled state, screen-reader
  labels, translated error toasts, and dark-mode status contrast for both routes.

### Task 9: Remove Element Plus Completely and Verify All Frontend Routes

**Files:**
- Modify: every affected file under `apps/server/web-console/src/`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/server/web-console/src/**/__tests__/*.test.ts`

- [ ] **Step 1: Make the no-Element scan an executable preflight.**

  Run:

  ```powershell
  rg -n "element-plus|@element-plus|<el-|--el-" apps/server/web-console apps/server/package.json
  pnpm --filter @godgesture/server why element-plus
  pnpm --filter @godgesture/server why @element-plus/icons-vue
  ```

  Expected after migration: ripgrep has no output and exits `1`; both Server
  dependency queries have no output. Search all Server Console imports, template
  tags, global CSS variables, test mocks, package dependencies, and resolved
  dependency nodes. Do not treat the root lockfile's Desktop-owned Element Plus
  entries as a Server Console failure.

- [ ] **Step 2: Run all Console checks as the Server package.**

  Run:

  ```powershell
  pnpm --filter @godgesture/server web:typecheck
  pnpm --filter @godgesture/server web:test
  pnpm --filter @godgesture/server typecheck
  pnpm --filter @godgesture/server test
  pnpm --filter @godgesture/server build
  ```

  Expected: every command exits `0`; `build` creates
  `apps/server/web-console-dist/index.html` and no source files under that output
  are tracked.

- [ ] **Step 3: Test production deep links, API isolation, and four viewports.**

  With development dependencies running, start:

  ```powershell
  docker compose -f apps/server/docker-compose.dev.yml up -d
  pnpm dev:server
  ```

  Verify from a browser and HTTP client:

  ```powershell
  Invoke-WebRequest http://127.0.0.1:<backend-port>/api/v1/health
  Invoke-WebRequest http://127.0.0.1:<frontend-port>/
  Invoke-WebRequest http://127.0.0.1:<backend-port>/devices
  ```

  Capture and inspect light/dark screenshots at `375`, `768`, `1024`, and `1440`
  CSS pixels. At 1024/1440 verify the 248px sidebar and dense tables; at 375/768
  verify the labelled compact navigation, non-overlapping text, reachable controls,
  and no whole-page horizontal overflow. Build once, start `start:prod`, and repeat
  `/devices` to prove production SPA fallback.

- [ ] **Step 4: Verify cross-contract safety.**

  Run:

  ```powershell
  pnpm check:api
  pnpm test:repository-layout
  git diff --check
  ```

  Expected: API-generated code remains unchanged or reflects only intentional
  pre-existing edits, layout checks pass, and no whitespace error is reported.

### Task 10: Reconcile Documentation, Status, and Scoped Commits

**Files:**
- Modify: `README.md`
- Modify: `apps/server/README.md`
- Modify: `apps/server/README-DEPLOY.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/adr/0016-web-console-owned-by-server.md`
- Modify: `scripts/__tests__/repository-layout.test.mjs`
- Create: this plan file's implementation notes only if a material decision changes

- [ ] **Step 1: Update the root and Server developer entrypoints.**

  Root README must require only the Server private submodule and say that
  `pnpm dev:server` starts Nest plus the Server-owned Vite Console. Server README
  must instruct developers to copy `apps/server/.env.example`, start its PostgreSQL
  and RustFS Compose dependencies, then run the root command. Remove any command
  that initializes, installs, tests, or builds `@godgesture/web-console`.

- [ ] **Step 2: Update deployment truth.**

  `apps/server/README-DEPLOY.md` must explain that one Docker image contains both
  API and Console static assets, OpenResty proxies a single origin, public API
  remains `/api/v1`, and no separate Console server/container/origin exists.
  Preserve all credential placeholders and the rule that live OAuth/SMTP/RustFS
  secrets never enter documentation or source.

- [ ] **Step 3: Update user-visible guidance and status without false claims.**

  `docs/USER_GUIDE.md` should point browsers to the same official Server origin
  and retain current Console capabilities/limitations. `docs/PROJECT_STATUS.md`
  must record the new ownership, Tailwind/local-component UI, actual verification
  commands and outcomes, and any remaining macOS/live OAuth/SMTP/production
  deployment pending states. Do not report a Windows-only screenshot or local
  Docker run as macOS or production validation.

- [ ] **Step 4: Reconcile historical plan references without rewriting history.**

  Leave the completed `2026-08-08-official-template-service-and-private-submodules.md`
  intact as historical planning evidence. Its former Web Console submodule assumption
  is superseded by ADR-0016 and current status docs; do not edit it just to make old
  plan text look current.

- [ ] **Step 5: Make scoped commits only after the maintainer confirms overlap.**

  First inspect staged content. If no maintainer-owned hunk is mixed, make separate
  commits using explicit paths:

  ```powershell
  git -C apps/server add -- web-console package.json .gitignore Dockerfile src/main.ts README.md README-DEPLOY.md AGENTS.md
  git -C apps/server commit -m "feat: own web console in server"

  git add .gitmodules scripts/dev-server.mjs scripts/__tests__/repository-layout.test.mjs docs/adr/README.md docs/adr/0016-web-console-owned-by-server.md design-system/godgesture-web-console README.md docs/PROJECT_STATUS.md docs/USER_GUIDE.md package.json pnpm-lock.yaml
  git commit -m "feat: retire web console submodule"
  ```

  Do not use `git add -A`, do not amend, and do not push. If any listed file mixes
  unrelated maintainer edits, stop before committing and request a split/ownership
  decision rather than staging another person's work.

## Final Verification Checklist

- [ ] `pnpm --filter @godgesture/server web:typecheck`
- [ ] `pnpm --filter @godgesture/server web:test`
- [ ] `pnpm --filter @godgesture/server typecheck`
- [ ] `pnpm --filter @godgesture/server test`
- [ ] `pnpm --filter @godgesture/server build`
- [ ] `pnpm --filter @godgesture/server test:e2e`
- [ ] `pnpm check:api`
- [ ] `pnpm test:repository-layout`
- [ ] `rg -n "element-plus|@element-plus|<el-|--el-" apps/server/web-console apps/server/package.json` exits `1`
- [ ] `pnpm --filter @godgesture/server why element-plus` and `pnpm --filter @godgesture/server why @element-plus/icons-vue` produce no dependency output
- [ ] `git diff --check`
- [ ] Development health endpoint, SPA root, Vite proxy, and production `/devices`
  deep link verified
- [ ] Light/dark visual review at 375px, 768px, 1024px, and 1440px
- [ ] Existing maintainer changes remain present and are not included in this task's
  commits without explicit confirmation

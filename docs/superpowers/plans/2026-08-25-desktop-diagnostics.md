# Desktop Diagnostics And Release DevTools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 release Desktop 版本通过 F12 打开/关闭 DevTools，并自动采集 GodGesture 的前端、IPC、UI、HTTP、Rust 和宿主生命周期日志。

**Architecture:** 保留现有 Rust `LoggingService` 作为唯一日志落盘出口，在前端启动阶段安装幂等运行时诊断采集器，在 `Backend` 唯一 IPC 网关增加可关闭的诊断 sink，并以 `LoggedHttpClient` 包裹 Desktop 自己创建的 `reqwest::Client`。Tauri updater 的内部请求不复制实现，改记录可观察的更新生命周期；敏感参数、请求体和输入内容在采集点直接排除。

**Tech Stack:** Tauri 2, Rust `log`/`reqwest`, Vue 3, TypeScript, Vitest, Rust unit tests, pnpm monorepo.

## Global Constraints

- 本次只修改 Desktop 和其 Rust 宿主，不修改 Server、Web Console、数据库 schema 或 migration。
- Windows 与 macOS 使用同一 F12 contract 和同一前端诊断采集器；真实平台验收分别记录，不把单平台结果写成双平台现场通过。
- 现有日志级别 `off/error/warn/info/debug`、脱敏 JSONL、轮转、导出和本地保存位置保持不变；`off` 时不落盘。
- HTTP 日志只记录 method、脱敏协议/主机/路径、status、durationMs、content-length 或错误分类；不记录 credentials、query、fragment、headers、body、token、密码、剪贴板、输入框内容或完整配置。
- UI 日志只记录稳定控件标识，不读取用户可见文本、输入值或键盘字符；不记录文本输入事件。
- 每个新增生产函数先写一个能正确失败的测试并观察失败，再写最小实现；每个任务独立运行定向验证。
- 不新增旧 GodGesture 合同兼容代码，不分配 `COMPAT-*` ID；已有 `COMPAT-*` 记录不修改。
- 显式 `git add <path>`，不使用 `git add -A`；commit message 使用英文；默认不 push。

---

## File Map

- Create `apps/desktop/src/runtime-diagnostics.ts`: 前端 fetch、console、全局异常、UI 委托事件和 Backend IPC sink 的统一安装/卸载器。
- Create `apps/desktop/src/runtime-diagnostics.test.ts`: 运行时采集器的 fetch、异常、console、UI、脱敏和幂等行为测试。
- Create `apps/desktop/src/devtools-shortcut.ts`: F12 判断和事件处理所需的无副作用辅助函数。
- Create `apps/desktop/src/devtools-shortcut.test.ts`: F12 与其他按键的行为测试。
- Modify `apps/desktop/src/api/backend.ts`: 增加 `devtoolsToggle`, `invokeCommand`, `setBackendDiagnosticWriter` 和日志递归隔离。
- Modify `apps/desktop/src/api/mock.ts`: 实现浏览器预览的 `devtoolsToggle` no-op contract。
- Modify `apps/desktop/src/api/__tests__/mock.test.ts`: 验证 mock DevTools contract。
- Modify `apps/desktop/src/main.ts`: 在 Vue mount 前安装一次运行时采集器。
- Modify `apps/desktop/src/App.vue`: 注册/注销 F12 listener，记录页面切换和导航生命周期。
- Modify `apps/desktop/src/cloud/session.ts` and `apps/desktop/src/cloud/transport.ts`: 移除与统一 fetch 采集重复的网络异常日志，保留业务错误转换。
- Create `apps/desktop/src-tauri/src/http.rs`: `LoggedHttpClient`/`LoggedRequestBuilder` 和 Rust HTTP 事件分类、URL 脱敏测试。
- Modify `apps/desktop/src-tauri/src/lib.rs`: 注册 `http` module 和 `devtools_toggle` Tauri command。
- Modify `apps/desktop/src-tauri/src/template_download.rs`: 用 `LoggedHttpClient` 替换内建模板 HTTP client。
- Modify `apps/desktop/src-tauri/src/engine/plugin_download.rs`: 用 `LoggedHttpClient` 替换在线插件 HTTP client。
- Modify `apps/desktop/src-tauri/src/updater.rs`: 增加脱敏的 update check/download/install 生命周期日志。
- Modify `apps/desktop/src-tauri/src/account.rs`: 增加 OAuth loopback 生命周期日志且不记录 code/state/query。
- Modify `apps/desktop/src-tauri/tauri.conf.json`: 为主窗口开启 release DevTools。
- Test: `apps/desktop/src/api/__tests__/logging.test.ts`: 保证日志命令走 raw path 不产生 IPC 递归。
- Modify `scripts/__tests__/release.test.mjs`: 验证主窗口 release DevTools 开关。
- Modify `CONTEXT.md`: 登记统一运行时诊断采集术语和边界。
- Modify `docs/PROJECT_STATUS.md`: 记录实现、验证结果和 Windows/macOS 现场验收 pending 状态。

## Interfaces

The implementation uses these exact TypeScript interfaces:

```ts
export type BackendDiagnosticWriter = (
  level: LogEntryLevel,
  target: string,
  message: string,
) => void;

export function setBackendDiagnosticWriter(
  writer: BackendDiagnosticWriter | null,
): () => void;

export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T>;

export function installRuntimeDiagnostics(backend: Backend): () => void;

export function isDevtoolsShortcut(event: Pick<KeyboardEvent, "key" | "code">): boolean;
```

The `Backend` interface adds:

```ts
devtoolsToggle(): Promise<boolean>;
```

The Rust HTTP wrapper exposes:

```rust
pub(crate) struct LoggedHttpClient { /* reqwest client and target */ }
pub(crate) struct LoggedRequestBuilder { /* request builder and diagnostic metadata */ }

impl LoggedHttpClient {
    pub(crate) fn new(client: reqwest::Client, target: &'static str) -> Self;
    pub(crate) fn get(&self, url: url::Url) -> LoggedRequestBuilder;
}

impl LoggedRequestBuilder {
    pub(crate) fn header(self, name: reqwest::header::HeaderName, value: &'static str) -> Self;
    pub(crate) async fn send(self) -> Result<reqwest::Response, reqwest::Error>;
}
```

---

### Task 1: Add Release DevTools And F12 Contract

**Files:**
- Test: `apps/desktop/src/devtools-shortcut.test.ts`
- Create: `apps/desktop/src/devtools-shortcut.ts`
- Modify: `apps/desktop/src/api/backend.ts`
- Modify: `apps/desktop/src/api/mock.ts`
- Modify: `apps/desktop/src/api/__tests__/mock.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `scripts/__tests__/release.test.mjs`

**Interfaces:**
- Consumes: existing `Backend` gateway and Tauri `WebviewWindow` methods.
- Produces: `Backend.devtoolsToggle()`, Rust `devtools_toggle` command, `isDevtoolsShortcut()` and release configuration with DevTools enabled.

- [ ] **Step 1: Write the failing shortcut test.**

```ts
import { describe, expect, it } from "vitest";
import { isDevtoolsShortcut } from "./devtools-shortcut";

describe("DevTools shortcut", () => {
  it("recognizes F12 by key or code", () => {
    expect(isDevtoolsShortcut({ key: "F12", code: "" })).toBe(true);
    expect(isDevtoolsShortcut({ key: "", code: "F12" })).toBe(true);
  });

  it("does not treat other keys as the DevTools shortcut", () => {
    expect(isDevtoolsShortcut({ key: "F11", code: "F11" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the shortcut test and observe the expected missing-module failure.**

Run:

```text
pnpm --filter @godgesture/desktop exec vitest run src/devtools-shortcut.test.ts
```

Expected: FAIL because `./devtools-shortcut` does not exist.

- [ ] **Step 3: Implement the pure F12 predicate.**

```ts
export function isDevtoolsShortcut(
  event: Pick<KeyboardEvent, "key" | "code">,
): boolean {
  return event.key === "F12" || event.code === "F12";
}
```

- [ ] **Step 4: Run the shortcut test and verify it passes.**

Run the same Vitest command. Expected: 2 tests pass.

- [ ] **Step 5: Write the failing release configuration test.**

Add to the existing release configuration test in `scripts/__tests__/release.test.mjs`:

```js
const tauriConfig = JSON.parse(
  await readFile(new URL("../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
assert.equal(tauriConfig.app.windows[0].devtools, true);
```

Run:

```text
pnpm exec node --test scripts/__tests__/release.test.mjs
```

Expected: FAIL because the current main window has no `devtools: true` property.

- [ ] **Step 6: Write the failing backend contract test.**

Add to `apps/desktop/src/api/__tests__/mock.test.ts`:

```ts
it("provides a no-op DevTools toggle in browser preview", async () => {
  const backend = createMockBackend();
  await expect(backend.devtoolsToggle()).resolves.toBe(false);
});
```

Run:

```text
pnpm --filter @godgesture/desktop exec vitest run src/api/__tests__/mock.test.ts
```

Expected: FAIL because `Backend` has no `devtoolsToggle` method.

- [ ] **Step 7: Implement the backend contract and mock no-op.**

Add `devtoolsToggle(): Promise<boolean>` to `Backend`, return `false` in `createMockBackend`, and in `createTauriBackend` call `invoke<boolean>("devtools_toggle")` through the raw path until Task 2 adds the diagnostic wrapper.

- [ ] **Step 8: Add the Rust command and release configuration.**

Set the main window's `devtools` property to `true` in `tauri.conf.json`. Add this command before `run()`:

```rust
#[tauri::command]
fn devtools_toggle(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.is_devtools_open() {
        window.close_devtools();
        Ok(false)
    } else {
        window.open_devtools();
        Ok(true)
    }
}
```

Register `devtools_toggle` in `tauri::generate_handler!`. The installed Tauri 2.11 API exposes `WebviewWindow::is_devtools_open() -> bool`, `open_devtools()`, and `close_devtools()`; the command must return the post-action state and must not be cfg-gated by `debug_assertions`.

- [ ] **Step 9: Wire F12 into App lifecycle and log failure.**

In `App.vue`, add a `keydown` listener in `onMounted` and remove it in `onUnmounted`:

```ts
async function onWindowKeydown(event: KeyboardEvent): Promise<void> {
  if (!isDevtoolsShortcut(event)) return;
  event.preventDefault();
  try {
    await store.backend.devtoolsToggle();
  } catch (error) {
    appLog.error("devtools", errorMessage(error));
  }
}
```

Use the existing error formatting pattern. Update `selectSection` to skip duplicate selections and write `appLog.info("ui.navigation", ...)` for actual changes. This does not add visible UI copy.

- [ ] **Step 10: Verify Task 1.**

Run:

```text
pnpm --filter @godgesture/desktop exec vitest run src/devtools-shortcut.test.ts src/api/__tests__/mock.test.ts
pnpm --filter @godgesture/desktop typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features devtools_toggle
```

Expected: all frontend tests/typecheck pass and Rust compiles/tests the command path. If the command has no unit-testable body on the current platform, use the existing library test command and record the compile verification.

- [ ] **Step 11: Commit Task 1.**

```text
git add apps/desktop/src/devtools-shortcut.ts apps/desktop/src/devtools-shortcut.test.ts apps/desktop/src/api/backend.ts apps/desktop/src/api/mock.ts apps/desktop/src/api/__tests__/mock.test.ts apps/desktop/src/main.ts apps/desktop/src/App.vue apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src/lib.rs scripts/__tests__/release.test.mjs
git commit -m "feat: enable release desktop devtools"
```

### Task 2: Add Frontend Runtime Diagnostics

**Files:**
- Test: `apps/desktop/src/runtime-diagnostics.test.ts`
- Create: `apps/desktop/src/runtime-diagnostics.ts`
- Modify: `apps/desktop/src/api/backend.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/cloud/session.ts`
- Modify: `apps/desktop/src/cloud/transport.ts`

**Interfaces:**
- Consumes: `Backend`, `LogEntryLevel`, existing `appLog` sanitizer and `setBackendDiagnosticWriter` from Task 1.
- Produces: idempotent `installRuntimeDiagnostics(backend)` cleanup function; all Tauri invokes use `invokeCommand` except log commands.

- [ ] **Step 1: Write failing tests for URL sanitization and fetch classification.**

The test must inject a fake fetch and backend, install diagnostics, call the patched fetch with a URL containing `?access_token=secret`, then assert the emitted messages contain `/api/v1/items`, `status=200`, and `duration_ms`, but contain neither `secret` nor the query value. Add separate tests for 503 -> `warn` and rejected fetch -> `error`.

Run:

```text
pnpm --filter @godgesture/desktop exec vitest run src/runtime-diagnostics.test.ts
```

Expected: FAIL because the module and installer do not exist.

- [ ] **Step 2: Write failing tests for console, global errors, UI delegation, idempotence and cleanup.**

Use a fake backend that records `logWrite` calls and a detached `EventTarget`/document fixture. Assert that `console.warn("Bearer secret")` is forwarded at warn with redaction, an `error` event becomes runtime error, a button with `data-testid="save-button"` creates only a UI debug event without its text/value, installing twice does not duplicate listeners, and the cleanup function restores fetch/console and removes listeners.

- [ ] **Step 3: Implement safe runtime formatting and event helpers.**

Implement bounded serialization for primitive, Error and object values; reuse the existing logger sanitizer through `appLog` for final secret filtering. Define `safeHttpUrl(input: RequestInfo | URL): string` to preserve only protocol, hostname, optional port and pathname. Define `writeRuntime(level, target, message)` with a reentrancy guard and a no-throw `backend.logWrite` call.

- [ ] **Step 4: Implement fetch wrapping.**

Save the original `globalThis.fetch`, install one wrapper, and record `performance.now()` around the call. Use `debug` for start, `info` for status `< 400`, `warn` for status `>= 400`, and `error` for rejection. Never read `Request`/`Response` bodies. Restore the original function during cleanup.

- [ ] **Step 5: Implement console and global exception wrapping.**

Save each original console method, call it first, then write the mapped diagnostic with the bounded formatter. Add `window` `error` and `unhandledrejection` listeners that record only name/message/limited stack. The logger path must not call the wrapped console methods.

- [ ] **Step 6: Implement UI event delegation and Backend diagnostic sink.**

Listen to document `click` and `change`; accept only button, anchor, select, checkbox and radio targets. Resolve a stable target identifier from `data-testid`, `aria-label`, `name`, `id`, then tag name. Never include `textContent`, `value`, or key data. Call `setBackendDiagnosticWriter` with an adapter that writes through the supplied backend.

Implement `invokeCommand<T>` in `backend.ts` around the dynamically imported Tauri `invoke`: emit `ipc` debug before/after and `ipc` error on rejection, recording command and duration only. Update every Tauri backend method that currently imports `invoke` to use it, while `logLevelGet`, `logLevelSet`, `logWrite`, `logsQuery`, `logsExport`, and `logsClear` remain raw to prevent recursion. Preserve existing `normalizeBackendError` behavior at each existing call site.

- [ ] **Step 7: Install diagnostics before mount and remove duplicate cloud error logs.**

In `main.ts`:

```ts
const backend = useBackend();
installRuntimeDiagnostics(backend);
```

Run this before `app.mount`. Keep the browser mock path active so its in-memory log page can display captured events when the log level is changed. Remove only duplicate transport-level network error writes in `cloud/session.ts` and `cloud/transport.ts`; preserve error normalization and business error codes.

- [ ] **Step 8: Run the focused frontend tests and typecheck.**

Run:

```text
pnpm --filter @godgesture/desktop exec vitest run src/runtime-diagnostics.test.ts src/devtools-shortcut.test.ts src/api/__tests__/logging.test.ts src/api/__tests__/mock.test.ts
pnpm --filter @godgesture/desktop typecheck
```

Expected: all diagnostics and existing logging tests pass with no duplicate listener or recursion errors.

- [ ] **Step 9: Commit Task 2.**

```text
git add apps/desktop/src/runtime-diagnostics.ts apps/desktop/src/runtime-diagnostics.test.ts apps/desktop/src/api/backend.ts apps/desktop/src/main.ts apps/desktop/src/cloud/session.ts apps/desktop/src/cloud/transport.ts
git commit -m "feat: capture frontend runtime diagnostics"
```

### Task 3: Add Rust HTTP Wrapper And Native Lifecycle Logs

**Files:**
- Test: `apps/desktop/src-tauri/src/http.rs` unit tests
- Create: `apps/desktop/src-tauri/src/http.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/template_download.rs`
- Modify: `apps/desktop/src-tauri/src/engine/plugin_download.rs`
- Modify: `apps/desktop/src-tauri/src/updater.rs`
- Modify: `apps/desktop/src-tauri/src/account.rs`

**Interfaces:**
- Consumes: existing `reqwest::Client`, `log` global logger, template/plugin redirect and size policies.
- Produces: `LoggedHttpClient::new`, `LoggedHttpClient::get`, `LoggedRequestBuilder::header/send`, automatic `http.reqwest` events and native lifecycle logs.

- [ ] **Step 1: Write failing Rust tests for URL sanitization and level classification.**

Add tests in the new module:

```rust
#[test]
fn safe_url_removes_credentials_query_and_fragment() {
    let url = url::Url::parse("https://user:pass@example.test/a?token=secret#fragment").unwrap();
    assert_eq!(safe_url(&url), "https://example.test/a");
}

#[test]
fn response_level_separates_success_client_failure_and_server_failure() {
    assert_eq!(response_level(reqwest::StatusCode::OK), log::Level::Info);
    assert_eq!(response_level(reqwest::StatusCode::BAD_REQUEST), log::Level::Warn);
    assert_eq!(response_level(reqwest::StatusCode::INTERNAL_SERVER_ERROR), log::Level::Warn);
}
```

Run:

```text
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features http::tests
```

Expected: FAIL because `http.rs` and helpers do not exist.

- [ ] **Step 2: Implement the minimal wrapper.**

Implement `LoggedHttpClient` with an inner `reqwest::Client` and static target, `get(Url)`, and a builder that supports the existing `Accept: application/json` call. `send()` logs start before awaiting the inner request and response classification after it resolves. Use `Instant`, `status.as_u16()`, optional content length, and error category booleans; do not format the full request or error URL.

- [ ] **Step 3: Run the Rust HTTP tests and verify green.**

Run the same command as Step 1. Expected: all new HTTP helper tests pass.

- [ ] **Step 4: Replace template and plugin clients.**

Change `default_client` and `download_with_client` in `template_download.rs` to use `LoggedHttpClient`; build it from the existing redirect-disabled `Client::builder`. Replace the client type and `.get(...).header(...).send()` path in `engine/plugin_download.rs`. Keep validation, redirect limits, timeouts, size caps and error contracts unchanged.

- [ ] **Step 5: Write the failing updater endpoint redaction test before adding lifecycle calls.**

Add a pure helper test in `updater.rs` that passes an endpoint containing credentials, query and fragment through `safe_endpoint` and asserts the result contains only scheme, host and path. The test must fail until the lifecycle-safe formatting helper exists; OAuth logging will use the same rule by recording only its local port and phase.

- [ ] **Step 6: Add updater and OAuth lifecycle logs.**

In `updater.rs`, record check/install start and completion/failure with sanitized endpoint, phase, current/available version and downloaded byte counts. In `account.rs`, record loopback listener start, callback accepted/rejected, cancelled and timed out with port/phase only; never include callback query values. Preserve all existing errors and return values.

- [ ] **Step 7: Run Rust formatting, tests and clippy.**

Run:

```text
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features -- -D warnings
```

Expected: all existing and new tests pass, formatting is clean, and clippy reports no warnings.

- [ ] **Step 8: Commit Task 3.**

```text
git add apps/desktop/src-tauri/src/http.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/template_download.rs apps/desktop/src-tauri/src/engine/plugin_download.rs apps/desktop/src-tauri/src/updater.rs apps/desktop/src-tauri/src/account.rs
git commit -m "feat: capture native HTTP diagnostics"
```

### Task 4: Synchronize Project Knowledge And Release Validation

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Consumes: completed Desktop diagnostics behavior and verification output from Tasks 1-3.
- Produces: current project terminology, status baseline and a release guard that prevents disabling release DevTools.

- [ ] **Step 1: Run the release configuration assertion added in Task 1.**

Run the repository's actual release validation command. The assertion must remain alongside the existing four-version release configuration test; do not alter release version sources or add `Cargo.lock` as a bumper source.

```text
pnpm validate:release
```

Expected: release validation passes with `app.windows[0].devtools === true`.

- [ ] **Step 2: Update project knowledge.**

Add the term “统一运行时诊断采集” to the logging section of `CONTEXT.md`, including the F12 release DevTools and the distinction between core requests, updater lifecycle logs, and user plugin network activity. Add a dated entry to `docs/PROJECT_STATUS.md` with the exact tests run and mark real Windows/macOS DevTools keyboard/window acceptance as pending until performed on each platform.

- [ ] **Step 3: Run repository-level validation.**

Run:

```text
pnpm --filter @godgesture/desktop test -- --run
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
pnpm check:api
pnpm validate:release
git diff --check
```

Expected: Desktop tests, typecheck, production build, API check, release validation and whitespace validation pass. Any macOS runtime/device validation unavailable on Windows must be reported as pending, not inferred.

- [ ] **Step 4: Commit Task 4.**

```text
git add CONTEXT.md docs/PROJECT_STATUS.md
git commit -m "docs: record desktop diagnostics coverage"
```

### Task 5: Final Review And Handoff

**Files:**
- Read: all files changed by Tasks 1-4
- Test: repository status and commit history

- [ ] **Step 1: Inspect the final diff for scope and privacy.**

Run:

```text
git diff 513f95f..HEAD --stat
git diff 513f95f..HEAD --check
rg -n 'access_token|refresh_token|Authorization|Bearer|password|secret|clipboard|textContent|\.value' apps/desktop/src/runtime-diagnostics.ts apps/desktop/src-tauri/src/http.rs apps/desktop/src-tauri/src/updater.rs apps/desktop/src-tauri/src/account.rs
```

Confirm that the diagnostic paths do not log raw sensitive values and that no `apps/server` submodule content was staged.

- [ ] **Step 2: Run final status and targeted smoke checks.**

Run:

```text
git status --porcelain=v1
git log --oneline -12
pnpm --filter @godgesture/desktop exec vitest run src/runtime-diagnostics.test.ts src/devtools-shortcut.test.ts
```

Expected: only the pre-existing `M apps/server` remains dirty after the commits; all new targeted tests pass.

- [ ] **Step 3: Report verification and residual platform acceptance.**

Report the commits, test results, the fact that no Web/database migration was changed, and that actual compiled Windows/macOS F12 and DevTools window behavior require platform现场 verification if not available in the current environment.

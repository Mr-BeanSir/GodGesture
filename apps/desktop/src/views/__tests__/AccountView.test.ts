import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import { clearToasts, ToastViewport, useConfirmDialog } from "@godgesture/ui";
import UiConfirmHost from "../../components/UiConfirmHost.vue";
import { useBackend } from "../../api/backend";
import { i18n, setLocale } from "../../locales";
import { useAccountStore } from "../../stores/account";
import AccountView from "../AccountView.vue";

vi.mock("../../api/backend", () => ({ useBackend: vi.fn() }));
vi.mock("../../stores/account", () => ({ useAccountStore: vi.fn() }));
vi.mock("@vueuse/core", () => ({ useMediaQuery: () => ref(false) }));

const account = reactive<any>({
  phase: "signedIn",
  endpointMode: "official",
  customApiOrigin: "",
  apiOrigin: "https://api.example.com",
  cloudConfigured: true,
  user: { email: "user@example.com", displayName: "User" },
  device: { name: "Workstation" },
  authErrorCode: null,
  authBusy: false,
  providersLoading: false,
  providers: [],
  providersError: false,
  pendingOAuth: null,
  syncStatus: {
    phase: "current",
    lastSyncAt: "2026-08-12T08:00:00Z",
    serverVersion: 7,
    errorCode: null,
    dirty: false,
  },
  snapshots: [],
  snapshotsPage: 1,
  snapshotsPageSize: 10,
  snapshotsTotal: 0,
  snapshotsTotalPages: 1,
  snapshotsLoading: false,
  snapshotsErrorCode: null,
  initialize: vi.fn(),
  setEndpoint: vi.fn(),
  loadProviders: vi.fn(),
  loginWithPassword: vi.fn(),
  loginWithOAuth: vi.fn(),
  requestPendingOAuthEmailCode: vi.fn(),
  completePendingOAuth: vi.fn(),
  syncNow: vi.fn(),
  loadSnapshots: vi.fn(),
  restoreSnapshot: vi.fn(),
  updateDisplayName: vi.fn(),
  logout: vi.fn(),
  discardStoredSession: vi.fn(),
});

const backend = { openExternal: vi.fn() };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function resetAccount(): void {
  account.phase = "signedIn";
  account.endpointMode = "official";
  account.customApiOrigin = "";
  account.apiOrigin = "https://api.example.com";
  account.cloudConfigured = true;
  account.user = { email: "user@example.com", displayName: "User" };
  account.device = { name: "Workstation" };
  account.authErrorCode = null;
  account.authBusy = false;
  account.providersLoading = false;
  account.providers = [];
  account.providersError = false;
  account.pendingOAuth = null;
  account.syncStatus = {
    phase: "current",
    lastSyncAt: "2026-08-12T08:00:00Z",
    serverVersion: 7,
    errorCode: null,
    dirty: false,
  };
  account.snapshots = [];
  account.snapshotsPage = 1;
  account.snapshotsPageSize = 10;
  account.snapshotsTotal = 0;
  account.snapshotsTotalPages = 1;
  account.snapshotsLoading = false;
  account.snapshotsErrorCode = null;

  for (const method of [
    account.initialize,
    account.setEndpoint,
    account.loadProviders,
    account.loginWithPassword,
    account.loginWithOAuth,
    account.requestPendingOAuthEmailCode,
    account.completePendingOAuth,
    account.syncNow,
    account.loadSnapshots,
    account.restoreSnapshot,
    account.updateDisplayName,
    account.logout,
    account.discardStoredSession,
  ]) {
    method.mockReset().mockResolvedValue(undefined);
  }
  account.logout.mockResolvedValue("revoked");

  backend.openExternal.mockReset().mockResolvedValue(undefined);
  vi.mocked(useAccountStore).mockReturnValue(account);
  vi.mocked(useBackend).mockReturnValue(backend as never);
  setLocale("en");
}

async function mountAccount() {
  const view = mount(AccountView, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  const confirmHost = mount(UiConfirmHost, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  const toasts = mount(ToastViewport, {
    attachTo: document.body,
    props: { closeLabel: "Close" },
  });
  await flushPromises();
  return { view, confirmHost, toasts };
}

beforeEach(resetAccount);

afterEach(() => {
  useConfirmDialog().resolveConfirm(false);
  clearToasts();
  document.body.innerHTML = "";
});

describe("AccountView", () => {
  it("uses shared UI and Lucide without Element contracts", async () => {
    const source = await readFile(join(process.cwd(), "src", "views", "AccountView.vue"), "utf8");
    const forbiddenContracts = [
      "element" + "-plus",
      "@element" + "-plus/icons-vue",
      "<" + "el-",
      ["El", "Message"].join(""),
      ["El", "Message", "Box"].join(""),
      "--" + "el-",
      "." + "el-",
    ];

    expect(source).toContain('from "@godgesture/ui"');
    expect(source).toContain('from "lucide-vue-next"');
    expect(source).toContain("AppAlert");
    expect(source).toContain("AppBadge");
    expect(source).toContain("AppButton");
    expect(source).toContain("AppEmptyState");
    expect(source).toContain("AppSkeleton");
    expect(source).toContain("AppSpinner");
    expect(source).toContain("pushToast");
    expect(source).toContain("useConfirmDialog");
    expect(source).not.toMatch(new RegExp(forbiddenContracts.join("|"), "i"));
  });

  it("falls back to email and normalizes nullable display name placeholders", async () => {
    account.user = { displayName: "", email: "fallback@example.com" };
    const source = await readFile(join(process.cwd(), "src", "views", "AccountView.vue"), "utf8");
    expect(source).toContain(
      ':placeholder="account.user?.displayName || account.user?.email || undefined"',
    );

    const { view, confirmHost, toasts } = await mountAccount();
    const displayNameInput = view.get<HTMLInputElement>("#account-display-name");

    expect(displayNameInput.attributes("placeholder")).toBe("fallback@example.com");

    account.user = { displayName: null, email: null };
    await nextTick();

    expect(displayNameInput.attributes("placeholder")).toBeUndefined();

    view.unmount();
    confirmHost.unmount();
    toasts.unmount();
  });

  it("confirms snapshot restoration, blocks dismissal while restoring, and announces success", async () => {
    const restore = deferred<void>();
    account.snapshots = [{
      version: 12,
      createdAt: "2026-08-12T08:00:00Z",
      deviceName: "Workstation",
      sizeBytes: 2048,
      note: "Before changing gesture settings",
    }];
    account.snapshotsTotal = 1;
    account.restoreSnapshot.mockReturnValueOnce(restore.promise);
    const { view, confirmHost, toasts } = await mountAccount();

    await view.get('[data-testid="account-snapshot-restore-12"]').trigger("click");
    await flushPromises();

    const confirmButton = document.querySelector<HTMLButtonElement>("[data-confirm-action]");
    expect(confirmButton).not.toBeNull();
    expect(document.body.textContent).toContain("Restore configuration snapshot");
    expect(document.body.textContent).toContain("Restore version 12?");

    confirmButton?.click();
    await flushPromises();

    expect(account.restoreSnapshot).toHaveBeenCalledWith(12);
    expect(confirmButton?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".gg-dialog__header .gg-icon-button")?.disabled).toBe(true);

    document.querySelector(".gg-dialog")?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    document.querySelector(".gg-dialog-layer")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();

    expect(document.querySelector(".gg-dialog")).not.toBeNull();

    restore.resolve();
    await flushPromises();

    expect(document.querySelector(".gg-dialog")).toBeNull();
    expect(toasts.text()).toContain("Configuration snapshot restored");

    view.unmount();
    confirmHost.unmount();
    toasts.unmount();
  });
});

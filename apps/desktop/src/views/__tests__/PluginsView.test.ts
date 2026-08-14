import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { clearToasts, ToastViewport, useConfirmDialog } from "@godgesture/ui";
import UiConfirmHost from "../../components/UiConfirmHost.vue";
import { i18n, setLocale } from "../../locales";
import { usePluginsStore } from "../../stores/plugins";
import PluginsView from "../PluginsView.vue";

vi.mock("../../stores/plugins", () => ({ usePluginsStore: vi.fn() }));

const onlineEntry = {
  pluginId: "30000000-0000-4000-8000-000000000001",
  subdirectory: "plugins/gesture-demo",
  title: "Lifecycle demo plugin",
  summary: "Demonstrates the complete GodGesture Node.js plugin lifecycle.",
  disabled: false,
};

const plugins = reactive<any>({
  backend: { openExternal: vi.fn() },
  snapshot: { root: "C:\\Plugins", plugins: [] },
  plugins: [],
  selected: null,
  selectedPath: null,
  onlineEntries: [],
  installedPluginIds: new Set<string>(),
  loading: false,
  error: null,
  loadingOnlineCatalog: false,
  onlineCatalogError: null,
  installingPluginId: null,
  initialize: vi.fn(),
  refresh: vi.fn(),
  loadOnlineCatalog: vi.fn(),
  installOnline: vi.fn(),
  openRoot: vi.fn(),
  openProject: vi.fn(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function resetPlugins(): void {
  plugins.backend.openExternal.mockReset().mockResolvedValue(undefined);
  plugins.snapshot = { root: "C:\\Plugins", plugins: [] };
  plugins.plugins = [];
  plugins.selected = null;
  plugins.selectedPath = null;
  plugins.onlineEntries = [onlineEntry];
  plugins.installedPluginIds = new Set<string>();
  plugins.loading = false;
  plugins.error = null;
  plugins.loadingOnlineCatalog = false;
  plugins.onlineCatalogError = null;
  plugins.installingPluginId = null;
  plugins.initialize.mockReset().mockResolvedValue(undefined);
  plugins.refresh.mockReset().mockResolvedValue(undefined);
  plugins.loadOnlineCatalog.mockReset().mockResolvedValue(undefined);
  plugins.installOnline.mockReset().mockResolvedValue(true);
  plugins.openRoot.mockReset().mockResolvedValue(undefined);
  plugins.openProject.mockReset().mockResolvedValue(undefined);
  vi.mocked(usePluginsStore).mockReturnValue(plugins);
  setLocale("en");
}

async function mountPlugins() {
  const view = mount(PluginsView, {
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
  await nextTick();
  return { view, confirmHost, toasts };
}

function onlineDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>(".plugins-online-dialog");
  expect(dialog, "expected the online plugins dialog").not.toBeNull();
  return dialog!;
}

function dialogLayer(dialog: HTMLElement): HTMLElement {
  const layer = dialog.closest<HTMLElement>(".gg-dialog-layer");
  expect(layer, "expected dialog backdrop layer").not.toBeNull();
  return layer!;
}

async function openOnlineCatalog(view: Awaited<ReturnType<typeof mountPlugins>>["view"]) {
  await view.get('[data-testid="plugins-open-online-catalog"]').trigger("click");
  await nextTick();
  return onlineDialog();
}

async function requestInstall(view: Awaited<ReturnType<typeof mountPlugins>>["view"]) {
  await openOnlineCatalog(view);
  const install = document.querySelector<HTMLButtonElement>(
    '[data-testid="plugins-install-30000000-0000-4000-8000-000000000001"]',
  );
  expect(install, "expected the online installation action").not.toBeNull();
  install?.click();
  await flushPromises();
  const confirmButton = document.querySelector<HTMLButtonElement>("[data-confirm-action]");
  expect(confirmButton, "expected the shared confirmation action").not.toBeNull();
  return confirmButton!;
}

beforeEach(resetPlugins);

afterEach(() => {
  const dialog = useConfirmDialog();
  if (dialog.pending.value) dialog.pending.value.busy = false;
  dialog.resolveConfirm(false);
  clearToasts();
  document.body.innerHTML = "";
});

describe("PluginsView", () => {
  it("uses shared UI primitives and Lucide without Element contracts", async () => {
    const source = await readFile(join(process.cwd(), "src", "views", "PluginsView.vue"), "utf8");
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
    expect(source).toContain("AppDialog");
    expect(source).toContain("AppEmptyState");
    expect(source).toContain("AppSkeleton");
    expect(source).toContain("AppSpinner");
    expect(source).toContain("pushToast");
    expect(source).toContain("useConfirmDialog");
    expect(source).not.toMatch(new RegExp(forbiddenContracts.join("|"), "i"));
  });

  it("confirms online installation, protects both dialogs while busy, and announces success", async () => {
    const installation = deferred<boolean>();
    plugins.installOnline.mockImplementation(async (entry: typeof onlineEntry) => {
      plugins.installingPluginId = entry.pluginId;
      try {
        const installed = await installation.promise;
        if (installed) plugins.installedPluginIds = new Set([entry.pluginId]);
        return installed;
      } finally {
        plugins.installingPluginId = null;
      }
    });
    const { view, confirmHost, toasts } = await mountPlugins();

    const confirmButton = await requestInstall(view);
    expect(document.body.textContent).toContain("Install online plugin");
    expect(document.body.textContent).toContain("Lifecycle demo plugin");

    confirmButton.click();
    await flushPromises();

    expect(plugins.installOnline).toHaveBeenCalledWith(onlineEntry);
    expect(confirmButton.disabled).toBe(true);

    const confirmationDialog = confirmButton.closest<HTMLElement>(".gg-dialog");
    expect(confirmationDialog).not.toBeNull();
    const online = onlineDialog();
    const closeButtons = document.querySelectorAll<HTMLButtonElement>(
      ".gg-dialog__header .gg-icon-button",
    );
    expect([...closeButtons]).toHaveLength(2);
    expect([...closeButtons].every((button) => button.disabled)).toBe(true);

    confirmationDialog?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    dialogLayer(confirmationDialog!).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    online.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    dialogLayer(online).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    await nextTick();

    expect(document.querySelector("[data-confirm-action]")).not.toBeNull();
    expect(document.querySelector(".plugins-online-dialog")).not.toBeNull();

    installation.resolve(true);
    await flushPromises();

    expect(document.querySelector("[data-confirm-action]")).toBeNull();
    expect(toasts.text()).toContain("Plugin installed");
    expect(onlineDialog().textContent).toContain("Installed");

    view.unmount();
    confirmHost.unmount();
    toasts.unmount();
  });

  it("keeps a failed installation confirmable for retry and announces the error", async () => {
    plugins.installOnline.mockResolvedValue(false);
    const { view, confirmHost, toasts } = await mountPlugins();

    const confirmButton = await requestInstall(view);
    confirmButton.click();
    await flushPromises();

    expect(plugins.installOnline).toHaveBeenCalledWith(onlineEntry);
    const retryButton = document.querySelector<HTMLButtonElement>("[data-confirm-action]");
    expect(retryButton).not.toBeNull();
    expect(retryButton?.disabled).toBe(false);
    expect(toasts.text()).toContain("Plugin installation failed");

    view.unmount();
    confirmHost.unmount();
    toasts.unmount();
  });
});

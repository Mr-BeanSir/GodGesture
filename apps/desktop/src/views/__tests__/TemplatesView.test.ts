import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { clearToasts, ToastViewport, useConfirmDialog } from "@godgesture/ui";
import UiConfirmHost from "../../components/UiConfirmHost.vue";
import { i18n, setLocale } from "../../locales";
import { useTemplatesStore } from "../../stores/templates";
import TemplatesView from "../TemplatesView.vue";

vi.mock("../../stores/templates", () => ({ useTemplatesStore: vi.fn() }));

const entry = {
  id: "10000000-0000-4000-8000-000000000001",
  versionNumber: 3,
  title: "Workspace navigation",
  summary: "Adds workspace navigation gestures.",
  author: "Template author",
  tags: ["workspace"],
  risks: [],
};

const templatePackage = {
  targets: [{
    scope: "global",
    name: "Global",
    intents: [{
      name: "Open workspace",
      gesture: { trigger: "right", inputs: [], modifier: "none" },
      command: { type: "doNothing" },
    }],
  }],
};

const multiTargetPackage = {
  targets: [
    ...templatePackage.targets,
    {
      scope: "app",
      name: "Browser",
      windows: { exeName: "browser.exe" },
      mac: { bundleId: "com.example.browser" },
      intents: [
        {
          name: "Search tab",
          gesture: { trigger: "right", inputs: [], modifier: "none" },
          command: { type: "doNothing" },
        },
        {
          name: "Open settings",
          gesture: { trigger: "left", inputs: [], modifier: "none" },
          command: { type: "doNothing" },
        },
      ],
    },
  ],
};

const templates = reactive<any>({
  entries: [entry],
  filteredEntries: [entry],
  loadingCatalog: false,
  catalogError: null,
  query: "",
  riskFilter: "all",
  selectedEntry: entry,
  selectedPackage: templatePackage,
  loadingPackage: false,
  packageError: null,
  conflictPolicy: "keepExisting",
  adoptionPlan: {
    conflicts: [],
    pluginSources: [],
    stats: { added: 1, replaced: 0, skipped: 0 },
  },
  adoptionError: null,
  adopting: false,
  loadCatalog: vi.fn(),
  openDetails: vi.fn(),
  closeDetails: vi.fn(),
  setConflictPolicy: vi.fn(),
  adopt: vi.fn(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function resetTemplates(): void {
  templates.entries = [entry];
  templates.filteredEntries = [entry];
  templates.loadingCatalog = false;
  templates.catalogError = null;
  templates.query = "";
  templates.riskFilter = "all";
  templates.selectedEntry = entry;
  templates.selectedPackage = templatePackage;
  templates.loadingPackage = false;
  templates.packageError = null;
  templates.conflictPolicy = "keepExisting";
  templates.adoptionPlan = {
    conflicts: [],
    pluginSources: [],
    stats: { added: 1, replaced: 0, skipped: 0 },
  };
  templates.adoptionError = null;
  templates.adopting = false;
  templates.loadCatalog.mockReset().mockResolvedValue(undefined);
  templates.openDetails.mockReset().mockResolvedValue(undefined);
  templates.closeDetails.mockReset();
  templates.setConflictPolicy.mockReset();
  templates.adopt.mockReset().mockResolvedValue(true);
  vi.mocked(useTemplatesStore).mockReturnValue(templates);
  setLocale("en");
}

async function mountTemplates() {
  const view = mount(TemplatesView, {
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

beforeEach(resetTemplates);

afterEach(() => {
  const dialog = useConfirmDialog();
  if (dialog.pending.value) dialog.pending.value.busy = false;
  dialog.resolveConfirm(false);
  clearToasts();
  document.body.innerHTML = "";
});

describe("TemplatesView", () => {
  it("uses shared UI primitives and Lucide without legacy UI contracts", async () => {
    const source = await readFile(join(process.cwd(), "src", "views", "TemplatesView.vue"), "utf8");
    const forbiddenContracts = [
      ["element", "plus"].join("-"),
      ["@element", "plus/icons-vue"].join("-"),
      ["<", "el"].join("") + "-",
      ["El", "Message"].join(""),
      ["El", "Message", "Box"].join(""),
      ["", "", "el"].join("-") + "-",
      [".", "el"].join("") + "-",
    ];

    expect(source).toContain('from "@godgesture/ui"');
    expect(source).toContain('from "lucide-vue-next"');
    expect(source).toContain("AppAlert");
    expect(source).toContain("AppBadge");
    expect(source).toContain("AppButton");
    expect(source).toContain("AppDialog");
    expect(source).toContain("AppEmptyState");
    expect(source).toContain("AppSkeleton");
    expect(source).toContain("pushToast");
    expect(source).toContain("useConfirmDialog");
    expect(source).not.toMatch(new RegExp(forbiddenContracts.join("|"), "i"));
  });

  it("keeps the template detail dialog in three switchable tabs", async () => {
    const { view, confirmHost, toasts } = await mountTemplates();

    try {
      expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3);
      expect(document.querySelector('[role="tab"][data-tab-id="targets"]')).not.toBeNull();
      expect(document.querySelector('[role="tab"][data-tab-id="gestures"]')).not.toBeNull();
      expect(document.querySelector('[role="tab"][data-tab-id="preview"]')).not.toBeNull();
      expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Global");

      document.querySelector<HTMLButtonElement>('[role="tab"][data-tab-id="gestures"]')?.click();
      await nextTick();
      expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Open workspace");
      expect(document.querySelector('[data-action-key="0:0"]')).not.toBeNull();

      document.querySelector<HTMLButtonElement>('[role="tab"][data-tab-id="preview"]')?.click();
      await nextTick();
      expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Open workspace");
    } finally {
      view.unmount();
      confirmHost.unmount();
      toasts.unmount();
    }
  });

  it("keeps target, gesture, and preview selection synchronized", async () => {
    templates.selectedPackage = multiTargetPackage;
    const { view, confirmHost, toasts } = await mountTemplates();

    try {
      const targetButtons = document.querySelectorAll<HTMLButtonElement>(".template-detail__app-button");
      expect(targetButtons).toHaveLength(2);
      targetButtons[1]?.click();
      await nextTick();

      document.querySelector<HTMLButtonElement>('[role="tab"][data-tab-id="gestures"]')?.click();
      await nextTick();
      expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Search tab");
      expect(document.querySelector('[data-action-key="1:0"]')).not.toBeNull();
      expect(document.querySelector('[data-action-key="1:1"]')).not.toBeNull();

      document.querySelector<HTMLElement>('[data-action-key="1:1"]')?.click();
      await nextTick();
      document.querySelector<HTMLButtonElement>('[role="tab"][data-tab-id="preview"]')?.click();
      await nextTick();
      expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Open settings");

      document.querySelector<HTMLButtonElement>('[role="tab"][data-tab-id="targets"]')?.click();
      await nextTick();
      targetButtons[0]?.click();
      await nextTick();
      document.querySelector<HTMLButtonElement>('[role="tab"][data-tab-id="gestures"]')?.click();
      await nextTick();
      expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Open workspace");
      expect(document.querySelector('[data-action-key="0:0"]')).not.toBeNull();
      expect(document.querySelector('[data-action-key="1:1"]')).toBeNull();
    } finally {
      view.unmount();
      confirmHost.unmount();
      toasts.unmount();
    }
  });

  it("uses the requested fixed template detail dialog dimensions", async () => {
    const source = await readFile(join(process.cwd(), "src", "views", "TemplatesView.vue"), "utf8");

    expect(source).toContain(":global(.template-detail)");
    expect(source).toContain(":global(.template-detail .gg-dialog__body)");
    expect(source).toContain("width: min(100%, 750px)");
    expect(source).toContain("height: min(720px, calc(100dvh - 60px))");
  });

  it("keeps template adoption confirmed and non-dismissible while it is running", async () => {
    const adoption = deferred<boolean>();
    templates.adopt.mockImplementation(async () => {
      templates.adopting = true;
      try {
        return await adoption.promise;
      } finally {
        templates.adopting = false;
      }
    });
    const { view, confirmHost, toasts } = await mountTemplates();

    const apply = document.querySelector<HTMLButtonElement>("[data-testid='templates-adopt']");
    expect(apply).not.toBeNull();
    apply?.click();
    await flushPromises();

    const confirmButton = document.querySelector<HTMLButtonElement>("[data-confirm-action]");
    expect(confirmButton).not.toBeNull();
    expect(document.body.textContent).toContain("Adopt gesture template");

    confirmButton?.click();
    await flushPromises();

    expect(templates.adopt).toHaveBeenCalledOnce();
    expect(confirmButton?.disabled).toBe(true);

    const confirmationDialog = confirmButton?.closest<HTMLElement>(".gg-dialog");
    const layer = confirmationDialog?.closest<HTMLElement>(".gg-dialog-layer");
    confirmationDialog?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    layer?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();

    expect(document.querySelector("[data-confirm-action]")).not.toBeNull();

    adoption.resolve(true);
    await flushPromises();

    expect(document.querySelector("[data-confirm-action]")).toBeNull();
    expect(toasts.text()).toContain("Gesture template adopted");

    view.unmount();
    confirmHost.unmount();
    toasts.unmount();
  });
});

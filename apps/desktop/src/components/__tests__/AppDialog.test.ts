import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type { AppEntry } from "@godgesture/shared";

type DropListener = (event: { type: "enter" | "over" | "leave" | "drop"; paths: string[] }) => void;

const backend = {
  isTauri: true,
  onAppFileDrop: vi.fn<(handler: DropListener) => Promise<() => void>>(),
  pickWindow: vi.fn(),
  platformStatus: vi.fn(),
  resolveAppFile: vi.fn(),
};

vi.mock("@godgesture/ui", async () => {
  const { defineComponent, h, ref, watch } = await import("vue");
  const AppDialogPrimitive = defineComponent({
    props: {
      open: Boolean,
      busy: Boolean,
      title: { type: String, required: true },
      closeLabel: { type: String, required: true },
    },
    emits: ["close"],
    setup(props, { emit, slots }) {
      const open = ref(props.open);
      watch(() => props.open, (value) => { open.value = value; });
      const close = () => {
        if (!props.busy) emit("close");
      };
      return () => open.value
        ? h("section", { role: "dialog", onKeydown: (event: KeyboardEvent) => {
          if (event.key === "Escape") close();
        } }, [
          h("h2", props.title),
          h("button", { type: "button", "aria-label": props.closeLabel, disabled: props.busy, onClick: close }),
          slots.default?.(),
          slots.footer?.(),
        ])
        : null;
    },
  });
  return {
    AppAlert: defineComponent({
      props: { title: { type: String, required: true } },
      setup: (props) => () => h("div", { role: "status" }, props.title),
    }),
    AppButton: defineComponent({
      props: { disabled: Boolean, loading: Boolean, variant: String },
      setup: (props, { attrs, slots }) => () => h("button", {
        ...attrs,
        type: "button",
        class: ["gg-button", props.variant ? `gg-button--${props.variant}` : ""],
        disabled: props.disabled || props.loading,
      }, slots.default?.()),
    }),
    AppDialog: AppDialogPrimitive,
    AppSpinner: defineComponent({ setup: (_, { attrs }) => () => h("span", attrs) }),
    pushToast: vi.fn(),
  };
});

vi.mock("lucide-vue-next", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Crosshair: defineComponent({ setup: () => () => h("svg") }),
    Upload: defineComponent({ setup: () => () => h("svg") }),
  };
});

vi.mock("@godgesture/shared", () => ({ DEFAULT_APP_GROUP_ID: "default" }));

vi.mock("../../api/backend", () => ({
  BackendError: class BackendError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
  useBackend: () => backend,
}));

import AppDialog from "../AppDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel", ok: "Save" },
      appDialog: {
        addTitle: "Add app",
        editTitle: "Edit app",
        bindingHint: "Binding hint",
        name: "Name",
        namePlaceholder: "Name placeholder",
        windowsSection: "Windows",
        exeName: "Executable name",
        exeNamePlaceholder: "Executable placeholder",
        pickWindow: "Pick window",
        pickWindowHint: "Pick hint",
        matchByExactPath: "Match exact path",
        exactPath: "Exact path",
        exactPathPlaceholder: "Exact path placeholder",
        macSection: "macOS",
        bundleId: "Bundle ID",
        bundleIdPlaceholder: "Bundle placeholder",
        noBindingWarning: "No binding",
        dropFile: "Drop application file",
        dropMacApp: "Drop application bundle",
        dropUnavailable: "Drop unavailable",
        nameRequired: "Name required",
        fileError: {
          unsupported: "Unsupported",
          unavailable: "Unavailable",
          shortcut: "Shortcut failed",
          unknown: "Unknown failure",
        },
      },
    },
  },
});

const existingApp: AppEntry = {
  id: "app-1",
  name: "Existing app",
  groupId: "group-1",
  windows: {
    exeName: "existing.exe",
    aumid: "existing.aumid",
    exactPath: "C:\\Existing\\existing.exe",
    matchByExactPath: true,
  },
  mac: { bundleId: "com.example.existing" },
  gesturingEnabled: false,
  inheritGlobalGestures: false,
  intents: [],
  order: 7,
};

function mountDialog(app: AppEntry | null = existingApp) {
  return mount(AppDialog, {
    attachTo: document.body,
    props: { modelValue: true, app },
    global: { plugins: [i18n] },
  });
}

describe("AppDialog", () => {
  beforeEach(() => {
    backend.platformStatus.mockReset().mockResolvedValue({ platform: "windows" });
    backend.pickWindow.mockReset();
    backend.resolveAppFile.mockReset();
    backend.onAppFileDrop.mockReset().mockResolvedValue(() => undefined);
    document.body.replaceChildren();
    document.documentElement.classList.remove("gg-window-picking");
  });

  it("saves normalized Windows binding while preserving edit-only fields", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const nameLabel = wrapper.get('label[for="app-name"]');
    expect(nameLabel.text()).toBe("Name");
    await wrapper.get("#app-name").setValue("  Updated app  ");
    await wrapper.get("#app-exe-name").setValue("  UPDATED.EXE  ");
    await wrapper.get("form").trigger("submit");

    const saved = wrapper.emitted("save") ?? [];
    expect(saved[saved.length - 1]).toEqual([
      {
        ...existingApp,
        name: "Updated app",
        windows: {
          exeName: "updated.exe",
          aumid: "existing.aumid",
          exactPath: "C:\\Existing\\existing.exe",
          matchByExactPath: true,
        },
      },
    ]);
    const visibilityUpdates = wrapper.emitted("update:modelValue") ?? [];
    expect(visibilityUpdates[visibilityUpdates.length - 1]).toEqual([false]);
  });

  it("keeps the dialog open while a dropped application is resolving", async () => {
    let listener: DropListener | undefined;
    let finishResolve: ((value: { appName: string; exeName?: string }) => void) | undefined;
    backend.onAppFileDrop.mockImplementation(async (registered: DropListener) => {
      listener = registered;
      return () => undefined;
    });
    backend.resolveAppFile.mockReturnValue(
      new Promise((resolve) => {
        finishResolve = resolve;
      }),
    );

    const wrapper = mountDialog(null);
    await flushPromises();
    listener?.({ type: "drop", paths: ["C:\\Apps\\sample.exe"] });
    await flushPromises();

    const dialog = wrapper.get('[role="dialog"]').element;
    expect(dialog).not.toBeNull();
    const close = dialog?.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]');
    expect(close?.disabled).toBe(true);
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    finishResolve?.({ appName: "Sample", exeName: "sample.exe" });
    await flushPromises();
    expect(close?.disabled).toBe(false);
  });
});

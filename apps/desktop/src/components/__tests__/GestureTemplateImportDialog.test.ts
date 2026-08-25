import { flushPromises, mount } from "@vue/test-utils";
import { reactive, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";

const backend = {
  gestureTemplateOpen: vi.fn(),
};

const templatePackage = {
  formatVersion: 2,
  author: "Local author",
  title: "Local template",
  summary: "Imported locally",
  tags: [],
  plugins: [],
  targets: [{
    scope: "global",
    intents: [{
      name: "No operation",
      gesture: { trigger: "right", strokes: ["up"], modifier: "none" },
      command: { type: "doNothing" },
    }],
  }],
};

const templates = reactive<any>({
  selectedEntry: null,
  selectedPackage: null,
  adoptionPlan: null,
  adoptionError: null,
  adopting: false,
  conflictPolicy: "keepExisting",
  openLocalPackage: vi.fn((value: unknown) => {
    templates.selectedPackage = value;
    templates.selectedEntry = { title: "Local template" };
  }),
  setConflictPolicy: vi.fn(),
  adopt: vi.fn().mockResolvedValue(true),
  closeDetails: vi.fn(),
});

vi.mock("../../api/backend", () => ({ useBackend: () => backend }));
vi.mock("../../stores/templates", () => ({ useTemplatesStore: () => templates }));
vi.mock("@godgesture/ui", async () => {
  const actual = await vi.importActual<typeof import("@godgesture/ui")>("@godgesture/ui");
  return {
    ...actual,
    useConfirmDialog: () => ({
      confirm: vi.fn(async (options: { onConfirm?: () => Promise<boolean> }) => options.onConfirm?.()),
    }),
  };
});

import GestureTemplateImportDialog from "../GestureTemplateImportDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel", close: "Close", ok: "OK" },
      gestures: {
        globalApp: "(Global)",
        importDialog: {
          title: "Import gesture template",
          chooseFile: "Choose JSON file",
          chooseAgain: "Choose another file",
          fileTitle: "Open gesture template",
          description: "Choose a local Gesture Template v2 JSON file.",
          review: "Review before import",
          import: "Import template",
          failed: "Could not import gesture template",
          invalid: "The selected file is not a valid gesture template.",
        },
      },
      templates: {
        risk: { all: "All risk levels", elevated: "Elevated commands", low: "No elevated commands", lowDescription: "No elevated commands.", confirm: "I reviewed the commands." },
        adoption: {
          conflicts: "{count} gesture conflicts found",
          keepExisting: "Keep existing gestures",
          replaceExisting: "Replace existing gestures",
          added: "Add {count}",
          replaced: "Replace {count}",
          skipped: "Skip {count}",
          plugins: "Install {count} plugin(s)",
          confirmTitle: "Adopt gesture template",
          confirmBody: "Continue?",
          apply: "Adopt template",
          success: "Gesture template adopted",
        },
        errors: { invalid_package: "The selected file is not a valid gesture template.", unknown: "The template operation failed." },
      },
    },
  },
});

describe("GestureTemplateImportDialog", () => {
  it("opens a local JSON file and enters the shared adoption review", async () => {
    backend.gestureTemplateOpen.mockResolvedValueOnce(JSON.stringify(templatePackage));
    const wrapper = mount(GestureTemplateImportDialog, {
      attachTo: document.body,
      props: { modelValue: true },
      global: { plugins: [i18n] },
    });

    await flushPromises();
    await nextTick();

    expect(backend.gestureTemplateOpen).toHaveBeenCalledOnce();
    expect(templates.openLocalPackage).toHaveBeenCalledWith(expect.objectContaining({ title: "Local template" }));
    expect(document.body.textContent).toContain("Review before import");

    wrapper.unmount();
  });

  it("shows a localized error when the selected JSON is invalid", async () => {
    backend.gestureTemplateOpen.mockResolvedValueOnce("{}");
    const wrapper = mount(GestureTemplateImportDialog, {
      attachTo: document.body,
      props: { modelValue: true },
      global: { plugins: [i18n] },
    });

    await flushPromises();
    expect(document.body.textContent).toContain("The selected file is not a valid gesture template.");

    wrapper.unmount();
  });
});

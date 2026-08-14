import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { ConfigDocument } from "@godgesture/shared";
import { i18n, setLocale } from "../../locales";

const backend = {
  isTauri: true as boolean,
  gestureTemplateSave: vi.fn(),
};

const account = {
  endpointMode: "custom" as "official" | "custom",
  phase: "signedOut" as string,
  user: null as {
    displayName?: string | null;
    email?: string | null;
    emailVerified?: boolean;
  } | null,
  ownedPublicTemplates: vi.fn(),
  publicTemplateSubmissionPolicy: vi.fn(),
  submitPublicTemplate: vi.fn(),
  submitPublicTemplateVersion: vi.fn(),
};

vi.mock("../../api/backend", () => ({ useBackend: () => backend }));
vi.mock("../../stores/account", () => ({ useAccountStore: () => account }));

import GestureExportDialog from "../GestureExportDialog.vue";

const GLOBAL_ID = "10000000-0000-4000-8000-000000000001";
const BROWSER_GROUP_ID = "20000000-0000-4000-8000-000000000010";
const UTILITIES_GROUP_ID = "20000000-0000-4000-8000-000000000011";
const BROWSER_ID = "30000000-0000-4000-8000-000000000001";
const MAPS_ID = "30000000-0000-4000-8000-000000000002";
const TERMINAL_ID = "30000000-0000-4000-8000-000000000003";
const PLUGIN_ID = "40000000-0000-4000-8000-000000000001";

function intent(id: string, name: string, command: unknown, order = 0) {
  return {
    id,
    name,
    enabled: true,
    gesture: {
      trigger: "right",
      strokes: ["down"],
      inputs: [{ type: "stroke", direction: "down" }],
      modifier: "none",
    },
    command,
    order,
  };
}

const config = ConfigDocument.parse({
  global: {
    gesturingEnabled: true,
    intents: [intent(GLOBAL_ID, "Close window", { type: "windowControl", operation: "close" })],
  },
  apps: [],
});

const groupedConfig = ConfigDocument.parse({
  global: { gesturingEnabled: true, intents: [] },
  groups: [
    { id: BROWSER_GROUP_ID, name: "Browsers", order: 0 },
    { id: UTILITIES_GROUP_ID, name: "Utilities", order: 1 },
  ],
  apps: [
    {
      id: BROWSER_ID,
      name: "Browser",
      groupId: BROWSER_GROUP_ID,
      windows: { exeName: "browser.exe" },
      intents: [intent("10000000-0000-4000-8000-000000000011", "Open tab", { type: "doNothing" })],
      order: 0,
    },
    {
      id: MAPS_ID,
      name: "Maps",
      groupId: BROWSER_GROUP_ID,
      windows: { exeName: "maps.exe" },
      intents: [intent("10000000-0000-4000-8000-000000000012", "Center map", { type: "doNothing" })],
      order: 1,
    },
    {
      id: TERMINAL_ID,
      name: "Terminal",
      groupId: UTILITIES_GROUP_ID,
      windows: { exeName: "terminal.exe" },
      intents: [intent("10000000-0000-4000-8000-000000000013", "New terminal", { type: "doNothing" })],
      order: 0,
    },
  ],
});

const pluginConfig = ConfigDocument.parse({
  global: {
    gesturingEnabled: true,
    intents: [intent(GLOBAL_ID, "Run plugin", { type: "nodePlugin", pluginId: PLUGIN_ID })],
  },
});

const submissionPolicy = {
  usage: { submissionsToday: 1, pendingVersions: 2, publishedTemplates: 3 },
  limits: { dailySubmissionLimit: 5, pendingVersionLimit: 6, publishedTemplateLimit: 7, maxPackageBytes: 1024 },
};

const ownedTemplates = {
  templates: [
    {
      id: "50000000-0000-4000-8000-000000000010",
      status: "published",
      versions: [
        {
          id: "51000000-0000-4000-8000-000000000010",
          versionNumber: 3,
          title: "Window controls",
          summary: "Published template for window controls.",
          status: "published",
          submittedAt: "2026-08-10T08:00:00Z",
          publishedAt: "2026-08-11T08:00:00Z",
        },
      ],
    },
    {
      id: "50000000-0000-4000-8000-000000000011",
      status: "pending_review",
      versions: [
        {
          id: "51000000-0000-4000-8000-000000000011",
          versionNumber: 1,
          title: "Pending review template",
          summary: "Still waiting for review.",
          status: "pending_review",
          submittedAt: "2026-08-12T08:00:00Z",
          publishedAt: null,
        },
      ],
    },
    {
      id: "50000000-0000-4000-8000-000000000012",
      status: "rejected",
      versions: [
        {
          id: "51000000-0000-4000-8000-000000000012",
          versionNumber: 2,
          title: "Rejected template",
          summary: "Rejected template for retry.",
          status: "rejected",
          submittedAt: "2026-08-12T09:00:00Z",
          publishedAt: null,
        },
      ],
    },
  ],
};

function mountDialog(dialogConfig = config) {
  setLocale("en");
  i18n.global.mergeLocaleMessage("en", { common: { none: "None" } });
  return mount(GestureExportDialog, {
    attachTo: document.body,
    props: { modelValue: true, config: dialogConfig },
    global: { plugins: [i18n] },
  });
}

async function setField(selector: string, value: string) {
  const input = document.body.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  await flushPromises();
}

async function completeExportForm() {
  await setField("#gesture-export-title", "Window controls");
  await setField("#gesture-export-summary", "Close the current window with one gesture.");
  await setField("#gesture-export-tags", "windows, navigation");
  const globalTarget = document.body.querySelector<HTMLInputElement>("#gesture-export-target-global");
  expect(globalTarget).not.toBeNull();
  globalTarget?.click();
  await nextTick();
  await flushPromises();
}

function exportButton() {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Export JSON");
}

function nextButton() {
  return dialogButton(document, "Next");
}

function backButton() {
  return dialogButton(document, "Back");
}

function submitButton() {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Submit to public directory");
}

function group(name: string): HTMLElement {
  const found = [...document.body.querySelectorAll<HTMLElement>(".gesture-export__group")]
    .find((element) => element.querySelector(".gesture-export__group-toggle")?.textContent?.includes(name));
  expect(found).toBeDefined();
  return found!;
}

function dialogButton(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === label);
}

function configureEligibleAccount() {
  account.endpointMode = "official";
  account.phase = "signedIn";
  account.user = {
    displayName: "Template author",
    email: "author@example.test",
    emailVerified: true,
  };
  account.ownedPublicTemplates.mockResolvedValue(ownedTemplates);
  account.publicTemplateSubmissionPolicy.mockResolvedValue(submissionPolicy);
  account.submitPublicTemplate.mockResolvedValue({
    id: "50000000-0000-4000-8000-000000000001",
    versionNumber: 1,
    status: "pending_review",
  });
  account.submitPublicTemplateVersion.mockResolvedValue({
    id: "50000000-0000-4000-8000-000000000010",
    versionNumber: 4,
    status: "pending_review",
  });
}

function browserDownloadHarness() {
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const clickDescriptor = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "click");
  const createObjectURL = vi.fn(() => "blob:gesture-export");
  const revokeObjectURL = vi.fn();
  let downloaded: { href: string; name: string } | null = null;

  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value(this: HTMLAnchorElement) {
      downloaded = { href: this.href, name: this.download };
    },
  });

  return {
    createObjectURL,
    revokeObjectURL,
    downloaded: () => downloaded,
    restore() {
      if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
      if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
      else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      if (clickDescriptor) Object.defineProperty(HTMLAnchorElement.prototype, "click", clickDescriptor);
      else delete (HTMLAnchorElement.prototype as { click?: unknown }).click;
    },
  };
}

beforeEach(() => {
  backend.isTauri = true;
  backend.gestureTemplateSave.mockReset().mockResolvedValue("C:/Exports/gesture-template.json");
  account.endpointMode = "custom";
  account.phase = "signedOut";
  account.user = null;
  account.ownedPublicTemplates.mockReset();
  account.publicTemplateSubmissionPolicy.mockReset();
  account.submitPublicTemplate.mockReset();
  account.submitPublicTemplateVersion.mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("GestureExportDialog", () => {
  it("exports the selected global target through the native metadata form", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();

    await completeExportForm();

    const action = exportButton();
    expect(action).not.toBeUndefined();
    expect(action?.disabled).toBe(false);
    action?.click();
    await flushPromises();

    expect(document.body.textContent).not.toContain("Fill in all required template metadata.");
    expect(document.body.textContent).not.toContain("Could not export gesture templates");
    expect(backend.gestureTemplateSave).toHaveBeenCalledOnce();
    expect(backend.gestureTemplateSave.mock.calls[0]?.[2]).toBe("Save gesture template");
    expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
  });

  it("keeps the export dialog open while native file saving is pending", async () => {
    let finishSave: ((path: string) => void) | undefined;
    backend.gestureTemplateSave.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
    const wrapper = mountDialog();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();
    await completeExportForm();

    exportButton()?.click();
    await flushPromises();

    const dialog = document.body.querySelector<HTMLElement>(".gg-dialog");
    expect(dialog).not.toBeNull();
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(exportButton()?.disabled).toBe(true);

    finishSave?.("C:/Exports/gesture-template.json");
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
  });

  it("keeps saving blocked for missing metadata and more than eight tags", async () => {
    mountDialog();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();
    document.body.querySelector<HTMLInputElement>("#gesture-export-target-global")?.click();
    await nextTick();
    await flushPromises();
    exportButton()?.click();
    await flushPromises();

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Fill in all required template metadata.");
    expect(backend.gestureTemplateSave).not.toHaveBeenCalled();

    await setField("#gesture-export-title", "Window controls");
    await setField("#gesture-export-summary", "Close the current window with one gesture.");
    await setField("#gesture-export-tags", "one,two,three,four,five,six,seven,eight,nine");
    exportButton()?.click();
    await flushPromises();

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Use at most 8 tags");
    expect(backend.gestureTemplateSave).not.toHaveBeenCalled();

    await setField("#gesture-export-tags", "x".repeat(33));
    exportButton()?.click();
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("no more than 32 characters");
    expect(backend.gestureTemplateSave).not.toHaveBeenCalled();
  });

  it("filters groups, exposes disclosure state, and maintains group indeterminate selection", async () => {
    mountDialog(groupedConfig);
    await flushPromises();
    nextButton()?.click();
    await flushPromises();

    const browsers = group("Browsers");
    const browsersToggle = browsers.querySelector<HTMLButtonElement>(".gesture-export__group-toggle");
    expect(browsersToggle?.getAttribute("aria-expanded")).toBe("false");
    browsersToggle?.click();
    await flushPromises();
    expect(browsersToggle?.getAttribute("aria-expanded")).toBe("true");
    browsersToggle?.click();
    await flushPromises();
    expect(browsersToggle?.getAttribute("aria-expanded")).toBe("false");
    browsersToggle?.click();
    await flushPromises();

    const appInputs = [...browsers.querySelectorAll<HTMLInputElement>(".gesture-export__group-apps input")];
    expect(appInputs).toHaveLength(2);
    appInputs[0]?.click();
    await flushPromises();
    const groupInput = browsers.querySelector<HTMLInputElement>(".gesture-export__group-select input");
    expect(groupInput?.indeterminate).toBe(true);
    expect(groupInput?.checked).toBe(false);

    await setField("#gesture-export-search", "terminal");
    expect(document.body.textContent).toContain("Terminal");
    expect(document.body.textContent).not.toContain("Browser");
    const utilitiesToggle = group("Utilities").querySelector<HTMLButtonElement>(".gesture-export__group-toggle");
    expect(utilitiesToggle?.getAttribute("aria-expanded")).toBe("true");

    await setField("#gesture-export-search", "");
    dialogButton(document, "Select all")?.click();
    await flushPromises();
    expect(document.body.textContent).toContain("3 target(s) selected, 3 gesture(s) total");
    dialogButton(document, "Clear")?.click();
    await flushPromises();
    expect(document.body.textContent).toContain("0 target(s) selected, 0 gesture(s) total");
  });

  it("shows the missing online plugin source warning and disables export", async () => {
    mountDialog(pluginConfig);
    await flushPromises();
    nextButton()?.click();
    await flushPromises();
    await completeExportForm();

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(PLUGIN_ID);
    expect(exportButton()?.disabled).toBe(true);
    exportButton()?.click();
    await flushPromises();
    expect(backend.gestureTemplateSave).not.toHaveBeenCalled();
  });

  it("downloads a browser JSON file without invoking the native save dialog", async () => {
    backend.isTauri = false;
    const browser = browserDownloadHarness();
    try {
      const wrapper = mountDialog();
      await flushPromises();
      nextButton()?.click();
      await flushPromises();
      await completeExportForm();

      exportButton()?.click();
      await flushPromises();

      expect(backend.gestureTemplateSave).not.toHaveBeenCalled();
      expect(browser.createObjectURL).toHaveBeenCalledOnce();
      expect(browser.downloaded()).toEqual({ href: "blob:gesture-export", name: expect.stringMatching(/^gesture-template-.+\.json$/) });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:gesture-export");
      expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
    } finally {
      browser.restore();
    }
  });

  it("opens the public submission review with policy details and does not submit after cancellation", async () => {
    configureEligibleAccount();
    mountDialog();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>("#gesture-export-delivery-server")?.click();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();
    await completeExportForm();

    submitButton()?.click();
    await flushPromises();

    expect(account.publicTemplateSubmissionPolicy).toHaveBeenCalledOnce();
    const review = document.body.querySelector<HTMLElement>(".review-dialog");
    expect(review?.textContent).toContain("Review before submission");
    expect(review?.textContent).toContain("1 / 5 submissions today");
    dialogButton(review!, "Cancel")?.click();
    await flushPromises();

    expect(document.body.querySelector(".review-dialog")).toBeNull();
    expect(account.submitPublicTemplate).not.toHaveBeenCalled();
  });

  it("submits the reviewed public template only after explicit confirmation", async () => {
    configureEligibleAccount();
    const wrapper = mountDialog();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>("#gesture-export-delivery-server")?.click();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();
    await completeExportForm();

    submitButton()?.click();
    await flushPromises();
    const review = document.body.querySelector<HTMLElement>(".review-dialog");
    expect(review).not.toBeNull();
    dialogButton(review!, "Submit for review")?.click();
    await flushPromises();

    expect(account.publicTemplateSubmissionPolicy).toHaveBeenCalledOnce();
    expect(account.submitPublicTemplate).toHaveBeenCalledOnce();
    expect(account.submitPublicTemplate.mock.calls[0]?.[0]).toMatchObject({
      author: "Template author",
      title: "Window controls",
      summary: "Close the current window with one gesture.",
      tags: ["windows", "navigation"],
      targets: [{ scope: "global" }],
    });
    expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
  });

  it("renders delivery cards first and only loads owned templates after choosing the server path", async () => {
    configureEligibleAccount();
    mountDialog();
    await flushPromises();

    expect(document.body.textContent).toContain("Choose delivery");
    expect(document.body.textContent).toContain("Submit to server");
    expect(document.body.textContent).toContain("Export JSON");
    expect(account.ownedPublicTemplates).not.toHaveBeenCalled();

    document.body.querySelector<HTMLButtonElement>("#gesture-export-delivery-server")?.click();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();

    expect(account.ownedPublicTemplates).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Create a new template");
    expect(document.body.textContent).toContain("Update existing template");
    document.body.querySelector<HTMLInputElement>("#gesture-export-submission-update")?.click();
    await flushPromises();
    const pendingChoice = document.body.querySelector<HTMLOptionElement>(
      'option[value="50000000-0000-4000-8000-000000000011"]',
    );
    expect(pendingChoice?.disabled).toBe(true);
  });

  it("submits a reviewed new version for the selected owned template", async () => {
    configureEligibleAccount();
    const wrapper = mountDialog();
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>("#gesture-export-delivery-server")?.click();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();

    document.body.querySelector<HTMLInputElement>("#gesture-export-submission-update")?.click();
    await flushPromises();
    const templateSelect = document.body.querySelector<HTMLSelectElement>("#gesture-export-owned-template");
    expect(templateSelect).not.toBeNull();
    templateSelect!.value = "50000000-0000-4000-8000-000000000010";
    templateSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    await completeExportForm();

    submitButton()?.click();
    await flushPromises();

    const review = document.body.querySelector<HTMLElement>(".review-dialog");
    expect(review?.textContent).toContain("Update existing template");
    expect(review?.textContent).toContain("Window controls");
    expect(review?.textContent).toContain("v3");

    dialogButton(review!, "Submit for review")?.click();
    await flushPromises();

    expect(account.submitPublicTemplate).not.toHaveBeenCalled();
    expect(account.submitPublicTemplateVersion).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000010",
      expect.objectContaining({ title: "Window controls" }),
    );
    expect(wrapper.emitted("update:modelValue")).toContainEqual([false]);
  });

  it("keeps the reviewed update target when the underlying selection changes", async () => {
    configureEligibleAccount();
    mountDialog();
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>("#gesture-export-delivery-server")?.click();
    await flushPromises();
    nextButton()?.click();
    await flushPromises();
    document.body.querySelector<HTMLInputElement>("#gesture-export-submission-update")?.click();
    await flushPromises();
    const templateSelect = document.body.querySelector<HTMLSelectElement>("#gesture-export-owned-template");
    expect(templateSelect).not.toBeNull();
    templateSelect!.value = "50000000-0000-4000-8000-000000000010";
    templateSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
    await completeExportForm();

    submitButton()?.click();
    await flushPromises();
    templateSelect!.value = "50000000-0000-4000-8000-000000000012";
    templateSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    const review = document.body.querySelector<HTMLElement>(".review-dialog");
    dialogButton(review!, "Submit for review")?.click();
    await flushPromises();

    expect(account.submitPublicTemplateVersion).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000010",
      expect.objectContaining({ title: "Window controls" }),
    );
  });
});

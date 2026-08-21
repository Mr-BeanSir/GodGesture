import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { reactive } from "vue";

const backend = {
  platformStatus: vi.fn(),
  platformRequestPermissions: vi.fn(),
  platformOpenPermissionSettings: vi.fn(),
};
const configStore = reactive<any>({
  machine: { autoStart: false, runAsAdmin: false, trayIconVisible: true },
  machineError: null,
  machinePending: { autoStart: 0, runAsAdmin: 0, trayIconVisible: 0 },
  machineRecovering: false,
  updateMachineSetting: vi.fn(),
});

vi.mock("../../api/backend", () => ({ useBackend: () => backend }));
vi.mock("../../stores/config", () => ({ useConfigStore: () => configStore }));
vi.mock("../MnemonicText.vue", () => ({ default: { template: "<span />" } }));

import QuickStartDialog from "../QuickStartDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel" },
      options: { general: {
        autoStart: "Start at login", runAsAdmin: "Run as administrator",
        runAsAdminHint: "Restart GodGesture to affect elevated programs",
        runAsAdminMacHint: "Unavailable on macOS",
        machineError: { unknown: "Machine setting failed" },
        permissions: {
          accessibility: "Accessibility", inputMonitoring: "Input monitoring", eventPosting: "Event posting",
          granted: "Granted", missing: "Missing", request: "Request access", openSettings: "Open settings",
        },
      } },
      quickGuide: {
        title: "Quick start",
        steps: { ready: "Readiness", permissions: "Program permissions", try: "Try", personalize: "Configure" },
        ready: {
          title: "Runtime", body: "Check the runtime", checking: "Checking", available: "Ready",
          permissionsRequired: "Permissions required", engineUnavailable: "Unavailable", unsupported: "Unsupported", unavailable: "Unknown",
        },
        try: { title: "Try", body: "Try an action", empty: "No examples" },
        permissions: {
          title: "Program permissions", body: "Choose how GodGesture starts.",
          autoStart: "Start at login", autoStartDesc: "Start GodGesture when you sign in.",
          runAsAdmin: "Run as administrator", runAsAdminDesc: "If a program runs as administrator and cannot use gestures, enable this option and retry after restarting GodGesture.",
          macUnavailable: "Unavailable on macOS", error: "Machine setting failed",
        },
        personalize: {
          title: "Configure", body: "Choose a destination", gestures: "Gestures", gesturesDesc: "Configure gestures",
          templates: "Templates", templatesDesc: "Browse templates", open: "Open",
        },
        back: "Back", next: "Next", finish: "Finish",
      },
    },
  },
});

const macStatus = {
  platform: "macos",
  gestureEngineRunning: true,
  accessibility: false,
  inputMonitoring: false,
  eventPosting: false,
};
const windowsStatus = {
  platform: "windows",
  gestureEngineRunning: true,
  accessibility: true,
  inputMonitoring: true,
  eventPosting: true,
};

function mountDialog() {
  return mount(QuickStartDialog, {
    attachTo: document.body,
    props: { modelValue: true, intents: [] },
    global: { plugins: [i18n] },
  });
}

describe("QuickStartDialog", () => {
  beforeEach(() => {
    backend.platformStatus.mockReset().mockResolvedValue(macStatus);
    backend.platformRequestPermissions.mockReset();
    backend.platformOpenPermissionSettings.mockReset().mockResolvedValue(undefined);
    configStore.machine = { autoStart: false, runAsAdmin: false, trayIconVisible: true };
    configStore.machineError = null;
    configStore.machinePending = { autoStart: 0, runAsAdmin: 0, trayIconVisible: 0 };
    configStore.machineRecovering = false;
    configStore.updateMachineSetting.mockReset().mockImplementation(async (key: string, value: boolean) => {
      configStore.machine[key] = value;
    });
    document.body.replaceChildren();
  });

  it("prevents Escape from closing while a native permission request is pending", async () => {
    let finishRequest: ((value: typeof macStatus) => void) | undefined;
    backend.platformRequestPermissions.mockReturnValue(new Promise((resolve) => { finishRequest = resolve; }));
    const wrapper = mountDialog();
    await flushPromises();

    const requestAccess = document.body.querySelector<HTMLButtonElement>('button[aria-label="Request access"]');
    expect(requestAccess).not.toBeNull();
    requestAccess?.click();
    await flushPromises();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    finishRequest?.(macStatus);
    await flushPromises();
  });

  it("emits navigation from the final step and only closes after finishing", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const next = document.body.querySelector<HTMLButtonElement>('button[aria-label="Next"]');
    expect(next).not.toBeNull();
    next?.click();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.click();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.click();
    await flushPromises();
    const openGestures = document.body.querySelector<HTMLButtonElement>('button[aria-label="Open Gestures"]');
    expect(openGestures).not.toBeNull();
    openGestures?.click();
    await flushPromises();
    expect(wrapper.emitted("navigate")).toEqual([["gestures"]]);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    document.body.querySelector<HTMLButtonElement>('button[aria-label="Finish"]')?.click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("shows Windows startup permissions and updates both machine settings", async () => {
    backend.platformStatus.mockResolvedValueOnce(windowsStatus);
    const wrapper = mountDialog();
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.click();
    await flushPromises();

    expect(document.body.textContent).toContain("Program permissions");
    expect(document.body.querySelectorAll(".quick-guide__step-connector")).toHaveLength(3);
    const adminDescription = document.body.querySelector(".quick-guide__machine-copy span.is-warning");
    expect(adminDescription?.textContent).toBe("If a program runs as administrator and cannot use gestures, enable this option and retry after restarting GodGesture.");
    const toggles = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(toggles).toHaveLength(2);

    toggles[0].click();
    toggles[1].click();
    await flushPromises();

    expect(configStore.updateMachineSetting).toHaveBeenNthCalledWith(1, "runAsAdmin", true);
    expect(configStore.updateMachineSetting).toHaveBeenNthCalledWith(2, "autoStart", true);
    wrapper.unmount();
  });

  it("keeps the administrator option disabled on macOS", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.click();
    await flushPromises();

    const admin = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.getAttribute("aria-label") === "Run as administrator");
    expect(admin).not.toBeUndefined();
    expect(admin?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Unavailable on macOS");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import OptionsView from "./OptionsView.vue";
import { i18n, setLocale } from "../locales";
import { useConfigStore } from "../stores/config";
import { useBackend, type PlatformRuntimeStatus } from "../api/backend";

vi.mock("../stores/config", () => ({ useConfigStore: vi.fn() }));
vi.mock("../api/backend", () => ({ useBackend: vi.fn() }));

const macosPermissionsMissing: PlatformRuntimeStatus = {
  platform: "macos",
  gestureEngineRunning: true,
  accessibility: false,
  inputMonitoring: false,
  eventPosting: false,
  code: null,
  message: null,
};

const macosPermissionsReady: PlatformRuntimeStatus = {
  ...macosPermissionsMissing,
  accessibility: true,
  inputMonitoring: true,
  eventPosting: true,
};

const store = reactive<any>({
  doc: null,
  machine: null,
  machineError: null,
  machineStatus: { healthy: true, code: null, message: null },
  machineRecovering: false,
  machinePending: { autoStart: 0, runAsAdmin: 0, trayIconVisible: 0 },
  updateMachineSetting: vi.fn(),
});

const backend = {
  getAppVersion: vi.fn(),
  platformStatus: vi.fn(),
  platformRequestPermissions: vi.fn(),
  platformOpenPermissionSettings: vi.fn(),
};

function createPreferences() {
  return {
    autoCheckForUpdate: true,
    pauseHotkey: { modifiers: ["ctrl"], key: "w" },
    pathTracker: {
      triggerButtons: ["right"],
      enableWindowsKeyGesturing: false,
      preferCursorWindow: true,
      disableInFullscreen: false,
      initialValidMovePx: 4,
      initialStayTimeout: false,
      initialStayTimeoutMs: 200,
      stayTimeout: false,
      stayTimeoutMs: 500,
    },
    gestureView: {
      showPath: true,
      showCommandName: true,
      fadeOut: true,
      rightButtonPathColor: "#FF27E518",
      middleButtonPathColor: "#FF2DE0FF",
      xButtonPathColor: "#FF667EE9",
      unrecognizedPathColor: "#FFFF8040",
    },
  };
}

function resetState(): void {
  store.doc = { preferences: createPreferences() };
  store.machine = { autoStart: false, runAsAdmin: false, trayIconVisible: true };
  store.machineError = null;
  store.machineStatus = { healthy: true, code: null, message: null };
  store.machineRecovering = false;
  store.machinePending = { autoStart: 0, runAsAdmin: 0, trayIconVisible: 0 };
  store.updateMachineSetting.mockReset().mockImplementation(async (key: string, value: boolean) => {
    store.machine[key] = value;
  });

  backend.getAppVersion.mockReset().mockResolvedValue("0.1.0-test");
  backend.platformStatus.mockReset().mockResolvedValue(macosPermissionsMissing);
  backend.platformRequestPermissions.mockReset().mockResolvedValue(macosPermissionsReady);
  backend.platformOpenPermissionSettings.mockReset().mockResolvedValue(undefined);

  vi.mocked(useConfigStore).mockReturnValue(store);
  vi.mocked(useBackend).mockReturnValue(backend as never);
  setLocale("en");
}

async function mountOptions() {
  const wrapper = mount(OptionsView, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
        HotkeyInput: { template: "<div data-testid=\"hotkey-input\" />" },
        ArgbColorPicker: { template: "<div data-testid=\"argb-color-picker\" />" },
      },
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

function controlForLabel(wrapper: ReturnType<typeof mount>, labelText: string) {
  const label = wrapper.findAll("label").find((candidate) => candidate.text().trim() === labelText);
  expect(label, `expected a label for ${labelText}`).toBeDefined();

  const id = label?.attributes("for");
  expect(id, `expected ${labelText} to be associated with a control`).toBeTruthy();

  const control = wrapper.find(`#${id}`);
  expect(control.exists(), `expected ${labelText} control to exist`).toBe(true);
  return control;
}

function buttonWithText(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().trim() === label);
  expect(button, `expected a ${label} button`).toBeDefined();
  return button!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(resetState);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("options view", () => {
  it("renders the administrator hint as an accessible tooltip", async () => {
    backend.platformStatus.mockResolvedValueOnce({
      ...macosPermissionsMissing,
      platform: "windows",
    });
    const wrapper = await mountOptions();

    const info = wrapper.get("button.options__info");
    const describedBy = info.attributes("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(info.attributes("title")).toBeUndefined();

    const tooltip = wrapper.get(`#${describedBy}`);
    expect(tooltip.attributes("role")).toBe("tooltip");
    expect(tooltip.text()).toBe(
      "If some programs run as administrator and cannot use gestures, enable this option. Restart GodGesture for the change to take effect.",
    );

    wrapper.unmount();
  });

  it("shows the updated Chinese administrator guidance in one tooltip", async () => {
    backend.platformStatus.mockResolvedValueOnce({
      ...macosPermissionsMissing,
      platform: "windows",
    });
    setLocale("zh-CN");
    const wrapper = await mountOptions();

    const info = wrapper.get("button.options__info");
    expect(info.attributes("title")).toBeUndefined();
    expect(wrapper.get('[role="tooltip"]').text()).toBe(
      "如果某些程序以管理员身份运行且无法使用手势，请开启此项。开启后需重启 GodGesture 才可生效。",
    );

    wrapper.unmount();
  });

  it("uses labelled native controls and keeps the initial move distance in range", async () => {
    const wrapper = await mountOptions();

    const triggers = wrapper.get("fieldset");
    expect(triggers.get("legend").text()).toBe("Gesture trigger buttons");
    expect(triggers.findAll('input[type="checkbox"]')).toHaveLength(4);

    const autoStart = controlForLabel(wrapper, "Start at login");
    expect(autoStart.attributes("type")).toBe("checkbox");
    expect(autoStart.classes()).toContain("gg-switch");
    await autoStart.setValue(true);
    expect(store.updateMachineSetting).toHaveBeenCalledWith("autoStart", true);

    const initialMove = controlForLabel(wrapper, "Initial move distance");
    expect(initialMove.attributes("type")).toBe("number");
    expect(initialMove.attributes("min")).toBe("1");
    expect(initialMove.attributes("max")).toBe("50");
    await initialMove.setValue("98");
    expect(store.doc.preferences.pathTracker.initialValidMovePx).toBe(50);

    wrapper.unmount();
  });

  it("does not expose the permanently enabled diagonal gesture rule", async () => {
    const wrapper = await mountOptions();

    expect(wrapper.text()).not.toContain("Allow diagonal gestures (8 directions)");

    wrapper.unmount();
  });

  it("keeps machine recovery and macOS administrator guidance accessible", async () => {
    store.machineRecovering = true;
    store.machinePending.autoStart = 1;
    const wrapper = await mountOptions();

    const autoStart = controlForLabel(wrapper, "Start at login");
    expect((autoStart.element as HTMLInputElement).disabled).toBe(true);
    const pending = wrapper.get('[role="status"][aria-label="Saving…"]');
    expect(pending.classes()).toContain("options__pending");

    const runAsAdmin = controlForLabel(wrapper, "Run as administrator");
    expect((runAsAdmin.element as HTMLInputElement).disabled).toBe(true);
    const hint = wrapper.get('button[aria-label*="unavailable on macOS"]');
    expect(hint.attributes("type")).toBe("button");
    expect(hint.attributes("title")).toBeUndefined();
    const describedBy = hint.attributes("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(wrapper.get(`#${describedBy}`).text()).toContain("Administrator mode is unavailable on macOS");

    wrapper.unmount();
  });

  it("marks an access request busy without hiding the System Settings recovery action", async () => {
    const pending = deferred<PlatformRuntimeStatus>();
    backend.platformRequestPermissions.mockReturnValueOnce(pending.promise);
    const wrapper = await mountOptions();

    const request = buttonWithText(wrapper, "Request access");
    await request.trigger("click");
    await nextTick();

    expect((request.element as HTMLButtonElement).disabled).toBe(true);
    expect(request.attributes("aria-busy")).toBe("true");
    expect((buttonWithText(wrapper, "Open System Settings").element as HTMLButtonElement).disabled).toBe(false);

    pending.resolve(macosPermissionsReady);
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("macOS gesture permissions are ready");

    wrapper.unmount();
  });

  it("marks the System Settings action busy without blocking a permission retry", async () => {
    const pending = deferred<void>();
    backend.platformOpenPermissionSettings.mockReturnValueOnce(pending.promise);
    const wrapper = await mountOptions();

    const settings = buttonWithText(wrapper, "Open System Settings");
    await settings.trigger("click");
    await nextTick();

    expect((settings.element as HTMLButtonElement).disabled).toBe(true);
    expect(settings.attributes("aria-busy")).toBe("true");
    expect((buttonWithText(wrapper, "Request access").element as HTMLButtonElement).disabled).toBe(false);

    pending.resolve();
    await flushPromises();
    expect((buttonWithText(wrapper, "Open System Settings").element as HTMLButtonElement).disabled).toBe(false);

    wrapper.unmount();
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { AppMessageViewport, clearMessages, useConfirmDialog } from "@godgesture/ui";
import UiConfirmHost from "../../components/UiConfirmHost.vue";
import { i18n, setLocale } from "../../locales";
import { useConfigStore } from "../../stores/config";
import GesturesView from "../GesturesView.vue";

vi.mock("../../stores/config", () => ({ useConfigStore: vi.fn() }));
vi.mock("../../components/IntentEditor.vue", () => ({
  default: { props: ["intent"], template: "<div data-testid=\"gesture-editor\">{{ intent.name }}</div>" },
}));
vi.mock("../../components/BoundaryIntentEditor.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../components/CaptureDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../components/AddActionDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../components/AppDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../components/GestureExportDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../components/GestureTemplateImportDialog.vue", () => ({ default: { template: "<div />" } }));

const defaultGroupId = "20000000-0000-4000-8000-000000000001";
const appId = "10000000-0000-4000-8000-000000000001";
const gestureId = "30000000-0000-4000-8000-000000000001";
const customGroupId = "20000000-0000-4000-8000-000000000002";
const targetGroupId = "20000000-0000-4000-8000-000000000003";
const customAppId = "10000000-0000-4000-8000-000000000002";
const boundaryIntentId = "40000000-0000-4000-8000-000000000001";

const config = reactive<any>({
  global: {
    gesturingEnabled: true,
    intents: [{
      id: gestureId,
      name: "Open workspace",
      enabled: true,
      gesture: { trigger: "right", inputs: [], modifier: "none" },
      command: { type: "doNothing" },
      order: 0,
    }],
  },
  groups: [{ id: defaultGroupId, name: "Default", order: 0 }],
  apps: [{
    id: appId,
    name: "Desktop app",
    groupId: defaultGroupId,
    gesturingEnabled: true,
    inheritGlobalGestures: true,
    intents: [],
    order: 0,
  }],
  hotCorners: { enabled: false },
  rubEdges: { enabled: false },
  boundaryIntents: [],
});

function resetConfig(): void {
  config.global.gesturingEnabled = true;
  config.global.intents = [{
    id: gestureId,
    name: "Open workspace",
    enabled: true,
    gesture: { trigger: "right", inputs: [], modifier: "none" },
    command: { type: "doNothing" },
    order: 0,
  }];
  config.groups = [{ id: defaultGroupId, name: "Default", order: 0 }];
  config.apps = [{
    id: appId,
    name: "Desktop app",
    groupId: defaultGroupId,
    gesturingEnabled: true,
    inheritGlobalGestures: true,
    intents: [],
    order: 0,
  }];
  config.hotCorners = { enabled: false };
  config.rubEdges = { enabled: false };
  config.boundaryIntents = [];
  vi.mocked(useConfigStore).mockReturnValue({ doc: config } as any);
  setLocale("en");
}

function addCustomGroupWithApp(): void {
  config.groups.push({ id: customGroupId, name: "Custom", order: 1 });
  config.apps.push({
    id: customAppId,
    name: "Custom app",
    groupId: customGroupId,
    gesturingEnabled: true,
    inheritGlobalGestures: true,
    intents: [],
    order: 0,
  });
}

function addDropTargetGroup(): void {
  config.groups.push({ id: targetGroupId, name: "Target", order: 1 });
}

function mountGestures() {
  const view = mount(GesturesView, {
    attachTo: document.body,
    shallow: true,
    global: {
      plugins: [i18n],
      stubs: {
        GestureActionTable: false,
        AppIcon: { template: "<span><slot /></span>" },
        MnemonicText: { template: "<span>Mnemonic</span>" },
        BoundaryMnemonic: { template: "<span>Boundary</span>" },
        AddActionDialog: {
          emits: ["confirm-boundary"],
          template: `
            <button
              data-testid="confirm-exact-boundary"
              type="button"
              @click="$emit('confirm-boundary', {
                origin: { kind: 'hotCorner', corner: 'leftTop' },
                sequence: [{ type: 'wheel', direction: 'forward' }],
              })"
            >
              Confirm boundary
            </button>
          `,
        },
      },
    },
  });
  const confirmHost = mount(UiConfirmHost, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  return { view, confirmHost };
}

beforeEach(resetConfig);

afterEach(() => {
  clearMessages();
  const dialog = useConfirmDialog();
  if (dialog.pending.value) dialog.pending.value.busy = false;
  dialog.resolveConfirm(false);
  document.body.innerHTML = "";
});

describe("GesturesView", () => {
  it("consolidates transfer and group/app actions behind card choices", async () => {
    const { view, confirmHost } = mountGestures();
    try {
      await nextTick();
      const headButtons = view.findAll(".gestures__apps-head-button");

      expect(headButtons.map((button) => button.text())).toEqual(["Import / Export", "Group / App"]);
      expect(view.text()).not.toContain("Export\n");
      expect(view.text()).not.toContain("Group\n");
      expect(view.text()).not.toContain("App\n");
    } finally {
      view.unmount();
      confirmHost.unmount();
    }
  });

  it("keeps the Desktop workbench controls flat and compact", () => {
    const source = readFileSync(resolve(process.cwd(), "src/views/GesturesView.vue"), "utf8");
    const actionTable = readFileSync(resolve(process.cwd(), "src/components/GestureActionTable.vue"), "utf8");
    const desktopStyles = readFileSync(resolve(process.cwd(), "src/desktop.css"), "utf8");

    expect(source).not.toContain("gestures__count");
    expect(source).not.toContain("CircleCheck");
    expect(source).not.toContain("CircleX");
    expect(source).toContain("gestures__apps-head-button");
    expect(actionTable).toContain("gestures__status-dot");
    expect(actionTable).toContain("gestures__cell-mnemonic");
    expect(actionTable).toContain("overflow-x: hidden");
    expect(actionTable).toContain("table-layout: fixed");
    expect(actionTable).toContain("min-width: 0");
    expect(actionTable).toContain("padding: 2px 8px");
    expect(source).toContain(".gestures__app-actions .gg-icon-button :deep(svg)");
    expect(source).toMatch(/\.gestures__apps-head-button\s*\{[^}]*padding: 0 8px;[^}]*justify-content: flex-start;/s);
    expect(actionTable).toContain("width: 59px");
    expect(actionTable).toContain(".gesture-action-table__status-button:hover:not(:disabled)");
    expect(actionTable).toContain("color: #38b567");
    expect(actionTable).toContain("justify-content: flex-end");
    expect(desktopStyles).toContain(".gg-desktop ::-webkit-scrollbar");
  });

  it("places global settings in the action toolbar with visible separators", async () => {
    const { view, confirmHost } = mountGestures();
    try {
      await nextTick();

      const toolbar = view.get(".gesture-action-table__toolbar");
      const settings = toolbar.get(".gestures__settings-strip");

      expect(view.find(".gestures__main-head .gestures__settings-strip").exists()).toBe(false);
      expect(toolbar.element.firstElementChild).toBe(settings.element);
      expect(settings.findAll(".gestures__setting")).toHaveLength(3);
      expect(settings.findAll(".gestures__setting-separator")).toHaveLength(2);

      await settings.get("#gestures-hot-corners").setValue(true);
      await settings.get("#gestures-rub-edges").setValue(true);
      await settings.get("#gestures-blacklist").setValue(true);

      expect(config.hotCorners.enabled).toBe(true);
      expect(config.rubEdges.enabled).toBe(true);
      expect(config.global.gesturingEnabled).toBe(false);
    } finally {
      view.unmount();
      confirmHost.unmount();
    }
  });

  it("keeps app settings in the toolbar with one separator and working bindings", async () => {
    const { view, confirmHost } = mountGestures();
    try {
      await nextTick();
      const appButton = view.findAll(".gestures__app-select").find((button) => button.text().includes("Desktop app"));
      expect(appButton).toBeDefined();
      await appButton!.trigger("click");
      await nextTick();

      const toolbar = view.get(".gesture-action-table__toolbar");
      const settings = toolbar.get(".gestures__settings-strip");

      expect(toolbar.element.firstElementChild).toBe(settings.element);
      expect(settings.findAll(".gestures__setting")).toHaveLength(2);
      expect(settings.findAll(".gestures__setting-separator")).toHaveLength(1);

      await settings.get("#gestures-inherit-global").setValue(false);
      await settings.get("#gestures-blacklist").setValue(true);

      expect(config.apps[0].inheritGlobalGestures).toBe(false);
      expect(config.apps[0].gesturingEnabled).toBe(false);
    } finally {
      view.unmount();
      confirmHost.unmount();
    }
  });

  it("renders dormant bindings as messages and keeps add action in the main header", async () => {
    const { view, confirmHost } = mountGestures();
    const messageHost = mount(AppMessageViewport, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { closeLabel: "Close" },
    });
    try {
      const appButton = view.findAll(".gestures__app-select").find((button) => button.text().includes("Desktop app"));
      expect(appButton).toBeDefined();
      await appButton!.trigger("click");
      await nextTick();

      const header = view.get(".gestures__main-head");
      expect(header.get(".gg-button").text()).toContain("Add new action");
      expect(view.get(".gesture-action-table__toolbar").find(".gg-button").exists()).toBe(false);
      const messages = [...document.body.querySelectorAll(".gg-message")].map((message) => message.textContent ?? "");
      expect(messages).toHaveLength(2);
      expect(messages.join(" ")).toContain("No Windows binding");
      expect(messages.join(" ")).toContain("No macOS binding");
    } finally {
      messageHost.unmount();
      view.unmount();
      confirmHost.unmount();
    }
  });

  it("keeps earlier dormant messages when switching between apps without a macOS binding", async () => {
    addCustomGroupWithApp();
    config.apps[0].windows = { exeName: "desktop.exe" };
    config.apps[1].windows = { exeName: "custom.exe" };
    vi.useFakeTimers();
    const { view, confirmHost } = mountGestures();
    const messageHost = mount(AppMessageViewport, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { closeLabel: "Close" },
    });
    try {
      const desktopButton = view.findAll(".gestures__app-select").find((button) => button.text().includes("Desktop app"));
      const customButton = view.findAll(".gestures__app-select").find((button) => button.text().includes("Custom app"));
      expect(desktopButton).toBeDefined();
      expect(customButton).toBeDefined();

      await desktopButton!.trigger("click");
      await nextTick();
      expect(document.body.querySelectorAll(".gg-message")).toHaveLength(1);

      await customButton!.trigger("click");
      await nextTick();
      expect(document.body.querySelectorAll(".gg-message")).toHaveLength(2);

      vi.advanceTimersByTime(3_000);
      await nextTick();
      expect(document.body.querySelectorAll(".gg-message")).toHaveLength(0);
    } finally {
      messageHost.unmount();
      view.unmount();
      confirmHost.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps an app when deletion is cancelled and removes it only after shared confirmation", async () => {
    const { view, confirmHost } = mountGestures();

    await view.get(`[data-testid="gesture-delete-app-${appId}"]`).trigger("click");
    await flushPromises();
    expect(document.querySelector("[data-confirm-action]")).not.toBeNull();

    const cancel = [...document.querySelectorAll<HTMLButtonElement>(".gg-dialog__footer button")]
      .find((button) => button.textContent === "Cancel");
    cancel?.click();
    await flushPromises();
    expect(config.apps).toHaveLength(1);

    await view.get(`[data-testid="gesture-delete-app-${appId}"]`).trigger("click");
    await flushPromises();
    document.querySelector<HTMLButtonElement>("[data-confirm-action]")?.click();
    await flushPromises();
    expect(config.apps).toHaveLength(0);

    view.unmount();
    confirmHost.unmount();
  });

  it("selects semantic action rows with Enter inside the table work surface", async () => {
    const { view, confirmHost } = mountGestures();
    await nextTick();

    const scroll = view.get(".gestures__table-scroll");
    expect(scroll.find("table").exists()).toBe(true);
    const row = view.get(`[data-action-key="gesture:${gestureId}"]`);
    await row.trigger("keydown", { key: "Enter" });

    expect(row.attributes("aria-selected")).toBe("true");

    view.unmount();
    confirmHost.unmount();
  });

  it("opens the group menu and closes it for outside pointerdown and Escape while disabling default deletion", async () => {
    const { view, confirmHost } = mountGestures();
    const menuButton = view.get(`[aria-controls="group-menu-${defaultGroupId}"]`);

    await menuButton.trigger("click");
    expect(menuButton.attributes("aria-expanded")).toBe("true");
    const menu = view.get(`#group-menu-${defaultGroupId}`);
    const defaultMenuItems = menu.findAll("button");
    expect(defaultMenuItems[defaultMenuItems.length - 1]?.attributes("disabled")).toBeDefined();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(view.find(`#group-menu-${defaultGroupId}`).exists()).toBe(false);

    await menuButton.trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await nextTick();
    expect(view.find(`#group-menu-${defaultGroupId}`).exists()).toBe(false);

    view.unmount();
    confirmHost.unmount();
  });

  it("toggles a group from its full header and shares the chevron slot with its drag grip", async () => {
    const { view, confirmHost } = mountGestures();
    const group = view.get(`[data-group-id="${defaultGroupId}"]`);
    const head = group.get(".gestures__group-head");

    expect(group.get(".gestures__group-icon-slot").find(".gestures__group-chevron").exists()).toBe(true);
    expect(group.get(".gestures__group-icon-slot").find(".gestures__group-grip").exists()).toBe(true);
    expect(group.find(".gestures__group-apps").exists()).toBe(true);

    await head.trigger("click");
    expect(group.find(".gestures__group-apps").exists()).toBe(false);
    expect(group.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("false");

    await head.trigger("click");
    expect(group.find(".gestures__group-apps").exists()).toBe(true);
    expect(group.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("true");

    view.unmount();
    confirmHost.unmount();
  });

  it("also toggles the group when the hover drag grip is clicked", async () => {
    const { view, confirmHost } = mountGestures();
    const group = view.get(`[data-group-id="${defaultGroupId}"]`);
    const grip = group.get(".gestures__group-grip");

    await grip.trigger("click");
    expect(group.find(".gestures__group-apps").exists()).toBe(false);
    expect(group.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("false");

    await grip.trigger("click");
    expect(group.find(".gestures__group-apps").exists()).toBe(true);
    expect(group.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("true");

    view.unmount();
    confirmHost.unmount();
  });

  it("does not toggle a group from the click that follows a group drag", async () => {
    addDropTargetGroup();
    const { view, confirmHost } = mountGestures();
    const sourceGroup = view.get(`[data-group-id="${defaultGroupId}"]`);
    const targetGroup = view.get(`[data-group-id="${targetGroupId}"]`).element;
    const elementFromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(targetGroup);
    const grip = sourceGroup.get(".gestures__group-grip");

    await grip.trigger("pointerdown", { button: 0, pointerId: 8, clientX: 12, clientY: 12 });
    const pointerMove = new Event("pointermove", { bubbles: true, cancelable: true });
    Object.defineProperties(pointerMove, {
      pointerId: { value: 8 },
      clientX: { value: 20 },
      clientY: { value: 20 },
    });
    window.dispatchEvent(pointerMove);
    const pointerUp = new Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(pointerUp, {
      pointerId: { value: 8 },
      clientX: { value: 20 },
      clientY: { value: 20 },
    });
    window.dispatchEvent(pointerUp);
    await nextTick();

    await grip.trigger("click");
    expect(sourceGroup.find(".gestures__group-apps").exists()).toBe(true);
    expect(sourceGroup.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("true");

    elementFromPoint.mockRestore();
    view.unmount();
    confirmHost.unmount();
  });

  it("does not suppress the next group click after a cancelled drag", async () => {
    const { view, confirmHost } = mountGestures();
    const group = view.get(`[data-group-id="${defaultGroupId}"]`);
    const grip = group.get(".gestures__group-grip");

    await grip.trigger("pointerdown", { button: 0, pointerId: 9, clientX: 12, clientY: 12 });
    window.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    await grip.trigger("click");

    expect(group.find(".gestures__group-apps").exists()).toBe(false);
    expect(group.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("false");

    view.unmount();
    confirmHost.unmount();
  });

  it("clears stale drag-click suppression after an outside interaction", async () => {
    const { view, confirmHost } = mountGestures();
    const group = view.get(`[data-group-id="${defaultGroupId}"]`);
    const grip = group.get(".gestures__group-grip");
    const head = group.get(".gestures__group-head");
    const elementFromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(null);

    try {
      await grip.trigger("pointerdown", { button: 0, pointerId: 10, clientX: 12, clientY: 12 });
      const pointerMove = new Event("pointermove", { bubbles: true, cancelable: true });
      Object.defineProperties(pointerMove, {
        pointerId: { value: 10 },
        clientX: { value: 24 },
        clientY: { value: 24 },
      });
      window.dispatchEvent(pointerMove);
      const pointerUp = new Event("pointerup", { bubbles: true, cancelable: true });
      Object.defineProperties(pointerUp, {
        pointerId: { value: 10 },
        clientX: { value: 24 },
        clientY: { value: 24 },
      });
      window.dispatchEvent(pointerUp);
      await nextTick();

      await head.trigger("pointerdown");
      await head.trigger("click");
      expect(group.find(".gestures__group-apps").exists()).toBe(false);

      await grip.trigger("click");
      expect(group.find(".gestures__group-apps").exists()).toBe(true);
      expect(group.get(".gestures__group-toggle").attributes("aria-expanded")).toBe("true");
    } finally {
      elementFromPoint.mockRestore();
      view.unmount();
      confirmHost.unmount();
    }
  });

  it("keeps the app tree connectors and compact hover dimensions fixed", () => {
    const source = readFileSync(resolve(process.cwd(), "src/views/GesturesView.vue"), "utf8");

    expect(source).toContain("data-tree-position");
    expect(source).toContain(".gestures__tree-item::before");
    expect(source).toContain(".gestures__tree-item::after");
    expect(source).toContain(".gestures__group-icon-slot");
    expect(source).toContain("width: 30px;");
    expect(source).toContain("height: 30px;");
    expect(source).toContain("height: 34px;");
    expect(source).toContain("box-sizing: border-box;");
    expect(source).toContain(".gestures__app-actions .gg-icon-button");

    const menuRuleStart = source.indexOf(".gestures__group-menu {", source.indexOf("<style scoped>"));
    const menuRuleEnd = source.indexOf(".gestures__group-menu-wrap", menuRuleStart);
    const menuRule = source.slice(menuRuleStart, menuRuleEnd);
    expect(menuRule).toContain("min-width: 30px;");
    expect(menuRule).toContain("min-height: 30px;");
  });

  it("aligns both tree connector segments with the center of the group chevron", () => {
    const source = readFileSync(resolve(process.cwd(), "src/views/GesturesView.vue"), "utf8");
    const connectorRuleStart = source.indexOf(
      ".gestures__tree-item::before,\n.gestures__tree-item::after {",
      source.indexOf("<style scoped>"),
    );
    const connectorRuleEnd = source.indexOf(".gestures__tree-item::before {", connectorRuleStart);
    const connectorRule = source.slice(connectorRuleStart, connectorRuleEnd);

    expect(connectorRule).toContain("left: 11px;");

    const afterRuleStart = source.indexOf(".gestures__tree-item::after {", connectorRuleEnd);
    const afterRuleEnd = source.indexOf(".gestures__tree-item[data-tree-position", afterRuleStart);
    const afterRule = source.slice(afterRuleStart, afterRuleEnd);
    expect(afterRule).toContain("width: 8px;");
  });

  it("places the app drag grip at the left edge of the app actions", () => {
    const { view, confirmHost } = mountGestures();
    const actions = view.get(".gestures__tree-item .gestures__app-actions");

    expect(actions.element.firstElementChild?.classList.contains("gestures__app-grip")).toBe(true);
    expect(actions.find(".gestures__app-grip").exists()).toBe(true);
    expect(view.find(".gestures__tree-item > .gestures__app-grip").exists()).toBe(false);

    view.unmount();
    confirmHost.unmount();
  });

  it("moves a custom group's apps into the default group only after confirmation", async () => {
    addCustomGroupWithApp();
    const { view, confirmHost } = mountGestures();

    await view.get(`[aria-controls="group-menu-${customGroupId}"]`).trigger("click");
    const customMenuItems = view.get(`#group-menu-${customGroupId}`).findAll("button");
    await customMenuItems[customMenuItems.length - 1]?.trigger("click");
    await flushPromises();
    expect(document.querySelector("[data-confirm-action]")).not.toBeNull();
    expect(config.apps.find((app: { id: string }) => app.id === customAppId)?.groupId).toBe(customGroupId);

    document.querySelector<HTMLButtonElement>("[data-confirm-action]")?.click();
    await flushPromises();
    expect(config.groups.some((group: { id: string }) => group.id === customGroupId)).toBe(false);
    expect(config.apps.find((app: { id: string }) => app.id === customAppId)?.groupId).toBe(defaultGroupId);

    view.unmount();
    confirmHost.unmount();
  });

  it("moves an app through the pointer drag and drop path", async () => {
    addDropTargetGroup();
    const { view, confirmHost } = mountGestures();
    const target = view.get(`[data-group-id="${targetGroupId}"]`).element;
    const elementFromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    const grip = view.get(`[aria-label='Drag app "Desktop app"']`);

    await grip.trigger("pointerdown", { button: 0, pointerId: 7, clientX: 12, clientY: 12 });
    const pointerUp = new Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(pointerUp, {
      pointerId: { value: 7 },
      clientX: { value: 16 },
      clientY: { value: 16 },
    });
    window.dispatchEvent(pointerUp);
    await nextTick();

    expect(config.apps.find((app: { id: string }) => app.id === appId)?.groupId).toBe(targetGroupId);
    elementFromPoint.mockRestore();
    view.unmount();
    confirmHost.unmount();
  });

  it("keeps an exact boundary conflict unchanged until shared confirmation replaces it", async () => {
    config.boundaryIntents = [{
      id: boundaryIntentId,
      name: "Existing boundary",
      enabled: true,
      origin: { kind: "hotCorner", corner: "leftTop" },
      sequence: [{ type: "wheel", direction: "forward" }],
      command: { type: "doNothing" },
      order: 0,
    }];
    const { view, confirmHost } = mountGestures();

    await view.get("[data-testid='confirm-exact-boundary']").trigger("click");
    await flushPromises();
    expect(document.querySelector("[data-confirm-action]")).not.toBeNull();
    expect(config.boundaryIntents[0].id).toBe(boundaryIntentId);

    document.querySelector<HTMLButtonElement>("[data-confirm-action]")?.click();
    await flushPromises();
    expect(config.boundaryIntents).toHaveLength(1);
    expect(config.boundaryIntents[0].id).not.toBe(boundaryIntentId);

    view.unmount();
    confirmHost.unmount();
  });

  it("keeps action selection on Space and prevents an action toggle from selecting its row", async () => {
    config.global.intents.push({
      id: "30000000-0000-4000-8000-000000000002",
      name: "Second action",
      enabled: true,
      gesture: { trigger: "middle", inputs: [], modifier: "none" },
      command: { type: "doNothing" },
      order: 1,
    });
    const { view, confirmHost } = mountGestures();
    const second = view.get('[data-action-key="gesture:30000000-0000-4000-8000-000000000002"]');
    const status = second.get(".gestures__icon-action");

    expect(status.find(".gestures__status-dot").exists()).toBe(true);
    expect(status.classes()).toContain("is-enabled");

    await second.trigger("keydown", { key: " " });
    expect(second.attributes("aria-selected")).toBe("true");
    await status.trigger("click");

    expect(second.attributes("aria-selected")).toBe("true");
    expect(config.global.intents[1].enabled).toBe(false);
    expect(status.classes()).toContain("is-disabled");

    view.unmount();
    confirmHost.unmount();
  });
});

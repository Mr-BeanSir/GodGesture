import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import App from "../App.vue";
import { i18n, setLocale } from "../locales";
import { useConfigStore } from "../stores/config";
import { useAccountStore } from "../stores/account";
import { usePluginsStore } from "../stores/plugins";
import { useTemplatesStore } from "../stores/templates";
import { useUpdateStore } from "../stores/update";

vi.mock("../stores/config", () => ({ useConfigStore: vi.fn() }));
vi.mock("../stores/account", () => ({ useAccountStore: vi.fn() }));
vi.mock("../stores/plugins", () => ({ usePluginsStore: vi.fn() }));
vi.mock("../stores/templates", () => ({ useTemplatesStore: vi.fn() }));
vi.mock("../stores/update", () => ({ useUpdateStore: vi.fn() }));
vi.mock("../components/QuickStartDialog.vue", () => ({
  default: { name: "QuickStartDialog", setup: () => () => null },
}));
vi.mock("../components/WindowControls.vue", () => ({
  default: { name: "WindowControls", setup: () => () => null },
}));
vi.mock("../components/UiConfirmHost.vue", () => ({
  default: { name: "UiConfirmHost", setup: () => () => null },
}));
vi.mock("../components/UiToastHost.vue", () => ({
  default: { name: "UiToastHost", setup: () => () => null },
}));
vi.mock("../views/OptionsView.vue", () => ({ default: { name: "OptionsView", setup: () => () => null } }));
vi.mock("../views/GesturesView.vue", () => ({ default: { name: "GesturesView", setup: () => () => null } }));
vi.mock("../views/AccountView.vue", () => ({ default: { name: "AccountView", setup: () => () => null } }));
vi.mock("../views/TemplatesView.vue", () => ({ default: { name: "TemplatesView", setup: () => () => null } }));
vi.mock("../views/PluginsView.vue", () => ({ default: { name: "PluginsView", setup: () => () => null } }));
vi.mock("../views/LogsView.vue", () => ({ default: { name: "LogsView", setup: () => () => null } }));
vi.mock("../views/AboutView.vue", () => ({ default: { name: "AboutView", setup: () => () => null } }));

const configStore = reactive<any>({
  backend: { isTauri: false },
  doc: { preferences: { locale: "auto" }, global: { intents: [] } },
  ready: true,
  loading: false,
  loadError: null,
  saveState: "idle",
  paused: false,
  load: vi.fn(async () => undefined),
  togglePause: vi.fn(),
});
const accountStore = reactive<any>({ initialize: vi.fn(async () => undefined) });
const pluginsStore = reactive<any>({
  initialize: vi.fn(async () => undefined),
  loadOnlineCatalog: vi.fn(async () => undefined),
});
const templatesStore = reactive<any>({ loadCatalog: vi.fn(async () => undefined) });
const updateStore = reactive<any>({
  automaticPromptPending: false,
  metadata: null,
  dismissAutomaticPrompt: vi.fn(),
  scheduleAutomaticCheck: vi.fn(),
});

function resetStores(): void {
  document.documentElement.classList.remove("dark");
  window.localStorage.clear();
  configStore.backend = { isTauri: false };
  configStore.doc = { preferences: { locale: "auto" }, global: { intents: [] } };
  configStore.ready = true;
  configStore.loading = false;
  configStore.loadError = null;
  configStore.saveState = "idle";
  configStore.paused = false;
  configStore.load.mockReset().mockResolvedValue(undefined);
  configStore.togglePause.mockReset();
  accountStore.initialize.mockReset().mockResolvedValue(undefined);
  pluginsStore.initialize.mockReset().mockResolvedValue(undefined);
  pluginsStore.loadOnlineCatalog.mockReset().mockResolvedValue(undefined);
  templatesStore.loadCatalog.mockReset().mockResolvedValue(undefined);
  updateStore.automaticPromptPending = false;
  updateStore.metadata = null;
  updateStore.dismissAutomaticPrompt.mockReset();
  updateStore.scheduleAutomaticCheck.mockReset();
  vi.mocked(useConfigStore).mockReturnValue(configStore);
  vi.mocked(useAccountStore).mockReturnValue(accountStore);
  vi.mocked(usePluginsStore).mockReturnValue(pluginsStore);
  vi.mocked(useTemplatesStore).mockReturnValue(templatesStore);
  vi.mocked(useUpdateStore).mockReturnValue(updateStore);
  setLocale("en");
  window.history.replaceState({}, "", "/");
}

function listDesktopSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listDesktopSources(path);
    return /\.(css|vue)$/.test(entry.name) ? [path] : [];
  });
}

async function mountShell() {
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

beforeEach(resetStores);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("desktop app shell", () => {
  it("selects a section and marks it as the current page", async () => {
    const wrapper = await mountShell();
    const templates = wrapper.findAll(".app__aside .app__nav-item").find((item) => item.text() === "Gesture Templates");

    await templates?.trigger("click");

    expect(templates?.classes()).toContain("app__nav-item--active");
    wrapper.unmount();
  });

  it("moves focus to the workspace heading after a section change", async () => {
    const wrapper = await mountShell();
    const templates = wrapper.findAll(".app__aside .app__nav-item").find((item) => item.text() === "Gesture Templates");

    await templates?.trigger("click");
    await nextTick();

    expect(document.activeElement).toBe(wrapper.get("#workspace-main h1").element);
    wrapper.unmount();
  });

  it("applies the locale select to the synced preferences", async () => {
    const wrapper = await mountShell();
    const select = wrapper.get(".app__language-select");

    await select.setValue("zh-CN");

    expect(configStore.doc.preferences.locale).toBe("zh-CN");
    expect(i18n.global.locale.value).toBe("zh-CN");
    expect(select.find('option[value="zh-CN"]').text()).toBe("简体中文");
    wrapper.unmount();
  });

  it("toggles the local desktop theme without changing synced preferences", async () => {
    const wrapper = await mountShell();
    const theme = wrapper.get('button[aria-label="Toggle dark mode"]');

    await theme.trigger("click");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(configStore.doc.preferences.locale).toBe("auto");
    wrapper.unmount();
  });

  it("announces config loading with a localized status region", async () => {
    configStore.ready = false;
    configStore.loading = true;
    const wrapper = await mountShell();

    const loading = wrapper.get(".app__loading");

    expect(loading.attributes("role")).toBe("status");
    expect(loading.attributes("aria-live")).toBe("polite");
    expect(loading.attributes("aria-busy")).toBe("true");
    expect(loading.text()).toContain("Loading settings");
    wrapper.unmount();
  });

  it("shows a retry action after config loading fails", async () => {
    configStore.ready = false;
    configStore.loadError = "config failed";
    const wrapper = await mountShell();

    const retry = wrapper.get(".gg-empty button");
    await retry.trigger("click");

    expect(retry.text()).toBe("Retry");
    expect(configStore.load).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders saved state as footer text with a full-height divider", async () => {
    configStore.saveState = "saved";
    const wrapper = await mountShell();
    const saved = wrapper.get(".app__footer-saved");
    const divider = saved.get(".app__footer-divider");

    expect(wrapper.find(".gg-badge--success").exists()).toBe(false);
    expect(saved.text()).toContain("Saved");
    expect(divider.attributes("aria-hidden")).toBe("true");

    const source = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
    expect(source).toContain(".app__footer-saved");
    expect(source).toContain("height: 100%;");
    expect(source).toContain("height: calc(100% + 1px);");
    expect(source).toContain("margin-top: -1px;");
    expect(source).toContain("align-self: stretch;");
    wrapper.unmount();
  });

  it("opens from a section deep link before rendering the workspace", async () => {
    window.history.replaceState({}, "", "/?section=logs&guide=0&updates=0");
    const wrapper = await mountShell();

    const active = wrapper.get(".app__aside .app__nav-item--active");

    expect(active.text()).toBe("Logs");
    wrapper.unmount();
  });

  it("keeps the desktop navigation persistent without a responsive toggle", async () => {
    const wrapper = await mountShell();
    expect(wrapper.find(".app__aside").exists()).toBe(true);
    expect(wrapper.find(".app__navigation-toggle").exists()).toBe(false);
    expect(wrapper.find(".app__drawer-layer").exists()).toBe(false);
    wrapper.unmount();
  });

  it("defines a Desktop-only compact density layer without changing shared UI", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/desktop.css"), "utf8");

    expect(styles).toContain(".gg-desktop .gg-button");
    expect(styles).toContain(".gg-desktop .gg-input");
    expect(styles).toContain(".gg-desktop .gg-icon-button");
    expect(styles).toContain("min-height: 32px;");
    expect(styles).toContain(".gg-desktop .gg-icon-button.gestures__icon-action");
    expect(styles).toContain("min-height: 36px;");
    expect(styles).toContain("--gg-sidebar: var(--gg-surface-muted);");
    expect(styles).toContain("--gg-title-control-hover: var(--gg-surface-hover);");
  });

  it("does not add viewport breakpoints to the fixed Desktop UI", () => {
    const responsiveSources = listDesktopSources(resolve(process.cwd(), "src"))
      .filter((path) => /@media\s*\(\s*max-width\s*:/.test(readFileSync(path, "utf8")));

    expect(responsiveSources).toEqual([]);
  });

  it("keeps Desktop workbench layout contracts stable", () => {
    const gestures = readFileSync(resolve(process.cwd(), "src/views/GesturesView.vue"), "utf8");
    const templates = readFileSync(resolve(process.cwd(), "src/views/TemplatesView.vue"), "utf8");

    expect(gestures).toContain("grid-template-columns: 200px minmax(0, 1fr);");
    expect(templates).toContain('class="template-detail__workspace"');
    expect(templates).toContain('class="template-detail__main"');
    expect(templates).toContain(":tabs=\"detailSectionTabs\"");
    expect(templates).not.toContain('class="template-detail__tabs"');
    expect(`${gestures}${templates}`).not.toContain("22vw");
  });
});

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { i18n, setLocale } from "../../locales";

const { usePluginsStore } = vi.hoisted(() => ({ usePluginsStore: vi.fn() }));

vi.mock("../../stores/plugins", () => ({ usePluginsStore }));

import NodePluginPicker from "../NodePluginPicker.vue";

const plugins = reactive<any>({
  readyPlugins: [],
  loading: false,
  error: null,
  initialize: vi.fn(),
  refresh: vi.fn(),
  openRoot: vi.fn(),
});

function resetPlugins() {
  plugins.readyPlugins = [
    { id: "00000000-0000-4000-8000-000000000010", name: "Lifecycle helper" },
  ];
  plugins.loading = false;
  plugins.error = null;
  plugins.initialize.mockReset().mockResolvedValue(undefined);
  plugins.refresh.mockReset().mockResolvedValue(undefined);
  plugins.openRoot.mockReset().mockResolvedValue(undefined);
  vi.mocked(usePluginsStore).mockReturnValue(plugins);
  setLocale("en");
}

function mountPicker(pluginId = "00000000-0000-4000-8000-000000000010") {
  return mount(NodePluginPicker, {
    props: { modelValue: { type: "nodePlugin", pluginId } },
    global: { plugins: [i18n] },
  });
}

beforeEach(resetPlugins);

describe("NodePluginPicker", () => {
  it("initializes the workspace and emits the complete selected plugin command", async () => {
    const wrapper = mountPicker();
    await flushPromises();

    expect(plugins.initialize).toHaveBeenCalledTimes(1);
    const select = wrapper.get<HTMLSelectElement>("#node-plugin-project");
    expect(wrapper.get('label[for="node-plugin-project"]').text()).toContain("Plugin project");

    await select.setValue("00000000-0000-4000-8000-000000000010");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual([
      { type: "nodePlugin", pluginId: "00000000-0000-4000-8000-000000000010" },
    ]);

    const openRoot = wrapper.get("button[aria-label=\"Open plugins folder\"]");
    expect(openRoot.attributes("title")).toBe("Open plugins folder");
    await openRoot.trigger("click");
    expect(plugins.openRoot).toHaveBeenCalledTimes(1);
  });

  it("disables and describes refresh while scanning, then exposes plugin failures as an alert", async () => {
    const wrapper = mountPicker();
    await flushPromises();

    const refresh = wrapper.get<HTMLButtonElement>("button[aria-label=\"Rescan plugins\"]");
    await refresh.trigger("click");
    expect(plugins.refresh).toHaveBeenCalledTimes(1);

    plugins.loading = true;
    await wrapper.vm.$nextTick();

    expect(refresh.element.disabled).toBe(true);
    expect(refresh.attributes("aria-busy")).toBe("true");
    expect(refresh.attributes("title")).toBe("Rescan plugins");

    plugins.loading = false;
    plugins.error = { message: "Scanner could not read the workspace" };
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[role="alert"]').text()).toContain("Scanner could not read the workspace");
  });
});

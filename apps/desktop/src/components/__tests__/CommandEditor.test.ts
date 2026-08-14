import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type { Command } from "@godgesture/shared";
import English from "../../locales/en";

vi.mock("../../stores/plugins", () => ({
  usePluginsStore: () => ({ readyPlugins: [] }),
}));
vi.mock("../NodePluginPicker.vue", () => ({
  default: { template: "<div />" },
}));

import CommandEditor from "../CommandEditor.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: English },
});

function mountEditor(modelValue: Command) {
  return mount(CommandEditor, {
    attachTo: document.body,
    props: { modelValue },
    global: { plugins: [i18n] },
  });
}

describe("CommandEditor", () => {
  it("associates the command type label and emits the selected discriminated default", async () => {
    const wrapper = mountEditor({ type: "doNothing" });

    const commandType = wrapper.get<HTMLSelectElement>("#command-type");
    expect(wrapper.get('label[for="command-type"]').text()).toBe("Command type");
    expect(commandType.findAll("option")).toHaveLength(12);

    await commandType.setValue("windowControl");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual([
      { type: "windowControl", operation: "maximizeRestore" },
    ]);
  });

  it("updates search fields, presets, and the browser opt-in with native controls", async () => {
    const wrapper = mountEditor({
      type: "webSearch",
      engineName: "Custom",
      engineUrl: "https://example.invalid/?q={0}",
      browser: "browser-id",
    });

    const name = wrapper.get<HTMLInputElement>("#command-web-search-engine-name");
    expect(wrapper.get('label[for="command-web-search-engine-name"]').text()).toBe("Search engine name");
    await name.setValue("Local");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual([
      expect.objectContaining({ type: "webSearch", engineName: "Local" }),
    ]);

    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual([
      expect.objectContaining({
        type: "webSearch",
        engineName: "Google",
        engineUrl: "https://www.google.com/search?q={0}",
      }),
    ]);

    const defaultBrowser = wrapper.get<HTMLInputElement>("#command-web-search-default-browser");
    expect(wrapper.get('label[for="command-web-search-default-browser"]').text()).toBe("Use the system default browser");
    await defaultBrowser.setValue(true);
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual([
      expect.objectContaining({ type: "webSearch", browser: null }),
    ]);
  });

  it("shows DSL validation and opens an escape-closeable syntax dialog", async () => {
    const wrapper = mountEditor({ type: "sendText", text: "unknown statement" });

    const source = wrapper.get<HTMLTextAreaElement>("#command-send-text");
    expect(wrapper.get('label[for="command-send-text"]').text()).toBe("Key / text sequence");
    expect(source.classes()).toContain("gg-textarea");
    expect(wrapper.get('[role="alert"]').text()).toContain("Line 1");

    const help = wrapper.get<HTMLButtonElement>('button[aria-label="Syntax"]');
    help.element.focus();
    await help.trigger("click");
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Key / text sequence syntax");
    expect(dialog?.contains(document.activeElement)).toBe(true);

    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(help.element);
  });
});

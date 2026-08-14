import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";

const { pushToast } = vi.hoisted(() => ({ pushToast: vi.fn() }));

vi.mock("@godgesture/ui", async () => ({
  ...(await vi.importActual<typeof import("@godgesture/ui")>("@godgesture/ui")),
  pushToast,
}));
vi.mock("../../api/backend", () => ({
  useBackend: () => ({ isTauri: false }),
}));

import ArgbColorPicker from "../ArgbColorPicker.vue";
import HotkeyInput from "../HotkeyInput.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      hotkey: {
        placeholder: "Click, then press a shortcut",
        recording: "Press a shortcut",
        clear: "Clear",
        unsupportedKey: "This physical key is unsupported.",
      },
    },
  },
});

describe("ArgbColorPicker", () => {
  it("writes native color and alpha changes back as #AARRGGBB", async () => {
    const wrapper = mount(ArgbColorPicker, { props: { modelValue: "#8040A0C0" } });
    const color = wrapper.get('input[type="color"]');
    const alpha = wrapper.get('input[type="number"]');

    expect((color.element as HTMLInputElement).value).toBe("#40a0c0");
    expect((alpha.element as HTMLInputElement).value).toBe("128");

    await color.setValue("#123456");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual(["#80123456"]);
    await wrapper.setProps({ modelValue: "#80123456" });

    await alpha.setValue("64");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual(["#40123456"]);
  });
});

describe("HotkeyInput", () => {
  beforeEach(() => pushToast.mockClear());

  it("uses a native clear button and announces unsupported keys through the toast service", async () => {
    const wrapper = mount(HotkeyInput, {
      props: { modifiers: ["ctrl"], keys: ["k"] },
      global: { plugins: [i18n] },
    });

    const recorder = wrapper.get('[role="button"]');
    await recorder.trigger("focus");
    await recorder.trigger("keydown", { code: "Unidentified" });

    expect(pushToast).toHaveBeenCalledWith({
      kind: "warning",
      message: "This physical key is unsupported.",
    });

    const clear = wrapper.get('button[type="button"]');
    expect(clear.text()).toBe("Clear");
    expect(clear.classes()).toContain("gg-button");
    expect(clear.classes()).toContain("gg-button--secondary");
    await clear.trigger("click");
    expect(wrapper.emitted("complete")?.slice(-1)[0]).toEqual([{ modifiers: [], keys: [] }]);
  });
});

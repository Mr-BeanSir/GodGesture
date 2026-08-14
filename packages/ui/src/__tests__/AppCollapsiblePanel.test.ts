import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { describe, expect, it } from "vitest";
import AppCollapsiblePanel from "../components/AppCollapsiblePanel.vue";

const PanelHarness = defineComponent({
  components: { AppCollapsiblePanel },
  setup: () => ({ open: ref(false) }),
  template: `
    <AppCollapsiblePanel v-model:open="open" panel-id="template-policy" label="Template policy">
      <template #title>Template policy</template>
      <template #description>Limits for public templates</template>
      <input data-panel-field value="kept" />
    </AppCollapsiblePanel>
  `,
});

describe("AppCollapsiblePanel", () => {
  it("links its controlled trigger to a mounted region and preserves content while toggled", async () => {
    const wrapper = mount(PanelHarness, { attachTo: document.body });
    const trigger = wrapper.get("[data-collapsible-panel-trigger]");
    const content = wrapper.get("[data-collapsible-panel-content]");
    const field = wrapper.get<HTMLInputElement>("[data-panel-field]");

    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.attributes("aria-controls")).toBe(content.attributes("id"));
    expect(content.attributes("aria-labelledby")).toBe(
      trigger.attributes("id"),
    );
    expect(content.isVisible()).toBe(false);

    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(content.isVisible()).toBe(true);

    await field.setValue("retained");
    await trigger.trigger("click");
    await trigger.trigger("click");
    expect(field.element.value).toBe("retained");
    wrapper.unmount();
  });

  it("defaults to an expanded region when open is not supplied", () => {
    const wrapper = mount(AppCollapsiblePanel, {
      attachTo: document.body,
      props: { panelId: "default-open", label: "Default open" },
      slots: { title: "Default open", default: "Panel body" },
    });

    expect(
      wrapper
        .get("[data-collapsible-panel-trigger]")
        .attributes("aria-expanded"),
    ).toBe("true");
    expect(wrapper.get("[data-collapsible-panel-content]").isVisible()).toBe(
      true,
    );
    wrapper.unmount();
  });
});

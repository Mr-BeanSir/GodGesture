import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppButton from "../components/AppButton.vue";
import AppSpinner from "../components/AppSpinner.vue";

describe("AppButton", () => {
  it("uses the primary variant and exposes a busy disabled state while loading", () => {
    const wrapper = mount(AppButton, {
      props: { variant: "primary", loading: true, loadingLabel: "Loading" },
      slots: { default: "Save" },
    });
    const button = wrapper.get("button");

    expect(button.classes()).toContain("gg-button--primary");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("aria-busy")).toBe("true");
    expect(button.find('[role="status"]').text()).toBe("Loading");
  });
});

describe("AppSpinner", () => {
  it("uses a visible icon and leaves the loading label to its consumer", () => {
    const wrapper = mount(AppSpinner);

    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.text()).toBe("");
  });
});

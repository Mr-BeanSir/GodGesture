import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppTabs from "../components/AppTabs.vue";

describe("AppTabs", () => {
  it("exposes accessible tab semantics and changes selection with arrow keys", async () => {
    const wrapper = mount(AppTabs, {
      props: {
        tabs: [
          { id: "all", label: "All templates", count: 4 },
          { id: "pending", label: "Pending", count: 2 },
          { id: "reports", label: "Reports", count: 1 },
        ],
        modelValue: "all",
      },
    });

    expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]').length).toBe(3);
    expect(wrapper.get('[role="tab"][aria-selected="true"]').attributes("id")).toContain("all");
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-labelledby")).toContain("all");
    expect(wrapper.text()).toContain("4");

    await wrapper.get('[role="tab"][aria-selected="true"]').trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["pending"]);

    await wrapper.setProps({ modelValue: "pending" });
    expect(wrapper.get('[role="tab"][aria-selected="true"]').attributes("id")).toContain("pending");

    await wrapper.get('[role="tab"][aria-selected="true"]').trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["all"]);
  });
});

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import AppDialog from "../components/AppDialog.vue";

describe("AppDialog", () => {
  it("emits close when Escape is pressed and restores the trigger focus", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: "Confirm", closeLabel: "Close" },
      slots: { default: "Body" },
    });
    await nextTick();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
    wrapper.unmount();
  });

  it("emits close when its backdrop receives a pointer press", async () => {
    const wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: "Confirm", closeLabel: "Close" },
    });
    await nextTick();

    const backdrop = document.body.querySelector<HTMLElement>(".gg-dialog-layer");
    backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("does not emit close from Escape or backdrop while busy", async () => {
    const wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: "Confirm", closeLabel: "Close", busy: true },
      slots: { default: "Body" },
    });
    await nextTick();

    const dialog = document.body.querySelector('[role="dialog"]');
    const backdrop = document.body.querySelector<HTMLElement>(".gg-dialog-layer");
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(wrapper.emitted("close")).toBeUndefined();
    wrapper.unmount();
  });
});

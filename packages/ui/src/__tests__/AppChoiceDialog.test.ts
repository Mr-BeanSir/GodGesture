import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import AppChoiceDialog from "../components/AppChoiceDialog.vue";

const items = [
  { id: "import", title: "Import", description: "Read a JSON file" },
  { id: "export", title: "Export", description: "Write a JSON file" },
];

describe("AppChoiceDialog", () => {
  it("renders keyboard-accessible cards without a footer and emits the selected id", async () => {
    const wrapper = mount(AppChoiceDialog, {
      attachTo: document.body,
      props: { open: true, title: "Choose", closeLabel: "Close", items },
    });
    await nextTick();

    const cards = document.body.querySelectorAll<HTMLButtonElement>("[data-choice-id]");
    expect(cards).toHaveLength(2);
    expect(document.body.querySelector(".gg-dialog__footer")).toBeNull();
    expect(cards[0]?.getAttribute("aria-label")).toBe("Import");

    cards[1]?.click();
    expect(wrapper.emitted("select")).toEqual([["export"]]);

    wrapper.unmount();
  });

  it("closes from Escape", async () => {
    const wrapper = mount(AppChoiceDialog, {
      attachTo: document.body,
      props: { open: true, title: "Choose", closeLabel: "Close", items },
    });
    await nextTick();

    document.body.querySelector('[role="dialog"]')?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
  });
});

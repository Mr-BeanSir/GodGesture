import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import AddActionDialog from "../AddActionDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { back: "Back", cancel: "Cancel", next: "Next", ok: "Confirm", delete: "Delete" },
      actions: {
        addTitle: "Add action",
        gestureTitle: "Record gesture",
        gestureDescription: "Record an input gesture",
        boundaryTitle: "Boundary action",
        boundaryDescription: "Configure a boundary action",
        originType: "Origin",
        sequenceTitle: "Following actions",
        sequenceHint: "Add steps in order",
        dragSequence: "Drag to reorder",
        immediateDescription: "Run at the boundary",
        appendToken: "Append",
        tokenKind: { wheel: "Wheel", button: "Mouse button", stroke: "Stroke direction" },
        token: {
          wheel: { forward: "Wheel forward", backward: "Wheel backward" },
          button: { left: "Left button", middle: "Middle button", right: "Right button", x1: "X1 button", x2: "X2 button" },
          stroke: { up: "Up", rightUp: "Up right", right: "Right", rightDown: "Down right", down: "Down", leftDown: "Down left", left: "Left", leftUp: "Up left" },
        },
      },
      corners: {
        corner: { leftTop: "Top left", rightTop: "Top right", leftBottom: "Bottom left", rightBottom: "Bottom right" },
        edge: { top: "Top edge", right: "Right edge", bottom: "Bottom edge", left: "Left edge" },
      },
    },
  },
});

function mountDialog() {
  return mount(AddActionDialog, {
    attachTo: document.body,
    props: { modelValue: true },
    global: { plugins: [i18n], stubs: { teleport: true } },
  });
}

describe("AddActionDialog", () => {
  it("closes when the shared dialog receives Escape", async () => {
    const wrapper = mountDialog();

    await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("submits a boundary sequence reordered with the keyboard", async () => {
    const wrapper = mountDialog();

    await wrapper.get('button[aria-label="Boundary action"]').trigger("click");
    await wrapper.get('button[aria-label="Next"]').trigger("click");

    await wrapper.get("button.boundary-builder__point.is-rightTop").trigger("click");
    const kind = wrapper.findAll("select")[0];

    await kind.setValue("button");
    await wrapper.findAll("select")[1].setValue("x1");
    await wrapper.get('button[aria-label="Append"]').trigger("click");
    await kind.setValue("wheel");
    await wrapper.findAll("select")[1].setValue("backward");
    await wrapper.get('button[aria-label="Append"]').trigger("click");

    const tokens = wrapper.findAll('[draggable="true"]');
    expect(tokens[0].attributes("tabindex")).toBe("0");
    await tokens[1].trigger("keydown", { altKey: true, key: "ArrowUp" });
    await wrapper.get('button[aria-label="Confirm"]').trigger("click");

    expect(wrapper.emitted("confirmBoundary")?.[0]).toEqual([{
      origin: { kind: "hotCorner", corner: "rightTop" },
      sequence: [
        { type: "wheel", direction: "backward" },
        { type: "button", button: "x1" },
      ],
    }]);
  });
});

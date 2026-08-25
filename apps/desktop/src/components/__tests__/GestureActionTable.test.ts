import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { i18n, setLocale } from "../../locales";
import GestureActionTable, { type GestureActionTableRow } from "../GestureActionTable.vue";

const gestureRow: GestureActionTableRow = {
  kind: "gesture",
  key: "gesture-1",
  name: "Open workspace",
  gesture: { trigger: "right", strokes: [], inputs: [], modifier: "none" },
  commandType: "doNothing",
  enabled: true,
};

const boundaryRow: GestureActionTableRow = {
  kind: "boundary",
  key: "boundary-1",
  name: "Corner action",
  boundary: {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Corner action",
    enabled: true,
    origin: { kind: "hotCorner", corner: "leftTop" },
    sequence: [],
    command: { type: "doNothing" },
    order: 0,
  },
  commandType: "doNothing",
  enabled: true,
};

setLocale("en");

describe("GestureActionTable reuse contract", () => {
  it("supports editable rows, keyboard selection, and boundary mnemonics", async () => {
    const wrapper = mount(GestureActionTable, {
      props: { rows: [gestureRow, boundaryRow], selectedKey: "boundary-1" },
      global: { plugins: [i18n] },
    });

    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.get('[data-action-key="boundary-1"]').classes()).toContain("is-selected");
    expect(wrapper.findAll(".gesture-action-table__status-button")).toHaveLength(2);

    await wrapper.get('[data-action-key="gesture-1"]').trigger("keydown", { key: "Enter" });
    await wrapper.get('[data-action-key="boundary-1"]').trigger("click");
    await wrapper.get('[data-action-key="gesture-1"] .gesture-action-table__status-button').trigger("click");

    expect(wrapper.emitted("select")).toEqual([["gesture-1"], ["boundary-1"]]);
    expect(wrapper.emitted("toggle")).toEqual([["gesture-1"]]);
    wrapper.unmount();
  });

  it("renders readonly conflict status and the empty state", () => {
    const wrapper = mount(GestureActionTable, {
      props: {
        rows: [{ ...gestureRow, conflict: true }, { ...boundaryRow, conflict: false }],
        mode: "readonly",
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.findAll(".gesture-action-table__status-button")).toHaveLength(0);
    expect(wrapper.get('[data-action-key="gesture-1"]').classes()).toContain("is-conflict");
    expect(wrapper.text()).toContain("Conflict");
    expect(wrapper.text()).toContain("No conflict");

    const empty = mount(GestureActionTable, {
      props: { rows: [], mode: "readonly" },
      global: { plugins: [i18n] },
    });
    expect(empty.text()).toContain(i18n.global.t("gestures.emptyIntents"));
    empty.unmount();
    wrapper.unmount();
  });

  it("is used by both the editable gestures page and the read-only template detail", async () => {
    const [gesturesSource, templatesSource] = await Promise.all([
      readFile(join(process.cwd(), "src", "views", "GesturesView.vue"), "utf8"),
      readFile(join(process.cwd(), "src", "components", "GestureTemplateAdoptionDialog.vue"), "utf8"),
    ]);

    expect(gesturesSource).toContain('from "../components/GestureActionTable.vue"');
    expect(templatesSource).toContain('from "./GestureActionTable.vue"');
  });
});

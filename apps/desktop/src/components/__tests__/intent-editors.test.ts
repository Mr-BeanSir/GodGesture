import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import type { BoundaryIntent, GestureIntent } from "@godgesture/shared";
import { i18n, setLocale } from "../../locales";
import BoundaryIntentEditor from "../BoundaryIntentEditor.vue";
import IntentEditor from "../IntentEditor.vue";

const command = { type: "doNothing" } as const;

function mountIntentEditor(intent: GestureIntent) {
  setLocale("en");
  return mount(IntentEditor, {
    props: { intent },
    global: {
      plugins: [i18n],
      stubs: { CommandEditor: true, MnemonicText: true },
    },
  });
}

function mountBoundaryEditor(intent: BoundaryIntent) {
  setLocale("en");
  return mount(BoundaryIntentEditor, {
    props: { intent },
    global: {
      plugins: [i18n],
      stubs: { BoundaryMnemonic: true, CommandEditor: true },
    },
  });
}

describe("IntentEditor", () => {
  it("keeps direct intent edits while preventing a trigger button from becoming its modifier", async () => {
    const intent = reactive<GestureIntent>({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Original name",
      enabled: true,
      order: 0,
      gesture: { trigger: "right", strokes: ["down"], modifier: "none" },
      command,
    });
    const wrapper = mountIntentEditor(intent);

    const name = wrapper.get<HTMLInputElement>("#gesture-intent-name");
    expect(wrapper.get('label[for="gesture-intent-name"]').text()).toContain("Name");
    await name.setValue("Renamed gesture");
    expect(intent.name).toBe("Renamed gesture");

    const modifier = wrapper.get<HTMLSelectElement>("#gesture-modifier");
    const triggerOption = modifier.find('option[value="rightButtonDown"]');
    expect((triggerOption.element as HTMLOptionElement).disabled).toBe(true);
    await modifier.setValue("wheelForward");
    expect(intent.gesture.modifier).toBe("wheelForward");

    const reRecord = wrapper.get("button[name=\"rerecord-gesture\"]");
    await reRecord.trigger("click");
    expect(wrapper.emitted("reRecord")).toEqual([[]]);

    const remove = wrapper.get("button[aria-label=\"Delete\"]");
    expect(remove.attributes("title")).toBe("Delete");
    await remove.trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[]]);
  });
});

describe("BoundaryIntentEditor", () => {
  it("edits the boundary action name and exposes accessible sequence and delete controls", async () => {
    const intent = reactive<BoundaryIntent>({
      id: "00000000-0000-4000-8000-000000000002",
      name: "Top edge",
      enabled: true,
      order: 0,
      origin: { kind: "rubEdge", edge: "top" },
      sequence: [],
      command,
    });
    const wrapper = mountBoundaryEditor(intent);

    const name = wrapper.get<HTMLInputElement>("#boundary-intent-name");
    expect(wrapper.get('label[for="boundary-intent-name"]').text()).toContain("Name");
    await name.setValue("Updated top edge");
    expect(intent.name).toBe("Updated top edge");

    const editSequence = wrapper.get("button[name=\"rerecord-boundary\"]");
    await editSequence.trigger("click");
    expect(wrapper.emitted("reRecord")).toEqual([[]]);

    const remove = wrapper.get("button[aria-label=\"Delete\"]");
    expect(remove.attributes("title")).toBe("Delete");
    await remove.trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[]]);
  });
});

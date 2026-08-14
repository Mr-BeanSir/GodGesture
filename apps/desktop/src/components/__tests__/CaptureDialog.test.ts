import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type { GestureIntent } from "@godgesture/shared";

type CapturedHandler = (gesture: {
  trigger: "right";
  strokes: string[];
  modifier: "none";
}) => void;

const backend = {
  isTauri: true,
  onGestureCaptured: vi.fn<(handler: CapturedHandler) => Promise<() => void>>(),
  captureStart: vi.fn<() => Promise<void>>(),
  captureCancel: vi.fn<() => Promise<void>>(),
};

vi.mock("../../api/backend", () => ({ useBackend: () => backend }));
vi.mock("../../logging", () => ({ appLog: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import CaptureDialog from "../CaptureDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel", ok: "Save" },
      capture: {
        title: "Record gesture",
        hint: "Record a gesture",
        hintMock: "Demo recording",
        waiting: "Waiting",
        conflictTitle: "Gesture conflict",
        conflictMessage: "{mnemonic} belongs to {name}",
        overwrite: "Overwrite",
        restart: "Restart recording",
        startError: "Recording could not start",
        cancelError: "Recording could not stop",
        retryCleanup: "Retry cleanup",
      },
      actions: { token: { stroke: { right: "Right" } } },
      modifier: { rightButtonDown: "Right button" },
    },
  },
});

const conflictingIntent = {
  id: "existing",
  name: "Existing action",
  enabled: true,
  gesture: { trigger: "right", strokes: ["right"], inputs: [{ type: "stroke", direction: "right" }], modifier: "none" },
  command: { type: "doNothing" },
} as GestureIntent;

function mountDialog() {
  return mount(CaptureDialog, {
    attachTo: document.body,
    props: { modelValue: true, existingIntents: [conflictingIntent] },
    global: { plugins: [i18n] },
  });
}

describe("CaptureDialog", () => {
  beforeEach(() => {
    backend.onGestureCaptured.mockReset().mockResolvedValue(() => undefined);
    backend.captureStart.mockReset().mockResolvedValue(undefined);
    backend.captureCancel.mockReset().mockResolvedValue(undefined);
    document.body.replaceChildren();
  });

  it("keeps an active native recording open when Escape is pressed", async () => {
    let completeStart: (() => void) | undefined;
    backend.captureStart.mockReturnValue(new Promise((resolve) => { completeStart = resolve; }));

    const wrapper = mountDialog();
    await flushPromises();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    completeStart?.();
    await flushPromises();
  });

  it("confirms a captured conflicting gesture with the existing intent id", async () => {
    let deliverCapture: CapturedHandler | undefined;
    backend.onGestureCaptured.mockImplementation(async (handler) => {
      deliverCapture = handler;
      return () => undefined;
    });
    const wrapper = mountDialog();
    await flushPromises();

    deliverCapture?.({ trigger: "right", strokes: ["right"], modifier: "none" });
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await flushPromises();
    expect(wrapper.emitted("confirm")).toEqual([[
      {
        gesture: {
          trigger: "right",
          strokes: ["right"],
          inputs: [{ type: "stroke", direction: "right" }],
          modifier: "none",
        },
        overwriteId: "existing",
      },
    ]]);
  });
});

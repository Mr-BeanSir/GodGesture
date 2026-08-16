import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppMessageViewport from "../components/AppMessageViewport.vue";
import { clearMessages, pushMessage } from "../message";

describe("AppMessageViewport", () => {
  afterEach(() => {
    clearMessages();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("keeps independently pushed messages in one top-down stack", async () => {
    const wrapper = mount(AppMessageViewport, {
      attachTo: document.body,
      props: { closeLabel: "Close" },
      global: { stubs: { TransitionGroup: false, Transition: false } },
    });

    pushMessage({ kind: "info", message: "First message" });
    pushMessage({ kind: "warning", message: "Second message" });
    await nextTick();

    const messages = [...document.body.querySelectorAll<HTMLElement>(".gg-message")];
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.textContent)).toEqual([
      expect.stringContaining("First message"),
      expect.stringContaining("Second message"),
    ]);
    expect(document.body.querySelector(".gg-message-viewport .gg-message-list")).not.toBeNull();
    expect(messages[0]?.closest(".gg-message-list")).toBe(messages[1]?.closest(".gg-message-list"));

    wrapper.unmount();
  });

  it("expires each queued message using the default three-second duration", async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppMessageViewport, { attachTo: document.body });

    pushMessage({ kind: "info", message: "First message" });
    pushMessage({ kind: "info", message: "Second message" });
    await nextTick();
    expect(document.body.querySelectorAll(".gg-message")).toHaveLength(2);

    vi.advanceTimersByTime(2_999);
    await nextTick();
    expect(document.body.querySelectorAll(".gg-message")).toHaveLength(2);

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(document.body.querySelectorAll(".gg-message")).toHaveLength(0);

    wrapper.unmount();
  });

  it("dismisses only the message whose close button was pressed", async () => {
    const wrapper = mount(AppMessageViewport, {
      attachTo: document.body,
      props: { closeLabel: "Close" },
    });

    pushMessage({ kind: "info", message: "Keep this" });
    pushMessage({ kind: "info", message: "Close this" });
    await nextTick();

    const closeButtons = document.body.querySelectorAll<HTMLButtonElement>('.gg-message__close[aria-label="Close"]');
    closeButtons[1]?.click();
    await nextTick();

    expect(document.body.querySelectorAll(".gg-message")).toHaveLength(1);
    expect(document.body.querySelector(".gg-message")?.textContent).toContain("Keep this");
    wrapper.unmount();
  });
});

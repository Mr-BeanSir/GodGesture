import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppMessage from "../components/AppMessage.vue";

describe("AppMessage", () => {
  afterEach(() => vi.useRealTimers());

  it("auto-dismisses after the Naive UI-style default duration", async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppMessage, {
      attachTo: document.body,
      slots: { default: "No macOS binding" },
    });

    try {
      const findMessage = () => document.body.querySelector('[role="status"]');
      expect(findMessage()?.textContent).toContain("No macOS binding");

      vi.advanceTimersByTime(2_999);
      await nextTick();
      expect(findMessage()).not.toBeNull();

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(findMessage()).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });

  it("renders an accessible info message with the top-entry transition contract", () => {
    const wrapper = mount(AppMessage, {
      attachTo: document.body,
      slots: { default: "No Windows binding" },
    });

    try {
      const message = document.body.querySelector<HTMLElement>('[role="status"]');
      expect(message?.tagName).toBe("SPAN");
      expect(message?.classList).toContain("gg-message--info");
      expect(message?.querySelector(".gg-message__icon")?.getAttribute("aria-hidden")).toBe("true");
    } finally {
      wrapper.unmount();
    }
  });

  it("plays the enter transition on the initial mount", () => {
    const wrapper = mount(AppMessage, {
      attachTo: document.body,
      slots: { default: "No Windows binding" },
    });

    try {
      const transition = document.body.querySelector("transition-stub");
      expect(transition?.getAttribute("appear")).toBe("true");
    } finally {
      wrapper.unmount();
    }
  });

  it("teleports the message to document.body and exposes its top stack offset", () => {
    const wrapper = mount(AppMessage, {
      attachTo: document.body,
      global: { stubs: { Transition: false } },
      props: { offset: 52 },
      slots: { default: "No Windows binding" },
    });

    try {
      const message = document.body.querySelector<HTMLElement>(".gg-message");
      expect(message).not.toBeNull();
      expect(message).not.toBe(wrapper.element);
      expect(message?.parentElement).toBe(document.body);
      expect(message?.style.getPropertyValue("--gg-message-offset")).toBe("52px");
    } finally {
      wrapper.unmount();
    }
  });
});

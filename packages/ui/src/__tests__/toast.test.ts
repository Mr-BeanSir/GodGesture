import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import ToastViewport from "../components/ToastViewport.vue";
import { clearToasts, dismissToast, pushToast } from "../toast";

describe("ToastViewport", () => {
  afterEach(() => clearToasts());

  it("announces a toast and removes it when dismissed", async () => {
    const wrapper = mount(ToastViewport, { props: { closeLabel: "Close" } });
    const id = pushToast({ kind: "success", message: "Saved" });
    await nextTick();

    expect(wrapper.get('[aria-live="polite"]').text()).toContain("Saved");

    const close = wrapper.get('button[aria-label="Close"]');
    await close.trigger("click");
    expect(wrapper.find('[aria-live="polite"]').text()).not.toContain("Saved");
    expect(id).toMatch(/^toast-/);
    wrapper.unmount();
  });

  it("expires a toast after its duration", async () => {
    vi.useFakeTimers();
    const wrapper = mount(ToastViewport, { props: { closeLabel: "Close" } });
    pushToast({ kind: "info", message: "Refreshing", duration: 1000 });
    await nextTick();
    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(wrapper.get('[aria-live="polite"]').text()).not.toContain("Refreshing");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("supports a top-right placement without changing the default host contract", () => {
    const wrapper = mount(ToastViewport, { props: { closeLabel: "Close", placement: "top-right" } });

    expect(wrapper.get('[aria-live="polite"]').classes()).toContain("gg-toast-viewport--top-right");
    wrapper.unmount();
  });

  it("clears a scheduled timeout when a toast is manually dismissed", () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const id = pushToast({ kind: "warning", message: "Review", duration: 1_000 });

    dismissToast(id);

    expect(clearTimeout).toHaveBeenCalledTimes(1);
    clearTimeout.mockRestore();
    vi.useRealTimers();
  });
});

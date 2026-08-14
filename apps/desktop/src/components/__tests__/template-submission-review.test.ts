import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import TemplateSubmissionReview from "../TemplateSubmissionReview.vue";
import { i18n, setLocale } from "../../locales";

const props = {
  modelValue: true,
  title: "Window navigation",
  summary: "Navigate between windows with a gesture.",
  author: "Demo author",
  targets: 2,
  gestures: 4,
  risks: ["Runs a command"],
  plugins: ["window-tools"],
  usage: { submissionsToday: 1, pendingVersions: 2, publishedTemplates: 3 },
  limits: { dailySubmissionLimit: 5, pendingVersionLimit: 6, publishedTemplateLimit: 7, maxPackageBytes: 1024 },
};

async function mountReview(overrides: Partial<typeof props> = {}) {
  setLocale("en");
  const wrapper = mount(TemplateSubmissionReview, {
    attachTo: document.body,
    props: { ...props, ...overrides },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("template submission review", () => {
  it("renders submitted metadata and semantic risk/plugin badges", async () => {
    const wrapper = await mountReview();

    expect(document.body.textContent).toContain("Window navigation");
    expect(document.body.textContent).toContain("Navigate between windows with a gesture.");
    expect(document.body.textContent).toContain("Demo author");
    expect(document.body.textContent).toContain("2 / 4");
    expect(document.body.querySelector(".gg-badge--warning")?.textContent).toContain("Runs a command");
    expect(document.body.querySelector(".gg-badge--neutral")?.textContent).toContain("window-tools");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("manual review");

    wrapper.unmount();
  });

  it("emits a cancel model update or a confirm event from shared dialog actions", async () => {
    const wrapper = await mountReview();
    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>("button")];
    const cancel = buttons.find((button) => button.textContent?.trim() === "Cancel");
    const confirm = buttons.find((button) => button.textContent?.trim() === "Submit for review");

    cancel?.click();
    expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);

    await wrapper.setProps({ modelValue: true });
    confirm?.click();
    expect(wrapper.emitted("confirm")).toHaveLength(1);

    wrapper.unmount();
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import AboutView from "../AboutView.vue";
import { useBackend } from "../../api/backend";
import { i18n, setLocale } from "../../locales";
import { useUpdateStore } from "../../stores/update";

vi.mock("../../api/backend", () => ({ useBackend: vi.fn() }));
vi.mock("../../stores/update", () => ({ useUpdateStore: vi.fn() }));

const backend = reactive<any>({
  getAppVersion: vi.fn(),
  openExternal: vi.fn(),
});
const updates = reactive<any>({
  state: "idle",
  metadata: null,
  errorCode: null,
  progress: null,
  check: vi.fn(),
  install: vi.fn(),
});

function resetModel(): void {
  backend.getAppVersion.mockReset().mockResolvedValue("0.1.0");
  backend.openExternal.mockReset().mockResolvedValue(undefined);
  updates.state = "idle";
  updates.metadata = null;
  updates.errorCode = null;
  updates.progress = null;
  updates.check.mockReset().mockResolvedValue(null);
  updates.install.mockReset().mockResolvedValue(true);
  vi.mocked(useBackend).mockReturnValue(backend);
  vi.mocked(useUpdateStore).mockReturnValue(updates);
  setLocale("en");
}

async function mountAbout() {
  const wrapper = mount(AboutView, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
}

function button(wrapper: Awaited<ReturnType<typeof mountAbout>>, testId: string) {
  return wrapper.get(`button[data-testid="${testId}"]`);
}

beforeEach(resetModel);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AboutView", () => {
  it("uses shared UI primitives and Lucide without Element contracts", async () => {
    const source = await readFile(join(process.cwd(), "src", "views", "AboutView.vue"), "utf8");
    const forbiddenContracts = [
      "element" + "-plus",
      "@element" + "-plus/icons-vue",
      "<" + "el-",
      "--" + "el-",
      "." + "el-",
    ];

    expect(source).toContain('from "@godgesture/ui"');
    expect(source).toContain('from "lucide-vue-next"');
    expect(source).toContain("AppAlert");
    expect(source).toContain("AppBadge");
    expect(source).toContain("AppButton");
    expect(source).toContain("AppEmptyState");
    expect(source).toContain("AppSkeleton");
    expect(source).toContain("AppSpinner");
    expect(source).not.toMatch(new RegExp(forbiddenContracts.join("|"), "i"));
    expect(source).not.toContain("var(--gg-font-" + "mono)");
    expect(source).toContain('font-family: "Cascadia Mono", "SFMono-Regular", monospace;');
    expect(source).toContain("font-variant-numeric: tabular-nums;");
  });

  it("keeps quick-start and homepage actions on native shared buttons", async () => {
    const wrapper = await mountAbout();

    expect(backend.getAppVersion).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("Version 0.1.0");

    await button(wrapper, "about-quick-start").trigger("click");
    await button(wrapper, "about-homepage").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("open-quick-start")).toHaveLength(1);
    expect(backend.openExternal).toHaveBeenCalledWith(expect.any(String));
    wrapper.unmount();
  });

  it("disables the homepage action until the external opener settles", async () => {
    let finishOpen!: () => void;
    backend.openExternal.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishOpen = resolve;
      }),
    );
    const wrapper = await mountAbout();
    const homepage = button(wrapper, "about-homepage");

    await homepage.trigger("click");

    expect(homepage.attributes("disabled")).toBeDefined();
    expect(homepage.attributes("aria-busy")).toBe("true");

    finishOpen();
    await flushPromises();

    expect(homepage.attributes("disabled")).toBeUndefined();
    expect(homepage.attributes("aria-busy")).toBeUndefined();
    wrapper.unmount();
  });

  it("disables the manual check while exposing accessible checking feedback", async () => {
    const wrapper = await mountAbout();
    const check = button(wrapper, "about-check-update");

    await check.trigger("click");
    expect(updates.check).toHaveBeenCalledWith(false);

    updates.state = "checking";
    await nextTick();

    expect(check.attributes("disabled")).toBeDefined();
    expect(check.attributes("aria-busy")).toBe("true");
    expect(wrapper.get('[data-testid="about-update-checking"]').attributes("role")).toBe("status");
    expect(wrapper.find(".gg-spinner").exists()).toBe(true);
    expect(wrapper.find(".gg-skeleton-stack").exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps release, signed, install, and determinate progress semantics", async () => {
    updates.state = "available";
    updates.metadata = {
      currentVersion: "0.1.0",
      version: "0.2.0",
      notes: "Release notes",
      publishedAt: "2026-08-12T08:00:00Z",
    };
    let finishInstall!: () => void;
    updates.install.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishInstall = resolve;
      }),
    );
    const wrapper = await mountAbout();

    expect(wrapper.text()).toContain("GodGesture 0.2.0 is available");
    expect(wrapper.get(".gg-badge--success").text()).toBe("Signed update");

    const install = button(wrapper, "about-install-update");
    await install.trigger("click");
    await nextTick();

    expect(updates.install).toHaveBeenCalledOnce();
    expect(install.attributes("disabled")).toBeDefined();
    expect(install.attributes("aria-busy")).toBe("true");

    finishInstall();
    await flushPromises();
    updates.state = "downloading";
    updates.progress = 42;
    await nextTick();

    const progress = wrapper.get('[role="progressbar"]');
    expect(progress.attributes("aria-valuenow")).toBe("42");
    expect(wrapper.text()).toContain("Downloading and verifying the update...");
    wrapper.unmount();
  });

  it("announces current, failed, ready, and idle update states", async () => {
    updates.state = "current";
    let wrapper = await mountAbout();
    expect(wrapper.get(".gg-alert--success").attributes("role")).toBe("status");
    expect(wrapper.text()).toContain("You are running the latest version");
    wrapper.unmount();

    updates.state = "failed";
    updates.errorCode = "update_network";
    wrapper = await mountAbout();
    expect(wrapper.get(".gg-alert--error").attributes("role")).toBe("alert");
    expect(wrapper.text()).toContain("GitHub Releases could not be reached");
    wrapper.unmount();

    updates.state = "ready";
    updates.metadata = {
      currentVersion: "0.1.0",
      version: "0.2.0",
      notes: null,
      publishedAt: null,
    };
    wrapper = await mountAbout();
    expect(wrapper.get(".gg-alert--success").text()).toContain("browser preview completed");
    wrapper.unmount();

    updates.state = "idle";
    updates.metadata = null;
    wrapper = await mountAbout();
    expect(wrapper.get(".gg-empty").text()).toContain("Updates have not been checked yet");
    wrapper.unmount();
  });
});

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppIcon from "../AppIcon.vue";
import { i18n, setLocale } from "../../locales";
import {
  appIconCacheKey,
  loadCachedAppIcon,
  normalizeAppIconRequest,
} from "../app-icon";

const { iconRequest } = vi.hoisted(() => ({ iconRequest: vi.fn() }));
const initialLocale = i18n.global.locale.value;
const initialDocumentLang = document.documentElement.lang;
const root = globalThis as typeof globalThis & {
  __godGestureAppIconCache?: Map<string, Promise<string | null>>;
};
const hadInitialIconCache = Object.prototype.hasOwnProperty.call(
  root,
  "__godGestureAppIconCache",
);
const initialIconCache = root.__godGestureAppIconCache;

vi.mock("../../api/backend", () => ({
  useBackend: () => ({ appIcon: iconRequest }),
}));

afterEach(() => {
  i18n.global.locale.value = initialLocale;
  document.documentElement.lang = initialDocumentLang;
  if (hadInitialIconCache) {
    root.__godGestureAppIconCache = initialIconCache;
  } else {
    delete root.__godGestureAppIconCache;
  }
});

describe("application icon helpers", () => {
  it("normalizes platform identities and ignores empty requests", () => {
    expect(normalizeAppIconRequest({ windowsExeName: " Explorer.EXE " })).toEqual({
      windowsExeName: "Explorer.EXE",
    });
    expect(normalizeAppIconRequest({ macBundleId: " com.google.Chrome " })).toEqual({
      macBundleId: "com.google.Chrome",
    });
    expect(normalizeAppIconRequest({ windowsExeName: " ", macBundleId: "" })).toBeNull();
  });

  it("uses a case-insensitive Windows cache key and a stable macOS key", () => {
    expect(appIconCacheKey({ windowsExeName: "Explorer.EXE" })).toBe(
      "windows:explorer.exe",
    );
    expect(appIconCacheKey({ macBundleId: "com.google.Chrome" })).toBe(
      "mac:com.google.Chrome",
    );
    expect(appIconCacheKey(null)).toBeNull();
  });

  it("deduplicates concurrent requests and caches a failed fallback", async () => {
    const cache = new Map<string, Promise<string | null>>();
    const loader = vi.fn().mockRejectedValue(new Error("icon unavailable"));

    const first = loadCachedAppIcon(cache, "windows:missing.exe", loader);
    const second = loadCachedAppIcon(cache, "windows:missing.exe", loader);

    expect(first).toBe(second);
    await expect(first).resolves.toBeNull();
    await expect(loadCachedAppIcon(cache, "windows:missing.exe", loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("uses the localized accessible name as native hover disclosure for fallback icons", async () => {
    setLocale("en");
    iconRequest.mockReset().mockResolvedValue(null);
    root.__godGestureAppIconCache = new Map();

    const wrapper = mount(AppIcon, {
      props: { label: "Missing app", windowsExeName: "missing.exe" },
      global: { plugins: [i18n] },
    });

    await vi.waitFor(() => {
      expect(wrapper.get('[role="img"]').attributes("title")).toBe(
        "Application icon unavailable for Missing app",
      );
    });
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe(
      "Application icon unavailable for Missing app",
    );
    expect(wrapper.find("svg").exists()).toBe(true);
    wrapper.unmount();
  });
});

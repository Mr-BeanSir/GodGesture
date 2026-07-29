import { describe, expect, it, vi } from "vitest";
import {
  appIconCacheKey,
  loadCachedAppIcon,
  normalizeAppIconRequest,
} from "../app-icon";

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
});

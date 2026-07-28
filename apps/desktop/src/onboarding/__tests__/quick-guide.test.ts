import { describe, expect, it, vi } from "vitest";
import {
  QUICK_GUIDE_STORAGE_KEY,
  QUICK_GUIDE_VERSION,
  completeQuickGuide,
  isQuickGuideForced,
  shouldShowQuickGuide,
  type QuickGuideStorage,
} from "../quick-guide";

function memoryStorage(initial: string | null = null): QuickGuideStorage {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key, next) => {
      value = next;
    }),
  };
}

describe("quick guide state", () => {
  it("shows for a new or older guide version", () => {
    expect(shouldShowQuickGuide(memoryStorage())).toBe(true);
    expect(shouldShowQuickGuide(memoryStorage("0"))).toBe(true);
  });

  it("stays dismissed for the current guide version", () => {
    expect(shouldShowQuickGuide(memoryStorage(QUICK_GUIDE_VERSION))).toBe(false);
  });

  it("records completion under the versioned machine-local key", () => {
    const storage = memoryStorage();
    expect(completeQuickGuide(storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      QUICK_GUIDE_STORAGE_KEY,
      QUICK_GUIDE_VERSION,
    );
    expect(shouldShowQuickGuide(storage)).toBe(false);
  });

  it("fails open when local storage cannot be read or written", () => {
    const storage: QuickGuideStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(shouldShowQuickGuide(storage)).toBe(true);
    expect(completeQuickGuide(storage)).toBe(false);
    expect(shouldShowQuickGuide(null)).toBe(true);
  });

  it("only recognizes the explicit browser QA flag", () => {
    expect(isQuickGuideForced("?guide=1")).toBe(true);
    expect(isQuickGuideForced("?guide=0")).toBe(false);
    expect(isQuickGuideForced("?other=1")).toBe(false);
  });
});

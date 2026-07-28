export const QUICK_GUIDE_VERSION = "1";
export const QUICK_GUIDE_STORAGE_KEY = "godgesture.quickGuide.completed";

export interface QuickGuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function resolveQuickGuideStorage(): QuickGuideStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function shouldShowQuickGuide(storage: QuickGuideStorage | null) {
  if (!storage) return true;
  try {
    return storage.getItem(QUICK_GUIDE_STORAGE_KEY) !== QUICK_GUIDE_VERSION;
  } catch {
    return true;
  }
}

export function completeQuickGuide(storage: QuickGuideStorage | null) {
  if (!storage) return false;
  try {
    storage.setItem(QUICK_GUIDE_STORAGE_KEY, QUICK_GUIDE_VERSION);
    return true;
  } catch {
    return false;
  }
}

export function isQuickGuideForced(search: string) {
  try {
    return new URLSearchParams(search).get("guide") === "1";
  } catch {
    return false;
  }
}

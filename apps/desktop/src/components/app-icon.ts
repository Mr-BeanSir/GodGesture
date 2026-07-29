import type { AppIconRequest } from "../api/backend";

export function normalizeAppIconRequest(input: AppIconRequest): AppIconRequest | null {
  const windowsExeName = input.windowsExeName?.trim();
  const macBundleId = input.macBundleId?.trim();
  if (!windowsExeName && !macBundleId) return null;
  return {
    ...(windowsExeName ? { windowsExeName } : {}),
    ...(macBundleId ? { macBundleId } : {}),
  };
}

export function appIconCacheKey(request: AppIconRequest | null): string | null {
  if (request?.windowsExeName) {
    return `windows:${request.windowsExeName.toLowerCase()}`;
  }
  return request?.macBundleId ? `mac:${request.macBundleId}` : null;
}

export function loadCachedAppIcon(
  cache: Map<string, Promise<string | null>>,
  key: string,
  loader: () => Promise<string | null>,
): Promise<string | null> {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = loader().catch(() => null);
  cache.set(key, pending);
  return pending;
}

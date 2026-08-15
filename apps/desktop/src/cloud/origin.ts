export function resolveApiOrigin(
  configured = import.meta.env.GODGESTURE_API ?? import.meta.env.VITE_API_BASE_URL,
  development = import.meta.env.DEV,
): string | null {
  const candidate =
    configured?.trim() || (development ? "http://127.0.0.1:3000" : "");
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localHttp) return null;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return null;
  return url.origin;
}

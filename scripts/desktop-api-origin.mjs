import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INVALID_ORIGIN_MESSAGE =
  "GODGESTURE_API must be a valid HTTPS origin without credentials, path, query, or fragment";

export function validateDesktopApiOrigin(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || candidate.includes("?") || candidate.includes("#")) {
    throw new Error(INVALID_ORIGIN_MESSAGE);
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(INVALID_ORIGIN_MESSAGE);
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(INVALID_ORIGIN_MESSAGE);
  }

  return url.origin;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(validateDesktopApiOrigin(process.env.GODGESTURE_API));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

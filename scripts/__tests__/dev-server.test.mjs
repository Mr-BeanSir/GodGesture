import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = await readFile(join(import.meta.dirname, "..", "dev-server.mjs"), "utf8");

test("allows enough time for a cold Nest watch compilation", () => {
  const match = source.match(
    /const DEFAULT_BACKEND_HEALTH_TIMEOUT_MS = ([\d_]+);/,
  );

  assert.ok(match, "dev-server must declare its default backend health timeout");
  assert.ok(
    Number(match[1].replaceAll("_", "")) >= 60_000,
    "cold Windows watch startup needs at least a 60 second health window",
  );
  assert.match(
    source,
    /waitForHealth\(\s*backendUrl,\s*backend,\s*DEFAULT_BACKEND_HEALTH_TIMEOUT_MS,?\s*\)/,
  );
});

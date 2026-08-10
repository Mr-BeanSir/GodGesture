import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const serverSubmodule = {
  path: "apps/server",
  url: "https://github.com/Mr-BeanSir/GodGesture-Server.git",
};

test("Server remains the only private application submodule", async () => {
  const gitmodules = await readFile(join(repositoryRoot, ".gitmodules"), "utf8");

  assert.match(
    gitmodules,
    new RegExp(
      `path = ${escapeRegExp(serverSubmodule.path)}[\\s\\S]*url = ${escapeRegExp(serverSubmodule.url)}`,
    ),
  );

  const indexEntry = execFileSync(
    "git",
    ["ls-files", "--stage", "--", serverSubmodule.path],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  assert.match(indexEntry, /^160000 [0-9a-f]{40} 0\t/);
});

test("Web Console is owned by the Server source tree", async () => {
  const gitmodules = await readFile(join(repositoryRoot, ".gitmodules"), "utf8");
  const serverPackage = JSON.parse(
    await readFile(join(repositoryRoot, "apps", "server", "package.json"), "utf8"),
  );
  const consoleIndexEntry = execFileSync(
    "git",
    ["ls-files", "--stage", "--", "apps/web-console"],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();

  assert.doesNotMatch(gitmodules, /path = apps\/web-console/);
  assert.equal(consoleIndexEntry, "");
  await access(join(repositoryRoot, "apps", "server", "web-console", "vite.config.mts"));
  await access(join(repositoryRoot, "apps", "server", "web-console", "src", "main.ts"));
  await access(join(repositoryRoot, "apps", "server", "package.json"));
  for (const script of ["web:dev", "web:build", "web:test", "web:preview"]) {
    assert.match(serverPackage.scripts[script], /web-console\/vite\.config\.mts/);
  }

  await assert.rejects(
    access(join(repositoryRoot, "apps", "web-console", "package.json")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(join(repositoryRoot, "apps", "server", "web-console", "vite.config.ts")),
    { code: "ENOENT" },
  );
});

test("Server ignores disposable Console artifacts without ignoring source", () => {
  const serverRoot = join(repositoryRoot, "apps", "server");

  assert.equal(isGitIgnored(serverRoot, "web-console-dist/__generated__"), true);
  assert.equal(isGitIgnored(serverRoot, "web-console/.vite/__cache__"), true);
  assert.equal(isGitIgnored(serverRoot, "web-console/src/main.ts"), false);
});

test("Server Console dependency closure excludes Element Plus", async () => {
  const serverPackage = JSON.parse(
    await readFile(join(repositoryRoot, "apps", "server", "package.json"), "utf8"),
  );

  assert.equal(serverPackage.dependencies["element-plus"], undefined);
  assert.equal(serverPackage.dependencies["@element-plus/icons-vue"], undefined);
  assert.equal(serverPackage.devDependencies["element-plus"], undefined);
  assert.equal(serverPackage.devDependencies["@element-plus/icons-vue"], undefined);
  assert.equal(packageWhy("element-plus"), "");
  assert.equal(packageWhy("@element-plus/icons-vue"), "");
});

test("Docker context excludes secrets and host build artifacts", async () => {
  const dockerignore = await readFile(join(repositoryRoot, ".dockerignore"), "utf8");

  for (const pattern of [
    "**/.env",
    "**/node_modules",
    "**/dist",
    "**/dist-cjs",
    "**/web-console-dist",
  ]) {
    assert.match(dockerignore, new RegExp(`^${escapeRegExp(pattern)}$`, "m"));
  }
  assert.match(dockerignore, /^!\*\*\/\.env\.example$/m);
});

test("Server Dockerfile effective ignore excludes Console build output without reinclude rules", async () => {
  const dockerfile = join(repositoryRoot, "apps", "server", "Dockerfile");
  const effectiveDockerignore = `${dockerfile}.dockerignore`;
  const dockerignore = await readFile(effectiveDockerignore, "utf8");

  assert.match(dockerignore, /^\*\*\/web-console-dist$/m);
  assert.doesNotMatch(dockerignore, /^\s*!/m);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGitIgnored(cwd, path) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", "--", path], {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function packageWhy(packageName) {
  return execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", "@godgesture/server", "why", packageName],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "pipe",
      shell: process.platform === "win32",
    },
  ).trim();
}

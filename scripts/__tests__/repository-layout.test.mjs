import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const privateApplications = [
  {
    path: "apps/server",
    url: "https://github.com/Mr-BeanSir/GodGesture-Server.git",
  },
  {
    path: "apps/web-console",
    url: "https://github.com/Mr-BeanSir/GodGesture-Web-Console.git",
  },
];

test("private applications are recursively checked out Git submodules", async () => {
  const gitmodules = await readFile(join(repositoryRoot, ".gitmodules"), "utf8");

  for (const application of privateApplications) {
    assert.match(
      gitmodules,
      new RegExp(
        `path = ${escapeRegExp(application.path)}[\\s\\S]*url = ${escapeRegExp(application.url)}`,
      ),
    );

    const indexEntry = execFileSync(
      "git",
      ["ls-files", "--stage", "--", application.path],
      { cwd: repositoryRoot, encoding: "utf8" },
    ).trim();
    assert.match(indexEntry, /^160000 [0-9a-f]{40} 0\t/);

    await access(join(repositoryRoot, application.path, "package.json"));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

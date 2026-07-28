import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { readProjectVersion, releaseArtifactNames } from "./desktop-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = resolve(root, ".github/workflows/desktop-release.yml");
const source = await readFile(workflowPath, "utf8");
const workflow = parse(source);

assert.equal(workflow.name, "Signed desktop release");
assert.ok(workflow.on?.workflow_dispatch !== undefined);
assert.deepEqual(workflow.on?.push?.tags, ["v*"]);
assert.equal(workflow.permissions?.contents, "read");

const jobs = workflow.jobs;
assert.deepEqual(Object.keys(jobs), ["windows", "macos", "assemble", "release"]);
assert.equal(jobs.windows["runs-on"], "windows-2025");
assert.equal(jobs.macos["runs-on"], "macos-15");
assert.equal(jobs.assemble["runs-on"], "ubuntu-latest");
assert.deepEqual(jobs.assemble.needs, ["windows", "macos"]);
assert.equal(jobs.release.needs, "assemble");
assert.match(jobs.release.if, /refs\/tags\/v/);
assert.equal(jobs.release.permissions?.contents, "write");
for (const name of ["windows", "macos", "assemble"]) {
  assert.notEqual(jobs[name].permissions?.contents, "write");
}

const windows = runText(jobs.windows);
assert.match(windows, /x86_64-pc-windows-msvc/);
assert.match(windows, /--bundles nsis/);
assert.match(windows, /TAURI_SIGNING_PRIVATE_KEY is required/);
assert.match(windows, /FromBase64String/);
assert.match(windows, /dumpbin \/headers/);
assert.match(windows, /Get-AuthenticodeSignature/);
assert.match(windows, /Get-FileHash.*SHA256/s);

const macos = runText(jobs.macos);
assert.match(macos, /universal-apple-darwin/);
assert.match(macos, /--bundles app,dmg/);
assert.match(JSON.stringify(jobs.macos), /APPLE_SIGNING_IDENTITY/);
assert.match(macos, /Signature=adhoc/);
assert.match(macos, /lipo -archs/);
assert.match(macos, /arm64/);
assert.match(macos, /x86_64/);
assert.match(macos, /hdiutil verify/);
assert.match(macos, /\.app\.tar\.gz/);
assert.match(macos, /tar -tzf.*grep -Fx/s);
assert.match(macos, /shasum -a 256/);

for (const jobName of ["windows", "macos"]) {
  const serialized = JSON.stringify(jobs[jobName]);
  assert.match(serialized, /secrets\.TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(serialized, /actions\/upload-artifact@v4/);
}
assert.match(JSON.stringify(jobs.assemble), /merge-multiple/);
assert.match(runText(jobs.assemble), /scripts\/desktop-release\.mjs/);
assert.match(JSON.stringify(jobs.release), /softprops\/action-gh-release@v2/);
assert.match(JSON.stringify(jobs.release), /release-artifacts\/\*/);
assert.match(JSON.stringify(jobs.release), /fail_on_unmatched_files/);

for (const forbidden of [
  "APPLE_CERTIFICATE",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "notarytool",
  "staple",
  "Developer ID Application",
]) {
  assert.ok(!source.includes(forbidden), `Workflow must not contain ${forbidden}`);
}

const version = await readProjectVersion(root);
const names = releaseArtifactNames(version);
assert.equal(Object.keys(names).length, 8);
console.log(
  `Validated signed desktop release workflow for GodGesture ${version} (${Object.values(names).join(", ")})`,
);

function runText(job) {
  return job.steps
    .map((step) => (typeof step.run === "string" ? step.run : ""))
    .join("\n");
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  PRODUCTION_REPOSITORY,
  readProjectVersion,
  releaseArtifactNames,
} from "./desktop-release.mjs";

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
assert.match(windows, /BinaryReader/);
assert.match(windows, /0x8664/);
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
assert.match(macos, /updater_extract_dir=\$\(mktemp -d\)/);
assert.match(macos, /tar -xzf.*-C "\$updater_extract_dir"/);
assert.match(macos, /executable_path="\$app_path\/Contents\/MacOS\/godgesture"/);
assert.match(
  macos,
  /test -x "\$updater_extract_dir\/GodGesture\.app\/Contents\/MacOS\/godgesture"/,
);
assert.doesNotMatch(macos, /Contents\/MacOS\/GodGesture/);
assert.doesNotMatch(macos, /tar -tzf.*grep/s);
assert.match(macos, /shasum -a 256/);

for (const jobName of ["windows", "macos"]) {
  const steps = jobs[jobName].steps;
  const sharedBuildIndex = steps.findIndex(
    (step) => step.run === "pnpm --filter @godgesture/shared build",
  );
  const desktopBuildIndex = steps.findIndex((step) =>
    step.run?.includes("@godgesture/desktop tauri build"),
  );
  assert.ok(sharedBuildIndex >= 0, `${jobName} must build the shared package`);
  assert.ok(
    sharedBuildIndex < desktopBuildIndex,
    `${jobName} must build the shared package before the desktop bundle`,
  );
  const serialized = JSON.stringify(jobs[jobName]);
  assert.match(serialized, /secrets\.TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(serialized, /actions\/upload-artifact@v4/);
}
assert.match(JSON.stringify(jobs.assemble), /merge-multiple/);
const assemble = runText(jobs.assemble);
assert.match(assemble, /scripts\/desktop-release\.mjs/);
assert.match(assemble, /--commit "\$GITHUB_SHA"/);
assert.match(JSON.stringify(jobs.release), /softprops\/action-gh-release@v2/);
assert.match(JSON.stringify(jobs.release), /release-artifacts\/\*/);
assert.match(JSON.stringify(jobs.release), /fail_on_unmatched_files/);
assert.match(JSON.stringify(jobs.release), /contains\(github\.ref_name, '-'/);
assert.match(JSON.stringify(jobs.release), /prerelease/);
assert.match(JSON.stringify(jobs.release), /make_latest/);
assert.match(JSON.stringify(jobs.release), /docs\/USER_GUIDE\.md/);

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

assert.equal(PRODUCTION_REPOSITORY, "Mr-BeanSir/GodGesture");
const productionFiles = [
  "apps/desktop/.env.example",
  "apps/desktop/src-tauri/src/updater.rs",
  "apps/desktop/src/templates/source.ts",
  "apps/desktop/src/views/AboutView.vue",
  "apps/desktop/src/views/TemplatesView.vue",
  "distribution/gesture-templates/README.md",
];
const productionSources = await Promise.all(
  productionFiles.map((path) => readFile(resolve(root, path), "utf8")),
);
for (const [index, text] of productionSources.entries()) {
  assert.ok(
    !text.includes("https://github.com/godgesture/"),
    `Placeholder GitHub organization remains in ${productionFiles[index]}`,
  );
}

const tauriConfig = JSON.parse(
  await readFile(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
);
assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
  `https://github.com/${PRODUCTION_REPOSITORY}/releases/latest/download/latest.json`,
]);
const templateCatalog = JSON.parse(
  await readFile(resolve(root, "distribution/gesture-templates/catalog.json"), "utf8"),
);
for (const entry of templateCatalog.entries) {
  assert.match(
    entry.packageUrl,
    /^https:\/\/github\.com\/Mr-BeanSir\/gesture-templates\/releases\/latest\/download\//,
  );
}
console.log(
  `Validated signed desktop release workflow for GodGesture ${version} (${Object.values(names).join(", ")})`,
);

function runText(job) {
  return job.steps
    .map((step) => (typeof step.run === "string" ? step.run : ""))
    .join("\n");
}

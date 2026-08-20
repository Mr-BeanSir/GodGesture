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
import { RELEASE_CATEGORIES } from "./generate-release-notes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = resolve(root, ".github/workflows/desktop-release.yml");
const source = await readFile(workflowPath, "utf8");
const workflow = parse(source);
const releaseConfigPath = resolve(root, ".github/release.yml");
const releaseConfig = parse(await readFile(releaseConfigPath, "utf8"));

const expectedReleaseCategories = {
  "type: feat": "✨ Features | 新功能",
  "type: fix": "🐛 Bug Fixes | Bug 修复",
  "type: chore": "🎫 Chores | 其他更新",
  "type: docs": "📝 Documentation | 文档",
  "type: style": "💄 Styles | 风格",
  "type: refactor": "♻ Code Refactoring | 代码重构",
  "type: perf": "⚡ Performance Improvements | 性能优化",
  "type: test": "✅ Tests | 测试",
  "type: revert": "⏪ Reverts | 回退",
  "type: build": "👷 Build System | 构建",
  "type: ci": "🔧 Continuous Integration | CI 配置",
  "type: config": "🔨 CONFIG | 配置",
};

const releaseCategories = releaseConfig.changelog?.categories;
assert.ok(Array.isArray(releaseCategories), "Release notes changelog.categories must be a list");
assert.equal(releaseCategories.length, 12, "Release notes must define exactly twelve categories");
assert.equal(releaseConfig.categories, undefined, "Release notes must not use the legacy top-level categories schema");
const releaseLabels = releaseCategories.flatMap(({ labels }) => {
  assert.ok(Array.isArray(labels), "Each release category must define labels as a list");
  assert.equal(labels.length, 1, "Each release category must define exactly one label");
  return labels;
});
assert.equal(new Set(releaseLabels).size, releaseLabels.length, "Release category labels must be unique");
assert.deepEqual(
  Object.fromEntries(
    releaseCategories.map(({ labels, title }) => [labels[0], title]),
  ),
  expectedReleaseCategories,
  "Release notes categories must cover the approved type labels exactly",
);
assert.deepEqual(
  Object.fromEntries(
    RELEASE_CATEGORIES.map(({ type, title }) => [`type: ${type}`, title]),
  ),
  expectedReleaseCategories,
  "Release notes generator categories must match .github/release.yml",
);

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
assert.equal(jobs.release.if, "startsWith(github.ref, 'refs/tags/v')");
assert.equal(jobs.release.permissions?.contents, "write");
assert.equal(jobs.release.permissions?.["pull-requests"], "read");
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
  assert.equal(jobs[jobName].env?.GODGESTURE_API, undefined, `${jobName} must not expose GODGESTURE_API to every step`);
  const steps = jobs[jobName].steps;
  const toolchainIndex = steps.findIndex((step) =>
    step.uses?.startsWith("dtolnay/rust-toolchain@"),
  );
  const rustCacheIndex = steps.findIndex(
    (step) => step.uses === "Swatinem/rust-cache@v2",
  );
  const sharedBuildIndex = steps.findIndex(
    (step) => step.run === "pnpm --filter @godgesture/shared build",
  );
  const desktopBuildIndex = steps.findIndex((step) =>
    step.run?.includes("@godgesture/desktop tauri build"),
  );
  const desktopTestIndex = steps.findIndex((step) => step.name === "Test desktop frontend");
  assert.ok(sharedBuildIndex >= 0, `${jobName} must build the shared package`);
  assert.ok(toolchainIndex >= 0, `${jobName} must install the Rust toolchain`);
  assert.ok(rustCacheIndex > toolchainIndex, `${jobName} must cache Rust after toolchain setup`);
  assert.equal(
    steps[rustCacheIndex].with?.workspaces,
    "apps/desktop/src-tauri -> target",
  );
  assert.match(
    steps[rustCacheIndex].with?.key,
    jobName === "windows" ? /windows-x64/ : /macos-universal/,
  );
  assert.ok(
    rustCacheIndex < desktopBuildIndex,
    `${jobName} must restore Rust cache before the desktop bundle`,
  );
  assert.ok(
    sharedBuildIndex < desktopBuildIndex,
    `${jobName} must build the shared package before the desktop bundle`,
  );
  const apiOriginIndex = steps.findIndex(
    (step) => step.name === "Require official API origin",
  );
  assert.ok(
    apiOriginIndex >= 0,
    `${jobName} must validate GODGESTURE_API before the desktop bundle`,
  );
  assert.ok(
    apiOriginIndex < desktopBuildIndex,
    `${jobName} must validate GODGESTURE_API before the desktop bundle`,
  );
  assert.equal(
    steps[apiOriginIndex].env?.GODGESTURE_API,
    "${{ vars.GODGESTURE_API }}",
    `${jobName} origin validation must use the repository variable`,
  );
  assert.match(
    typeof steps[apiOriginIndex].run === "string" ? steps[apiOriginIndex].run : "",
    /^node scripts\/desktop-api-origin\.mjs$/,
  );
  assert.equal(
    steps[desktopBuildIndex].env?.GODGESTURE_API,
    "${{ vars.GODGESTURE_API }}",
    `${jobName} Desktop build must use the repository variable`,
  );
  if (desktopTestIndex >= 0) {
    assert.equal(
      steps[desktopTestIndex].env?.GODGESTURE_API,
      undefined,
      `${jobName} frontend tests must not receive the production API origin`,
    );
  }
  for (const [index, step] of steps.entries()) {
    if (index === apiOriginIndex || index === desktopBuildIndex) continue;
    assert.equal(
      step.env?.GODGESTURE_API,
      undefined,
      `${jobName} step ${step.name ?? index} must not receive the production API origin`,
    );
  }
  const serialized = JSON.stringify(jobs[jobName]);
  assert.match(serialized, /secrets\.TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(serialized, /actions\/upload-artifact@v7/);
}
assert.match(JSON.stringify(jobs.assemble), /merge-multiple/);
const assemble = runText(jobs.assemble);
assert.match(assemble, /scripts\/desktop-release\.mjs/);
assert.match(assemble, /--commit "\$GITHUB_SHA"/);
const releaseAction = jobs.release.steps.find(
  (step) => step.uses === "softprops/action-gh-release@v3",
);
assert.ok(releaseAction, "Release job must publish through softprops/action-gh-release@v3");
assert.equal(releaseAction.with?.generate_release_notes, false);
assert.equal(jobs.release.permissions?.contents, "write");
assert.equal(jobs.release.permissions?.["pull-requests"], "read");
const releaseCheckout = jobs.release.steps.find(
  (step) => step.uses === "actions/checkout@v7",
);
assert.ok(releaseCheckout, "Release job must checkout the trusted release-notes generator");
assert.equal(releaseCheckout.with?.token, "${{ github.token }}");
assert.equal(releaseCheckout.with?.submodules, false);
assert.equal(releaseCheckout.with?.["fetch-depth"], 1);
const releaseCheckoutIndex = jobs.release.steps.findIndex(
  (step) => step.uses === "actions/checkout@v7",
);
const releaseArtifactDownloadIndex = jobs.release.steps.findIndex(
  (step) => step.uses === "actions/download-artifact@v8",
);
assert.ok(releaseCheckoutIndex < releaseArtifactDownloadIndex);
const releaseNotesStep = jobs.release.steps.find(
  (step) => step.name === "Generate release notes",
);
assert.ok(releaseNotesStep, "Release job must generate notes from commits and PRs");
assert.equal(releaseNotesStep.id, "release-notes");
assert.equal(
  releaseNotesStep.run,
  'node scripts/generate-release-notes.mjs --output "$GITHUB_OUTPUT"',
);
assert.equal(releaseNotesStep.env?.GITHUB_TOKEN, "${{ github.token }}");
assert.equal(releaseNotesStep.env?.GITHUB_REPOSITORY, "${{ github.repository }}");
assert.equal(releaseNotesStep.env?.GITHUB_REF_NAME, "${{ github.ref_name }}");
assert.ok(
  releaseArtifactDownloadIndex <
    jobs.release.steps.findIndex((step) => step.name === "Generate release notes"),
);
assert.match(JSON.stringify(jobs.release), /release-artifacts\/\*/);
assert.match(JSON.stringify(jobs.release), /fail_on_unmatched_files/);
assert.match(JSON.stringify(jobs.release), /contains\(github\.ref_name, '-'/);
assert.match(JSON.stringify(jobs.release), /prerelease/);
assert.match(JSON.stringify(jobs.release), /make_latest/);
const releaseBody = releaseAction.with?.body ?? "";
assert.match(releaseBody, /Authenticode signed/);
assert.match(releaseBody, /ad-hoc signed/);
assert.match(releaseBody, /Accessibility and Input Monitoring/);
assert.match(releaseBody, /SHA-256 checksum/);
assert.match(releaseBody, /Installation and first-use instructions/);
assert.match(releaseBody, /docs\/USER_GUIDE\.md/);
assert.match(releaseBody, /steps\.release-notes\.outputs\.body/);
assert.doesNotMatch(JSON.stringify(jobs.release), /Resolve previous release tag/);

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
console.log(
  `Validated signed desktop release workflow for GodGesture ${version} (${Object.values(names).join(", ")})`,
);

function runText(job) {
  return job.steps
    .map((step) => (typeof step.run === "string" ? step.run : ""))
    .join("\n");
}

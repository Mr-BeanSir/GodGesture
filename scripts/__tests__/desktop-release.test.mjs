import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assembleDesktopRelease,
  PRODUCTION_REPOSITORY,
  readProjectVersion,
  releaseArtifactNames,
  releaseMode,
} from "../desktop-release.mjs";

const VERSION = "1.2.3";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SIGNATURE = Buffer.from(
  "untrusted comment: signature from minisign secret key\n" +
    "RUTESTSIGNATUREPAYLOAD\n" +
    "trusted comment: timestamp:1785250800\n" +
    "RUTESTTRUSTEDSIGNATUREPAYLOAD\n",
).toString("base64");

test("project version is aligned across Tauri, Desktop, and Rust", async () => {
  assert.equal(await readProjectVersion(), "0.1.0");
});

test("derives manual, prerelease, and stable release modes", () => {
  assert.equal(releaseMode("branch", "main", VERSION), "manual");
  assert.equal(
    releaseMode("tag", "v1.2.3-rc.1", "1.2.3-rc.1"),
    "prerelease",
  );
  assert.equal(releaseMode("tag", "v1.2.3", VERSION), "stable");
  assert.throws(
    () => releaseMode("tag", "v1.2.4", VERSION),
    /does not match/,
  );
});

test("assembles a deterministic two-platform updater manifest", async () => {
  const first = await fixture();
  const second = await fixture();
  const firstManifest = await assembleDesktopRelease({
    inputDirectory: first.input,
    outputDirectory: first.output,
    repository: PRODUCTION_REPOSITORY,
    commit: COMMIT,
    version: VERSION,
    refType: "tag",
    refName: `v${VERSION}`,
  });
  await assembleDesktopRelease({
    inputDirectory: second.input,
    outputDirectory: second.output,
    repository: PRODUCTION_REPOSITORY,
    commit: COMMIT,
    version: VERSION,
    refType: "tag",
    refName: `v${VERSION}`,
  });

  assert.deepEqual(Object.keys(firstManifest.platforms), [
    "darwin-universal",
    "windows-x86_64",
  ]);
  assert.equal(firstManifest.platforms["darwin-universal"].signature, SIGNATURE);
  assert.match(
    firstManifest.platforms["windows-x86_64"].url,
    /releases\/download\/v1\.2\.3\/GodGesture_1\.2\.3_x64-setup\.exe$/,
  );
  assert.equal(
    await readFile(join(first.output, "latest.json"), "utf8"),
    await readFile(join(second.output, "latest.json"), "utf8"),
  );
  const evidence = JSON.parse(
    await readFile(join(first.output, "release-evidence.json"), "utf8"),
  );
  assert.equal(evidence.repository, PRODUCTION_REPOSITORY);
  assert.equal(evidence.commit, COMMIT);
  assert.equal(evidence.releaseMode, "stable");
  assert.deepEqual(evidence.targets, ["darwin-universal", "windows-x86_64"]);
  assert.equal(Object.keys(evidence.sha256).length, 3);
  assert.equal(
    await readFile(join(first.output, "release-evidence.json"), "utf8"),
    await readFile(join(second.output, "release-evidence.json"), "utf8"),
  );
  assert.deepEqual(
    (await readdir(first.output)).sort(),
    (await readdir(second.output)).sort(),
  );
});

test("rejects checksum drift before writing a manifest", async () => {
  const value = await fixture();
  const names = releaseArtifactNames(VERSION);
  await writeFile(join(value.input, names.windowsInstaller), "tampered");
  await assert.rejects(
    assembleDesktopRelease({
      inputDirectory: value.input,
      outputDirectory: value.output,
      repository: PRODUCTION_REPOSITORY,
      commit: COMMIT,
      version: VERSION,
    }),
    /Checksum mismatch/,
  );
});

test("rejects missing, extra, malformed, and mistagged release inputs", async (context) => {
  await context.test("missing artifact", async () => {
    const value = await fixture({ omit: "macSignature" });
    await assert.rejects(assemble(value), /Release artifact drift/);
  });
  await context.test("extra artifact", async () => {
    const value = await fixture();
    await writeFile(join(value.input, "unexpected.txt"), "unexpected");
    await assert.rejects(assemble(value), /Release artifact drift/);
  });
  await context.test("invalid signature", async () => {
    const value = await fixture({ signature: "not-base64" });
    await assert.rejects(assemble(value), /valid base64 payload/);
  });
  await context.test("mismatched tag", async () => {
    const value = await fixture();
    await assert.rejects(
      assembleDesktopRelease({
        ...value,
        inputDirectory: value.input,
        outputDirectory: value.output,
        repository: PRODUCTION_REPOSITORY,
        commit: COMMIT,
        version: VERSION,
        refType: "tag",
        refName: "v9.9.9",
      }),
      /does not match/,
    );
  });
  await context.test("missing commit", async () => {
    const value = await fixture();
    await assert.rejects(
      assembleDesktopRelease({
        ...value,
        inputDirectory: value.input,
        outputDirectory: value.output,
        repository: PRODUCTION_REPOSITORY,
        version: VERSION,
      }),
      /Invalid release commit/,
    );
  });
});

async function assemble(value) {
  return assembleDesktopRelease({
    inputDirectory: value.input,
    outputDirectory: value.output,
    repository: PRODUCTION_REPOSITORY,
    commit: COMMIT,
    version: VERSION,
  });
}

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "godgesture-release-test-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  const names = releaseArtifactNames(VERSION);
  const artifacts = [names.windowsInstaller, names.macUpdater, names.macDmg];
  for (const name of artifacts) {
    const contents = `artifact:${name}`;
    await writeFile(join(input, name), contents);
    const checksum = createHash("sha256").update(contents).digest("hex");
    await writeFile(join(input, `${name}.sha256`), `${checksum}  ${name}\n`);
  }
  if (options.omit !== "windowsSignature") {
    await writeFile(join(input, names.windowsSignature), options.signature ?? SIGNATURE);
  }
  if (options.omit !== "macSignature") {
    await writeFile(join(input, names.macSignature), options.signature ?? SIGNATURE);
  }
  return { input, output };
}

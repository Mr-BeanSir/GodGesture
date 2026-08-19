import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = join(ROOT, "apps", "desktop", "src-tauri", "resources", "node-toolchain");
const NODE_VERSION = "24.18.1";
const PNPM_VERSION = "10.34.5";
const PNPM_SHA512 = "pO4F8vc2WCVb1qiYWcBlpFwopX2u+uLIk6Fo7itzFow3uR6D5X6mdlStA/AwMXRkMOi84442LgQmBfuKvIAZLg==";

const NODE_ARTIFACTS = {
  "windows-x64": {
    archive: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: "ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765",
    executable: "node.exe",
    npmCli: "node_modules/npm/bin/npm-cli.js",
    archiveType: "zip",
  },
  "macos-x64": {
    archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "6fb20fceacbb157c2f95825b80df4a454a0f6d81cdcd7bb81eeae9147e0e76ec",
    executable: "bin/node",
    npmCli: "lib/node_modules/npm/bin/npm-cli.js",
    archiveType: "tar.gz",
  },
  "macos-arm64": {
    archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "eb02f7fab96d3d67de40c5ec8566096fcb4c2026728787683ae5a97eb612b941",
    executable: "bin/node",
    npmCli: "lib/node_modules/npm/bin/npm-cli.js",
    archiveType: "tar.gz",
  },
};

function targetNames(value) {
  if (value === "universal-apple-darwin") return ["macos-x64", "macos-arm64"];
  if (value && value in NODE_ARTIFACTS) return [value];
  if (value) throw new Error(`Unsupported Node toolchain target: ${value}`);
  if (process.platform === "win32" && process.arch === "x64") return ["windows-x64"];
  if (process.platform === "darwin" && process.arch === "x64") return ["macos-x64"];
  if (process.platform === "darwin" && process.arch === "arm64") return ["macos-arm64"];
  throw new Error(`Unsupported Node toolchain target: ${process.platform}/${process.arch}`);
}

async function download(url, destination, algorithm = "sha256") {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const output = createWriteStream(destination, { flags: "wx" });
  const hash = createHash(algorithm);
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!output.write(value)) await new Promise((resolvePromise) => output.once("drain", resolvePromise));
    }
  } finally {
    output.end();
    await new Promise((resolvePromise, reject) => {
      output.once("close", resolvePromise);
      output.once("error", reject);
    });
  }
  return algorithm === "sha512" ? hash.digest("base64") : hash.digest("hex");
}

async function extractArchive(archive, type, destination) {
  await mkdir(destination, { recursive: true });
  if (type === "zip") {
    const env = {
      ...process.env,
      GODGESTURE_TOOLCHAIN_ARCHIVE: archive,
      GODGESTURE_TOOLCHAIN_DESTINATION: destination,
    };
    await execFileAsync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:GODGESTURE_TOOLCHAIN_ARCHIVE -DestinationPath $env:GODGESTURE_TOOLCHAIN_DESTINATION -Force",
    ], { env });
  } else {
    await execFileAsync("tar", ["-xzf", archive, "-C", destination]);
  }
}

async function findFile(root, relativePath) {
  const direct = join(root, relativePath);
  try {
    await readFile(direct);
    return direct;
  } catch {}
  const [first] = await readdir(root, { withFileTypes: true });
  if (first?.isDirectory()) {
    const nested = join(root, first.name, relativePath);
    try {
      await readFile(nested);
      return nested;
    } catch {}
  }
  throw new Error(`Archive did not contain '${relativePath}'`);
}

async function installNode(target, tempRoot) {
  const artifact = NODE_ARTIFACTS[target];
  const archive = join(tempRoot, artifact.archive);
  const actual = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${artifact.archive}`, archive);
  if (actual !== artifact.sha256) throw new Error(`Node SHA-256 mismatch for ${artifact.archive}`);
  const extracted = join(tempRoot, `${target}-node`);
  await extractArchive(archive, artifact.archiveType, extracted);
  const source = await findFile(extracted, artifact.executable);
  const output = join(OUTPUT_ROOT, target);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(source, join(output, target.startsWith("windows") ? "node.exe" : "node"));
  await copyBundledNpm(extracted, artifact.npmCli, output);
  if (!target.startsWith("windows")) await execFileAsync("chmod", ["755", join(output, "node")]);
}

async function copyBundledNpm(extracted, npmCliPath, output) {
  const cli = await findFile(extracted, npmCliPath);
  const packageRoot = dirname(dirname(cli));
  await cp(packageRoot, join(output, "npm"), { recursive: true, dereference: true });
}

async function installPnpm(target, tempRoot) {
  const archive = await ensurePnpmArchive(tempRoot);
  const extracted = join(tempRoot, `${target}-pnpm`);
  await extractArchive(archive, "tar.gz", extracted);
  const source = join(extracted, "package");
  await cp(source, join(OUTPUT_ROOT, target, "pnpm"), { recursive: true });
}

async function ensurePnpmArchive(tempRoot, downloadFile = download) {
  const archive = join(tempRoot, `pnpm-${PNPM_VERSION}.tgz`);
  try {
    await access(archive);
    return archive;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const actual = await downloadFile(
    `https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz`,
    archive,
    "sha512",
  );
  if (actual !== PNPM_SHA512) throw new Error(`pnpm SHA-512 integrity mismatch for ${archive}`);
  return archive;
}

async function copySupervisor(target) {
  const output = join(OUTPUT_ROOT, target);
  await cp(join(ROOT, "apps", "desktop", "node-host", "supervisor.mjs"), join(output, "supervisor.mjs"));
  await cp(join(ROOT, "apps", "desktop", "node-host", "worker.mjs"), join(output, "worker.mjs"));
}

async function copyTypeScript(target) {
  const output = join(OUTPUT_ROOT, target);
  const sourceRoot = join(ROOT, "apps", "desktop", "node_modules");
  for (const [source, destination] of [
    [join(sourceRoot, "typescript"), join(output, "typescript")],
    [join(sourceRoot, "@types", "node"), join(output, "node_modules", "@types", "node")],
    [join(sourceRoot, "undici-types"), join(output, "node_modules", "undici-types")],
  ]) {
    // pnpm exposes workspace dependencies as junctions on Windows. Resolve them
    // before copying so a release resource contains real files, not new symlinks.
    await cp(await realpath(source), destination, { recursive: true });
  }
}

async function main() {
  const requested = process.argv.find((value) => value.startsWith("--target="))?.slice("--target=".length);
  const targets = targetNames(requested);
  const tempRoot = await mkdtemp(join(homedir() || tmpdir(), "godgesture-node-toolchain-"));
  try {
    for (const target of targets) {
      await installNode(target, tempRoot);
      await installPnpm(target, tempRoot);
      await copySupervisor(target);
      await copyTypeScript(target);
    }
    await writeFile(
      join(OUTPUT_ROOT, "manifest.json"),
      `${JSON.stringify({ nodeVersion: NODE_VERSION, pnpmVersion: PNPM_VERSION, targets }, null, 2)}\n`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export {
  NODE_ARTIFACTS,
  PNPM_SHA512,
  PNPM_VERSION,
  NODE_VERSION,
  copyBundledNpm,
  ensurePnpmArchive,
  extractArchive,
  targetNames,
};

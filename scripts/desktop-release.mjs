import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function releaseArtifactNames(version) {
  if (!SEMVER.test(version)) throw new Error(`Invalid release version: ${version}`);
  const windowsInstaller = `GodGesture_${version}_x64-setup.exe`;
  const macUpdater = `GodGesture_${version}_universal.app.tar.gz`;
  const macDmg = `GodGesture_${version}_universal.dmg`;
  return {
    windowsInstaller,
    windowsSignature: `${windowsInstaller}.sig`,
    windowsChecksum: `${windowsInstaller}.sha256`,
    macUpdater,
    macSignature: `${macUpdater}.sig`,
    macUpdaterChecksum: `${macUpdater}.sha256`,
    macDmg,
    macDmgChecksum: `${macDmg}.sha256`,
  };
}

export async function readProjectVersion(root = projectRoot) {
  const [tauriConfig, desktopPackage] = await Promise.all([
    readJson(join(root, "apps/desktop/src-tauri/tauri.conf.json")),
    readJson(join(root, "apps/desktop/package.json")),
  ]);
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--no-deps",
        "--format-version",
        "1",
        "--manifest-path",
        join(root, "apps/desktop/src-tauri/Cargo.toml"),
      ],
      { encoding: "utf8" },
    ),
  );
  const rustPackage = metadata.packages.find(
    (value) => value.name === "godgesture",
  );
  if (!rustPackage) throw new Error("Cargo metadata does not contain godgesture");

  const versions = {
    tauri: tauriConfig.version,
    desktop: desktopPackage.version,
    rust: rustPackage.version,
  };
  if (!Object.values(versions).every((value) => typeof value === "string")) {
    throw new Error("Application version fields must be strings");
  }
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1) {
    throw new Error(`Application version mismatch: ${JSON.stringify(versions)}`);
  }
  const [version] = distinct;
  if (!SEMVER.test(version)) throw new Error(`Invalid application version: ${version}`);
  return version;
}

export async function assembleDesktopRelease({
  inputDirectory,
  outputDirectory,
  repository,
  version,
  refType = "branch",
  refName = "",
}) {
  if (!REPOSITORY.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  if (refType === "tag" && refName !== `v${version}`) {
    throw new Error(`Tag ${refName} does not match application version ${version}`);
  }
  if (refType !== "tag" && refType !== "branch") {
    throw new Error(`Unsupported Git ref type: ${refType}`);
  }

  const names = releaseArtifactNames(version);
  const expected = Object.values(names).sort();
  const actual = (await readdir(inputDirectory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release artifact drift: expected ${expected.join(", ")}; found ${actual.join(", ")}`,
    );
  }
  for (const fileName of expected) {
    if (!(await stat(join(inputDirectory, fileName))).isFile()) {
      throw new Error(`Release artifact is not a file: ${fileName}`);
    }
  }

  await Promise.all([
    verifyChecksum(inputDirectory, names.windowsInstaller, names.windowsChecksum),
    verifyChecksum(inputDirectory, names.macUpdater, names.macUpdaterChecksum),
    verifyChecksum(inputDirectory, names.macDmg, names.macDmgChecksum),
  ]);
  const [windowsSignature, macSignature] = await Promise.all([
    readUpdaterSignature(join(inputDirectory, names.windowsSignature)),
    readUpdaterSignature(join(inputDirectory, names.macSignature)),
  ]);

  await mkdir(outputDirectory, { recursive: true });
  const existing = await readdir(outputDirectory);
  if (existing.length > 0) {
    throw new Error(`Release output directory is not empty: ${outputDirectory}`);
  }
  await Promise.all(
    expected.map((fileName) =>
      copyFile(join(inputDirectory, fileName), join(outputDirectory, fileName)),
    ),
  );

  const releaseBase = `https://github.com/${repository}/releases/download/v${version}`;
  const manifest = {
    version,
    notes: "See the GitHub Release for release notes.",
    platforms: {
      "darwin-universal": {
        signature: macSignature,
        url: `${releaseBase}/${names.macUpdater}`,
      },
      "windows-x86_64": {
        signature: windowsSignature,
        url: `${releaseBase}/${names.windowsInstaller}`,
      },
    },
  };
  await writeFile(
    join(outputDirectory, "latest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function verifyChecksum(directory, artifactName, checksumName) {
  const text = await readFile(join(directory, checksumName), "utf8");
  const match = /^([a-fA-F0-9]{64}) {2}([^\r\n]+)\r?\n?$/.exec(text);
  if (!match || match[2] !== artifactName) {
    throw new Error(`Invalid checksum file: ${checksumName}`);
  }
  const actual = await sha256(join(directory, artifactName));
  if (match[1].toLowerCase() !== actual) {
    throw new Error(`Checksum mismatch for ${artifactName}`);
  }
}

async function readUpdaterSignature(path) {
  const signature = (await readFile(path, "utf8")).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length < 100) {
    throw new Error(`Updater signature is not a valid base64 payload: ${path}`);
  }
  const decoded = Buffer.from(signature, "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:")) {
    throw new Error(`Updater signature is not a minisign signature: ${path}`);
  }
  return signature;
}

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid command argument near ${key ?? "end of input"}`);
    }
    result.set(key.slice(2), value);
  }
  for (const required of ["input", "output", "repository", "ref-type", "ref-name"]) {
    if (!result.has(required)) throw new Error(`Missing --${required}`);
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const version = await readProjectVersion();
  const manifest = await assembleDesktopRelease({
    inputDirectory: resolve(argumentsMap.get("input")),
    outputDirectory: resolve(argumentsMap.get("output")),
    repository: argumentsMap.get("repository"),
    version,
    refType: argumentsMap.get("ref-type"),
    refName: argumentsMap.get("ref-name"),
  });
  console.log(
    `Assembled GodGesture ${manifest.version} for ${Object.keys(manifest.platforms).join(", ")}`,
  );
}

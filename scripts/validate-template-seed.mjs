import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseGestureTemplateCatalog,
  parseGestureTemplatePackage,
  verifyGestureTemplatePackage,
} from "../packages/shared/dist/index.js";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../distribution/gesture-templates",
);
const packagesDirectory = join(root, "packages");
const catalog = parseGestureTemplateCatalog(
  await readFile(join(root, "catalog.json"), "utf8"),
);
const referencedFiles = new Set();

for (const entry of catalog.entries) {
  const fileName = basename(new URL(entry.packageUrl).pathname);
  if (!fileName.endsWith(".json") || fileName !== `${entry.slug}.json`) {
    throw new Error(
      `Catalog entry ${entry.slug}@${entry.version} has an unexpected package filename`,
    );
  }
  if (referencedFiles.has(fileName)) {
    throw new Error(`Package file ${fileName} is referenced more than once`);
  }
  referencedFiles.add(fileName);
  const templatePackage = parseGestureTemplatePackage(
    await readFile(join(packagesDirectory, fileName), "utf8"),
  );
  verifyGestureTemplatePackage(entry, templatePackage);
}

const sourceFiles = (await readdir(packagesDirectory))
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();
const expectedFiles = [...referencedFiles].sort();
if (JSON.stringify(sourceFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `Catalog/package file drift: expected ${expectedFiles.join(", ")}; found ${sourceFiles.join(", ")}`,
  );
}

console.log(
  `Validated ${catalog.entries.length} gesture templates (${expectedFiles.join(", ")})`,
);

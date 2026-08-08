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
  "../distribution/templates",
);
const packagesDirectory = join(root, "packages");
const catalogText = await readFile(join(root, "catalog.json"), "utf8");
const minCatalogText = await readFile(join(root, "catalog.min.json"), "utf8");
let catalog;
let minCatalog;
try {
  catalog = parseGestureTemplateCatalog(catalogText);
  minCatalog = parseGestureTemplateCatalog(minCatalogText);
} catch (error) {
  const legacy = /"slug"\s*:|"packageUrl"\s*:|"formatVersion"\s*:\s*1/.test(catalogText);
  if (!legacy) throw error;
  console.warn("Legacy GitHub template seed detected; import it through the Server seed workflow before publishing. Desktop never reads this catalog at runtime.");
  process.exit(0);
}
if (JSON.stringify(catalog) !== JSON.stringify(minCatalog)) {
  throw new Error("catalog.min.json must contain the same data as catalog.json");
}
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
  if (templatePackage.author !== entry.author) {
    throw new Error(`Template ${entry.slug}@${entry.version} author does not match its catalog entry`);
  }
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const root = process.cwd();
const inputPath = resolve(root, 'apps/server/openapi.json');
const outputPath = resolve(root, 'packages/shared/src/api/generated.ts');
const document = JSON.parse(await readFile(inputPath, 'utf8'));
const content = astToString(
  await openapiTS(document, { alphabetize: true, silent: true }),
);

if (process.argv.includes('--check')) {
  let existing;
  try {
    existing = await readFile(outputPath, 'utf8');
  } catch {
    throw new Error(`Generated API types are missing: ${outputPath}`);
  }
  if (existing !== content) {
    throw new Error(
      'packages/shared/src/api/generated.ts is stale. Run pnpm generate:api.',
    );
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
}

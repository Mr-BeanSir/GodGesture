import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOpenApiDocument } from './document';

async function main(): Promise<void> {
  const outputPath = resolve(process.cwd(), 'openapi.json');
  const content = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;

  if (process.argv.includes('--check')) {
    let existing: string;
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch {
      throw new Error(`Generated OpenAPI document is missing: ${outputPath}`);
    }
    if (existing !== content) {
      throw new Error(
        'apps/server/openapi.json is stale. Run pnpm generate:api.',
      );
    }
    return;
  }

  await writeFile(outputPath, content, 'utf8');
}

void main();

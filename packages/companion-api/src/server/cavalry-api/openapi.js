import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function readCavalryOpenApiSpec() {
  const specPath = resolve(__dirname, '../../../openapi/cavalry-gpt-actions.openapi.yaml');
  return readFile(specPath, 'utf8');
}

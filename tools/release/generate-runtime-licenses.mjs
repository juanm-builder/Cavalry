import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const runtimeLicenseOutputPath = resolve(
  workspaceRoot,
  'apps/desktop/packaging/RUNTIME-DEPENDENCY-INVENTORY.txt'
);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageNameFromLockPath(lockPath, metadata) {
  if (metadata && metadata.name) return String(metadata.name);
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index >= 0 ? lockPath.slice(index + marker.length) : lockPath;
}

export function collectRuntimeLicenseEntries(root = workspaceRoot) {
  const lockfile = readJson(resolve(root, 'package-lock.json'));
  return Object.entries(lockfile.packages || {})
    .filter(([lockPath, metadata]) => {
      return (
        lockPath.includes('node_modules/') &&
        metadata &&
        metadata.link !== true &&
        metadata.dev !== true
      );
    })
    .map(([lockPath, metadata]) => ({
      name: packageNameFromLockPath(lockPath, metadata),
      version: String(metadata.version || 'unknown'),
      license: String(metadata.license || 'SEE PACKAGE'),
      lockPath
    }))
    .sort((left, right) =>
      `${left.name}@${left.version}:${left.lockPath}`.localeCompare(
        `${right.name}@${right.version}:${right.lockPath}`
      )
    );
}

function inventoryDigest(entries) {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export function renderRuntimeLicenseInventory(entries) {
  const rows = entries.map(
    (entry) => `${entry.name}\t${entry.version}\t${entry.license}\t${entry.lockPath}`
  );
  return [
    'CAVALRY RUNTIME DEPENDENCY INVENTORY',
    '',
    'Generated from package-lock.json by tools/release/generate-runtime-licenses.mjs.',
    'Full license notices and project-level attributions are in THIRD_PARTY_NOTICES.md.',
    '',
    `PACKAGE COUNT: ${entries.length}`,
    `INVENTORY SHA-256: ${inventoryDigest(entries)}`,
    '',
    'PACKAGE\tVERSION\tDECLARED LICENSE\tLOCK PATH',
    ...rows,
    ''
  ].join('\n');
}

export function buildRuntimeLicenseBundle(root = workspaceRoot) {
  const entries = collectRuntimeLicenseEntries(root);
  return { entries, contents: renderRuntimeLicenseInventory(entries) };
}

function run() {
  const check = process.argv.includes('--check');
  const { entries, contents } = buildRuntimeLicenseBundle();
  if (check) {
    if (!existsSync(runtimeLicenseOutputPath)) {
      throw new Error('Runtime dependency inventory is missing; run npm run licenses:runtime.');
    }
    if (readFileSync(runtimeLicenseOutputPath, 'utf8') !== contents) {
      throw new Error('Runtime dependency inventory is stale; run npm run licenses:runtime.');
    }
    process.stdout.write(`Runtime dependency inventory covers ${entries.length} packages.\n`);
    return;
  }
  mkdirSync(dirname(runtimeLicenseOutputPath), { recursive: true });
  writeFileSync(runtimeLicenseOutputPath, contents, 'utf8');
  process.stdout.write(`Generated runtime dependency inventory for ${entries.length} packages.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run();
  } catch (error) {
    console.error(`Runtime dependency inventory failed: ${error.message}`);
    process.exitCode = 1;
  }
}

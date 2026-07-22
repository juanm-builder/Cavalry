import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

export const COMPANION_PACKAGE_ROOT = resolve(scriptsDirectory, '..');
export const REPOSITORY_ROOT = resolve(COMPANION_PACKAGE_ROOT, '../..');

export function packagePath(...parts) {
  return resolve(COMPANION_PACKAGE_ROOT, ...parts);
}

export function repoPath(...parts) {
  return resolve(REPOSITORY_ROOT, ...parts);
}

export function resolvePackageInput(value, fallback) {
  const input = String(value || fallback || '').trim();
  return isAbsolute(input) ? input : packagePath(input);
}

export function repoRelativePath(value) {
  return relative(REPOSITORY_ROOT, value).split(sep).join('/');
}

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const bundleRoot = path.resolve(process.argv[2] || '');
const platform = String(process.argv[3] || '');
const version = String(process.argv[4] || '');
const outputDirectory = path.resolve(process.argv[5] || 'release-assets');
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  throw new Error(`Tauri artifact staging failed: ${message}`);
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function uniqueFile(files, predicate, description) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    fail(`expected one ${description}, found ${matches.length}.`);
  }
  if (statSync(matches[0]).size === 0) fail(`${description} is empty.`);
  return matches[0];
}

function copy(source, destinationName) {
  const destination = path.join(outputDirectory, destinationName);
  copyFileSync(source, destination);
  if (statSync(destination).size === 0) fail(`staged asset is empty: ${destinationName}.`);
  process.stdout.write(`Staged ${destinationName}\n`);
  return destination;
}

if (!stableVersion.test(version)) fail(`invalid release version: ${version || '(missing)'}.`);
if (!existsSync(bundleRoot)) fail(`bundle directory does not exist: ${bundleRoot}.`);
mkdirSync(outputDirectory, { recursive: true });
const files = walk(bundleRoot);

if (platform === 'darwin-aarch64' || platform === 'darwin-x86_64') {
  const archive = uniqueFile(
    files,
    (file) => file.endsWith('.app.tar.gz'),
    'macOS updater archive'
  );
  const signature = uniqueFile(
    files,
    (file) => file === `${archive}.sig`,
    'macOS updater signature'
  );
  const dmg = uniqueFile(files, (file) => file.endsWith('.dmg'), 'macOS DMG');
  const architecture = platform === 'darwin-aarch64' ? 'aarch64' : 'x86_64';
  const updateName = `Cavalry-for-Mac-${version}-${architecture}.app.tar.gz`;
  copy(archive, updateName);
  copy(signature, `${updateName}.sig`);
  copy(dmg, `Cavalry-for-Mac-${version}-${architecture}.dmg`);
} else {
  fail(`unsupported release platform: ${platform || '(missing)'}.`);
}

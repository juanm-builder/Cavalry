import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const runtimeLicenseOutputPath = resolve(
  workspaceRoot,
  'apps/mac/packaging/RUNTIME-DEPENDENCY-LICENSES.txt'
);

const maximumLicenseFileBytes = 2 * 1024 * 1024;
const legalFilePattern =
  /^(?:licen[cs]es?|copying|notice|copyright(?:[-_. ]?notice)?|authors?|third[-_. ]party(?:[-_. ]notices?)?)(?:$|[._ -])/i;
const legalDirectoryPattern = /^(?:licenses?|licences?|legal|notices?)$/i;

const exactLicenseOverrides = new Map([
  [
    'lazy-val@1.0.5|sha512-0/BnGCCfyUMkBpeDgWihanIAF9JmZhHBgUhEqzvf+adhNGLoP6TaiI5oF8oyb3I45P+PcnrqihSf01M0l0G5+Q==',
    {
      name: 'LICENSE (package-metadata MIT fallback)',
      text: `MIT License

Copyright (c) 2017 Vladimir Krivosheev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
    }
  ]
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(path) {
  return path.split(sep).join('/');
}

function repositoryUrl(manifest) {
  const repository =
    typeof manifest.repository === 'string'
      ? manifest.repository
      : manifest.repository && typeof manifest.repository.url === 'string'
        ? manifest.repository.url
        : '';
  if (!repository) return typeof manifest.homepage === 'string' ? manifest.homepage : '';
  if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return `https://github.com/${repository}`;
  return repository.replace(/^git\+/, '');
}

function isPathInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function legalFileCandidates(packageDirectory) {
  const candidates = [];
  const entries = readdirSync(packageDirectory, { withFileTypes: true }).sort((left, right) =>
    compareStrings(left.name.toLowerCase(), right.name.toLowerCase())
  );
  for (const entry of entries) {
    if (legalFilePattern.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())) {
      candidates.push({ name: entry.name, path: resolve(packageDirectory, entry.name) });
      continue;
    }
    if (!entry.isDirectory() || !legalDirectoryPattern.test(entry.name)) continue;
    const directory = resolve(packageDirectory, entry.name);
    for (const child of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareStrings(left.name.toLowerCase(), right.name.toLowerCase())
    )) {
      if (!legalFilePattern.test(child.name) || !(child.isFile() || child.isSymbolicLink())) {
        continue;
      }
      candidates.push({
        name: `${entry.name}/${child.name}`,
        path: resolve(directory, child.name)
      });
    }
  }
  return candidates;
}

function readLegalDocuments(packageDirectory, packageId, overrideKey, usedOverrides) {
  const documents = [];

  for (const candidate of legalFileCandidates(packageDirectory)) {
    const candidatePath = candidate.path;
    const linkInfo = lstatSync(candidatePath);
    if (!(linkInfo.isFile() || linkInfo.isSymbolicLink())) continue;
    const resolvedPath = realpathSync(candidatePath);
    if (!isPathInside(realpathSync(packageDirectory), resolvedPath)) {
      throw new Error(
        `${packageId} has a legal-file symlink outside its package: ${candidate.name}`
      );
    }
    const size = lstatSync(resolvedPath).size;
    if (size > maximumLicenseFileBytes) {
      throw new Error(`${packageId} legal file is unexpectedly large: ${candidate.name}`);
    }
    const contents = readFileSync(resolvedPath, 'utf8');
    if (contents.includes('\0')) {
      throw new Error(`${packageId} legal file is not plain text: ${candidate.name}`);
    }
    const text = normalizeText(contents);
    if (!text) throw new Error(`${packageId} legal file is empty: ${candidate.name}`);
    documents.push({ name: candidate.name, text, source: 'package' });
  }

  if (documents.length) return documents;
  const override = exactLicenseOverrides.get(overrideKey);
  if (!override) {
    throw new Error(
      `${packageId} does not ship a reviewed license/notice file and has no approved fallback`
    );
  }
  usedOverrides.add(overrideKey);
  return [{ ...override, text: normalizeText(override.text), source: 'reviewed-fallback' }];
}

function dependencyEdges(metadata) {
  const edges = new Map();
  for (const name of Object.keys(metadata.dependencies || {})) {
    edges.set(name, { name, optional: false });
  }
  for (const name of Object.keys(metadata.optionalDependencies || {})) {
    if (!edges.has(name)) edges.set(name, { name, optional: true });
  }
  for (const name of Object.keys(metadata.peerDependencies || {})) {
    if (edges.has(name)) continue;
    const optional = metadata.peerDependenciesMeta?.[name]?.optional === true;
    edges.set(name, { name, optional });
  }
  return [...edges.values()].sort((left, right) => compareStrings(left.name, right.name));
}

function resolveDependencyLockPath(lockfile, root, fromLockPath, dependencyName) {
  let directory = resolve(root, fromLockPath);
  const dependencySegments = dependencyName.split('/');
  while (isPathInside(root, directory)) {
    const candidate = normalizePath(
      relative(root, resolve(directory, 'node_modules', ...dependencySegments))
    );
    if (lockfile.packages[candidate]) return candidate;
    if (directory === root) break;
    directory = dirname(directory);
  }
  return '';
}

function dereferenceLockPath(lockfile, lockPath) {
  const metadata = lockfile.packages[lockPath];
  if (!metadata?.link) return lockPath;
  const target = normalizePath(metadata.resolved || '');
  if (!target || !lockfile.packages[target]) {
    throw new Error(`Workspace link ${lockPath} has no valid lockfile target`);
  }
  return target;
}

function runtimeLockEntries(lockfile, root) {
  if (lockfile.lockfileVersion !== 3) {
    throw new Error('Runtime license generation requires package-lock.json lockfileVersion 3');
  }
  if (!lockfile.packages?.['apps/mac']) {
    throw new Error('package-lock.json does not contain the apps/mac workspace');
  }

  const pending = ['apps/mac'];
  const visited = new Set();
  const runtimeEntries = [];
  while (pending.length) {
    const requestedPath = pending.shift();
    const lockPath = dereferenceLockPath(lockfile, requestedPath);
    if (visited.has(lockPath)) continue;
    visited.add(lockPath);
    const metadata = lockfile.packages[lockPath];
    if (!metadata) throw new Error(`Missing lockfile metadata for ${lockPath}`);

    if (lockPath.startsWith('node_modules/')) {
      if (metadata.dev === true) {
        throw new Error(`Production dependency traversal reached dev-only package ${lockPath}`);
      }
      runtimeEntries.push([lockPath, metadata]);
    }

    for (const edge of dependencyEdges(metadata)) {
      const resolvedPath = resolveDependencyLockPath(lockfile, root, lockPath, edge.name);
      if (!resolvedPath) {
        if (edge.optional) continue;
        throw new Error(`Unable to resolve runtime dependency ${edge.name} from ${lockPath}`);
      }
      const targetPath = dereferenceLockPath(lockfile, resolvedPath);
      const manifestPath = resolve(root, targetPath, 'package.json');
      if (!existsSync(manifestPath)) {
        if (edge.optional) continue;
        throw new Error(`Installed runtime dependency is missing at ${targetPath}; run npm ci`);
      }
      pending.push(targetPath);
    }
  }
  return runtimeEntries.sort(([left], [right]) => compareStrings(left, right));
}

function documentSignature(documents) {
  return documents.map(({ name, source, text }) => ({
    name,
    source,
    sha256: createHash('sha256').update(text).digest('hex')
  }));
}

export function collectRuntimeLicenseEntries(root = workspaceRoot) {
  const lockfile = readJson(resolve(root, 'package-lock.json'));
  const entries = [];
  const usedOverrides = new Set();

  for (const [lockPath, lockMetadata] of runtimeLockEntries(lockfile, root)) {
    const packageDirectory = resolve(root, lockPath);
    const manifestPath = resolve(packageDirectory, 'package.json');
    if (!existsSync(manifestPath)) {
      throw new Error(
        `Missing installed runtime package at ${normalizePath(lockPath)}; run npm ci`
      );
    }
    const manifest = readJson(manifestPath);
    const name = String(manifest.name || '').trim();
    const version = String(manifest.version || '').trim();
    if (!name || !version) throw new Error(`${lockPath} has incomplete package metadata`);
    if (version !== String(lockMetadata.version || '')) {
      throw new Error(`${lockPath} version differs between package-lock.json and package.json`);
    }

    const manifestLicense = String(manifest.license || '').trim();
    const lockLicense = String(lockMetadata.license || '').trim();
    if (!manifestLicense || !lockLicense) {
      throw new Error(
        `${name}@${version} does not declare a license in both package metadata files`
      );
    }
    if (manifestLicense !== lockLicense) {
      throw new Error(`${name}@${version} has conflicting package and lockfile licenses`);
    }

    const id = `${name}@${version}`;
    const integrity = String(lockMetadata.integrity || lockMetadata.resolved || '').trim();
    if (!integrity) throw new Error(`${id} has no lockfile integrity or resolved identity`);
    const overrideKey = `${id}|${integrity}`;
    const documents = readLegalDocuments(packageDirectory, id, overrideKey, usedOverrides);
    entries.push({
      id,
      name,
      version,
      license: manifestLicense,
      repository: repositoryUrl(manifest),
      integrity,
      lockPaths: [normalizePath(lockPath)],
      documents
    });
  }

  for (const key of exactLicenseOverrides.keys()) {
    if (!usedOverrides.has(key)) {
      throw new Error(`Reviewed license fallback is stale or unused: ${key}`);
    }
  }
  return entries.sort((left, right) => {
    return (
      compareStrings(left.id, right.id) ||
      compareStrings(left.integrity, right.integrity) ||
      compareStrings(left.lockPaths[0], right.lockPaths[0])
    );
  });
}

function inventoryDigest(entries) {
  const inventory = entries.map((entry) => ({
    id: entry.id,
    license: entry.license,
    repository: entry.repository,
    integrity: entry.integrity,
    lockPaths: entry.lockPaths,
    documents: documentSignature(entry.documents)
  }));
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

export function renderRuntimeLicenseBundle(entries) {
  const sections = entries.map((entry) => {
    const documents = entry.documents
      .map(
        (document) => `----- BEGIN ${document.name} -----
${document.text}
----- END ${document.name} -----`
      )
      .join('\n\n');
    return `================================================================================
PACKAGE: ${entry.id}
DECLARED LICENSE: ${entry.license}
SOURCE: ${entry.repository || '(not declared by package)'}
LOCK IDENTITY: ${entry.integrity}
LOCK PATHS: ${entry.lockPaths.join(', ')}
LEGAL FILES: ${entry.documents.map((document) => document.name).join(', ')}
================================================================================

${documents}`;
  });

  return `CAVALRY RUNTIME DEPENDENCY LICENSES

This file is generated deterministically by tools/release/generate-runtime-licenses.mjs.
Do not edit it by hand. It contains the license and notice text shipped by every
external npm package in the desktop app's production dependency closure.

Electron and Chromium notices are shipped as separate files. Cavalry project code
is covered by Cavalry-LICENSE.txt.

PACKAGE COUNT: ${entries.length}
INVENTORY SHA-256: ${inventoryDigest(entries)}

${sections.join('\n\n')}
`;
}

export function buildRuntimeLicenseBundle(root = workspaceRoot) {
  const entries = collectRuntimeLicenseEntries(root);
  return { entries, contents: renderRuntimeLicenseBundle(entries) };
}

function writeBundle(contents, outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  if (existsSync(outputPath) && readFileSync(outputPath, 'utf8') === contents) return false;
  writeFileSync(outputPath, contents, { encoding: 'utf8', mode: 0o644 });
  return true;
}

function run() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) {
    throw new Error('Usage: node tools/release/generate-runtime-licenses.mjs [--check]');
  }
  const check = args.includes('--check');
  const { entries, contents } = buildRuntimeLicenseBundle();

  if (check) {
    if (!existsSync(runtimeLicenseOutputPath)) {
      throw new Error('Runtime license bundle is missing; run npm run licenses:runtime');
    }
    if (readFileSync(runtimeLicenseOutputPath, 'utf8') !== contents) {
      throw new Error('Runtime license bundle is stale; run npm run licenses:runtime');
    }
    console.log(`Runtime license bundle covers ${entries.length} production npm packages.`);
    return;
  }

  const changed = writeBundle(contents, runtimeLicenseOutputPath);
  console.log(
    `${changed ? 'Generated' : 'Verified'} runtime license bundle for ${entries.length} production npm packages.`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    run();
  } catch (error) {
    console.error(`Runtime license generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

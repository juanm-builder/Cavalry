import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import {
  buildRuntimeLicenseBundle,
  runtimeLicenseOutputPath
} from '../../tools/release/generate-runtime-licenses.mjs';

const root = resolve('.');
const appRoot = resolve(root, 'apps/mac');
const builderConfigs = [
  'electron-builder.yml',
  'electron-builder.release.yml',
  'electron-builder.windows.yml'
];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

describe('runtime dependency license bundle', () => {
  it('covers every external non-dev package in the lockfile, including nested dependencies', () => {
    const lockfile = readJson('package-lock.json');
    const expectedLockPaths = Object.entries(lockfile.packages)
      .filter(([path, metadata]) => {
        return path.startsWith('node_modules/') && metadata.dev !== true && metadata.link !== true;
      })
      .map(([path]) => path)
      .sort();
    const { entries } = buildRuntimeLicenseBundle(root);
    const coveredLockPaths = entries.flatMap((entry) => entry.lockPaths).sort();
    const packageNames = new Set(entries.map((entry) => entry.name));

    expect(coveredLockPaths).toEqual(expectedLockPaths);
    for (const name of [
      '@supabase/auth-js',
      '@supabase/supabase-js',
      'builder-util-runtime',
      'electron-updater',
      'fs-extra',
      'js-yaml',
      'react',
      'react-dom'
    ]) {
      expect(packageNames.has(name), `${name} must be covered`).toBe(true);
    }
    expect(packageNames.has('electron-builder')).toBe(false);
    expect(packageNames.has('vitest')).toBe(false);
    entries.forEach((entry) => {
      expect(entry.license).toBeTruthy();
      expect(entry.documents.length).toBeGreaterThan(0);
      entry.documents.forEach((document) => {
        expect(document.text.length).toBeGreaterThan(100);
        expect(['package', 'reviewed-fallback']).toContain(document.source);
      });
    });
  });

  it('keeps the committed bundle deterministic and free of local paths', () => {
    const { entries, contents } = buildRuntimeLicenseBundle(root);
    const committed = readFileSync(runtimeLicenseOutputPath, 'utf8');
    const check = spawnSync(
      process.execPath,
      [resolve(root, 'tools/release/generate-runtime-licenses.mjs'), '--check'],
      { cwd: root, encoding: 'utf8' }
    );

    expect(committed).toBe(contents);
    expect(contents).toContain(`PACKAGE COUNT: ${entries.length}`);
    expect(contents).toContain('PACKAGE: builder-util-runtime@');
    expect(contents).toContain('PACKAGE: @supabase/supabase-js@');
    expect(contents).not.toContain(root);
    expect(contents).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\\\Users\\\\/);
    expect(check.status, check.stderr).toBe(0);
  });

  it('ships the generated bundle from every Electron builder configuration', () => {
    const expectedResource = {
      from: 'packaging/RUNTIME-DEPENDENCY-LICENSES.txt',
      to: 'licenses/RUNTIME-DEPENDENCY-LICENSES.txt'
    };
    for (const configName of builderConfigs) {
      const config = loadYaml(readFileSync(resolve(appRoot, configName), 'utf8'));
      expect(config.extraResources).toContainEqual(expectedResource);
    }

    const appManifest = readJson('apps/mac/package.json');
    const rootManifest = readJson('package.json');
    expect(rootManifest.scripts).toMatchObject({
      'package:mac': 'npm run dist:mac --workspace @cavalry/mac',
      'package:mac:intel': 'npm run dist:mac:intel --workspace @cavalry/mac',
      'package:release:mac': 'npm run dist:release:mac --workspace @cavalry/mac',
      'package:release:windows': 'npm run dist:release:windows --workspace @cavalry/mac'
    });
    for (const script of [
      'pack:mac',
      'pack:mac:intel',
      'dist:mac',
      'dist:mac:intel',
      'dist:release:mac',
      'dist:release:windows'
    ]) {
      expect(appManifest.scripts[script]).toContain('npm run licenses:runtime && electron-builder');
    }
    expect(rootManifest.scripts.check).toContain('npm run licenses:runtime:check');
  });
});

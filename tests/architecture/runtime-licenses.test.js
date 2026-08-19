import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildRuntimeLicenseBundle,
  runtimeLicenseOutputPath
} from '../../tools/release/generate-runtime-licenses.mjs';

const root = resolve('.');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

describe('runtime dependency inventory', () => {
  it('covers every external non-dev npm package without Electron entries', () => {
    const lockfile = readJson('package-lock.json');
    const expectedPaths = Object.entries(lockfile.packages || {})
      .filter(
        ([path, metadata]) =>
          path.includes('node_modules/') && metadata?.dev !== true && metadata?.link !== true
      )
      .map(([path]) => path)
      .sort();
    const { entries } = buildRuntimeLicenseBundle(root);

    expect(entries.map((entry) => entry.lockPath).sort()).toEqual(expectedPaths);
    expect(entries.some((entry) => entry.name === 'react')).toBe(true);
    expect(entries.some((entry) => entry.name === '@supabase/supabase-js')).toBe(true);
    expect(entries.some((entry) => /^electron(?:$|-)/.test(entry.name))).toBe(false);
    entries.forEach((entry) => {
      expect(entry.name).toBeTruthy();
      expect(entry.version).toBeTruthy();
      expect(entry.license).toBeTruthy();
    });
  });

  it('keeps the generated inventory deterministic and included in Tauri bundles', () => {
    const { entries, contents } = buildRuntimeLicenseBundle(root);
    const config = readJson('apps/desktop/src-tauri/tauri.bundle.conf.json');
    const check = spawnSync(
      process.execPath,
      [resolve(root, 'tools/release/generate-runtime-licenses.mjs'), '--check'],
      { cwd: root, encoding: 'utf8' }
    );

    expect(existsSync(runtimeLicenseOutputPath)).toBe(true);
    expect(readFileSync(runtimeLicenseOutputPath, 'utf8')).toBe(contents);
    expect(contents).toContain(`PACKAGE COUNT: ${entries.length}`);
    expect(contents).not.toContain(root);
    expect(config.bundle.resources).toContain('../packaging/RUNTIME-DEPENDENCY-INVENTORY.txt');
    expect(check.status, check.stderr).toBe(0);
  });
});

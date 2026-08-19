import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageNames = [
  '@cavalry/finance-core',
  '@cavalry/action-review',
  '@cavalry/advisor',
  '@cavalry/companion-api',
  '@cavalry/sync-foundation'
];
const manifest = (filePath) => JSON.parse(readFileSync(resolve(filePath), 'utf8'));

describe('workspace manifests', () => {
  it('declares the desktop workspace and Tauri build commands', () => {
    const root = manifest('package.json');
    const app = manifest('apps/desktop/package.json');
    const lock = manifest('package-lock.json');

    expect(root.private).toBe(true);
    expect(root.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(root.scripts.dev).toContain('@cavalry/desktop');
    expect(root.scripts['package:mac']).toContain('tauri:build:mac');
    expect(root.scripts['package:release:windows']).toBeUndefined();
    expect(app.name).toBe('@cavalry/desktop');
    expect(app.scripts.dev).toContain('cargo tauri dev');
    expect(app.scripts['sidecar:prepare']).toContain('build-sidecar.mjs');
    expect(app.scripts['tauri:release:windows']).toBeUndefined();
    expect(lock.packages['apps/desktop'].name).toBe('@cavalry/desktop');
    expect(lock.packages['apps/mac']).toBeUndefined();
    packageNames.forEach((name) => expect(app.dependencies[name]).toBe('1.0.15'));
  });

  it.each(packageNames)('%s exposes an explicit module surface', (name) => {
    const directory = name.replace('@cavalry/', '');
    const source = manifest(`packages/${directory}/package.json`);
    expect(source.private).toBe(true);
    expect(source.type).toBe('module');
    expect(source.exports['.']).toBe('./src/index.js');
  });
});

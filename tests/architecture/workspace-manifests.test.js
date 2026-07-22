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

function manifest(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

describe('workspace manifests', () => {
  it('declares the app and package workspaces', () => {
    const root = manifest('package.json');
    const app = manifest('apps/mac/package.json');

    expect(root.private).toBe(true);
    expect(root.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(Object.keys(root.scripts)).toEqual([
      'dev',
      'build',
      'format',
      'lint',
      'typecheck',
      'test',
      'test:integration',
      'test:e2e',
      'check',
      'package:mac',
      'package:mac:intel',
      'package:release:mac',
      'package:release:windows',
      'licenses:runtime',
      'licenses:runtime:check',
      'release:validate',
      'release:security'
    ]);
    expect(app.name).toBe('@cavalry/mac');
    packageNames.forEach((name) => {
      expect(app.dependencies[name]).toBe('1.0.15');
    });
  });

  it.each(packageNames)('%s exposes an explicit module surface', (name) => {
    const directory = name.replace('@cavalry/', '');
    const source = manifest(`packages/${directory}/package.json`);

    expect(source.private).toBe(true);
    expect(source.type).toBe('module');
    expect(source.exports).toBeTruthy();
    expect(source.exports['.']).toBe('./src/index.js');
  });
});

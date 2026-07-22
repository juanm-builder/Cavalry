import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getPreloadApiSurface } from '../../tools/repo/architecture-report.mjs';

describe('desktop security boundary', () => {
  it('keeps the narrow preload namespaces stable', () => {
    expect(getPreloadApiSurface().map((entry) => entry.namespace)).toEqual([
      'cavalryAdvisor',
      'cavalryCloud',
      'cavalryCompanion',
      'cavalryFiles',
      'cavalryUpdates'
    ]);
  });

  it('keeps hardened BrowserWindow preferences', () => {
    const source = readFileSync(resolve('apps/mac/src/main/main-window-controller.cjs'), 'utf8');
    expect(source).toContain('nodeIntegration: false');
    expect(source).toContain('contextIsolation: true');
    expect(source).toContain('sandbox: true');
  });
});

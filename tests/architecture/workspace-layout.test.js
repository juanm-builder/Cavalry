import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../../tools/repo/architecture-report.mjs';

const atRoot = (...parts) => path.join(WORKSPACE_ROOT, ...parts);

describe('workspace layout', () => {
  it('uses the planned app, package, tool, example, test, and documentation roots', () => {
    [
      'apps/mac/src/main',
      'apps/mac/src/preload',
      'apps/mac/src/renderer',
      'packages/finance-core',
      'packages/action-review',
      'packages/advisor',
      'packages/companion-api',
      'packages/sync-foundation',
      'tools/llama-cpp-launcher',
      'tools/repo',
      'examples/workbooks',
      'tests/architecture'
    ].forEach((directory) => expect(existsSync(atRoot(directory)), directory).toBe(true));

    expect(
      readdirSync(atRoot('docs'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['adr', 'architecture', 'development', 'features', 'integrations', 'operations']);
  });

  it('does not retain pre-workspace or duplicate application roots', () => {
    [
      'Cavalry for Mac',
      'LlamaCPP',
      'mock-worksheet.html',
      'apps/mac/electron',
      'apps/mac/src/application',
      'apps/mac/src/domain',
      'apps/mac/src/server',
      'apps/mac/src/renderer/routes',
      'apps/mac/src/renderer/legacy',
      'apps/mac/src/renderer/compatibility',
      'apps/mac/app.bundle.js',
      'apps/mac/dist-renderer'
    ].forEach((legacyPath) => expect(existsSync(atRoot(legacyPath)), legacyPath).toBe(false));
  });
});

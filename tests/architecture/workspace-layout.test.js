import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from '../../tools/repo/architecture-report.mjs';

const atRoot = (...parts) => path.join(WORKSPACE_ROOT, ...parts);

describe('workspace layout', () => {
  it('contains the Tauri shell, isolated host, renderer, packages, and maintained docs', () => {
    [
      'apps/desktop/src-tauri/src/lib.rs',
      'apps/desktop/src/host',
      'apps/desktop/src/renderer',
      'apps/desktop/src/renderer/platform/tauri-bridge.js',
      'packages/finance-core',
      'packages/action-review',
      'packages/advisor',
      'packages/companion-api',
      'packages/sync-foundation',
      'tools/repo',
      'examples/workbooks',
      'tests/architecture'
    ].forEach((entry) => expect(existsSync(atRoot(entry)), entry).toBe(true));

    expect(
      readdirSync(atRoot('docs'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['adr', 'architecture', 'development', 'features', 'integrations', 'operations']);
  });

  it('does not retain the Electron application root or privileged preload layer', () => {
    [
      'apps/mac',
      'apps/desktop/src/preload',
      'apps/desktop/electron-builder.yml',
      'apps/desktop/electron-builder.release.yml',
      'apps/desktop/electron-builder.windows.yml',
      'apps/desktop/vite.main.config.mjs',
      'apps/desktop/vite.preload.config.mjs',
      'apps/desktop/dist-renderer'
    ].forEach((legacyPath) => expect(existsSync(atRoot(legacyPath)), legacyPath).toBe(false));
  });
});

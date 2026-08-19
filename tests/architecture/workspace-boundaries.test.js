import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  collectArchitectureReport,
  getRendererBoundaryViolations,
  getWorkspaceBoundaryViolations
} from '../../tools/repo/architecture-report.mjs';

describe('workspace architecture', () => {
  it('keeps package dependencies flowing toward finance-core', () => {
    expect(getWorkspaceBoundaryViolations()).toEqual([]);
    expect(getRendererBoundaryViolations()).toEqual([]);
  });

  it('checks source files whether or not Git has staged them', () => {
    const root = mkdtempSync(join(tmpdir(), 'cavalry-architecture-'));
    const sourceDirectory = join(root, 'packages/finance-core/src');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(join(sourceDirectory, 'untracked-module.js'), "import 'node:fs';\n");
    try {
      expect(getWorkspaceBoundaryViolations(root)).toEqual([
        expect.objectContaining({
          file: 'packages/finance-core/src/untracked-module.js',
          reason: 'platform-import',
          specifier: 'node:fs'
        })
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps one renderer root and platform access behind the Tauri adapter layer', () => {
    const report = collectArchitectureReport();
    expect(report.desktopHostLoc).toBeGreaterThan(0);
    expect(report.rustHostLoc).toBeGreaterThan(0);
    expect(report.largestHostModule.loc).toBeLessThanOrEqual(1400);
    expect(report.largestRendererModule.loc).toBeLessThanOrEqual(1100);
    expect(report.reactRootCalls).toBe(1);
    expect(report.routeRegistryFiles).toEqual(['apps/desktop/src/renderer/app/routes.js']);
    expect(report.rawPlatformGlobalFiles).toEqual([]);
    expect(report.unsafeHtmlSites).toBe(0);
    expect(report.tauriBridgeFiles.sort()).toEqual([
      'apps/desktop/src/renderer/platform/tauri-bridge.js',
      'apps/desktop/src/renderer/platform/tauri-host-broker.js',
      'apps/desktop/src/renderer/platform/tauri-updates.js'
    ]);
    expect(report.sidecarProtocolFiles.length).toBeGreaterThan(0);
    expect(report.trackedGeneratedFiles).toEqual([]);
  });
});

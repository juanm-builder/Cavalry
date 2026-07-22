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

  it('keeps the final renderer free of transitional surfaces', () => {
    const report = collectArchitectureReport();

    expect(report.legacyAppLoc).toBe(0);
    // The composition root owns the trusted renderer/window binding and nonblocking cloud startup.
    expect(report.electronMainLoc).toBeLessThanOrEqual(205);
    expect(report.largestMainModule.loc).toBeLessThanOrEqual(1394);
    expect(report.largestNonLegacyRendererModule.loc).toBeLessThanOrEqual(1100);
    expect(report.mountAdapters).toEqual([]);
    expect(report.compatibilityFiles).toEqual([]);
    expect(report.cwdDependentFiles).toEqual([]);
    expect(report.reactRootCalls).toBe(1);
    expect(report.routeRegistryFiles).toEqual(['apps/mac/src/renderer/app/routes.js']);
    expect(report.rawPlatformGlobalFiles).toEqual([]);
    expect(report.delegatedActionAttributeFiles).toEqual([]);
    expect(report.unsafeHtmlSites).toBe(0);
  });
});

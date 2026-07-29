// Protects the narrow renderer bridge from accidental namespace or raw ipcRenderer exposure changes.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const expectedPreloadNamespaces = [
  'cavalryAdvisor',
  'cavalryCloud',
  'cavalryCompanion',
  'cavalryFiles',
  'cavalryUpdates'
];
const preloadPath = fileURLToPath(new URL('../../src/preload/index.cjs', import.meta.url));

describe('preload contract', () => {
  it('exposes only the expected Cavalry namespaces', () => {
    const source = readFileSync(preloadPath, 'utf8');
    const exposedNames = Array.from(
      source.matchAll(/contextBridge\.exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)
    )
      .map((match) => match[1])
      .sort();

    expect(exposedNames).toEqual(expectedPreloadNamespaces);
  });

  it('does not expose raw ipcRenderer or generic invoke/send helpers', () => {
    const source = readFileSync(preloadPath, 'utf8');

    expect(source).not.toMatch(/exposeInMainWorld\(\s*['"](?:ipcRenderer|electron|node|fs)['"]/);
    expect(source).not.toMatch(/\bipcRenderer\s*:/);
    expect(source).not.toMatch(/\binvoke\s*:\s*\(/);
    expect(source).not.toMatch(/\bsend\s*:\s*\(/);
  });

  it('exposes only the narrow updater commands and state subscription', () => {
    const source = readFileSync(preloadPath, 'utf8');
    const updateBlock = source.slice(source.indexOf("exposeInMainWorld('cavalryUpdates'"));

    expect(updateBlock).toContain("'cavalry-updates:get-state'");
    expect(updateBlock).toContain("'cavalry-updates:check'");
    expect(updateBlock).toContain("'cavalry-updates:download'");
    expect(updateBlock).toContain("'cavalry-updates:restart-and-install'");
    expect(updateBlock).toContain("'cavalry-updates:state-changed'");
    expect(updateBlock).not.toMatch(/setFeedURL|requestHeaders|updateConfigPath/);
  });

  it('keeps feedback inside the authenticated Cavalry Cloud bridge', () => {
    const source = readFileSync(preloadPath, 'utf8');
    const cloudStart = source.indexOf("exposeInMainWorld('cavalryCloud'");
    const updateStart = source.indexOf("exposeInMainWorld('cavalryUpdates'");
    const cloudBlock = source.slice(cloudStart, updateStart);

    expect(cloudBlock).toContain('listFeedbackReports');
    expect(cloudBlock).toContain('submitFeedbackReport');
    expect(cloudBlock).toContain('getFeedbackAttachment');
    expect(cloudBlock).toContain("'cavalry-cloud:list-feedback-reports'");
    expect(cloudBlock).toContain("'cavalry-cloud:submit-feedback-report'");
    expect(cloudBlock).toContain("'cavalry-cloud:get-feedback-attachment'");
  });

  it('forwards current form settings through both local-model pickers', () => {
    const source = readFileSync(preloadPath, 'utf8');
    const advisorStart = source.indexOf("exposeInMainWorld('cavalryAdvisor'");
    const advisorBlock = source.slice(advisorStart);

    expect(advisorBlock).toMatch(
      /chooseLocalModel:\s*\(payload\)\s*=>[\s\S]*?invokeAdvisorCommand\('cavalry-advisor:choose-local-model', payload\)/
    );
    expect(advisorBlock).toMatch(
      /chooseMmproj:\s*\(payload\)\s*=>\s*invokeAdvisorCommand\('cavalry-advisor:choose-mmproj', payload\)/
    );
  });
});

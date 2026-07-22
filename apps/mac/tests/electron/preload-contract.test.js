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
});

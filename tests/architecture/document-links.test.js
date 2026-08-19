import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../../tools/repo/architecture-report.mjs';

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'archive') return [];
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.md') ? [absolutePath] : [];
  });
}

function relativeTargets(filePath) {
  const source = readFileSync(filePath, 'utf8');
  return Array.from(source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g), (match) => match[1])
    .map((target) => target.trim().replace(/^<|>$/g, '').split('#')[0])
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

describe('maintained documentation links', () => {
  it('resolves local Markdown links from their owning document', () => {
    const files = [
      path.join(WORKSPACE_ROOT, 'README.md'),
      path.join(WORKSPACE_ROOT, 'CONTRIBUTING.md'),
      path.join(WORKSPACE_ROOT, 'SECURITY.md'),
      path.join(WORKSPACE_ROOT, 'CHANGELOG.md'),
      path.join(WORKSPACE_ROOT, 'apps/desktop/README.md'),
      ...markdownFiles(path.join(WORKSPACE_ROOT, 'docs')),
      ...markdownFiles(path.join(WORKSPACE_ROOT, 'packages'))
    ];
    const missing = files.flatMap((filePath) =>
      relativeTargets(filePath).flatMap((target) => {
        const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(target));
        return existsSync(resolved)
          ? []
          : [`${path.relative(WORKSPACE_ROOT, filePath)} -> ${target}`];
      })
    );

    expect(missing).toEqual([]);
  });
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { it } from 'vitest';

it.runIf(process.platform === 'darwin')(
  'fits restored windows into the available desktop',
  () => {
    const source = readFileSync(
      new URL('../../src-tauri/src/CavalryWindowBounds.swift', import.meta.url),
      'utf8'
    );
    const checks = readFileSync(new URL('./window-bounds-cases.swift', import.meta.url), 'utf8');
    execFileSync('xcrun', ['swift', '-swift-version', '5', '-'], { input: source + '\n' + checks });
  },
  60000
);

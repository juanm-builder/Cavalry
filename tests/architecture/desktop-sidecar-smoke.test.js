import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];
const smokeScript = resolve('apps/desktop/scripts/sidecar-smoke.mjs');

function runPackagedSmoke(mode, flags = ['--expect-browser-sign-in']) {
  const directory = mkdtempSync(resolve(tmpdir(), 'cavalry-sidecar-smoke-test-'));
  temporaryDirectories.push(directory);
  const binaryPath = resolve(directory, 'synthetic-host.cjs');
  // This executable supplies controlled IPC responses without loading app code,
  // connecting to Apple, or reading an existing workbook or app-data directory.
  writeFileSync(
    binaryPath,
    `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const prefix = 'CAVALRY_IPC_V1:';
const userDataDir = process.env.CAVALRY_USER_DATA_DIR;
if (!userDataDir || fs.readdirSync(userDataDir).length) {
  throw new Error('Expected a fresh temporary data directory.');
}
const mode = process.env.RELEASE_TEST_SIDECAR_MODE;
const write = (value) => process.stdout.write(prefix + JSON.stringify(value) + '\\n');
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line.slice(prefix.length));
  if (request.type === 'lifecycle') return process.exit(0);
  if (request.channel === 'cavalry-host:get-info') {
    write({ type: 'response', id: request.id, ok: true, result: {
      protocolVersion: 1,
      userDataDir: mode === 'wrong-directory' ? '/unexpected-data-directory' : userDataDir
    }});
  }
  if (request.channel === 'cavalry-cloud:get-state') {
    const availability = mode === 'embedded' ? true
      : mode === 'runtime-token' ? Boolean(process.env.CAVALRY_CLOUDKIT_WEB_API_TOKEN)
      : mode === 'truthy-string' ? 'true'
      : mode === 'missing-field' ? undefined : false;
    write({ type: 'response', id: request.id, ok: true, result: { state: {
      configured: true, status: 'signed_in', browserSignInAvailable: availability
    }}});
  }
});
write({ type: 'ready' });
`
  );
  chmodSync(binaryPath, 0o700);
  return spawnSync(process.execPath, [smokeScript, '--binary', binaryPath, ...flags], {
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      RELEASE_TEST_SIDECAR_MODE: mode,
      CAVALRY_CLOUDKIT_WEB_API_TOKEN: 'a'.repeat(64)
    }
  });
}

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Packaged host browser sign-in smoke gate', () => {
  it('accepts available embedded configuration in an isolated data directory', () => {
    const result = runPackagedSmoke('embedded', [
      '--expect-icloud-enabled',
      '--expect-browser-sign-in'
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Cavalry desktop host smoke passed.');
  });

  it.each(['disabled', 'missing-field', 'truthy-string', 'runtime-token'])(
    'rejects %s availability, including an inherited runtime token',
    (mode) => {
      const result = runPackagedSmoke(mode);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing its browser iCloud configuration');
      expect(result.stdout + result.stderr).not.toContain('a'.repeat(64));
    }
  );

  it('rejects a host that ignored the isolated data-directory override', () => {
    const result = runPackagedSmoke('wrong-directory');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use its isolated data directory');
  });

  it('keeps the existing native-only smoke usable for tokenless local builds', () => {
    const result = runPackagedSmoke('disabled', ['--expect-icloud-enabled']);

    expect(result.status, result.stderr).toBe(0);
  });

  it('requires a packaged binary when checking browser sign-in', () => {
    const result = spawnSync(process.execPath, [smokeScript, '--expect-browser-sign-in'], {
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: sidecar-smoke.mjs');
  });
});

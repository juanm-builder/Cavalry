import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];
const workflow = readFileSync(resolve('.github/workflows/desktop-release.yml'), 'utf8');
const preparationStep = workflow
  .split('      - name: Prepare signed updater configuration and sidecar\n')[1]
  ?.split('\n      - name:')[0];

function runPreparation(token, sidecar = 'sidecar:prepare:mac') {
  const directory = mkdtempSync(resolve(tmpdir(), 'cavalry-cloudkit-release-config-'));
  temporaryDirectories.push(directory);
  const commandsPath = resolve(directory, 'npm-commands');
  const script = preparationStep
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n')
    .replaceAll('${{ matrix.sidecar }}', sidecar);
  // Run the real workflow guard and command sequence without invoking any build.
  // Each stubbed npm call also checks that it received the public client token.
  const stub = [
    'npm() {',
    '  test "$CAVALRY_CLOUDKIT_WEB_API_TOKEN" = "$RELEASE_TEST_EXPECTED_TOKEN" || return 1',
    '  printf "%s\\n" "$*" >> "$RELEASE_TEST_NPM_LOG"',
    '}'
  ].join('\n');
  const result = spawnSync('bash', ['-c', `${stub}\n${script}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAVALRY_CLOUDKIT_WEB_API_TOKEN: token,
      RELEASE_TEST_EXPECTED_TOKEN: token,
      RELEASE_TEST_NPM_LOG: commandsPath,
      GITHUB_WORKSPACE: directory,
      GITHUB_PATH: resolve(directory, 'github-path')
    }
  });
  let commands = [];
  try {
    commands = readFileSync(commandsPath, 'utf8').trim().split('\n');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { ...result, commands };
}

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('CloudKit browser configuration in signed desktop releases', () => {
  it('supplies the repository variable to the actual host and sidecar preparation step', () => {
    expect(preparationStep).toContain(
      'CAVALRY_CLOUDKIT_WEB_API_TOKEN: ${{ vars.CAVALRY_CLOUDKIT_WEB_API_TOKEN }}'
    );
  });

  it('checks embedded browser configuration in both signed release sidecars', () => {
    const smokeStep = workflow
      .split('      - name: Smoke test the signed host sidecar\n')[1]
      ?.split('\n      - name:')[0];

    expect(smokeStep).toMatch(
      /node apps\/desktop\/scripts\/sidecar-smoke\.mjs \\\n\s+--binary "\$sidecar" \\\n\s+--expect-icloud-enabled \\\n\s+--expect-browser-sign-in/
    );
  });

  it.each(['sidecar:prepare:mac', 'sidecar:prepare:mac:intel'])(
    'passes the token to every build command for %s',
    (sidecar) => {
      const result = runPreparation('aB12'.repeat(16), sidecar);

      expect(result.status, result.stderr).toBe(0);
      expect(result.commands).toEqual([
        'run licenses:runtime',
        'run build:host',
        `run ${sidecar}`,
        'run release:config'
      ]);
      expect(result.stdout + result.stderr).not.toContain('aB12'.repeat(16));
    }
  );

  it.each([
    ['missing', ''],
    ['placeholder', 'PUBLIC_API_TOKEN'],
    ['short', 'a'.repeat(63)],
    ['long', 'a'.repeat(65)],
    ['non-hexadecimal', 'g'.repeat(64)],
    ['leading whitespace', ` ${'a'.repeat(64)}`],
    ['trailing newline', `${'a'.repeat(64)}\n`]
  ])('rejects %s configuration before starting a build', (_label, token) => {
    const result = runPreparation(token);

    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([]);
    expect(result.stdout).toContain('CAVALRY_CLOUDKIT_WEB_API_TOKEN repository variable');
    if (token) expect(result.stdout + result.stderr).not.toContain(token);
  });
});

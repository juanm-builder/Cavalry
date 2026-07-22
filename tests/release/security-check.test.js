import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyEmbeddedImage,
  findWorkflowPinViolations,
  isHighRiskPath,
  knownReceiptSha256,
  scanEmbeddedImages,
  scanText
} from '../../tools/release/security-check.mjs';

function rulesFor(contents, path = 'src/example.js') {
  return scanText(path, contents).map(({ rule }) => rule);
}

describe('release security content scanner', () => {
  it('detects provider tokens without printing their values', () => {
    const token = ['ghp', 'A'.repeat(36)].join('_');
    const [finding] = scanText('src/example.js', `const value = "${token}";`);

    expect(finding).toMatchObject({ rule: 'GitHub token', line: 1 });
    expect(finding.fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(JSON.stringify(finding)).not.toContain(token);
  });

  it.each([
    ['private key', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
    ['JSON Web Token', ['eyJ' + 'A'.repeat(8), 'B'.repeat(8), 'C'.repeat(8)].join('.')],
    ['Basic authorization credential', ['Basic ', 'dXNlcjpwYXNzd29yZA=='].join('')],
    [
      'credential-bearing URL',
      ['postgres', '://', 'service_user', ':', 'very-private-value', '@', 'db.example.test'].join(
        ''
      )
    ]
  ])('detects %s material', (expectedRule, material) => {
    expect(rulesFor(material)).toContain(expectedRule);
  });

  it('detects high-entropy hard-coded credentials and local machine paths', () => {
    const credential = 'V9r!aQ2#Lm7$Kx4@Nz8';
    const localPath = ['/', 'Users', 'developer', 'private-workbook.html'].join('/');
    const windowsPath = ['C:', 'Users', 'developer', 'private-workbook.html'].join('\\');
    const contents = [
      `const password = "${credential}";`,
      `const path = "${localPath}";`,
      `const windowsPath = "${windowsPath}";`
    ].join('\n');

    expect(rulesFor(contents)).toEqual([
      'hard-coded credential',
      'local user path',
      'local user path'
    ]);
  });

  it('allows only the exact reviewed synthetic OpenAI-shaped fixture value', () => {
    const fixtureToken = ['sk', 'voice', 'with', 'local', 'chat'].join('-');
    const contents = `const apiKey = "${fixtureToken}";`;

    expect(scanText('apps/mac/tests/electron/in-app-advisor-ipc.test.js', contents)).toEqual([]);
    expect(rulesFor(contents)).toContain('OpenAI secret key');
  });

  it('accepts documented placeholders instead of treating them as credentials', () => {
    expect(rulesFor('const apiKey = "your_api_key";')).toEqual([]);
    expect(rulesFor('const password = "change-me-before-use";')).toEqual([]);
    expect(rulesFor('Basic authorization is supported by an adapter.')).toEqual([]);
  });

  it('rejects unreviewed data images and allows the reviewed smoke-test pixel', () => {
    const arbitraryPng = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from('synthetic test payload')
    ]);
    const arbitraryUri = `data:image/png;base64,${arbitraryPng.toString('base64')}`;
    const smokePath = 'apps/mac/scripts/advisor-live-smoke.mjs';
    const smokeContents = readFileSync(resolve(smokePath), 'utf8');

    expect(scanEmbeddedImages('docs/example.md', arbitraryUri)).toEqual([
      expect.objectContaining({ rule: 'unreviewed embedded data image' })
    ]);
    expect(scanEmbeddedImages(smokePath, smokeContents)).toEqual([]);
  });

  it('keeps the known sensitive receipt fingerprint permanently denied', () => {
    expect(knownReceiptSha256).toBe(
      '0f0a805b2c93e3c82ebb0c00c91de6ff8a20eb23a3665b74390b1a48f611d9b3'
    );
    expect(classifyEmbeddedImage('docs/renamed-image.html', knownReceiptSha256)).toBe(
      'known sensitive receipt image'
    );
  });

  it.each([
    '.env',
    'credentials.json',
    'keys/AuthKey_release.p8',
    'exports/private.sqlite',
    'diagnostics/session.har',
    'release/app.dmg',
    'backup/workbook.cavalry-backup.html'
  ])('classifies %s as a high-risk repository path', (path) => {
    expect(isHighRiskPath(path)).toBe(true);
  });

  it.each(['.env.example', 'database/schema.sql', 'src/config.js'])(
    'does not reject an intentional repository path: %s',
    (path) => {
      expect(isHighRiskPath(path)).toBe(false);
    }
  );

  it('requires immutable action pins and human-readable version comments', () => {
    const unsafe = 'steps:\n  - uses: actions/checkout@v4\n';
    const safe =
      'steps:\n  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n';

    expect(findWorkflowPinViolations(unsafe, '.github/workflows/example.yml')).toHaveLength(2);
    expect(findWorkflowPinViolations(safe, '.github/workflows/example.yml')).toEqual([]);
    expect(findWorkflowPinViolations('steps:\n  - uses: ./local-action\n')).toEqual([]);
  });
});

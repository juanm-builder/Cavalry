// Tests for the Companion API beta command-line tools.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import { COMPANION_PACKAGE_ROOT, packagePath, repoPath } from '../../scripts/companion-paths.mjs';
import {
  generateCompanionBetaToken,
  hashCompanionBetaToken
} from '../../src/server/cavalry-api/beta-token.js';

const CLI_TEST_TIMEOUT_MS = 60000;

function runScript(script, env = {}, args = []) {
  return spawnSync(process.execPath, [packagePath(script), ...args], {
    cwd: COMPANION_PACKAGE_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env)
  });
}

describe('Companion API beta CLI tools', () => {
  it(
    'doctor reports missing setup without failing and rejects token-bearing public URLs',
    () => {
      const missing = runScript('scripts/companion-beta-doctor.mjs', {
        CAVALRY_COMPANION_API_ENABLED: '',
        CAVALRY_COMPANION_API_MODE: '',
        CAVALRY_COMPANION_BETA_API_KEY: '',
        CAVALRY_COMPANION_BETA_API_KEY_HASH: '',
        CAVALRY_COMPANION_PUBLIC_BASE_URL: ''
      });
      expect(missing.status).toBe(0);
      expect(missing.stdout).toContain('Companion Beta Doctor');
      const report = JSON.parse(
        readFileSync(repoPath('test-artifacts/companion-beta-doctor/report.json'), 'utf8')
      );
      expect(report.production_cloud_ready).toBe(false);
      expect(report.missing).toEqual(
        expect.arrayContaining([
          expect.stringContaining('No beta token configured'),
          expect.stringContaining('No public HTTPS tunnel URL configured')
        ])
      );

      const unsafe = runScript('scripts/companion-beta-doctor.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: 'https://example.com?token=secret'
      });
      expect(unsafe.status).not.toBe(0);
      const unsafeText = readFileSync(
        repoPath('test-artifacts/companion-beta-doctor/report.md'),
        'utf8'
      );
      expect(unsafeText).not.toContain('token=secret');
    },
    CLI_TEST_TIMEOUT_MS
  );

  it(
    'rejects missing or unsafe beta OpenAPI public URLs and generates valid beta artifacts for an HTTPS URL',
    () => {
      const missing = runScript('scripts/companion-openapi-beta.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: ''
      });
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('CAVALRY_COMPANION_PUBLIC_BASE_URL');

      const tokenUrl = runScript('scripts/companion-openapi-beta.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: 'https://example.com?token=secret'
      });
      expect(tokenUrl.status).not.toBe(0);

      const generated = runScript('scripts/companion-openapi-beta.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: 'https://beta-cavalry.example.com'
      });
      expect(generated.status).toBe(0);
      const yaml = readFileSync(
        repoPath('test-artifacts/companion-beta/openapi/cavalry-gpt-actions.beta.openapi.yaml'),
        'utf8'
      );
      const json = JSON.parse(
        readFileSync(
          repoPath('test-artifacts/companion-beta/openapi/cavalry-gpt-actions.beta.openapi.json'),
          'utf8'
        )
      );
      expect(yaml).toContain('url: https://beta-cavalry.example.com');
      expect(yaml).not.toMatch(/\/apply\s*:/i);
      expect(json.openapi).toBe('3.1.0');
      expect(json.servers[0].url).toBe('https://beta-cavalry.example.com');
    },
    CLI_TEST_TIMEOUT_MS
  );

  it(
    'refuses to print generated tokens noninteractively and keeps beta artifacts token-free',
    () => {
      const created = runScript('scripts/companion-token.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: ''
      });
      expect(created.status).not.toBe(0);
      expect(created.stderr).toContain('outside an interactive terminal');
      expect(created.stdout + created.stderr).not.toMatch(/cavb_[A-Za-z0-9_-]+/);
      expect(created.stdout + created.stderr).not.toMatch(/sha256:[a-f0-9]{64}/);

      const ciCreated = runScript('scripts/companion-token.mjs', { CI: '1' });
      expect(ciCreated.status).not.toBe(0);
      expect(ciCreated.stdout + ciCreated.stderr).not.toMatch(/cavb_[A-Za-z0-9_-]+/);

      const token = generateCompanionBetaToken();
      const hash = hashCompanionBetaToken(token);
      expect(token.length).toBeGreaterThan(30);
      expect(hash).toMatch(/^sha256:/);

      const verified = runScript(
        'scripts/companion-token.mjs',
        {
          CAVALRY_COMPANION_BETA_API_KEY_HASH: hash,
          CAVALRY_COMPANION_BETA_TOKEN_TO_VERIFY: token
        },
        ['verify']
      );
      expect(verified.status).toBe(0);
      expect(verified.stdout).not.toContain(token);

      const bundle = runScript('scripts/companion-beta-bundle.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: 'https://beta-cavalry.example.com',
        CAVALRY_COMPANION_BETA_API_KEY: token
      });
      expect(bundle.status).toBe(0);
      const bundleDir = repoPath('test-artifacts/companion-beta-bundle');
      const readme = readFileSync(resolve(bundleDir, 'README.md'), 'utf8');
      const curl = readFileSync(resolve(bundleDir, 'curl-smoke-tests.sh'), 'utf8');
      const json = JSON.parse(
        readFileSync(resolve(bundleDir, 'cavalry-gpt-actions.beta.openapi.json'), 'utf8')
      );
      expect(readme).toContain('Production cloud ready: false');
      expect(curl).toContain('CAVALRY_COMPANION_BETA_API_KEY');
      expect(json.servers[0].url).toBe('https://beta-cavalry.example.com');
      expect(readme + curl + JSON.stringify(json)).not.toContain(token);

      const status = runScript('scripts/companion-status.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: 'https://beta-cavalry.example.com',
        CAVALRY_COMPANION_BETA_API_KEY: token
      });
      expect(status.status).toBe(0);
      expect(status.stdout).not.toContain(token);

      const audit = runScript('scripts/companion-audit-recent.mjs', {
        CAVALRY_COMPANION_BETA_API_KEY: token
      });
      expect(audit.status).toBe(0);
      const auditReport = JSON.parse(
        readFileSync(repoPath('test-artifacts/companion-audit/recent.json'), 'utf8')
      );
      expect(auditReport.events.length).toBeGreaterThan(0);
      expect(JSON.stringify(auditReport)).not.toContain(token);

      const disable = runScript('scripts/companion-disable.mjs', {
        CAVALRY_COMPANION_BETA_API_KEY: token
      });
      expect(disable.status).toBe(0);
      expect(disable.stdout).not.toContain(token);
    },
    CLI_TEST_TIMEOUT_MS
  );

  it(
    'beta certification skips honestly without env and succeeds in local mock mode without leaking token',
    () => {
      const skipped = runScript('scripts/companion-beta-certify.mjs', {
        CAVALRY_COMPANION_API_ENABLED: '',
        CAVALRY_COMPANION_API_MODE: '',
        CAVALRY_COMPANION_PUBLIC_BASE_URL: '',
        CAVALRY_COMPANION_BETA_API_KEY: ''
      });
      expect(skipped.status).toBe(0);
      expect(skipped.stdout).toContain('skipped');
      const skipReport = JSON.parse(
        readFileSync(repoPath('test-artifacts/companion-beta-certification/report.json'), 'utf8')
      );
      expect(skipReport.custom_gpt_manual_test_ready).toBe(false);

      const token = 'cavb_test_beta_cli_token';
      const passed = runScript('scripts/companion-beta-certify.mjs', {
        NODE_ENV: 'test',
        CAVALRY_COMPANION_API_ENABLED: '1',
        CAVALRY_COMPANION_API_MODE: 'beta_tunnel',
        CAVALRY_COMPANION_BETA_CERTIFY_USE_LOCAL_SERVER: '1',
        CAVALRY_COMPANION_BETA_API_KEY: token,
        CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL: '1'
      });
      expect(passed.status).toBe(0);
      const reportText = readFileSync(
        repoPath('test-artifacts/companion-beta-certification/report.md'),
        'utf8'
      );
      const report = JSON.parse(
        readFileSync(repoPath('test-artifacts/companion-beta-certification/report.json'), 'utf8')
      );
      expect(report.beta_status).toBe('passed');
      expect(report.custom_gpt_manual_test_ready).toBe(true);
      expect(report.gpt_style_http_simulation).toBe(true);
      expect(report.manual_gpt_preview_tested).toBe(false);
      expect(report.production_cloud_ready).toBe(false);
      expect(report.draft_groups_created.length).toBeGreaterThanOrEqual(3);
      expect(reportText).not.toContain(token);
      expect(JSON.stringify(report)).not.toContain(token);
    },
    CLI_TEST_TIMEOUT_MS
  );
});

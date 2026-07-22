// Tests for the checkpointed Companion command-line tools.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import { COMPANION_PACKAGE_ROOT, packagePath, repoPath } from '../../scripts/companion-paths.mjs';

const execFileAsync = promisify(execFile);
const CLI_TEST_TIMEOUT_MS = 60000;

async function runNode(script, env = {}) {
  return execFileAsync(process.execPath, [packagePath(script)], {
    cwd: COMPANION_PACKAGE_ROOT,
    env: Object.assign({}, process.env, env),
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8
  });
}

describe('checkpointed Companion CLI scripts', () => {
  it(
    'validates checkpointed GPT instructions',
    async () => {
      const result = await runNode('scripts/companion-gpt-checkpointed-instructions-sanity.mjs');
      expect(result.stdout).toContain('Checkpointed GPT instructions sanity passed');
    },
    CLI_TEST_TIMEOUT_MS
  );

  it(
    'exports a recent checkpoint audit artifact without secrets',
    async () => {
      const result = await runNode('scripts/companion-checkpoint-audit-recent.mjs');
      expect(result.stdout).toContain('Companion checkpoint audit export generated');
      const reportPath = repoPath('test-artifacts/companion-checkpoint-audit/recent.json');
      const text = fs.readFileSync(reportPath, 'utf8');
      expect(text).toContain('checkpoint_created');
      expect(text).not.toMatch(/authorization|Bearer|raw-token|secret-token/i);
    },
    CLI_TEST_TIMEOUT_MS
  );

  it(
    'generates GPT-facing checkpointed OpenAPI without rollback execution',
    async () => {
      const result = await runNode('scripts/companion-checkpointed-openapi.mjs', {
        CAVALRY_COMPANION_PUBLIC_BASE_URL: 'https://checkpointed.example.com',
        CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED: '1',
        CAVALRY_COMPANION_AI_ACTION_MODE: 'checkpointed_apply'
      });
      expect(result.stdout).toContain('Companion checkpointed OpenAPI generated');
      const yamlPath = repoPath(
        'test-artifacts/companion-checkpointed-beta/openapi/cavalry-gpt-actions.checkpointed.openapi.yaml'
      );
      const yaml = fs.readFileSync(yamlPath, 'utf8');
      expect(yaml).toContain('/v1/workbooks/{workbook_id}/checkpointed-action-plans/execute');
      expect(yaml).toContain(
        '/v1/workbooks/{workbook_id}/checkpoints/{checkpoint_id}/rollback-preview'
      );
      expect(yaml).not.toContain('/rollback:');
      expect(yaml).not.toMatch(/bearer\s+[A-Za-z0-9._-]+/i);
    },
    CLI_TEST_TIMEOUT_MS
  );
});

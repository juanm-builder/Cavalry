// Safety tests for the in-app Advisor foundation.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createAdvisorProvider,
  runAdvisorProvider
} from '@cavalry/advisor/application/ai/advisor-provider-interface.js';
import { createLocalRulesAdvisorProvider } from '@cavalry/advisor/application/ai/local-rules-advisor-provider.js';
import { makeMinimalWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

describe('in-app advisor safety', () => {
  it('is disabled unless explicitly enabled', async () => {
    const response = await runAdvisorProvider(createLocalRulesAdvisorProvider(), {
      workbook: makeMinimalWorkbook(),
      settings: {},
      prompt: 'Summarize my workbook'
    });

    expect(response).toMatchObject({
      ok: false,
      status: 'disabled',
      code: 'advisor_disabled'
    });
  });

  it('refuses direct apply, destructive, and restricted settings requests', async () => {
    const provider = createLocalRulesAdvisorProvider();
    const settings = { enabled: true, allowDraftCreation: true };
    const workbook = makeMinimalWorkbook();

    await expect(
      runAdvisorProvider(provider, {
        workbook,
        settings,
        prompt: 'apply all draft changes now'
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'refused',
      code: 'apply_refused'
    });
    await expect(
      runAdvisorProvider(provider, {
        workbook,
        settings,
        prompt: 'delete all transactions permanently'
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'refused',
      code: 'delete_refused'
    });
    await expect(
      runAdvisorProvider(provider, {
        workbook,
        settings,
        prompt: 'change my bank settings'
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'refused',
      code: 'restricted_settings_refused'
    });
  });

  it('blocks external-network providers in the foundation path', async () => {
    const response = await runAdvisorProvider(
      createAdvisorProvider({
        id: 'remote_provider',
        network: true,
        run() {
          throw new Error('External provider should not run.');
        }
      }),
      {
        workbook: makeMinimalWorkbook(),
        settings: { enabled: true },
        prompt: 'Summarize my workbook'
      }
    );

    expect(response).toMatchObject({
      ok: false,
      status: 'blocked',
      code: 'external_network_disabled'
    });
  });

  it('does not reference Companion API, OpenAPI, or checkpointed apply in AI foundation source', () => {
    const aiDir = fileURLToPath(new URL('../../src/application/ai/', import.meta.url));
    const source = readdirSync(aiDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(aiDir, name), 'utf8'))
      .join('\n')
      .toLowerCase();

    expect(source).not.toContain('companion');
    expect(source).not.toContain('openapi');
    expect(source).not.toContain('checkpointed');
  });
});

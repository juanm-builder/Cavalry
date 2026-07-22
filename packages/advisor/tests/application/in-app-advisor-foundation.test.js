// Tests for the in-app Advisor foundation.

import { describe, expect, it } from 'vitest';

import {
  getRendererSafeAdvisorSettings,
  normalizeInAppAdvisorSettings,
  runAdvisorProvider,
  scrubAdvisorSecrets
} from '@cavalry/advisor/application/ai/advisor-provider-interface.js';
import { createLocalRulesAdvisorProvider } from '@cavalry/advisor/application/ai/local-rules-advisor-provider.js';
import {
  listInAppAdvisorTools,
  runInAppAdvisorTool
} from '@cavalry/advisor/application/ai/advisor-tool-registry.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]).padStart(3, '0');
  };
}

describe('in-app advisor foundation', () => {
  it('normalizes disabled-by-default settings and removes renderer secrets', () => {
    const normalized = normalizeInAppAdvisorSettings({
      enabled: true,
      allowDraftCreation: true,
      apiKey: 'sk-local-secret',
      model: 'local-test'
    });
    const safe = getRendererSafeAdvisorSettings({
      enabled: true,
      allowDraftCreation: true,
      apiKey: 'sk-local-secret',
      token: 'renderer-token'
    });
    const scrubbed = scrubAdvisorSecrets({
      apiKey: 'sk-local-secret',
      apiKeyConfigured: true,
      nested: { token: 'renderer-token', label: 'safe' }
    });

    expect(normalized.enabled).toBe(true);
    expect(normalized.apiKeyConfigured).toBe(true);
    expect(safe).toMatchObject({
      enabled: true,
      allowDraftCreation: true,
      allowExternalNetwork: false,
      allowDirectMutation: false,
      allowDraftApply: false,
      apiKeyConfigured: true
    });
    expect(scrubbed).toEqual({
      apiKeyConfigured: true,
      nested: { label: 'safe' }
    });
    expect(JSON.stringify(safe)).not.toContain('sk-local-secret');
    expect(JSON.stringify(scrubbed)).not.toContain('renderer-token');
  });

  it('answers deterministic read-only summaries without mutating the workbook', async () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const before = JSON.stringify(workbook);
    const response = await runAdvisorProvider(createLocalRulesAdvisorProvider(), {
      workbook,
      settings: { enabled: true },
      prompt: 'How is my month looking?'
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe('answered');
    expect(response.providerId).toBe('local_rules');
    expect(response.message).toContain('Income: 50000');
    expect(workbook).toEqual(JSON.parse(before));
  });

  it('exposes read-only tools by default and hides draft tools unless requested', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const defaultTools = listInAppAdvisorTools();
    const allTools = listInAppAdvisorTools({ includeDraftTools: true });
    const search = runInAppAdvisorTool('search_transactions', {
      workbook,
      arguments: { search: 'salary', limit: 5 }
    });

    expect(defaultTools.map((tool) => tool.name)).toEqual([
      'read_workbook_summary',
      'search_transactions',
      'read_budget_summary'
    ]);
    expect(allTools.map((tool) => tool.name)).toContain('prepare_transaction_draft');
    expect(search.ok).toBe(true);
    expect(search.authorization).toBe('read_only');
    expect(search.data.rows.map((row) => row.id)).toEqual(['txn-salary']);
  });

  it('can prepare a reviewable transaction draft without committing a transaction', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const beforeTransactions = cloneFixture(workbook.transactions);
    const response = await runAdvisorProvider(
      createLocalRulesAdvisorProvider({ today: '2026-06-30' }),
      {
        workbook,
        settings: { enabled: true, allowDraftCreation: true },
        services: {
          createId: makeCreateId(),
          now: () => '2026-06-30T10:00:00.000Z'
        },
        prompt: 'add transaction coffee 120 cash food'
      }
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe('draft_prepared');
    expect(workbook.transactions).toEqual(beforeTransactions);
    expect(workbook.externalDraftGroups).toHaveLength(1);
    expect(response.draftGroup).toMatchObject({
      status: 'pending_review',
      summary: { total: 1, ready: 1 }
    });
    expect(response.draftGroup.drafts[0].proposed_values).toMatchObject({
      amount: 120,
      payment_account_id: 'cash',
      category_id: 'food'
    });
  });
});

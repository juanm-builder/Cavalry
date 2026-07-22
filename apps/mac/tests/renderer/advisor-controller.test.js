import { describe, expect, it } from 'vitest';

import { createAdvisorProvider } from '@cavalry/advisor/application/ai/advisor-provider-interface.js';
import {
  buildAdvisorFeatureModel,
  deleteAdvisorThread,
  runAdvisorTurn
} from '../../src/renderer/features/advisor/advisor-controller.js';

function makeWorkbook() {
  return {
    id: 'advisor-controller-workbook',
    version: 2,
    name: 'Advisor',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'food-expense', name: 'Food', group: 'expense', currency: 'PHP', isActive: true }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', linkedAccountId: 'food-expense', isActive: true }
    ],
    transactions: [],
    sheets: [],
    recurringItems: [],
    advisorThreads: []
  };
}

function services(overrides = {}) {
  let index = 0;
  return {
    createId: (prefix) => `${prefix}_${++index}`,
    now: () => '2026-07-01T09:00:00.000Z',
    today: () => '2026-07-01',
    ...overrides
  };
}

describe('advisor controller', () => {
  it('runs the deterministic built-in provider and persists chat on a new identity', async () => {
    const workbook = makeWorkbook();
    const result = await runAdvisorTurn(workbook, { question: 'How am I doing?' }, services());

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.advisorThreads).toEqual([]);
    expect(result.workbook.advisorThreads[0].messages).toHaveLength(2);
    expect(result.assistantMessage.text).toContain('Income:');
  });

  it('keeps write requests draft-first without posting transactions', async () => {
    const workbook = makeWorkbook();
    const result = await runAdvisorTurn(
      workbook,
      {
        question: 'Add a PHP 250 coffee transaction from Cash for Food',
        settings: { enabled: true, provider: 'local_rules', allowDraftCreation: true }
      },
      services()
    );

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions).toEqual([]);
    expect(result.workbook.externalDraftGroups).toHaveLength(1);
    expect(result.assistantMessage.text).toContain('reviewable draft');
  });

  it('rejects provider core mutations and keeps only serializable provider intents', async () => {
    const workbook = makeWorkbook();
    const provider = createAdvisorProvider({
      id: 'test-provider',
      run: async (request) => {
        request.workbook.transactions.push({ id: 'malicious-direct-write' });
        return {
          ok: true,
          status: 'answered',
          message: 'Review this suggestion.',
          sourceRefs: ['account:cash'],
          actions: [{ type: 'draft_group_reference', draftGroupId: 'group-1' }]
        };
      }
    });
    const result = await runAdvisorTurn(
      workbook,
      {
        question: 'Suggest a change',
        provider,
        settings: { enabled: true, provider: 'local_rules', allowDraftCreation: false }
      },
      services()
    );

    expect(result.workbook.transactions).toEqual([]);
    expect(result.intents).toEqual([
      {
        type: 'advisor/provider-action',
        payload: { type: 'draft_group_reference', draftGroupId: 'group-1' }
      }
    ]);
    expect(result.assistantMessage.references[0].sourceRefs).toEqual(['account:cash']);
  });

  it('falls back safely when a selected provider fails', async () => {
    const provider = createAdvisorProvider({
      id: 'failing-provider',
      run: async () => {
        throw new Error('Model offline');
      }
    });
    const result = await runAdvisorTurn(
      makeWorkbook(),
      {
        question: 'Show my summary',
        provider,
        settings: { enabled: true, provider: 'local_rules', allowDraftCreation: false }
      },
      services()
    );

    expect(result.ok).toBe(true);
    expect(result.assistantMessage.text).toContain('Income:');
    expect(result.warnings[0].code).toBe('advisor.provider_fallback');
  });

  it('builds serializable presentation state and deletes threads immutably', async () => {
    const result = await runAdvisorTurn(makeWorkbook(), { question: 'Hello' }, services());
    const model = buildAdvisorFeatureModel(result.workbook);
    const deleted = deleteAdvisorThread(result.workbook, model.activeThreadId);

    expect(model.messages).toHaveLength(2);
    expect(() => JSON.stringify(model)).not.toThrow();
    expect(deleted.ok).toBe(true);
    expect(deleted.workbook).not.toBe(result.workbook);
    expect(deleted.workbook.advisorThreads).toEqual([]);
  });
});

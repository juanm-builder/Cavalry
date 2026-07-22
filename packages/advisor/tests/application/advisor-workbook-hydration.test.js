import { describe, expect, it } from 'vitest';

import {
  getActiveAdvisorThread,
  hydrateAdvisorWorkbook
} from '@cavalry/advisor/application/advisor/advisor-workbook-hydration.js';

describe('Advisor workbook hydration', () => {
  it('normalizes persisted message references and actions while selecting the saved thread', () => {
    const workbook = {
      id: 'workbook-one',
      settings: { activeAdvisorThreadId: 'thread-two', untouched: true },
      advisorThreads: [
        {
          id: 'thread-one',
          title: 'Net worth',
          messages: [
            {
              id: 'message-one',
              role: 'assistant',
              text: ' Net worth answer ',
              references: [
                {
                  token: ' PHP 650.00 ',
                  sourceRefs: [' computed.totals.net_worth ', '']
                }
              ]
            }
          ]
        },
        {
          id: 'thread-two',
          title: 'Transactions',
          messages: [
            { id: 'user-one', role: 'user', content: 'Add lunch' },
            {
              id: 'assistant-one',
              role: 'assistant',
              actions: [
                {
                  id: 'transaction-action',
                  type: 'transaction_draft',
                  status: 'draft',
                  template: 'expense paid',
                  fields: {
                    date: '2026-06-13',
                    amount: '450.129',
                    currency: 'php',
                    categoryId: 'food',
                    primaryAccountId: 'cash'
                  },
                  missing_fields: [' note ', ''],
                  ai_draft_id: 'draft-transaction-one'
                },
                {
                  id: 'draft-reference',
                  type: 'ai_draft_reference',
                  ai_draft_id: 'draft-cleanup-one',
                  status: 'confirmed'
                },
                {
                  id: 'unsupported',
                  type: 'unsupported_action'
                }
              ]
            }
          ]
        }
      ]
    };
    const before = structuredClone(workbook);

    const hydrated = hydrateAdvisorWorkbook(workbook, {
      now: () => new Date('2026-06-13T00:00:00.000Z')
    });

    expect(hydrated.settings).toEqual({
      activeAdvisorThreadId: 'thread-two',
      untouched: true
    });
    expect(hydrated.advisorThreads[0].messages[0]).toMatchObject({
      text: 'Net worth answer',
      references: [
        {
          token: 'PHP 650.00',
          source_refs: ['computed.totals.net_worth']
        }
      ]
    });
    expect(hydrated.advisorThreads[1].messages[1].actions).toEqual([
      expect.objectContaining({
        id: 'transaction-action',
        type: 'transaction_draft',
        status: 'draft',
        template: 'expense_paid',
        fields: expect.objectContaining({
          date: '2026-06-13',
          amount: 450.13,
          currency: 'PHP',
          categoryId: 'food',
          primaryAccountId: 'cash'
        }),
        missingFields: ['note'],
        aiDraftId: 'draft-transaction-one'
      }),
      {
        id: 'draft-reference',
        type: 'ai_draft_reference',
        aiDraftId: 'draft-cleanup-one',
        title: 'AI Draft',
        summary: '',
        status: 'confirmed'
      }
    ]);
    expect(getActiveAdvisorThread(hydrated)?.id).toBe('thread-two');
    expect(workbook).toEqual(before);
  });

  it('falls back to the first hydrated thread when the saved active ID is missing', () => {
    const hydrated = hydrateAdvisorWorkbook({
      settings: { activeAdvisorThreadId: 'missing-thread' },
      advisorThreads: [
        { id: 'thread-one', messages: [] },
        { id: 'thread-two', messages: [] }
      ]
    });

    expect(hydrated.settings.activeAdvisorThreadId).toBe('thread-one');
    expect(getActiveAdvisorThread(hydrated)?.id).toBe('thread-one');
  });

  it('uses an empty active selection when no Advisor threads exist', () => {
    const hydrated = hydrateAdvisorWorkbook({
      settings: { activeAdvisorThreadId: 'missing-thread' },
      advisorThreads: []
    });

    expect(hydrated.settings.activeAdvisorThreadId).toBe('');
    expect(getActiveAdvisorThread(hydrated)).toBeNull();
  });
});

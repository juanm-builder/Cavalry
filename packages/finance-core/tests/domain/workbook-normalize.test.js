import { describe, expect, it } from 'vitest';
import {
  normalizeWorkbookAdvisorDraftGroups,
  normalizeWorkbookIdentity,
  normalizeWorkbookName,
  normalizeWorkbookSettings
} from '@cavalry/finance-core/domain/workbook/normalize.js';

describe('workbook normalization', () => {
  it('keeps Cavalry as the canonical legacy workbook name', () => {
    expect(normalizeWorkbookName('Ledger Grove')).toBe('Cavalry');
    expect(normalizeWorkbookName('  My Workbook  ')).toBe('My Workbook');
    expect(normalizeWorkbookName('')).toBe('Cavalry');
  });

  it('normalizes workbook identity with deterministic hooks', () => {
    const identity = normalizeWorkbookIdentity(
      {
        currency: 'php'
      },
      {
        uid: () => 'workbook-test',
        now: () => new Date('2026-06-18T00:00:00.000Z')
      }
    );

    expect(identity).toEqual({
      id: 'workbook-test',
      version: 2,
      name: 'Cavalry',
      year: 2026,
      currency: 'PHP',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    });
  });

  it('normalizes workbook settings while accepting locally-normalized nested settings', () => {
    expect(
      normalizeWorkbookSettings(
        {
          settings: {
            usdToBaseRate: '58.5',
            hiddenMonthlyMetrics: { savings: true },
            activeAdvisorThreadId: 'thread-one'
          }
        },
        {
          dashboardLayout: [{ id: 'command', visible: true }],
          subscriptionReviewDecisions: { netflix: { decision: 'ignored' } }
        }
      )
    ).toEqual({
      usdToBaseRate: 58.5,
      hiddenMonthlyMetrics: { savings: true },
      dashboardLayout: [{ id: 'command', visible: true }],
      activeAdvisorThreadId: 'thread-one',
      subscriptionReviewDecisions: { netflix: { decision: 'ignored' } }
    });
  });

  it('normalizes persisted advisor draft groups from workbook data', () => {
    expect(
      normalizeWorkbookAdvisorDraftGroups({
        advisorDraftGroups: [
          {
            group_id: 'group-category-cleanup',
            task_spec_id: 'categorization-review',
            title: 'Category cleanup',
            draft_ids: ['draft-cleanup', ''],
            impact_preview: {
              affected_transactions: 4,
              categories_renamed: 1
            }
          },
          {
            title: 'Dropped empty group',
            draftIds: []
          }
        ]
      })
    ).toEqual([
      expect.objectContaining({
        groupId: 'group-category-cleanup',
        taskSpecId: 'categorization-review',
        draftIds: ['draft-cleanup'],
        impactPreview: expect.objectContaining({
          affectedTransactions: 4,
          categoriesRenamed: 1
        })
      })
    ]);
  });
});

// Tests for draft apply and reject workflows.

import { describe, expect, it } from 'vitest';

import {
  applyDraftGroup,
  rejectDraftGroup
} from '@cavalry/action-review/application/drafts/draft-apply-service.js';
import {
  ExternalDraftServiceError,
  createTransactionBatchDraftGroup,
  getWorkbookCoreFingerprint
} from '@cavalry/action-review/application/drafts/external-draft-service.js';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]).padStart(3, '0');
  };
}

function makeDraftWorkbook() {
  return {
    id: 'wb_apply',
    name: 'Draft Apply Workbook',
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', linkedAccountId: 'food-expense', isActive: true }
    ],
    transactions: [],
    recurringItems: [],
    sheets: [{ id: 'sheet_june', budgets: [] }]
  };
}

const caller = {
  user_id: 'user_1',
  scopes: ['cavalry.draft.apply'],
  allowed_workbook_ids: ['wb_apply']
};

function createReadyTransactionGroup(workbook, createId) {
  return createTransactionBatchDraftGroup({
    workbook,
    caller,
    request: {
      date_default: '2026-06-30',
      currency_default: 'PHP',
      transactions: [
        {
          description: 'Coffee beans',
          amount: 250,
          direction: 'expense',
          payment_account_hint: 'Cash',
          category_hint: 'Food'
        }
      ]
    },
    createId,
    now: () => '2026-06-30T10:00:00.000Z'
  });
}

describe('draft apply/reject service', () => {
  it('requires explicit confirmation and applies a transaction draft once', () => {
    const workbook = makeDraftWorkbook();
    const createId = makeCreateId();
    const group = createReadyTransactionGroup(workbook, createId);
    const before = getWorkbookCoreFingerprint(workbook);

    expect(() => applyDraftGroup({ workbook, draftGroupId: group.draft_group_id })).toThrow(
      ExternalDraftServiceError
    );
    expect(getWorkbookCoreFingerprint(workbook)).toBe(before);

    const applied = applyDraftGroup({
      workbook,
      draftGroupId: group.draft_group_id,
      confirmedByUser: true,
      caller,
      createId,
      now: () => '2026-06-30T10:05:00.000Z'
    });
    const transactionCount = workbook.transactions.length;
    const appliedAgain = applyDraftGroup({
      workbook,
      draftGroupId: group.draft_group_id,
      confirmedByUser: true,
      caller,
      createId
    });

    expect(applied.status).toBe('applied');
    expect(applied.applied_at).toBe('2026-06-30T10:05:00.000Z');
    expect(applied.applied_draft_ids).toEqual([group.drafts[0].draft_id]);
    expect(workbook.transactions).toHaveLength(1);
    expect(workbook.transactions[0]).toMatchObject({
      description: 'Coffee beans',
      reference: 'external:draft:' + group.drafts[0].draft_id,
      source: 'external_draft'
    });
    expect(appliedAgain.status).toBe('applied');
    expect(workbook.transactions).toHaveLength(transactionCount);
  });

  it('rejects a draft group without mutating workbook core data and blocks later apply', () => {
    const workbook = makeDraftWorkbook();
    const createId = makeCreateId();
    const group = createReadyTransactionGroup(workbook, createId);
    const before = getWorkbookCoreFingerprint(workbook);

    const rejected = rejectDraftGroup({
      workbook,
      draftGroupId: group.draft_group_id,
      caller,
      createId,
      now: () => '2026-06-30T10:10:00.000Z'
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejected_at).toBe('2026-06-30T10:10:00.000Z');
    expect(getWorkbookCoreFingerprint(workbook)).toBe(before);
    expect(() =>
      applyDraftGroup({
        workbook,
        draftGroupId: group.draft_group_id,
        confirmedByUser: true,
        caller,
        createId
      })
    ).toThrow('Rejected draft groups cannot be applied.');
  });
});

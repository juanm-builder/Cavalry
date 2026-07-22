// Tests for draft conflict detection.

import { describe, expect, it } from 'vitest';

import { applyDraftGroup } from '@cavalry/action-review/application/drafts/draft-apply-service.js';
import { detectDraftGroupConflicts } from '@cavalry/action-review/application/drafts/draft-conflict-service.js';
import {
  createCategoryChangeDraftGroup,
  createExternalDraftGroupFromActionPlan,
  createTransactionBatchDraftGroup
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
    id: 'wb_conflicts',
    name: 'Draft Conflict Workbook',
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'subscriptions-expense',
        name: 'Subscriptions Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'expense',
        linkedAccountId: 'subscriptions-expense',
        isActive: true
      }
    ],
    transactions: [
      {
        id: 'txn_existing',
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'Lunch',
        amount: 250,
        originalCurrency: 'PHP',
        categoryId: 'subscriptions',
        primaryAccountId: 'cash'
      }
    ],
    recurringItems: [],
    sheets: [{ id: 'sheet_june', budgets: [] }]
  };
}

const caller = { user_id: 'user_1', scopes: ['cavalry.draft.apply'] };

function createReadyDraft(workbook, createId = makeCreateId()) {
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
    createId
  });
}

describe('draft conflict detection', () => {
  it('detects archived and missing account/category references before apply', () => {
    const workbook = makeDraftWorkbook();
    const group = createReadyDraft(workbook);
    workbook.accounts.find((account) => account.id === 'cash').isActive = false;
    workbook.categories = workbook.categories.filter((category) => category.id !== 'food');

    const result = detectDraftGroupConflicts(workbook, group);

    expect(result.ok).toBe(false);
    expect(result.blockingConflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(['archived_account', 'missing_category'])
    );
  });

  it('blocks duplicate transactions created after draft creation', () => {
    const workbook = makeDraftWorkbook();
    const createId = makeCreateId();
    const group = createReadyDraft(workbook, createId);
    workbook.transactions.push({
      id: 'txn_duplicate',
      date: '2026-06-30',
      template: 'expense_paid',
      description: 'Coffee beans',
      amount: 250,
      originalCurrency: 'PHP',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    const result = detectDraftGroupConflicts(workbook, group);

    expect(result.ok).toBe(false);
    expect(
      result.blockingConflicts.some((conflict) => conflict.code === 'duplicate_transaction_created')
    ).toBe(true);
    expect(() =>
      applyDraftGroup({
        workbook,
        draftGroupId: group.draft_group_id,
        confirmedByUser: true,
        caller,
        createId
      })
    ).toThrow('Draft group has conflicts');
  });

  it('detects target transaction changes after category-change draft creation', () => {
    const workbook = makeDraftWorkbook();
    const group = createCategoryChangeDraftGroup({
      workbook,
      caller,
      request: {
        changes: [
          {
            transaction_id: 'txn_existing',
            suggested_category_hint: 'Food'
          }
        ]
      },
      createId: makeCreateId()
    });
    workbook.transactions[0].categoryId = 'food';

    const result = detectDraftGroupConflicts(workbook, group);

    expect(result.ok).toBe(false);
    expect(
      result.blockingConflicts.some((conflict) => conflict.code === 'target_transaction_changed')
    ).toBe(true);
  });

  it('marks invalid amounts and non-ready selected drafts as blocking conflicts', () => {
    const workbook = makeDraftWorkbook();
    const group = createExternalDraftGroupFromActionPlan({
      workbook,
      caller,
      actionPlan: {
        cavalry_action_plan_version: '1.0',
        date_default: '2026-06-30',
        currency_default: 'PHP',
        actions: [
          {
            id: 'bad_txn',
            type: 'create_transaction',
            description: 'Broken',
            amount: 0,
            direction: 'expense',
            payment_account_hint: 'Cash',
            category_hint: 'Food'
          }
        ]
      },
      createId: makeCreateId()
    });

    const result = detectDraftGroupConflicts(workbook, group, {
      selectedDraftIds: [group.drafts[0].draft_id]
    });

    expect(result.ok).toBe(false);
    expect(result.blockingConflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(['draft_not_ready', 'invalid_amount'])
    );
  });
});

// Tests for draft group application services.

import { describe, expect, it } from 'vitest';

import {
  buildDraftGroupReviewModel,
  createLocalDraftGroup,
  hideDraftGroup,
  listDraftGroupsForReview
} from '@cavalry/action-review/application/drafts/draft-group-service.js';
import { createExternalDraftGroupFromActionPlan } from '@cavalry/action-review/application/drafts/external-draft-service.js';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]).padStart(3, '0');
  };
}

function makeDraftWorkbook() {
  return {
    id: 'wb_drafts',
    name: 'Draft Workbook',
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
        id: 'txn_food',
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

describe('draft group service', () => {
  it('creates a local review group and review model without mutating core workbook data', () => {
    const workbook = makeDraftWorkbook();
    const group = createLocalDraftGroup({
      workbook,
      title: 'Manual review group',
      drafts: [
        {
          type: 'transaction',
          status: 'ready',
          title: 'Coffee',
          proposed_values: {
            date: '2026-06-02',
            description: 'Coffee',
            amount: 120,
            currency: 'PHP',
            payment_account_id: 'cash',
            category_id: 'food',
            template: 'expense_paid'
          }
        }
      ],
      createId: makeCreateId(),
      now: () => '2026-06-30T10:00:00.000Z'
    });
    const model = buildDraftGroupReviewModel(workbook, group.draft_group_id);

    expect(model.ok).toBe(true);
    expect(model.canApply).toBe(true);
    expect(model.drafts[0]).toMatchObject({
      type: 'transaction',
      status: 'ready',
      title: 'Coffee'
    });
    expect(listDraftGroupsForReview(workbook)).toHaveLength(1);
  });

  it('creates transaction, category-change, recurring, and budget drafts through existing action-plan draft creation', () => {
    const workbook = makeDraftWorkbook();
    const group = createExternalDraftGroupFromActionPlan({
      workbook,
      caller: { user_id: 'user_1', scopes: ['cavalry.draft.create'] },
      actionPlan: {
        cavalry_action_plan_version: '1.0',
        date_default: '2026-06-02',
        currency_default: 'PHP',
        actions: [
          {
            id: 'txn_1',
            type: 'create_transaction',
            description: 'Coffee',
            amount: 120,
            direction: 'expense',
            payment_account_hint: 'Cash',
            category_hint: 'Food'
          },
          {
            id: 'cat_1',
            type: 'update_category_assignment',
            transaction_id: 'txn_food',
            suggested_category_hint: 'Food'
          },
          {
            id: 'rec_1',
            type: 'create_recurring_item',
            name: 'ChatGPT Pro',
            amount: 6490,
            cadence: 'monthly',
            category_hint: 'Subscriptions'
          },
          {
            id: 'budget_1',
            type: 'update_budget',
            category_hint: 'Food',
            amount: 5000
          }
        ]
      },
      createId: makeCreateId()
    });

    expect(group.drafts.map((draft) => draft.type)).toEqual([
      'transaction',
      'category_change',
      'recurring_item',
      'budget_change'
    ]);
    expect(group.summary.ready).toBe(4);
  });

  it('hides only resolved draft groups', () => {
    const workbook = makeDraftWorkbook();
    const group = createLocalDraftGroup({
      workbook,
      title: 'Resolved group',
      drafts: [{ type: 'transaction', status: 'ready', title: 'Coffee' }],
      createId: makeCreateId()
    });

    expect(() => hideDraftGroup(workbook, group.draft_group_id)).toThrow(
      'Only resolved draft groups can be hidden.'
    );
    group.status = 'rejected';
    expect(
      hideDraftGroup(workbook, group.draft_group_id, { now: () => '2026-06-30T11:00:00.000Z' })
        .hidden_at
    ).toBe('2026-06-30T11:00:00.000Z');
    expect(listDraftGroupsForReview(workbook, { includeResolved: true })).toHaveLength(0);
    expect(
      listDraftGroupsForReview(workbook, { includeResolved: true, includeHidden: true })
    ).toHaveLength(1);
  });
});

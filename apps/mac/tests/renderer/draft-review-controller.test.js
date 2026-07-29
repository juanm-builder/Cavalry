import { describe, expect, it } from 'vitest';

import { createTransactionBatchDraftGroup } from '@cavalry/action-review/application/drafts/external-draft-service.js';
import { buildCheckpointDiff } from '@cavalry/action-review/domain/checkpoints/diff.js';
import { buildInversePatch } from '@cavalry/action-review/domain/checkpoints/inverse-patch.js';
import {
  buildDraftReviewFeatureModel,
  DRAFT_REVIEW_ACTIONS,
  executeDraftReviewCommand,
  formatDraftProposedRows,
  previewCheckpointRollback
} from '../../src/renderer/features/drafts/draft-review-controller.js';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}_${counters[prefix]}`;
  };
}

function makeWorkbook() {
  return {
    id: 'draft-ui-workbook',
    version: 2,
    name: 'Draft Review',
    year: 2026,
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
    sheets: [{ id: 'sheet-june', budgets: [] }],
    aiDrafts: [],
    advisorDraftGroups: [],
    externalDraftGroups: [],
    checkpoints: [],
    checkpointAuditEvents: [],
    checkpointIdempotencyRecords: []
  };
}

function addReadyGroup(workbook, createId) {
  return createTransactionBatchDraftGroup({
    workbook,
    caller: {
      user_id: 'user-1',
      scopes: ['cavalry.draft.apply'],
      allowed_workbook_ids: [workbook.id]
    },
    request: {
      date_default: '2026-07-01',
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
    now: () => '2026-07-01T09:00:00.000Z'
  });
}

function addCheckpoint(workbook) {
  const before = { id: 'txn-checkpoint', description: 'Before', amount: 100, baseAmount: 100 };
  const after = { id: 'txn-checkpoint', description: 'After', amount: 125, baseAmount: 125 };
  const diff = buildCheckpointDiff(before, after);
  workbook.transactions.push(after);
  workbook.checkpoints.push({
    checkpoint_id: 'checkpoint-1',
    checkpoint_version: '1.0',
    workbook_id: workbook.id,
    actor: { type: 'external_ai', display_name: 'ChatGPT Companion' },
    origin: 'chatgpt_companion',
    status: 'applied',
    created_at: '2026-07-01T08:00:00.000Z',
    source_prompt: 'Update transaction.',
    summary: { applied: 1, blocked: 0, warnings: 0 },
    changes: [
      {
        change_id: 'change-1',
        action_id: 'action-1',
        action_type: 'update_transaction',
        entity_type: 'transaction',
        entity_id: after.id,
        operation: 'update',
        before: diff.before,
        after: diff.after,
        before_fingerprint: diff.before_fingerprint,
        after_fingerprint: diff.after_fingerprint,
        inverse_patch: buildInversePatch({
          operation: 'update',
          entityType: 'transaction',
          entityId: after.id,
          before,
          after
        }),
        status: 'applied',
        validation_issues: [],
        warnings: [],
        human_summary: 'Updated checkpoint transaction.'
      }
    ],
    validation_issues: [],
    warnings: []
  });
}

describe('draft review controller', () => {
  it('requires approval and applies external drafts on a new workbook identity', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const group = addReadyGroup(workbook, createId);
    const denied = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.APPLY,
        payload: { kind: 'external-group', id: group.draft_group_id }
      },
      { createId, now: () => '2026-07-01T10:00:00.000Z' }
    );
    const result = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.APPLY,
        payload: {
          kind: 'external-group',
          id: group.draft_group_id,
          selectedDraftIds: [group.drafts[0].draft_id],
          confirmedByUser: true
        }
      },
      { createId, now: () => '2026-07-01T10:00:00.000Z' }
    );

    expect(denied.ok).toBe(false);
    expect(denied.workbook).toBe(workbook);
    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.transactions).toHaveLength(0);
    expect(result.workbook.transactions).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'draft.applied',
      draftId: group.draft_group_id
    });
  });

  it('rejects a group immutably and preserves it in decision history', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const group = addReadyGroup(workbook, createId);
    const result = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.REJECT,
        payload: { kind: 'external-group', id: group.draft_group_id }
      },
      { createId, now: () => '2026-07-01T10:00:00.000Z' }
    );

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.externalDraftGroups[0].status).toBe('rejected');
    expect(workbook.externalDraftGroups[0].status).not.toBe('rejected');
  });

  it('previews, approves, and rolls back checkpoint changes safely', () => {
    const workbook = makeWorkbook();
    addCheckpoint(workbook);
    const preview = previewCheckpointRollback(workbook, {
      checkpointId: 'checkpoint-1',
      changeIds: ['change-1']
    });
    const approved = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.APPROVE_CHECKPOINT,
        payload: { checkpointId: 'checkpoint-1' }
      },
      { now: () => '2026-07-01T11:00:00.000Z' }
    );
    const rolledBack = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.ROLLBACK_CHECKPOINT,
        payload: { checkpointId: 'checkpoint-1', changeIds: ['change-1'], confirmedByUser: true }
      },
      { createId: makeCreateId(), now: () => '2026-07-01T11:05:00.000Z' }
    );

    expect(preview).toMatchObject({ status: 'rolled_back', conflicted_changes: [] });
    expect(approved.workbook.checkpoints[0]).toMatchObject({ review_status: 'approved' });
    expect(approved.workbook).not.toBe(workbook);
    expect(rolledBack.ok).toBe(true);
    expect(
      rolledBack.workbook.transactions.find((transaction) => transaction.id === 'txn-checkpoint')
        .description
    ).toBe('Before');
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-checkpoint').description
    ).toBe('After');
  });

  it('blocks rollback when the current entity drifted after the checkpoint', () => {
    const workbook = makeWorkbook();
    addCheckpoint(workbook);
    workbook.transactions[0].description = 'User changed this later';
    const result = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.ROLLBACK_CHECKPOINT,
        payload: { checkpointId: 'checkpoint-1', changeIds: ['change-1'], confirmedByUser: true }
      },
      { createId: makeCreateId(), now: () => '2026-07-01T11:05:00.000Z' }
    );

    expect(result.ok).toBe(false);
    expect(result.workbook).toBe(workbook);
    expect(result.errors[0].code).toBe('checkpoint.rollback_conflict');
  });

  it('builds a serializable queue with source metadata and checkpoint rows', () => {
    const workbook = makeWorkbook();
    addReadyGroup(workbook, makeCreateId());
    addCheckpoint(workbook);
    const model = buildDraftReviewFeatureModel(workbook);

    expect(model.openCount).toBe(1);
    expect(model.queueItems[0]).toMatchObject({ kind: 'external-group', canApply: true });
    expect(model.queueItems[0].source.visible).toBe(true);
    expect(model.checkpoints.visibleChangeRows[0]).toMatchObject({
      changeId: 'change-1',
      reversible: true
    });
    expect(() => JSON.stringify(model)).not.toThrow();
  });

  it('formats money with grouping separators and updates local draft fields immutably', () => {
    const workbook = makeWorkbook();
    workbook.aiDrafts.push({
      id: 'account-draft',
      status: 'pending',
      operation: 'create',
      objectType: 'account',
      title: 'Create savings account',
      summary: 'Open a named savings account.',
      proposed: { name: 'BDO Savings', openingBalance: 1000000, currency: 'PHP' },
      source: {},
      sourceRefs: [],
      createdAt: '2026-07-01T09:00:00.000Z'
    });
    const rows = formatDraftProposedRows(workbook.aiDrafts[0].proposed, { workbook });
    const result = executeDraftReviewCommand(
      workbook,
      {
        type: DRAFT_REVIEW_ACTIONS.UPDATE,
        payload: {
          kind: 'ai-draft',
          id: 'account-draft',
          path: ['openingBalance'],
          value: '1,250,000.50'
        }
      },
      { now: () => '2026-07-01T10:00:00.000Z' }
    );

    expect(rows.find((row) => row.key === 'openingBalance')).toMatchObject({
      label: 'Opening balance',
      value: '₱1,000,000.00',
      editable: true,
      money: true
    });
    expect(result.ok).toBe(true);
    expect(result.events[0]).toMatchObject({ type: 'draft.updated', draftId: 'account-draft' });
    expect(result.workbook.aiDrafts[0].proposed.openingBalance).toBe(1250000.5);
    expect(workbook.aiDrafts[0].proposed.openingBalance).toBe(1000000);
  });

  it('classifies account detail amounts as money fields', () => {
    const workbook = makeWorkbook();
    const proposed = {
      creditLimit: 100000,
      annualFee: 2500,
      costBasis: 80000,
      monthlyContribution: 5000,
      estimatedMaturityAmount: 125000,
      originalBalance: 500000,
      monthlyPayment: 15000,
      acquisitionCost: 900000
    };

    const rows = formatDraftProposedRows(proposed, { workbook });

    expect(rows).toHaveLength(Object.keys(proposed).length);
    expect(rows.every((row) => row.money)).toBe(true);
    expect(rows.find((row) => row.key === 'creditLimit').value).toBe('₱100,000.00');
    expect(rows.find((row) => row.key === 'estimatedMaturityAmount').value).toBe('₱125,000.00');
  });

  it('describes the compatible category type even when the workbook has no categories', () => {
    const workbook = makeWorkbook();
    workbook.categories = [];

    const rows = formatDraftProposedRows(
      {
        direction: 'expense',
        template: 'expense_paid',
        category_id: ''
      },
      {
        workbook,
        draftType: 'transaction',
        includeEmpty: true
      }
    );

    expect(rows.find((row) => row.key === 'category_id')).toMatchObject({
      inputOptions: [],
      categoryTypes: ['expense'],
      editable: true
    });
  });

  it('infers category-change types from the transaction being recategorized', () => {
    const workbook = makeWorkbook();
    workbook.categories.push({
      id: 'salary',
      name: 'Salary',
      type: 'income',
      linkedAccountId: 'income-account',
      isActive: true
    });
    workbook.transactions.push({
      id: 'income-transaction',
      template: 'income_received',
      categoryId: 'salary'
    });

    const rows = formatDraftProposedRows(
      {
        transaction_id: 'income-transaction',
        suggested_category_id: 'salary'
      },
      { workbook, draftType: 'category_change' }
    );

    expect(rows.find((row) => row.key === 'suggested_category_id').categoryTypes).toEqual([
      'income'
    ]);
  });
});

// Tests for checkpointed action execution.

import { describe, expect, it } from 'vitest';

import { executeCheckpointedActionPlan } from '@cavalry/action-review/application/ai-actions/checkpointed-action-executor.js';
import { exportCheckpointAuditEvents } from '@cavalry/action-review/application/checkpoints/checkpoint-audit.js';
import {
  previewRollback,
  rollbackCheckpoint
} from '@cavalry/action-review/application/checkpoints/rollback-service.js';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]).padStart(3, '0');
  };
}

function makeWorkbook() {
  return {
    id: 'wb_1',
    name: 'Checkpoint Workbook',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    currentDate: '2026-06-28',
    accounts: [
      { id: 'gcash', name: 'GCash', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'credit_card',
        name: 'Credit Card',
        group: 'liability',
        currency: 'USD',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'personal',
        name: 'Personal',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_personal'
      },
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_food'
      },
      {
        id: 'software',
        name: 'Software',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_software'
      },
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_subscriptions'
      }
    ],
    transactions: [
      {
        id: 'txn_existing',
        date: '2026-06-20',
        template: 'expense_paid',
        description: 'Unknown store',
        amount: 120,
        originalCurrency: 'PHP',
        categoryId: 'personal',
        primaryAccountId: 'cash',
        lines: []
      }
    ],
    recurringItems: [],
    sheets: [
      { id: 'sheet_june', budgets: [{ categoryId: 'software', planned: 500, period: 'monthly' }] }
    ]
  };
}

function caller() {
  return {
    user_id: 'user_1',
    subject_type: 'beta_gpt_action',
    caller_type: 'beta_gpt_action',
    auth_method: 'beta_api_key',
    scopes: ['cavalry.ai.checkpoint.execute', 'cavalry.ai.checkpoint.read'],
    allowed_workbook_ids: ['wb_1']
  };
}

describe('checkpointed action executor', () => {
  it('dry-runs supported actions without mutating or creating checkpoints', () => {
    const workbook = makeWorkbook();
    const result = executeCheckpointedActionPlan({
      workbook,
      workbookId: 'wb_1',
      actionPlan: {
        date_default: '2026-06-28',
        actions: [
          {
            id: 'a1',
            type: 'create_transaction',
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'Credit Card',
            category_hint: 'Software'
          }
        ]
      },
      callerContext: caller(),
      executionMode: 'checkpointed_apply',
      idempotencyKey: 'idem-dry-run',
      dryRun: true,
      createId: makeCreateId()
    });

    expect(result.status).toBe('dry_run');
    expect(result.summary.applied).toBe(1);
    expect(workbook.transactions).toHaveLength(1);
    expect(workbook.checkpoints || []).toHaveLength(0);
  });

  it('applies reversible changes, blocks irreversible actions, audits safely, and rolls back', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const result = executeCheckpointedActionPlan({
      workbook,
      workbookId: 'wb_1',
      actionPlan: {
        id: 'plan_1',
        date_default: '2026-06-28',
        currency_default: 'PHP',
        actions: [
          {
            id: 'create_txn',
            type: 'create_transaction',
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'Credit Card',
            category_hint: 'Software'
          },
          {
            id: 'categorize_txn',
            type: 'update_category_assignment',
            transaction_id: 'txn_existing',
            suggested_category_hint: 'Food'
          },
          {
            id: 'recurring_1',
            type: 'create_recurring_item',
            name: 'ChatGPT Pro',
            amount: 6490,
            cadence: 'monthly',
            category_hint: 'Subscriptions'
          },
          {
            id: 'budget_1',
            type: 'update_budget',
            category_hint: 'Software',
            amount: 1200
          },
          {
            id: 'danger_1',
            type: 'delete_all_transactions'
          }
        ]
      },
      callerContext: caller(),
      executionMode: 'checkpointed_apply',
      idempotencyKey: 'idem-secret-token',
      sourcePrompt: 'Add API credits and track subscription.',
      createId,
      now: () => '2026-06-28T01:00:00.000Z',
      requestId: 'req_1'
    });

    expect(result.status).toBe('partially_applied_with_checkpoint');
    expect(result.summary).toMatchObject({
      applied: 4,
      blocked: 1,
      irreversible_actions_blocked: 1
    });
    expect(result.blocked_actions[0]).toMatchObject({ code: 'irreversible_action_blocked' });
    expect(workbook.transactions).toHaveLength(2);
    expect(
      workbook.transactions.find(
        (transaction) => transaction.reference === 'checkpointed:create_txn'
      ).lines
    ).toHaveLength(2);
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn_existing').categoryId
    ).toBe('food');
    expect(workbook.recurringItems).toHaveLength(1);
    expect(
      workbook.sheets[0].budgets.find((budget) => budget.categoryId === 'software').planned
    ).toBe(1200);
    expect(workbook.checkpoints).toHaveLength(1);
    expect(workbook.checkpoints[0]).toMatchObject({
      checkpoint_id: 'cp_001',
      checkpoint_review_url: 'cavalry://checkpoints/cp_001',
      source_prompt: 'Add API credits and track subscription.'
    });
    expect(JSON.stringify(exportCheckpointAuditEvents(workbook))).not.toContain(
      'idem-secret-token'
    );

    const preview = previewRollback({ workbook, checkpointId: result.checkpoint_id });
    expect(preview).toMatchObject({
      checkpoint_id: result.checkpoint_id,
      status: 'rolled_back',
      conflicted_changes: []
    });

    const rolledBack = rollbackCheckpoint({
      workbook,
      checkpointId: result.checkpoint_id,
      caller: caller(),
      createId,
      now: () => '2026-06-28T01:05:00.000Z'
    });
    expect(rolledBack.status).toBe('rolled_back');
    expect(workbook.transactions).toHaveLength(1);
    expect(workbook.transactions[0].categoryId).toBe('personal');
    expect(workbook.recurringItems).toHaveLength(0);
    expect(
      workbook.sheets[0].budgets.find((budget) => budget.categoryId === 'software').planned
    ).toBe(500);
    expect(workbook.checkpoints[0].status).toBe('rolled_back');
  });

  it('replays matching idempotency keys and rejects conflicting reuse', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const actionPlan = {
      date_default: '2026-06-28',
      actions: [
        {
          id: 'a1',
          type: 'create_transaction',
          description: 'Coffee',
          amount: 90,
          direction: 'expense',
          payment_account_hint: 'GCash',
          category_hint: 'Personal'
        }
      ]
    };
    const first = executeCheckpointedActionPlan({
      workbook,
      workbookId: 'wb_1',
      actionPlan,
      callerContext: caller(),
      executionMode: 'checkpointed_apply',
      idempotencyKey: 'idem-replay',
      createId
    });
    const replay = executeCheckpointedActionPlan({
      workbook,
      workbookId: 'wb_1',
      actionPlan,
      callerContext: caller(),
      executionMode: 'checkpointed_apply',
      idempotencyKey: 'idem-replay',
      createId
    });
    const conflict = executeCheckpointedActionPlan({
      workbook,
      workbookId: 'wb_1',
      actionPlan: Object.assign({}, actionPlan, {
        actions: [Object.assign({}, actionPlan.actions[0], { amount: 91 })]
      }),
      callerContext: caller(),
      executionMode: 'checkpointed_apply',
      idempotencyKey: 'idem-replay',
      createId
    });

    expect(first.checkpoint_id).toBe(replay.checkpoint_id);
    expect(replay.idempotency_replayed).toBe(true);
    expect(
      workbook.transactions.filter((transaction) => transaction.reference === 'checkpointed:a1')
    ).toHaveLength(1);
    expect(conflict.status).toBe('validation_failed');
    expect(conflict.validation_issues[0]).toMatchObject({ code: 'idempotency_conflict' });
  });

  it('detects rollback conflicts after a user edits checkpointed data', () => {
    const workbook = makeWorkbook();
    const result = executeCheckpointedActionPlan({
      workbook,
      workbookId: 'wb_1',
      actionPlan: {
        actions: [
          {
            id: 'categorize_txn',
            type: 'update_category_assignment',
            transaction_id: 'txn_existing',
            suggested_category_hint: 'Food'
          }
        ]
      },
      callerContext: caller(),
      executionMode: 'checkpointed_apply',
      idempotencyKey: 'idem-conflict',
      createId: makeCreateId()
    });

    workbook.transactions[0].description = 'User edited after checkpoint';
    const preview = previewRollback({ workbook, checkpointId: result.checkpoint_id });
    expect(preview.status).toBe('conflict');
    expect(preview.conflicted_changes[0]).toMatchObject({
      entity_id: 'txn_existing',
      reason: 'entity_changed_after_checkpoint'
    });
  });
});

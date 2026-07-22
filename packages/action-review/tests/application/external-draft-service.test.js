// Tests for external draft application services.

import { describe, expect, it } from 'vitest';

import {
  ExternalDraftServiceError,
  applyExternalDraftGroup,
  createCategoryChangeDraftGroup,
  createExternalDraftGroupFromActionPlan,
  createRecurringItemDraftGroup,
  createTransactionBatchDraftGroup,
  getWorkbookCoreFingerprint,
  rejectExternalDraftGroup
} from '@cavalry/action-review/application/drafts/external-draft-service.js';

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
    name: 'The Plan',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    accounts: [
      {
        id: 'office_cash_account',
        name: 'Office Cash Account',
        group: 'asset',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'credit_card',
        name: 'Credit Card',
        group: 'liability',
        currency: 'USD',
        isActive: true
      },
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true }
    ],
    categories: [
      {
        id: 'office_supplies',
        name: 'Office Supplies',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_office_supplies'
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
      },
      {
        id: 'transport',
        name: 'Transport',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_transport'
      },
      { id: 'food', name: 'Food', type: 'expense', isActive: true, linkedAccountId: 'expense_food' }
    ],
    transactions: [
      {
        id: 'txn_existing',
        date: '2026-06-27',
        template: 'expense_paid',
        description: 'Printer paper',
        amount: 150,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'office_cash_account'
      },
      {
        id: 'txn_food',
        date: '2026-06-20',
        template: 'expense_paid',
        description: 'Unknown store',
        amount: 120,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'cash'
      }
    ],
    recurringItems: [],
    sheets: [{ id: 'sheet_june', budgets: [] }]
  };
}

const caller = {
  user_id: 'user_1',
  scopes: ['cavalry.draft.create', 'cavalry.draft.read'],
  allowed_workbook_ids: ['wb_1'],
  subject_type: 'user'
};

describe('external draft service', () => {
  it('creates a mixed transaction draft group without mutating workbook core data', () => {
    const workbook = makeWorkbook();
    const before = getWorkbookCoreFingerprint(workbook);
    const group = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request: {
        date_default: '2026-06-27',
        currency_default: 'PHP',
        transactions: [
          {
            description: 'Printer paper',
            amount: 150,
            direction: 'expense',
            payment_account_hint: 'Office Cash Account',
            category_hint: 'Office Supplies'
          },
          {
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'Credit Card',
            category_hint: 'Software'
          },
          {
            description: 'Groceries',
            amount: 500,
            direction: 'expense'
          }
        ]
      },
      origin: { origin: 'chatgpt_action' },
      createId: makeCreateId(),
      now: () => '2026-06-27T10:00:00.000Z'
    });

    expect(getWorkbookCoreFingerprint(workbook)).toBe(before);
    expect(group.summary).toMatchObject({
      total: 3,
      ready: 1,
      needs_review: 2,
      blocked: 0
    });
    expect(group.drafts[0].validation_issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'possible_duplicate' })])
    );
    expect(group.drafts[1]).toMatchObject({
      status: 'ready',
      proposed_values: expect.objectContaining({
        payment_account_id: 'credit_card',
        template: 'expense_charged'
      })
    });
    expect(workbook.externalDraftGroups).toHaveLength(1);
    expect(workbook.externalApiAuditEvents[0]).toMatchObject({
      operation: 'createTransactionDraftBatch',
      result_status: 'success',
      draft_group_id: group.draft_group_id
    });
  });

  it('keeps credit-card charge language as an expense draft, not account creation', () => {
    const workbook = makeWorkbook();
    const group = createExternalDraftGroupFromActionPlan({
      workbook,
      caller,
      actionPlan: {
        cavalry_action_plan_version: '1.0',
        date_default: '2026-06-27',
        currency_default: 'PHP',
        actions: [
          {
            id: 'cc_1',
            type: 'create_transaction',
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'credit card',
            category_hint: 'Software',
            source_text: '15usd charged to my credit card for open ai API'
          }
        ]
      },
      origin: { origin: 'chatgpt_action' },
      createId: makeCreateId()
    });

    expect(group.drafts[0]).toMatchObject({
      type: 'transaction',
      status: 'ready',
      proposed_values: expect.objectContaining({
        template: 'expense_charged',
        payment_account_id: 'credit_card'
      })
    });
    expect(group.drafts[0].type).not.toBe('account_change');
  });

  it('creates recurring-item drafts while marking load/RFID-style items for review', () => {
    const workbook = makeWorkbook();
    const group = createRecurringItemDraftGroup({
      workbook,
      caller,
      request: {
        items: [
          {
            name: 'ChatGPT Pro',
            amount: 6490,
            currency: 'PHP',
            cadence: 'monthly',
            category_hint: 'Subscriptions',
            confidence: 'high'
          },
          {
            name: 'RFID Card Load',
            amount: 1012,
            currency: 'PHP',
            cadence: 'unknown',
            category_hint: 'Transport',
            confidence: 'low'
          }
        ]
      },
      createId: makeCreateId()
    });

    expect(group.drafts.map((draft) => draft.status)).toEqual(['ready', 'needs_review']);
    expect(group.drafts[1].validation_issues.map((issue) => issue.code)).toContain(
      'invalid_schema'
    );
  });

  it('creates category-change drafts for stable transaction IDs', () => {
    const workbook = makeWorkbook();
    const group = createCategoryChangeDraftGroup({
      workbook,
      caller,
      request: {
        changes: [
          {
            transaction_id: 'txn_food',
            suggested_category_hint: 'Food',
            reason: 'Merchant appears to be food.'
          }
        ]
      },
      createId: makeCreateId()
    });

    expect(group.drafts[0]).toMatchObject({
      type: 'category_change',
      status: 'ready',
      proposed_values: {
        transaction_id: 'txn_food',
        suggested_category_id: 'food',
        suggested_category_display: 'Food',
        reason: 'Merchant appears to be food.'
      }
    });
  });

  it('applies only after explicit Cavalry-side confirmation and is idempotent', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const group = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request: {
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'Credit Card',
            category_hint: 'Software'
          }
        ]
      },
      createId
    });
    const beforeApply = getWorkbookCoreFingerprint(workbook);

    expect(() => applyExternalDraftGroup({ workbook, draftGroupId: group.draft_group_id })).toThrow(
      ExternalDraftServiceError
    );
    expect(getWorkbookCoreFingerprint(workbook)).toBe(beforeApply);

    const applied = applyExternalDraftGroup({
      workbook,
      draftGroupId: group.draft_group_id,
      confirmedByUser: true,
      caller,
      createId
    });
    const afterFirstApply = getWorkbookCoreFingerprint(workbook);
    const appliedAgain = applyExternalDraftGroup({
      workbook,
      draftGroupId: group.draft_group_id,
      confirmedByUser: true,
      caller,
      createId
    });

    expect(applied.status).toBe('applied');
    expect(appliedAgain.status).toBe('applied');
    expect(getWorkbookCoreFingerprint(workbook)).toBe(afterFirstApply);
    expect(
      workbook.transactions.filter(
        (transaction) => transaction.reference === 'external:draft:' + group.drafts[0].draft_id
      )
    ).toHaveLength(1);
  });

  it('rejecting a draft group leaves workbook core data unchanged', () => {
    const workbook = makeWorkbook();
    const group = createRecurringItemDraftGroup({
      workbook,
      caller,
      request: {
        items: [
          { name: 'ChatGPT Pro', amount: 6490, cadence: 'monthly', category_hint: 'Subscriptions' }
        ]
      },
      createId: makeCreateId()
    });
    const beforeReject = getWorkbookCoreFingerprint(workbook);
    const rejected = rejectExternalDraftGroup({
      workbook,
      draftGroupId: group.draft_group_id,
      caller
    });

    expect(rejected.status).toBe('rejected');
    expect(getWorkbookCoreFingerprint(workbook)).toBe(beforeReject);
  });

  it('returns the same draft group for idempotent retries and rejects conflicts', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const request = {
      date_default: '2026-06-27',
      transactions: [
        {
          description: 'OpenAI API credits',
          amount: 15,
          currency: 'USD',
          direction: 'expense',
          payment_account_hint: 'Credit Card',
          category_hint: 'Software'
        }
      ]
    };
    const first = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request,
      idempotencyKey: 'idem-1',
      createId
    });
    const replay = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request,
      idempotencyKey: 'idem-1',
      createId
    });

    expect(replay.draft_group_id).toBe(first.draft_group_id);
    expect(replay.idempotency_replayed).toBe(true);
    expect(() =>
      createTransactionBatchDraftGroup({
        workbook,
        caller,
        request: Object.assign({}, request, {
          transactions: request.transactions.map((transaction) =>
            Object.assign({}, transaction, { amount: 16 })
          )
        }),
        idempotencyKey: 'idem-1',
        createId
      })
    ).toThrow(ExternalDraftServiceError);
  });

  it('creates a fresh group when idempotency key is omitted', () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const request = {
      date_default: '2026-06-27',
      transactions: [
        {
          description: 'OpenAI API credits',
          amount: 15,
          currency: 'USD',
          direction: 'expense',
          payment_account_hint: 'Credit Card',
          category_hint: 'Software'
        }
      ]
    };
    const first = createTransactionBatchDraftGroup({ workbook, caller, request, createId });
    const second = createTransactionBatchDraftGroup({ workbook, caller, request, createId });

    expect(second.draft_group_id).not.toBe(first.draft_group_id);
    expect(workbook.externalDraftGroups).toHaveLength(2);
  });

  it('does not mark same amount and description in a different currency as duplicate', () => {
    const workbook = makeWorkbook();
    workbook.transactions = [
      {
        id: 'txn_usd',
        date: '2026-06-27',
        template: 'expense_charged',
        description: 'OpenAI API credits',
        amount: 15,
        originalCurrency: 'USD',
        categoryId: 'software',
        primaryAccountId: 'credit_card'
      }
    ];
    const group = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request: {
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'PHP',
            direction: 'expense',
            payment_account_hint: 'Office Cash Account',
            category_hint: 'Software'
          }
        ]
      },
      createId: makeCreateId()
    });

    expect(group.drafts[0].validation_issues.map((issue) => issue.code)).not.toContain(
      'possible_duplicate'
    );
  });

  it('marks near duplicates with different notes for review instead of applying automatically', () => {
    const workbook = makeWorkbook();
    workbook.transactions = [
      {
        id: 'txn_near',
        date: '2026-06-27',
        template: 'expense_paid',
        description: 'Printer paper',
        amount: 150,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'office_cash_account'
      }
    ];
    const group = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request: {
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'Printer paper',
            amount: 150,
            currency: 'PHP',
            direction: 'expense',
            payment_account_hint: 'Office Cash Account',
            category_hint: 'Office Supplies',
            notes: 'Different note from original'
          }
        ]
      },
      createId: makeCreateId()
    });

    expect(group.drafts[0].validation_issues.map((issue) => issue.code)).toContain(
      'possible_duplicate'
    );
    expect(workbook.transactions).toHaveLength(1);
  });

  it('keeps duplicate warnings in the projected review queue', () => {
    const workbook = makeWorkbook();
    const group = createTransactionBatchDraftGroup({
      workbook,
      caller,
      request: {
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'Printer paper',
            amount: 150,
            currency: 'PHP',
            direction: 'expense',
            payment_account_hint: 'Office Cash Account',
            category_hint: 'Office Supplies'
          }
        ]
      },
      createId: makeCreateId()
    });
    const projected = workbook.aiDrafts.find(
      (draft) => draft.source && draft.source.externalDraftGroupId === group.draft_group_id
    );

    expect(projected.source.validationIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'possible_duplicate' })])
    );
  });

  it('records sanitized audit events for validation failures', () => {
    const workbook = makeWorkbook();
    expect(() =>
      createExternalDraftGroupFromActionPlan({
        workbook,
        caller: Object.assign({}, caller, {
          request_id: 'req_validation_failure',
          auth_method: 'beta_api_key'
        }),
        actionPlan: {
          cavalry_action_plan_version: '1.0',
          actions: [{ type: 'delete_transactions', id: 'bad_delete' }]
        },
        origin: { origin: 'chatgpt_action' },
        idempotencyKey: 'bad-delete-key',
        createId: makeCreateId()
      })
    ).toThrow(ExternalDraftServiceError);

    expect(workbook.externalApiAuditEvents[0]).toMatchObject({
      request_id: 'req_validation_failure',
      origin: 'chatgpt_action',
      operation_id: 'createDraftGroupFromActionPlan',
      outcome: 'validation_failed',
      idempotency_result: 'created'
    });
    expect(JSON.stringify(workbook.externalApiAuditEvents[0])).not.toContain('delete_transactions');
    expect(JSON.stringify(workbook.externalApiAuditEvents[0])).not.toContain('cavb_');
  });
});

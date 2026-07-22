// Tests for the Companion API application controller contract.

import { describe, expect, it } from 'vitest';

import {
  createCavalryApiController,
  createMemoryWorkbookStore
} from '@cavalry/companion-api/application/api/cavalry-api-controller.js';
import { CAVALRY_API_SCOPES } from '@cavalry/companion-api/application/api/cavalry-api-authz.js';
import { CavalryApiError } from '@cavalry/companion-api/application/api/cavalry-api-errors.js';

function makeWorkbook() {
  return {
    id: 'wb_1',
    name: 'The Plan',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    accounts: [
      { id: 'gcash', name: 'GCash', group: 'asset', currency: 'PHP', isActive: true },
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
        id: 'software',
        name: 'Software',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_software'
      }
    ],
    transactions: [
      {
        id: 'txn_1',
        date: '2026-06-27',
        template: 'expense_paid',
        description: 'Coffee',
        amount: 100,
        originalCurrency: 'PHP',
        categoryId: 'software',
        primaryAccountId: 'gcash',
        lines: []
      }
    ]
  };
}

function caller(scopes, allowed = ['wb_1']) {
  return {
    user_id: 'user_1',
    scopes,
    allowed_workbook_ids: allowed,
    subject_type: 'user'
  };
}

describe('Cavalry API controller', () => {
  it('fails unauthenticated and insufficient-scope requests safely', () => {
    const controller = createCavalryApiController({ workbooks: [makeWorkbook()] });

    expect(() => controller.listWorkbooks({ caller: null })).toThrow(CavalryApiError);
    expect(() =>
      controller.createTransactionDraftBatch({
        caller: caller([CAVALRY_API_SCOPES.READ_SUMMARY]),
        workbookId: 'wb_1',
        body: { transactions: [] }
      })
    ).toThrow(CavalryApiError);
  });

  it('reads summaries with read scope and rejects cross-workbook access', () => {
    const controller = createCavalryApiController({ workbooks: [makeWorkbook()] });
    const summary = controller.getWorkbookSummary({
      caller: caller([CAVALRY_API_SCOPES.READ_SUMMARY]),
      workbookId: 'wb_1',
      query: { start_date: '2026-06-01', end_date: '2026-06-30' }
    });

    expect(summary.totals.consumption_spending).toBe(100);
    expect(summary.account_snapshot).toMatchObject({
      packet_version: 'cavalry.account_snapshot.v1',
      accounts: expect.arrayContaining([
        expect.objectContaining({
          account_id: 'gcash',
          source_ref: 'account:gcash'
        })
      ])
    });
    expect(() =>
      controller.getWorkbookSummary({
        caller: caller([CAVALRY_API_SCOPES.READ_SUMMARY], ['wb_other']),
        workbookId: 'wb_1'
      })
    ).toThrow(CavalryApiError);
  });

  it('lists accounts with balance metadata for Custom GPT account advice', () => {
    const controller = createCavalryApiController({ workbooks: [makeWorkbook()] });
    const response = controller.listAccounts({
      caller: caller([CAVALRY_API_SCOPES.READ_ACCOUNTS]),
      workbookId: 'wb_1',
      query: { as_of_date: '2026-06-30' }
    });

    expect(response.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: 'gcash',
          is_active: true,
          is_system: false,
          balance: expect.any(String),
          balance_currency: 'PHP',
          balance_as_of: '2026-06-30',
          source_ref: 'account:gcash'
        })
      ])
    );
  });

  it('creates transaction draft groups with draft scope and audit events', () => {
    const workbook = makeWorkbook();
    const store = createMemoryWorkbookStore([workbook]);
    const controller = createCavalryApiController({
      workbookStore: store,
      createId: (prefix) => prefix + '_fixed',
      now: () => '2026-06-27T10:00:00.000Z'
    });
    const response = controller.createTransactionDraftBatch({
      caller: caller([CAVALRY_API_SCOPES.DRAFT_CREATE]),
      workbookId: 'wb_1',
      idempotencyKey: 'idem-api',
      origin: 'chatgpt_action',
      body: {
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
      }
    });

    expect(response).toMatchObject({
      draft_group_id: 'dg_fixed',
      status: 'pending_review',
      review_url: 'cavalry://draft-groups/dg_fixed',
      summary: { total: 1, ready: 1 }
    });
    expect(workbook.transactions).toHaveLength(1);
    expect(workbook.externalApiAuditEvents[0]).toMatchObject({
      operation: 'createTransactionDraftBatch',
      draft_group_id: 'dg_fixed'
    });
  });

  it('reads draft group status with draft read scope', () => {
    const workbook = makeWorkbook();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      createId: (prefix) => prefix + '_fixed'
    });
    const created = controller.createTransactionDraftBatch({
      caller: caller([CAVALRY_API_SCOPES.DRAFT_CREATE]),
      workbookId: 'wb_1',
      body: {
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
      }
    });
    const fetched = controller.getDraftGroup({
      caller: caller([CAVALRY_API_SCOPES.DRAFT_READ]),
      workbookId: 'wb_1',
      draftGroupId: created.draft_group_id
    });

    expect(fetched.draft_group_id).toBe(created.draft_group_id);
  });

  it('blocks checkpointed execution in draft-only runtime mode before workbook mutation', () => {
    const workbook = makeWorkbook();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      runtimeStatus: {
        ai_action_mode: 'draft_only',
        checkpointed_apply_enabled: false
      }
    });

    expect(() =>
      controller.executeCheckpointedActionPlan({
        caller: caller([CAVALRY_API_SCOPES.CHECKPOINT_EXECUTE]),
        workbookId: 'wb_1',
        body: { actions: [] }
      })
    ).toThrow(/Checkpointed AI actions are not enabled/);
    expect(workbook.checkpoints || []).toEqual([]);
  });
});

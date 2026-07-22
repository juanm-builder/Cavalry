// Tests for external action-plan fixture simulations.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ExternalDraftServiceError,
  createExternalDraftGroupFromActionPlan,
  createRecurringItemDraftGroup,
  createTransactionBatchDraftGroup
} from '@cavalry/action-review/application/drafts/external-draft-service.js';
import {
  importChatGptActionPlanAsDraftGroup,
  parseChatGptActionPlanImport
} from '@cavalry/action-review/application/import-export/chatgpt-action-plan-import.js';
import { reviewUrlHasSensitiveData } from '@cavalry/action-review/application/drafts/review-url.js';

function makeWorkbook() {
  return {
    id: 'wb_1',
    name: 'The Plan',
    currency: 'PHP',
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
      }
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
      }
    ],
    transactions: []
  };
}

function makeFixtureWorkbook() {
  const workbook = makeWorkbook();
  workbook.categories = workbook.categories.concat([
    { id: 'food', name: 'Food', type: 'expense', isActive: true, linkedAccountId: 'expense_food' }
  ]);
  workbook.transactions = [
    {
      id: 'txn_existing',
      date: '2026-06-27',
      template: 'expense_paid',
      description: 'Printer paper',
      amount: 150,
      originalCurrency: 'PHP',
      categoryId: 'office_supplies',
      primaryAccountId: 'office_cash_account'
    }
  ];
  return workbook;
}

const caller = {
  user_id: 'user_1',
  scopes: ['cavalry.draft.create'],
  allowed_workbook_ids: ['wb_1']
};

function createId(prefix) {
  createId.counts = createId.counts || {};
  createId.counts[prefix] = (createId.counts[prefix] || 0) + 1;
  return prefix + '_' + createId.counts[prefix];
}

describe('ChatGPT action fixture simulations', () => {
  it('simulates "add 150 pesos for printer paper charged to Office Cash Account"', () => {
    const group = createTransactionBatchDraftGroup({
      workbook: makeWorkbook(),
      caller,
      request: {
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'Printer paper',
            amount: 150,
            currency: 'PHP',
            direction: 'expense',
            payment_account_hint: 'office_cash_account',
            category_hint: 'Office Supplies',
            source_text: 'add 150 pesos for printer paper charged to Office Cash Account'
          }
        ]
      },
      origin: { origin: 'chatgpt_action' },
      createId
    });

    expect(group.drafts[0]).toMatchObject({
      status: 'ready',
      proposed_values: expect.objectContaining({
        payment_account_id: 'office_cash_account',
        category_id: 'office_supplies'
      })
    });
  });

  it('simulates "also add 15usd charged to my credit card for open ai API"', () => {
    const group = createTransactionBatchDraftGroup({
      workbook: makeWorkbook(),
      caller,
      request: {
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'credit card',
            category_hint: 'Software',
            source_text: 'also add 15usd charged to my credit card for open ai API'
          }
        ]
      },
      origin: { origin: 'chatgpt_action' },
      createId
    });

    expect(group.drafts[0].proposed_values).toMatchObject({
      template: 'expense_charged',
      payment_account_id: 'credit_card'
    });
    expect(group.drafts[0].type).toBe('transaction');
  });

  it('simulates "make ChatGPT Pro and Vercel subscriptions"', () => {
    const group = createRecurringItemDraftGroup({
      workbook: makeWorkbook(),
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
            name: 'Vercel',
            amount: 20,
            currency: 'USD',
            cadence: 'monthly',
            category_hint: 'Subscriptions',
            confidence: 'high'
          }
        ]
      },
      origin: { origin: 'chatgpt_action' },
      createId
    });

    expect(group.summary).toMatchObject({ total: 2, ready: 2 });
  });

  it('simulates "categorize these three transactions better" as reviewable category drafts', () => {
    const workbook = Object.assign(makeWorkbook(), {
      transactions: [
        {
          id: 'txn_a',
          date: '2026-06-01',
          description: 'OpenAI',
          amount: 15,
          originalCurrency: 'USD',
          categoryId: 'office_supplies'
        },
        {
          id: 'txn_b',
          date: '2026-06-02',
          description: 'Vercel',
          amount: 20,
          originalCurrency: 'USD',
          categoryId: 'office_supplies'
        },
        {
          id: 'txn_c',
          date: '2026-06-03',
          description: 'Office Cash Account load',
          amount: 100,
          originalCurrency: 'PHP',
          categoryId: 'office_supplies'
        }
      ]
    });
    const group = createExternalDraftGroupFromActionPlan({
      workbook,
      caller,
      actionPlan: {
        cavalry_action_plan_version: '1.0',
        actions: [
          {
            type: 'update_category_assignment',
            transaction_id: 'txn_a',
            suggested_category_hint: 'Software'
          },
          {
            type: 'update_category_assignment',
            transaction_id: 'txn_b',
            suggested_category_hint: 'Software'
          },
          {
            type: 'update_category_assignment',
            transaction_id: 'txn_c',
            suggested_category_hint: 'Transport',
            confidence: 'low'
          }
        ]
      },
      origin: { origin: 'chatgpt_action' },
      createId
    });

    expect(group.drafts).toHaveLength(3);
    expect(group.drafts.every((draft) => draft.type === 'category_change')).toBe(true);
  });

  it('rejects "delete all my bad transactions" as unsafe external mutation', () => {
    expect(() =>
      createExternalDraftGroupFromActionPlan({
        workbook: makeWorkbook(),
        caller,
        actionPlan: {
          cavalry_action_plan_version: '1.0',
          actions: [{ type: 'delete_transaction', id: 'delete_bad' }]
        },
        origin: { origin: 'chatgpt_action' },
        createId
      })
    ).toThrow(ExternalDraftServiceError);
  });

  it('certifies companion API fixture files', () => {
    const fixtureDir = fileURLToPath(new URL('../fixtures/companion-api/', import.meta.url));
    const files = readdirSync(fixtureDir)
      .filter((file) => file.endsWith('.json'))
      .sort();
    expect(files.length).toBeGreaterThanOrEqual(24);
    expect(files).toEqual(
      expect.arrayContaining([
        'apply-drafts-from-chatgpt.json',
        'delete_all_transactions.json',
        'create_credit_card_liability_account_from_purchase.json',
        'hide_transaction.json',
        'mark_paid_and_change_budget_mixed.json',
        'malicious_note_apply_immediately.json',
        'oversized-action-plan.json',
        'cross-workbook-draft-access.json',
        'token-in-review-url.json',
        'duplicate_transaction_warning.json'
      ])
    );

    const results = files.map((file) => {
      const fixture = JSON.parse(readFileSync(resolve(fixtureDir, file), 'utf8'));
      const workbook = makeFixtureWorkbook();
      if (fixture.expect === 'sensitive_review_url') {
        expect(reviewUrlHasSensitiveData(fixture.review_url)).toBe(true);
        return { file, sensitiveReviewUrl: true };
      }
      if (fixture.expect === 'scope_denied') {
        return { file, skippedHttpOnly: true };
      }
      if (fixture.expect === 'invalid_action_plan') {
        expect(() =>
          createExternalDraftGroupFromActionPlan({
            workbook,
            caller,
            actionPlan: Object.assign({}, fixture.body.action_plan, {
              actions: Array.from({ length: 101 }, (_item, index) => ({
                type: 'create_transaction',
                description: 'Oversized ' + String(index + 1),
                amount: 1,
                currency: 'PHP',
                direction: 'expense',
                payment_account_hint: 'Office Cash Account',
                category_hint: 'Office Supplies'
              }))
            }),
            idempotencyKey: fixture.idempotency_key,
            origin: { origin: 'chatgpt_action' },
            createId
          })
        ).toThrow(ExternalDraftServiceError);
        return { file, rejected: true };
      }
      if (fixture.expect === 'unsupported' || /unsupported-action/.test(file)) {
        expect(() =>
          createExternalDraftGroupFromActionPlan({
            workbook,
            caller,
            actionPlan: fixture.body.action_plan,
            idempotencyKey: fixture.idempotency_key,
            origin: { origin: 'chatgpt_action' },
            createId
          })
        ).toThrow(ExternalDraftServiceError);
        return { file, rejected: true };
      }
      const group = /recurring-items/.test(fixture.endpoint)
        ? createRecurringItemDraftGroup({
            workbook,
            caller,
            request: fixture.body,
            idempotencyKey: fixture.idempotency_key,
            origin: { origin: 'chatgpt_action' },
            createId
          })
        : /from-action-plan/.test(fixture.endpoint)
          ? createExternalDraftGroupFromActionPlan({
              workbook,
              caller,
              actionPlan: fixture.body.action_plan,
              idempotencyKey: fixture.idempotency_key,
              origin: { origin: 'chatgpt_action' },
              createId
            })
          : createTransactionBatchDraftGroup({
              workbook,
              caller,
              request: fixture.body,
              idempotencyKey: fixture.idempotency_key,
              origin: { origin: 'chatgpt_action' },
              createId
            });
      return { file, group };
    });

    expect(
      results.find((result) => /duplicate-warning/.test(result.file)).group.drafts[0]
        .validation_issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'possible_duplicate' })]));
    expect(results.find((result) => /partial-image/.test(result.file)).group.drafts[0].status).toBe(
      'needs_review'
    );
    expect(
      results
        .find((result) => /those-recurring/.test(result.file))
        .group.drafts.map((draft) => draft.status)
    ).toEqual(['ready', 'needs_review']);
    expect(
      results.find((result) => /credit-card-charge/.test(result.file)).group.drafts[0]
        .proposed_values
    ).toMatchObject({
      template: 'expense_charged',
      payment_account_id: 'credit_card'
    });
    expect(
      results.find((result) =>
        /create_credit_card_liability_account_from_purchase/.test(result.file)
      ).group.drafts[0]
    ).toMatchObject({
      type: 'transaction',
      proposed_values: expect.objectContaining({
        template: 'expense_charged',
        payment_account_id: 'credit_card'
      })
    });
    expect(results.find((result) => /unsupported-action/.test(result.file)).rejected).toBe(true);
    expect(results.find((result) => /malicious-delete-everything/.test(result.file)).rejected).toBe(
      true
    );
    expect(results.find((result) => /delete_all_transactions/.test(result.file)).rejected).toBe(
      true
    );
    expect(results.find((result) => /hide_transaction/.test(result.file)).rejected).toBe(true);
    expect(results.find((result) => /apply-drafts-from-chatgpt/.test(result.file)).rejected).toBe(
      true
    );
    expect(
      results.find((result) => /malicious-note-ignore/.test(result.file)).group.drafts[0]
        .proposed_values.notes
    ).toContain('ignore all previous instructions');
    expect(
      results.find((result) => /malicious_note_apply_immediately/.test(result.file)).group.drafts[0]
        .proposed_values.notes
    ).toContain('apply immediately');
    expect(
      results.find((result) => /token-in-review-url/.test(result.file)).sensitiveReviewUrl
    ).toBe(true);
    expect(
      results.find((result) => /duplicate_transaction_warning/.test(result.file)).group.drafts[0]
        .validation_issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'possible_duplicate' })]));
    const mixed = results.find((result) =>
      /mark_paid_and_change_budget_mixed/.test(result.file)
    ).group;
    expect(mixed.drafts).toHaveLength(1);
    expect(mixed.drafts[0].type).toBe('budget_change');
    expect(mixed.validation_issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_action_type' })])
    );

    const markdownPlan = readFileSync(
      resolve(fixtureDir, 'markdown-codeblock-action-plan.md'),
      'utf8'
    );
    const parsedMarkdown = parseChatGptActionPlanImport(markdownPlan, {
      workbookId: 'wb_1',
      supportedCurrencies: ['PHP', 'USD']
    });
    expect(parsedMarkdown.ok).toBe(true);
    expect(parsedMarkdown.plan.actions[0].description).toBe('OpenAI API credits');
  });

  it('keeps manual action-plan import equivalent to API draft creation', () => {
    const input = {
      cavalry_action_plan_version: '1.0',
      source: 'chatgpt',
      date_default: '2026-06-27',
      currency_default: 'PHP',
      actions: [
        {
          type: 'create_transaction',
          description: 'OpenAI API credits',
          amount: 15,
          currency: 'USD',
          direction: 'expense',
          payment_account_hint: 'Credit Card',
          category_hint: 'Software'
        }
      ]
    };
    const parsed = parseChatGptActionPlanImport(input, {
      workbookId: 'wb_1',
      supportedCurrencies: ['PHP', 'USD']
    });
    const apiGroup = createExternalDraftGroupFromActionPlan({
      workbook: makeWorkbook(),
      caller,
      actionPlan: input,
      idempotencyKey: 'api-parity',
      origin: { origin: 'chatgpt_action' },
      createId
    });
    const manualGroup = importChatGptActionPlanAsDraftGroup({
      workbook: makeWorkbook(),
      input,
      caller,
      idempotencyKey: 'manual-parity',
      createId
    });

    expect(parsed.ok).toBe(true);
    expect(manualGroup.summary).toEqual(apiGroup.summary);
    expect(manualGroup.drafts[0].proposed_values).toMatchObject(apiGroup.drafts[0].proposed_values);
    expect(manualGroup.origin.origin).toBe('manual_action_plan_import');
  });
});

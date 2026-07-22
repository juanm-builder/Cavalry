// Tests for CavalryActionPlan parsing and validation.

import { describe, expect, it } from 'vitest';

import { parseCavalryActionPlan } from '@cavalry/action-review/domain/cavalry-action-plan/parse.js';
import { validateCavalryActionPlan } from '@cavalry/action-review/domain/cavalry-action-plan/validate.js';

describe('CavalryActionPlan parsing and validation', () => {
  it('parses clean JSON action plans', () => {
    const parsed = parseCavalryActionPlan({
      cavalry_action_plan_version: '1.0',
      source: 'chatgpt',
      date_default: '2026-06-27',
      currency_default: 'PHP',
      actions: [
        {
          type: 'create_transaction',
          description: 'Printer paper',
          amount: 150,
          direction: 'expense',
          payment_account_hint: 'Office Cash Account',
          category_hint: 'Office Supplies',
          idempotency_key: 'row-key'
        }
      ]
    });

    expect(parsed.plan.actions[0]).toMatchObject({
      type: 'create_transaction',
      description: 'Printer paper',
      amount: 150,
      idempotency_key: 'row-key'
    });
    expect(validateCavalryActionPlan(parsed.plan, { workbookId: 'wb_1' }).ok).toBe(true);
  });

  it('parses JSON inside Markdown code blocks', () => {
    const parsed = parseCavalryActionPlan(
      'Here is the plan:\n```json\n{"cavalry_action_plan_version":"1.0","actions":[{"type":"create_recurring_item","name":"ChatGPT Pro","amount":6490,"cadence":"monthly"}]}\n```'
    );

    expect(parsed.plan.actions[0]).toMatchObject({
      type: 'create_recurring_item',
      name: 'ChatGPT Pro',
      cadence: 'monthly'
    });
  });

  it('rejects invalid JSON safely', () => {
    const parsed = parseCavalryActionPlan('```json\n{ nope\n```');

    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]).toMatchObject({
      code: 'invalid_json',
      severity: 'blocked'
    });
  });

  it('rejects unknown action types', () => {
    const parsed = parseCavalryActionPlan({
      cavalry_action_plan_version: '1.0',
      actions: [{ id: 'x', type: 'teleport_money' }]
    });

    expect(parsed.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported_action_type',
        severity: 'blocked',
        action_id: 'x'
      })
    ]);
  });

  it('rejects direct mutation commands', () => {
    const parsed = parseCavalryActionPlan({
      cavalry_action_plan_version: '1.0',
      actions: [{ id: 'danger', type: 'delete_transaction', transaction_id: 'txn_1' }]
    });

    expect(parsed.issues[0]).toMatchObject({
      code: 'unsafe_direct_mutation_claim',
      severity: 'blocked',
      action_id: 'danger'
    });
  });

  it('normalizes safe aliases while preserving IDs and keys', () => {
    const parsed = parseCavalryActionPlan({
      version: '1.0',
      actions: [
        {
          id: 'action_1',
          type: 'add_transaction',
          description: 'OpenAI API credits',
          amount: '15 USD',
          direction: 'expense',
          payment_account: 'credit card',
          category: 'Software',
          idempotencyKey: 'idem-row-1'
        }
      ]
    });

    expect(parsed.plan.actions[0]).toMatchObject({
      id: 'action_1',
      type: 'create_transaction',
      amount: 15,
      payment_account_hint: 'credit card',
      category_hint: 'Software',
      idempotency_key: 'idem-row-1'
    });
  });

  it('rejects cross-workbook IDs', () => {
    const parsed = parseCavalryActionPlan({
      cavalry_action_plan_version: '1.0',
      workbook_id: 'wb_other',
      date_default: '2026-06-27',
      currency_default: 'PHP',
      actions: [
        {
          type: 'create_transaction',
          description: 'Groceries',
          amount: 500,
          direction: 'expense'
        }
      ]
    });
    const validation = validateCavalryActionPlan(parsed.plan, { workbookId: 'wb_1' });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'workbook_mismatch', severity: 'blocked' })
      ])
    );
  });
});

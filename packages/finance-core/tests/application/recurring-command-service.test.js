import { describe, expect, it } from 'vitest';

import {
  createRecurringItemFromTransactionCommand,
  linkTransactionToRecurringItemCommand
} from '@cavalry/finance-core/application/recurring/recurring-command-service.js';
import { cloneFixture, makeBasicSpendingWorkbook } from '../fixtures/core-workbook-fixtures.js';

function makeWorkbook() {
  const workbook = makeBasicSpendingWorkbook();
  workbook.counterparties = [{ id: 'netflix', name: 'Netflix', kind: 'biller', isActive: true }];
  workbook.transactions[3].counterpartyId = 'netflix';
  workbook.recurringItems = [
    {
      id: 'rec-existing',
      kind: 'subscription',
      name: 'Existing Streaming',
      categoryId: 'subscriptions',
      accountId: 'bank',
      amount: 499,
      currency: 'PHP',
      frequency: 'Monthly',
      anchorDate: '2026-05-04',
      isActive: true
    }
  ];
  return workbook;
}

describe('recurring command service', () => {
  it('creates a recurring item from an expense transaction and links the transaction', () => {
    const workbook = makeWorkbook();
    const result = createRecurringItemFromTransactionCommand(
      workbook,
      'txn-subscription',
      {
        kind: 'subscription',
        frequency: 'biweekly'
      },
      {
        createId: () => 'rec-created'
      }
    );

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.recurringItems).toHaveLength(1);
    expect(result.workbook.recurringItems).toHaveLength(2);
    expect(result.recurringItem).toMatchObject({
      id: 'rec-created',
      kind: 'subscription',
      name: 'Netflix',
      categoryId: 'subscriptions',
      accountId: 'bank',
      amount: 499,
      currency: 'PHP',
      frequency: 'Every 2 Weeks',
      anchorDate: '2026-06-04',
      autoRenew: true,
      createdFromTransactionId: 'txn-subscription'
    });
    expect(
      result.workbook.transactions.find((transaction) => transaction.id === 'txn-subscription')
        .recurringItemId
    ).toBe('rec-created');
    expect(result.events.map((event) => event.type)).toEqual([
      'close-modal',
      'schedule-save',
      'render'
    ]);
  });

  it('links a transaction to an existing recurring item', () => {
    const workbook = makeWorkbook();
    const result = linkTransactionToRecurringItemCommand(
      workbook,
      'txn-subscription',
      'rec-existing'
    );

    expect(result.ok).toBe(true);
    expect(result.recurringItem.id).toBe('rec-existing');
    expect(result.workbook).not.toBe(workbook);
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-subscription')
        .recurringItemId
    ).toBe('');
    expect(
      result.workbook.transactions.find((transaction) => transaction.id === 'txn-subscription')
        .recurringItemId
    ).toBe('rec-existing');
    expect(result.events.map((event) => event.type)).toEqual([
      'close-modal',
      'schedule-save',
      'render'
    ]);
  });

  it('rejects missing link targets without mutating the workbook', () => {
    const workbook = makeWorkbook();
    const before = cloneFixture(workbook);
    const result = linkTransactionToRecurringItemCommand(
      workbook,
      'txn-subscription',
      'missing-recurring'
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      {
        code: 'recurring.link_target_not_found',
        message: 'Choose a valid transaction and recurring tracker.'
      }
    ]);
    expect(workbook).toEqual(before);
  });

  it('rejects non-expense transactions without creating recurring items', () => {
    const workbook = makeWorkbook();
    workbook.transactions[0].categoryId = '';
    const before = cloneFixture(workbook);
    const result = createRecurringItemFromTransactionCommand(
      workbook,
      'txn-food-cash',
      {},
      {
        createId: () => 'rec-should-not-exist'
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: 'recurring.expense_category_required'
    });
    expect(workbook).toEqual(before);
  });
});

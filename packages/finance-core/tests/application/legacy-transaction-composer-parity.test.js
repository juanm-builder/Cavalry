import { describe, expect, it } from 'vitest';

import { buildLegacyTransactionFromComposerFields } from '@cavalry/finance-core/application/transactions/legacy-transaction-composer-adapter.js';
import { normalizeLedgerTransactionTemplate } from '@cavalry/finance-core/domain/ledger/transactions.js';
import { cloneFixture, makeIncomeAndExpenseWorkbook } from '../fixtures/core-workbook-fixtures.js';

function makeServices() {
  const counters = {};
  const nextId = (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]);
  };
  return {
    createId: nextId,
    ensureCounterparty(workbook, input) {
      workbook.counterparties = Array.isArray(workbook.counterparties)
        ? workbook.counterparties
        : [];
      const name = String((input && input.name) || '').trim();
      const existing = workbook.counterparties.find((counterparty) => counterparty.name === name);
      if (existing) return existing;
      const counterparty = {
        id: nextId('counterparty'),
        name,
        kind: String((input && input.kind) || 'other').toLowerCase(),
        isActive: true
      };
      workbook.counterparties.push(counterparty);
      return counterparty;
    },
    getAccountById(workbook, accountId) {
      return (workbook.accounts || []).find((account) => account.id === accountId) || null;
    },
    getCategoryById(workbook, categoryId) {
      return (workbook.categories || []).find((category) => category.id === categoryId) || null;
    },
    getCounterpartyById(workbook, counterpartyId) {
      return (
        (workbook.counterparties || []).find(
          (counterparty) => counterparty.id === counterpartyId
        ) || null
      );
    },
    getRecurringItemById(workbook, recurringItemId) {
      return (workbook.recurringItems || []).find((item) => item.id === recurringItemId) || null;
    },
    normalizeTransactionTemplate: normalizeLedgerTransactionTemplate
  };
}

function build(workbook, fields, existingTransaction = null, index = 0, sourceOptions = {}) {
  return buildLegacyTransactionFromComposerFields(
    workbook,
    fields,
    existingTransaction,
    index,
    sourceOptions,
    makeServices()
  );
}

describe('legacy transaction composer parity adapter', () => {
  it('matches legacy shape for a basic expense creation with trimmed text and notes', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = build(
      workbook,
      {
        template: 'expense_paid',
        description: '  Coffee  ',
        amount: '120.50',
        currency: 'PHP',
        date: '2026-06-20',
        categoryId: 'food',
        primaryAccountId: 'cash',
        note: '  receipt in bag  '
      },
      null,
      5
    );

    expect(transaction).toMatchObject({
      id: 'txn_5_1',
      date: '2026-06-20',
      monthKey: '2026-06',
      template: 'expense_paid',
      description: 'Coffee',
      categoryId: 'food',
      originalCurrency: 'PHP',
      amount: 120.5,
      baseAmount: 120.5,
      note: 'receipt in bag',
      source: 'manual'
    });
    expect(transaction.lines).toEqual([
      expect.objectContaining({
        id: 'line_1',
        accountId: 'food-expense',
        direction: 'debit',
        amount: 120.5,
        baseAmount: 120.5
      }),
      expect.objectContaining({
        id: 'line_2',
        accountId: 'cash',
        direction: 'credit',
        amount: 120.5,
        baseAmount: 120.5
      })
    ]);
  });

  it('matches legacy shape for a basic income creation and positive amount convention', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = build(workbook, {
      template: 'income_received',
      description: 'June salary',
      amount: 50000,
      currency: 'PHP',
      date: '2026-06-15',
      categoryId: 'salary',
      primaryAccountId: 'bank'
    });

    expect(transaction).toMatchObject({
      template: 'income_received',
      description: 'June salary',
      categoryId: 'salary',
      amount: 50000,
      baseAmount: 50000
    });
    expect(transaction.lines).toEqual([
      expect.objectContaining({ accountId: 'bank', direction: 'debit', amount: 50000 }),
      expect.objectContaining({ accountId: 'salary-income', direction: 'credit', amount: 50000 })
    ]);
  });

  it('preserves legacy missing category and missing account rejection behavior', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const fields = {
      template: 'expense_paid',
      description: 'Coffee',
      amount: 120,
      currency: 'PHP',
      date: '2026-06-20',
      categoryId: 'food',
      primaryAccountId: 'cash'
    };

    expect(() => build(workbook, Object.assign({}, fields, { categoryId: '' }))).toThrow(
      'Pick an expense category.'
    );
    expect(() => build(workbook, Object.assign({}, fields, { categoryId: 'missing' }))).toThrow(
      'Pick an expense category.'
    );
    expect(() => build(workbook, Object.assign({}, fields, { categoryId: ' food ' }))).toThrow(
      'Pick an expense category.'
    );
    expect(() => build(workbook, Object.assign({}, fields, { primaryAccountId: '' }))).toThrow(
      'Choose an asset account to fund the payment.'
    );
    expect(() =>
      build(workbook, Object.assign({}, fields, { primaryAccountId: 'missing' }))
    ).toThrow('Choose an asset account to fund the payment.');
    expect(() =>
      build(workbook, Object.assign({}, fields, { primaryAccountId: ' cash ' }))
    ).toThrow('Choose an asset account to fund the payment.');
  });

  it('uses deterministic UI-provided default date and workbook currency values', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = build(workbook, {
      template: 'expense_paid',
      description: 'Defaulted form values',
      amount: 88,
      date: '2026-06-30',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    expect(transaction.date).toBe('2026-06-30');
    expect(transaction.originalCurrency).toBe('PHP');
  });

  it('preserves legacy amount parsing behavior for strings, commas, and invalid amounts', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const fields = {
      template: 'expense_paid',
      description: 'Amount parsing',
      currency: 'PHP',
      date: '2026-06-20',
      categoryId: 'food',
      primaryAccountId: 'cash'
    };

    expect(build(workbook, Object.assign({}, fields, { amount: '120.25' })).amount).toBe(120.25);
    expect(() => build(workbook, Object.assign({}, fields, { amount: '1,200' }))).toThrow(
      'Enter a valid amount.'
    );
    expect(() => build(workbook, Object.assign({}, fields, { amount: 'nope' }))).toThrow(
      'Enter a valid amount.'
    );
  });

  it('preserves legacy fallback descriptions and counterparty side effects', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    workbook.counterparties = [];
    const transaction = build(workbook, {
      template: 'expense_paid',
      amount: 120,
      currency: 'PHP',
      date: '2026-06-20',
      categoryId: 'food',
      primaryAccountId: 'cash',
      counterpartyName: 'Cafe Rider',
      counterpartyKind: 'merchant'
    });

    expect(workbook.counterparties).toEqual([
      expect.objectContaining({ id: 'counterparty_1', name: 'Cafe Rider', kind: 'merchant' })
    ]);
    expect(transaction.description).toBe('Food paid to Cafe Rider');
    expect(transaction.counterpartyId).toBe('counterparty_1');
  });

  it('preserves transaction ID, reference, source, and recurring item on description and amount edits', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const existing = cloneFixture(
      workbook.transactions.find((transaction) => transaction.id === 'txn-food-cash')
    );
    existing.reference = 'manual-ref';
    existing.source = 'manual';
    existing.recurringItemId = 'recurring-existing';
    existing.counterpartyId = 'merchant-existing';
    workbook.counterparties = [{ id: 'merchant-existing', name: 'Old Merchant', kind: 'merchant' }];
    workbook.recurringItems = [{ id: 'recurring-other', name: 'Other tracker' }];

    const edited = build(
      workbook,
      {
        template: existing.template,
        description: 'Updated lunch',
        amount: 450,
        currency: existing.originalCurrency,
        date: existing.date,
        categoryId: existing.categoryId,
        primaryAccountId: 'cash',
        recurringItemId: 'recurring-other',
        counterpartyId: existing.counterpartyId
      },
      existing,
      0,
      {
        reference: 'ignored-new-ref',
        source: 'ignored-new-source'
      }
    );

    expect(edited).toMatchObject({
      id: existing.id,
      reference: 'manual-ref',
      source: 'manual',
      recurringItemId: 'recurring-existing',
      counterpartyId: 'merchant-existing',
      description: 'Updated lunch',
      amount: 450,
      baseAmount: 450
    });
    expect(edited.lines[1]).toMatchObject({ accountId: 'cash', direction: 'credit', amount: 450 });
  });

  it('preserves legacy edit behavior for category, account, and direction/template changes', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const existing = cloneFixture(
      workbook.transactions.find((transaction) => transaction.id === 'txn-food-cash')
    );

    const categoryEdited = build(
      workbook,
      {
        template: existing.template,
        description: existing.description,
        amount: existing.amount,
        currency: existing.originalCurrency,
        date: existing.date,
        categoryId: 'transport',
        primaryAccountId: 'cash'
      },
      existing,
      0
    );
    const accountEdited = build(
      workbook,
      {
        template: existing.template,
        description: existing.description,
        amount: existing.amount,
        currency: existing.originalCurrency,
        date: existing.date,
        categoryId: existing.categoryId,
        primaryAccountId: 'bank'
      },
      existing,
      0
    );
    const directionEdited = build(
      workbook,
      {
        template: 'income_received',
        description: 'Corrected income',
        amount: existing.amount,
        currency: existing.originalCurrency,
        date: existing.date,
        categoryId: 'salary',
        primaryAccountId: 'bank'
      },
      existing,
      0
    );

    expect(categoryEdited).toMatchObject({ id: existing.id, categoryId: 'transport' });
    expect(categoryEdited.lines[0]).toMatchObject({
      accountId: 'transport-expense',
      direction: 'debit'
    });
    expect(accountEdited).toMatchObject({ id: existing.id, categoryId: existing.categoryId });
    expect(accountEdited.lines[1]).toMatchObject({ accountId: 'bank', direction: 'credit' });
    expect(directionEdited).toMatchObject({
      id: existing.id,
      template: 'income_received',
      categoryId: 'salary'
    });
    expect(directionEdited.lines).toEqual([
      expect.objectContaining({ accountId: 'bank', direction: 'debit' }),
      expect.objectContaining({ accountId: 'salary-income', direction: 'credit' })
    ]);
  });
});

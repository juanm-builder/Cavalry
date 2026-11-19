import { describe, expect, it } from 'vitest';
import {
  applyImportPreview,
  buildBudgetRouteViewModel,
  buildCategorySpendingReport,
  buildDashboardCategoryDrilldownRows,
  buildImportPreview,
  buildTransactionCalculationReceipt,
  buildTransactionRows,
  buildTransactionTableView,
  deleteCategory,
  deserializeWorkbookFromFile,
  exportTransactionsCsv,
  filterTransactionRows,
  getCategoryUsageSummary,
  getLedgerNativeBalances,
  getStoredCategorySplitIssue,
  getTransactionCategoryAllocations,
  replaceCategoryLinkedAccount,
  serializeWorkbookForSave,
  submitManualTransactionCommand,
  summarizeLedgerActivity,
  validateLedgerInvariants
} from '@cavalry/finance-core';
import {
  makeCoreAccounts,
  makeCoreCategories,
  makeMinimalWorkbook
} from '../fixtures/core-workbook-fixtures.js';

const fields = {
  template: 'expense_paid',
  description: 'Supermarket',
  amount: 10,
  currency: 'PHP',
  date: '2026-06-20',
  primaryAccountId: 'cash',
  categorySplits: [
    { categoryId: 'food', amount: 7.25 },
    { categoryId: 'shopping', amount: 2.75 }
  ]
};

function workbook() {
  return {
    ...makeMinimalWorkbook(),
    accounts: makeCoreAccounts(),
    categories: makeCoreCategories(),
    sheets: [{ id: 'june', monthKey: '2026-06', name: 'June', monthIndex: 5, budgets: [] }]
  };
}

describe('split purchases', () => {
  it.each([
    ['cash', 'expense_paid', -10],
    ['credit-card', 'expense_charged', 10]
  ])(
    'posts one funding entry and one debit for each expense category on %s',
    (accountId, template, balance) => {
      const result = submitManualTransactionCommand(workbook(), {
        ...fields,
        primaryAccountId: accountId
      });
      expect(result.transaction).toMatchObject({
        template,
        categoryId: 'food',
        categorySplits: fields.categorySplits,
        lines: [
          { direction: 'debit', accountId: 'food-expense', amount: 7.25 },
          { direction: 'debit', accountId: 'shopping-expense', amount: 2.75 },
          { direction: 'credit', accountId, amount: 10 }
        ]
      });
      expect(getLedgerNativeBalances(result.workbook)[accountId]).toBe(balance);
      expect(validateLedgerInvariants(result.workbook).errors).toEqual([]);
      expect(summarizeLedgerActivity(result.workbook)).toMatchObject({
        expense: 10,
        transactionCount: 1,
        categoryTotals: { food: 7.25, shopping: 2.75 }
      });
    }
  );

  it('counts each category separately but the receipt once in reports, tables, budgets, and drilldowns', () => {
    const { workbook: ledger, transaction } = submitManualTransactionCommand(workbook(), fields);
    expect(buildCategorySpendingReport(ledger)).toMatchObject({
      transactionCount: 1,
      total: 10,
      rows: [
        { categoryId: 'food', total: 7.25, transactionCount: 1 },
        { categoryId: 'shopping', total: 2.75, transactionCount: 1 }
      ]
    });
    const budget = buildBudgetRouteViewModel(ledger, {
      range: { start: '2026-06-01', end: '2026-06-30' },
      currentDate: '2026-06-20'
    });
    expect(budget.categoryRows.find((row) => row.categoryId === 'shopping')).toMatchObject({
      actual: 2.75,
      transactions: [{ id: transaction.id, amount: 2.75, accountId: 'cash' }]
    });
    expect(buildDashboardCategoryDrilldownRows(ledger, { categoryId: 'shopping' })).toMatchObject([
      { amount: 2.75, baseAmount: 2.75 }
    ]);
    expect(
      filterTransactionRows(buildTransactionRows(ledger), { categoryId: 'shopping' })
    ).toMatchObject([{ id: transaction.id, categoryLabel: 'Food, Shopping' }]);
    expect(buildTransactionTableView(ledger, { categoryId: 'shopping' })).toMatchObject({
      rows: [{ id: transaction.id, amount: 2.75 }],
      totals: { count: 1, expense: 2.75 }
    });
    expect(
      buildTransactionCalculationReceipt(ledger, ledger.transactions, { metric: 'expense' })
    ).toMatchObject({ value: 10, includedCount: 1 });
  });

  it('keeps FX rounding consistent through portable workbook and CSV round trips', () => {
    const halves = fields.categorySplits.map((part) => ({ ...part, amount: 5 }));
    const input = {
      ...fields,
      categorySplits: halves,
      currency: 'USD',
      fxRateToBase: 55.555,
      allowCurrencyConversion: true
    };
    const { workbook: ledger, transaction } = submitManualTransactionCommand(workbook(), input);
    const allocation = getTransactionCategoryAllocations(transaction);
    expect(transaction.lines.map((line) => line.baseAmount)).toEqual([277.78, 277.77, 555.55]);
    expect(allocation.map((part) => part.baseAmount)).toEqual([277.78, 277.77]);
    const serialized = serializeWorkbookForSave(ledger);
    const restored = deserializeWorkbookFromFile(serialized.html, { rejectInvalid: true });
    expect(restored.workbook.transactions[0]).toEqual(transaction);
    const csv = exportTransactionsCsv(ledger);
    expect(csv).toContain('Food 5.00 / Shopping 5.00');
    const empty = workbook();
    const preview = buildImportPreview(empty, csv);
    expect(preview.summary.readyRows).toBe(1);
    const imported = applyImportPreview(empty, preview).transactions[0];
    expect(imported).toMatchObject({
      categorySplits: halves,
      baseAmount: transaction.baseAmount,
      fxRateToBase: 55.555
    });
    expect(getStoredCategorySplitIssue(empty, imported)).toBeNull();
  });

  it.each(['cash', 'credit-card'])(
    'recovers equal shares from distinct preserved debits after a legacy re-save on %s',
    (accountId) => {
      const categorySplits = fields.categorySplits.map(({ categoryId }) => ({
        categoryId,
        amount: 5
      }));
      const source = workbook();
      source.categories = source.categories.filter(
        (category) => category.id !== 'archived-shopping'
      );
      const original = submitManualTransactionCommand(source, {
        ...fields,
        categorySplits,
        primaryAccountId: accountId,
        currency: 'USD',
        fxRateToBase: 55.555,
        allowCurrencyConversion: true
      });
      const legacyWorkbook = structuredClone(original.workbook);
      delete legacyWorkbook.transactions[0].categorySplits;
      const recovered = deserializeWorkbookFromFile(JSON.stringify(legacyWorkbook), {
        rejectInvalid: true
      }).workbook;
      expect(recovered.transactions).toEqual(original.workbook.transactions);
      expect(getLedgerNativeBalances(recovered)).toEqual(
        getLedgerNativeBalances(original.workbook)
      );
      expect(summarizeLedgerActivity(recovered).categoryTotals).toEqual({
        food: 277.78,
        shopping: 277.77
      });
      expect(
        deserializeWorkbookFromFile(serializeWorkbookForSave(recovered).html, {
          rejectInvalid: true
        }).workbook.transactions
      ).toEqual(recovered.transactions);
    }
  );

  it('requires unambiguous category links, exact stored totals, and a purchase template before recovery', () => {
    const source = workbook();
    source.categories = source.categories.filter((category) => category.id !== 'archived-shopping');
    const posted = submitManualTransactionCommand(source, fields);
    function loadAfter(change) {
      const ledger = structuredClone(posted.workbook);
      const tx = ledger.transactions[0];
      delete tx.categorySplits;
      change(ledger, tx);
      return deserializeWorkbookFromFile(JSON.stringify(ledger));
    }
    for (const change of [
      (ledger) =>
        ledger.categories.push({
          ...ledger.categories.find((item) => item.id === 'shopping'),
          id: 'also-shopping'
        }),
      (_ledger, tx) => {
        tx.categoryId = 'shopping';
      },
      (_ledger, tx) => {
        tx.template = 'manual_journal';
      },
      (_ledger, tx) => {
        tx.lines.at(-1).amount += 1;
      },
      (_ledger, tx) => {
        delete tx.baseAmount;
      },
      (_ledger, tx) => {
        tx.lines[0].baseAmount -= 0.01;
        tx.lines[1].baseAmount += 0.01;
      },
      (_ledger, tx) => {
        tx.lines[1].accountId = tx.lines[0].accountId;
      }
    ]) {
      expect(loadAfter(change).workbook.transactions[0].categorySplits).toBeUndefined();
    }
    const explicit = loadAfter((_ledger, tx) => {
      tx.categorySplits = [];
    });
    expect(explicit.workbook.transactions[0].categorySplits).toEqual([]);
    expect(explicit.validation.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_category_splits' })])
    );
  });

  it('keeps omitted allocations on edits, rebuilds changed allocations and explicitly removes them', () => {
    const { workbook: ledger, transaction } = submitManualTransactionCommand(workbook(), fields);
    const edit = {
      ...fields,
      transactionId: transaction.id,
      categoryId: 'food',
      description: 'Corrected receipt'
    };
    delete edit.categorySplits;
    expect(submitManualTransactionCommand(ledger, edit).transaction).toMatchObject({
      lines: transaction.lines,
      categorySplits: fields.categorySplits
    });
    expect(submitManualTransactionCommand(ledger, { ...edit, amount: 11 })).toMatchObject({
      ok: false,
      workbook: ledger
    });
    const changed = submitManualTransactionCommand(ledger, {
      ...edit,
      categorySplits: [
        { categoryId: 'food', amount: 6 },
        { categoryId: 'shopping', amount: 4 }
      ]
    });
    expect(changed.transaction.lines.map((line) => line.amount)).toEqual([6, 4, 10]);
    const ordinary = submitManualTransactionCommand(ledger, { ...edit, categorySplits: [] });
    expect(ordinary.transaction.categorySplits).toBeUndefined();
    expect(ordinary.transaction.lines.map((line) => line.amount)).toEqual([10, 10]);
    expect(transaction.lines.map((line) => line.amount)).toEqual([7.25, 2.75, 10]);
  });

  it.each([
    [
      'wrong sum',
      [
        { categoryId: 'food', amount: 1 },
        { categoryId: 'shopping', amount: 2 }
      ]
    ],
    [
      'duplicate',
      [
        { categoryId: 'food', amount: 1 },
        { categoryId: 'food', amount: 9 }
      ]
    ],
    [
      'missing category',
      [
        { categoryId: 'deleted', amount: 1 },
        { categoryId: 'food', amount: 9 }
      ]
    ],
    [
      'wrong category type',
      [
        { categoryId: 'salary', amount: 1 },
        { categoryId: 'food', amount: 9 }
      ]
    ],
    [
      'zero',
      [
        { categoryId: 'shopping', amount: 0 },
        { categoryId: 'food', amount: 10 }
      ]
    ],
    [
      'fractional cent',
      [
        { categoryId: 'shopping', amount: 0.005 },
        { categoryId: 'food', amount: 9.995 }
      ]
    ],
    ['invalid entry', [null, { categoryId: 'food', amount: 10 }]]
  ])('rejects %s without changing the workbook', (_case, categorySplits) => {
    const ledger = workbook();
    const result = submitManualTransactionCommand(ledger, { ...fields, categorySplits });
    expect(result.ok).toBe(false);
    expect(result.workbook).toBe(ledger);
    expect(ledger.transactions).toEqual([]);
  });

  it('validates imported allocations and their actual postings, including replacement account history', () => {
    const { workbook: ledger, transaction } = submitManualTransactionCommand(workbook(), fields);
    const categoryId = 'shopping';
    expect(getCategoryUsageSummary(ledger, categoryId).transactionCount).toBe(1);
    expect(() => deleteCategory(ledger, { categoryId, allowReferencedDelete: true })).toThrow(
      /split purchase/i
    );
    replaceCategoryLinkedAccount(ledger, { categoryId });
    ledger.categories.find((category) => category.id === categoryId).isActive = false;
    expect(getStoredCategorySplitIssue(ledger, transaction)).toBeNull();
    for (const value of [null, {}, [], [null, { categoryId: 'food', amount: 10 }]]) {
      const damaged = { ...transaction, categorySplits: value };
      expect(getStoredCategorySplitIssue(ledger, damaged)).toMatchObject({
        code: 'invalid_category_splits'
      });
      expect(validateLedgerInvariants({ ...ledger, transactions: [damaged] }).ok).toBe(false);
    }
    const wrongAccount = structuredClone(transaction);
    wrongAccount.lines[1].accountId = 'food-expense';
    expect(getStoredCategorySplitIssue(ledger, wrongAccount)).toMatchObject({
      code: 'invalid_category_splits'
    });
  });
});

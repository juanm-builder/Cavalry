import { describe, expect, it } from 'vitest';

import {
  WorkbookPersistenceError,
  deserializeWorkbookFromFile,
  serializeWorkbookForSave,
  validateWorkbookAfterLoad
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import {
  cloneFixture,
  makeDirtyLegacyWorkbook,
  makeDraftIsolationWorkbook,
  makeIncomeAndExpenseWorkbook,
  makeMinimalWorkbook
} from '../fixtures/core-workbook-fixtures.js';

function makeFullWorkbook() {
  const workbook = makeIncomeAndExpenseWorkbook();
  workbook.name = 'Full Persistence Workbook';
  workbook.defaultCurrency = workbook.currency;
  workbook.timezone = 'Asia/Manila';
  workbook.accounts.push({
    id: 'old-bank',
    name: 'Old Bank',
    group: 'asset',
    currency: 'PHP',
    isActive: false
  });
  workbook.categories.push({
    id: 'old-utilities',
    name: 'Old Utilities',
    type: 'expense',
    currency: 'PHP',
    linkedAccountId: 'utilities-expense',
    isActive: false
  });
  workbook.sheets = [
    {
      id: 'sheet-june',
      name: 'June',
      monthIndex: 5,
      budgets: [{ categoryId: 'food', planned: 5000 }],
      budgetLineItems: [
        {
          id: 'bill-internet',
          categoryId: 'utilities',
          name: 'Internet',
          planned: 2000,
          accountId: 'bank',
          recurringItemId: 'recurring-internet',
          isActive: true
        }
      ],
      entries: [],
      notes: 'June plan'
    }
  ];
  workbook.recurringItems = [
    {
      id: 'recurring-internet',
      name: 'Internet',
      kind: 'bill',
      categoryId: 'utilities',
      accountId: 'bank',
      amount: 2000,
      currency: 'PHP',
      anchorDate: '2026-06-15',
      isActive: true
    }
  ];
  workbook.aiDrafts = [
    {
      id: 'draft-pending-food',
      status: 'pending',
      objectType: 'transaction',
      proposed: { amount: 321, categoryId: 'food' }
    }
  ];
  workbook.externalDraftGroups = [
    {
      draft_group_id: 'external-group-full',
      status: 'pending',
      drafts: [{ draft_id: 'external-draft-full', proposed: { amount: 123 } }]
    }
  ];
  workbook.advisorDraftGroups = [
    {
      groupId: 'advisor-group-full',
      draftIds: ['draft-pending-food'],
      status: 'pending'
    }
  ];
  return workbook;
}

function loadRoundtrip(workbook) {
  const serialized = serializeWorkbookForSave(workbook);
  return deserializeWorkbookFromFile(serialized.html);
}

describe('workbook save/load persistence service', () => {
  it('saves and reloads a minimal workbook with identity, currency, and timezone intact', () => {
    const workbook = makeMinimalWorkbook();
    workbook.name = 'Minimal Save Load';
    workbook.defaultCurrency = 'PHP';
    workbook.timezone = 'Asia/Manila';

    const { workbook: loaded, validation } = loadRoundtrip(workbook);

    expect(validation.ok).toBe(true);
    expect(loaded).toMatchObject({
      id: workbook.id,
      version: 2,
      name: 'Minimal Save Load',
      currency: 'PHP',
      defaultCurrency: 'PHP',
      timezone: 'Asia/Manila'
    });
    expect(validateLedgerInvariants(loaded).ok).toBe(true);
  });

  it('preserves full workbook IDs, amounts, dates, references, archives, budgets, recurring items, and totals', () => {
    const workbook = makeFullWorkbook();
    workbook.categories[0].icon = 'shopping_cart';
    workbook.categories[0].color = '#5ba1df';
    workbook.categories[0].description = 'Everyday groceries';
    const beforeSummary = summarizeLedgerActivity(workbook);
    const beforeBalances = validateLedgerInvariants(workbook).summary.balances;
    const { workbook: loaded, validation } = loadRoundtrip(workbook);
    const afterSummary = summarizeLedgerActivity(loaded);
    const afterBalances = validateLedgerInvariants(loaded).summary.balances;

    expect(validation.ok).toBe(true);
    expect(loaded.transactions.map((transaction) => transaction.id)).toEqual(
      workbook.transactions.map((transaction) => transaction.id)
    );
    expect(loaded.transactions.map((transaction) => transaction.amount)).toEqual(
      workbook.transactions.map((transaction) => transaction.amount)
    );
    expect(loaded.transactions.map((transaction) => transaction.date)).toEqual(
      workbook.transactions.map((transaction) => transaction.date)
    );
    expect(loaded.transactions.map((transaction) => transaction.categoryId)).toEqual(
      workbook.transactions.map((transaction) => transaction.categoryId)
    );
    expect(
      loaded.transactions.flatMap((transaction) => transaction.lines.map((line) => line.accountId))
    ).toEqual(
      workbook.transactions.flatMap((transaction) =>
        transaction.lines.map((line) => line.accountId)
      )
    );
    expect(loaded.accounts.find((account) => account.id === 'old-bank').isActive).toBe(false);
    expect(loaded.categories.find((category) => category.id === 'old-utilities').isActive).toBe(
      false
    );
    expect(loaded.categories[0]).toMatchObject({
      icon: 'shopping_cart',
      color: '#5ba1df',
      description: 'Everyday groceries'
    });
    expect(loaded.sheets[0].budgets).toEqual(workbook.sheets[0].budgets);
    expect(loaded.recurringItems).toEqual(workbook.recurringItems);
    expect(afterSummary).toMatchObject(beforeSummary);
    expect(afterBalances).toEqual(beforeBalances);
  });

  it('normalizes and round-trips occurrence reconciliation records safely', () => {
    const workbook = makeFullWorkbook();
    workbook.transactions[0].recurringItemId = 'recurring-internet';
    workbook.transactions[0].recurringOccurrenceDate = ' 2026-06-15 ';
    workbook.recurringReconciliations = [
      {
        id: 'reconciliation-internet-june',
        recurringItemId: ' recurring-internet ',
        occurrenceDate: ' 2026-06-15 ',
        transactionId: ` ${workbook.transactions[0].id} `,
        decision: 'MATCHED',
        method: 'AUTOMATIC',
        allocatedBaseAmount: '2000',
        confidence: 108,
        createdAt: '2026-06-15T12:31:00.000Z',
        updatedAt: '',
        matchSignals: { account: true, amount: true }
      },
      {
        recurringItemId: 'recurring-internet',
        occurrenceDate: 'not-a-date',
        transactionId: workbook.transactions[0].id,
        decision: 'unsafe-value',
        method: 'unsafe-value',
        allocatedBaseAmount: -50,
        confidence: -4,
        reviewerNote: 'Keep this forward-compatible field.'
      },
      null,
      'not-a-record'
    ];

    const { workbook: loaded, validation } = loadRoundtrip(workbook);

    expect(validation.ok).toBe(true);
    expect(loaded.transactions[0]).toMatchObject({
      recurringItemId: 'recurring-internet',
      recurringOccurrenceDate: '2026-06-15'
    });
    expect(loaded.recurringReconciliations).toEqual([
      {
        id: 'reconciliation-internet-june',
        recurringItemId: 'recurring-internet',
        occurrenceDate: '2026-06-15',
        transactionId: workbook.transactions[0].id,
        decision: 'matched',
        method: 'automatic',
        allocatedBaseAmount: 2000,
        confidence: 100,
        createdAt: '2026-06-15T12:31:00.000Z',
        updatedAt: '2026-06-15T12:31:00.000Z',
        matchSignals: { account: true, amount: true }
      },
      {
        id: 'recurring_reconciliation_1',
        recurringItemId: 'recurring-internet',
        occurrenceDate: '',
        transactionId: workbook.transactions[0].id,
        decision: 'rejected',
        method: 'legacy',
        allocatedBaseAmount: 0,
        confidence: 0,
        createdAt: '',
        updatedAt: '',
        reviewerNote: 'Keep this forward-compatible field.'
      }
    ]);
  });

  it('defaults legacy workbooks to an empty reconciliation collection', () => {
    const workbook = makeMinimalWorkbook();
    delete workbook.recurringReconciliations;

    const { workbook: loaded, validation } = loadRoundtrip(workbook);

    expect(validation.ok).toBe(true);
    expect(loaded.recurringReconciliations).toEqual([]);
  });

  it('round-trips canonical and custom institution metadata without data loss', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const linkedAccount = workbook.accounts.find((account) => account.id === 'cash');
    linkedAccount.institution = 'RCBC';
    linkedAccount.institutionId = 'rcbc';
    workbook.accounts.push({
      id: 'custom-cooperative',
      name: 'Community Savings',
      group: 'asset',
      subtype: 'savings',
      currency: 'PHP',
      institution: 'My Cooperative',
      institutionId: '',
      isActive: true
    });

    const { workbook: loaded, validation } = loadRoundtrip(workbook);

    expect(validation.ok).toBe(true);
    expect(loaded.accounts.find((account) => account.id === 'cash')).toMatchObject({
      institution: 'RCBC',
      institutionId: 'rcbc'
    });
    expect(loaded.accounts.find((account) => account.id === 'custom-cooperative')).toMatchObject({
      institution: 'My Cooperative',
      institutionId: ''
    });
  });

  it('keeps dirty legacy data inspectable and reports invariant failures after load', () => {
    const dirty = makeDirtyLegacyWorkbook();
    const { workbook, validation } = loadRoundtrip(dirty);
    const errorCodes = validation.errors.map((error) => error.code);
    const warningCodes = validation.warnings.map((warning) => warning.code);

    expect(workbook.version).toBe(2);
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'dirty-string-amount').amount
    ).toBe(125.5);
    expect(validation.ok).toBe(false);
    expect(errorCodes).toEqual(
      expect.arrayContaining(['transaction_missing_category', 'transaction_invalid_date'])
    );
    expect(warningCodes).toContain('workbook_missing_version');
  });

  it('surfaces one load warning when account metadata disagrees with posting currencies', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';

    const { validation } = loadRoundtrip(workbook);
    const mismatchWarnings = validation.warnings.filter(
      (warning) => warning.code === 'account_posting_currency_mismatch'
    );

    expect(validation.ok).toBe(true);
    expect(mismatchWarnings).toEqual([
      expect.objectContaining({
        detail: 'cash: configured USD; postings PHP'
      })
    ]);
  });

  it('warns on old, missing, and future workbook versions without losing transactions', () => {
    const current = makeMinimalWorkbook();
    const old = Object.assign(cloneFixture(current), { version: 1 });
    const missing = cloneFixture(current);
    const future = Object.assign(cloneFixture(current), { version: 99 });
    delete missing.version;

    const oldResult = loadRoundtrip(old);
    const missingResult = loadRoundtrip(missing);
    const futureResult = loadRoundtrip(future);

    expect(oldResult.validation.warnings.map((warning) => warning.code)).toContain(
      'workbook_legacy_version'
    );
    expect(missingResult.validation.warnings.map((warning) => warning.code)).toContain(
      'workbook_missing_version'
    );
    expect(futureResult.validation.warnings.map((warning) => warning.code)).toContain(
      'workbook_future_version'
    );
    expect(oldResult.workbook.transactions).toHaveLength(current.transactions.length);
    expect(missingResult.workbook.transactions).toHaveLength(current.transactions.length);
    expect(futureResult.workbook.transactions).toHaveLength(current.transactions.length);
  });

  it('can reject invalid loaded workbooks when a caller wants a hard failure', () => {
    const serialized = serializeWorkbookForSave(makeDirtyLegacyWorkbook());

    expect(() => deserializeWorkbookFromFile(serialized.html, { rejectInvalid: true })).toThrow(
      WorkbookPersistenceError
    );
  });

  it('keeps pending and rejected drafts isolated from committed totals after reload', () => {
    const workbook = makeDraftIsolationWorkbook();
    const beforeTransactions = cloneFixture(workbook.transactions);
    const beforeSummary = summarizeLedgerActivity(workbook);
    const { workbook: loaded, validation } = loadRoundtrip(workbook);

    expect(validation.ok).toBe(true);
    expect(loaded.aiDrafts).toHaveLength(2);
    expect(loaded.externalDraftGroups).toHaveLength(1);
    expect(loaded.transactions).toEqual(beforeTransactions);
    expect(summarizeLedgerActivity(loaded)).toMatchObject(beforeSummary);
  });

  it('validates missing reference corruption without mutating the source report into silence', () => {
    const workbook = makeMinimalWorkbook();
    workbook.transactions.push({
      id: 'txn-missing-account',
      date: '2026-06-20',
      monthKey: '2026-06',
      template: 'expense_paid',
      description: 'Missing account',
      categoryId: 'food',
      amount: 100,
      baseAmount: 100,
      lines: [
        {
          id: 'line-food',
          accountId: 'food-expense',
          direction: 'debit',
          amount: 100,
          currency: 'PHP',
          baseAmount: 100
        },
        {
          id: 'line-missing',
          accountId: 'missing-account',
          direction: 'credit',
          amount: 100,
          currency: 'PHP',
          baseAmount: 100
        }
      ]
    });

    const result = validateWorkbookAfterLoad(workbook);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('line_missing_account');
  });
});

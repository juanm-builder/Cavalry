import { describe, expect, it } from 'vitest';
import { buildDashboardRouteViewModel } from '@cavalry/finance-core';

import {
  ACCOUNT_ACTIONS,
  buildAccountsFeatureModel,
  executeAccountCommand
} from '../../src/renderer/features/accounts/account-controller.js';

function makeWorkbook() {
  return {
    id: 'account-controller-workbook',
    version: 2,
    name: 'Accounts',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'bank',
        name: 'Bank',
        group: 'asset',
        subtype: 'bank',
        institution: 'RCBC',
        institutionId: 'rcbc',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'unused',
        name: 'Unused',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'system-asset',
        name: 'System Asset',
        group: 'asset',
        subtype: 'clearing',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', linkedAccountId: 'food-expense', isActive: true }
    ],
    transactions: [
      {
        id: 'txn-bank',
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'Groceries',
        categoryId: 'food',
        amount: 100,
        baseAmount: 100,
        lines: [
          {
            id: 'line-food',
            accountId: 'food-expense',
            direction: 'debit',
            amount: 100,
            baseAmount: 100
          },
          { id: 'line-bank', accountId: 'bank', direction: 'credit', amount: 100, baseAmount: 100 }
        ]
      }
    ],
    recurringItems: [],
    sheets: []
  };
}

describe('account controller', () => {
  it('creates on a cloned workbook and returns the standard result contract', () => {
    const workbook = makeWorkbook();
    const result = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.CREATE,
      payload: {
        name: 'Savings',
        group: 'asset',
        subtype: 'savings',
        currency: 'PHP',
        openedDate: '2026-06-30'
      }
    });

    expect(result).toMatchObject({ ok: true, warnings: [], errors: [] });
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.accounts.some((account) => account.name === 'Savings')).toBe(false);
    expect(result.workbook.accounts.some((account) => account.name === 'Savings')).toBe(true);
    expect(result.events).toEqual([expect.objectContaining({ type: 'account.created' })]);
  });

  it('allows duplicate display names while preserving identity on protected-account failures', () => {
    const workbook = makeWorkbook();
    const duplicate = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.CREATE,
      payload: { name: 'Cash', group: 'asset', currency: 'PHP', openedDate: '2026-06-30' }
    });
    const systemDelete = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.DELETE,
      payload: { accountId: 'system-asset' }
    });

    expect(duplicate.ok).toBe(true);
    expect(duplicate.workbook).not.toBe(workbook);
    expect(workbook.accounts.filter((account) => account.name === 'Cash')).toHaveLength(1);
    expect(duplicate.workbook.accounts.filter((account) => account.name === 'Cash')).toHaveLength(
      2
    );
    expect(systemDelete.ok).toBe(false);
    expect(systemDelete.workbook).toBe(workbook);
  });

  it('archives referenced accounts instead of deleting history', () => {
    const workbook = makeWorkbook();
    const result = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.DELETE,
      payload: { accountId: 'bank' }
    });

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.accounts.find((account) => account.id === 'bank').isActive).toBe(false);
    expect(result.workbook.transactions).toEqual(workbook.transactions);
    expect(result.warnings[0].code).toBe('account.archived_instead_of_deleted');
    expect(result.events[0]).toMatchObject({ type: 'account.archived', accountId: 'bank' });
  });

  it('builds a serializable model from the public finance-core view model', () => {
    const workbook = makeWorkbook();
    Object.assign(
      workbook.accounts.find((account) => account.id === 'bank'),
      {
        icon: 'savings',
        logoMode: 'icon'
      }
    );
    const model = buildAccountsFeatureModel(workbook, { selectedAccountId: 'bank' });

    expect(model.selectedAccount.id).toBe('bank');
    expect(model.selectedAccount).toMatchObject({
      typeLabel: 'Bank Account',
      institution: 'RCBC',
      institutionId: 'rcbc',
      icon: 'savings',
      logoMode: 'icon',
      institutionColor: '#0067b1'
    });
    expect(model.accountRows.find((row) => row.id === 'bank')).toMatchObject({
      icon: 'savings',
      logoMode: 'icon'
    });
    expect(model.accountRows.find((row) => row.id === 'system-asset').canDelete).toBe(false);
    expect(model.selectedAccount.historyRows[0]).toMatchObject({
      transactionId: 'txn-bank',
      accountName: 'Bank',
      categoryName: 'Food',
      typeLabel: 'Expense Paid',
      relatedAccountNames: ['Food'],
      relatedAccountCopy: '',
      amountCopy: '₱100.00',
      change: -100,
      changeCopy: '-₱100.00',
      beforeBalance: 0,
      beforeBalanceCopy: '₱0.00',
      runningBalance: -100,
      balanceCopy: '-₱100.00'
    });
    expect(() => JSON.stringify(model)).not.toThrow();
  });

  it('keeps transfer details in the selected account perspective', () => {
    const workbook = makeWorkbook();
    workbook.transactions.push({
      id: 'txn-transfer',
      date: '2026-06-02',
      template: 'transfer',
      description: 'Move cash to bank',
      amount: 250,
      baseAmount: 250,
      lines: [
        { id: 'line-cash', accountId: 'cash', direction: 'credit', amount: 250, baseAmount: 250 },
        { id: 'line-bank', accountId: 'bank', direction: 'debit', amount: 250, baseAmount: 250 }
      ]
    });

    const bankDetail = buildAccountsFeatureModel(workbook, {
      selectedAccountId: 'bank'
    }).selectedAccount.historyRows[0];
    const cashDetail = buildAccountsFeatureModel(workbook, {
      selectedAccountId: 'cash'
    }).selectedAccount.historyRows[0];

    expect(bankDetail).toMatchObject({
      transactionId: 'txn-transfer',
      categoryName: 'Transfer',
      relatedAccountCopy: 'Cash',
      change: 250,
      changeCopy: '₱250.00',
      beforeBalanceCopy: '-₱100.00',
      balanceCopy: '₱150.00',
      changeTone: 'good'
    });
    expect(cashDetail).toMatchObject({
      transactionId: 'txn-transfer',
      relatedAccountCopy: 'Bank',
      change: -250,
      changeCopy: '-₱250.00',
      beforeBalanceCopy: '₱0.00',
      balanceCopy: '-₱250.00',
      changeTone: 'bad'
    });
  });

  it('shows USD accounts in native currency while matching the dashboard PHP valuation', () => {
    const workbook = makeWorkbook();
    workbook.settings.usdToBaseRate = 61.75;
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    workbook.accounts.push({
      id: 'usd-account',
      name: 'USD Account',
      group: 'asset',
      subtype: 'bank',
      currency: 'USD',
      openedDate: '2026-01-01',
      isActive: true
    });
    workbook.transactions.push(
      {
        id: 'txn-php-cash',
        date: '2026-07-01',
        template: 'opening_balance',
        description: 'PHP cash opening',
        amount: 112,
        baseAmount: 112,
        lines: [
          {
            accountId: 'cash',
            direction: 'debit',
            amount: 112,
            currency: 'PHP',
            baseAmount: 112
          }
        ]
      },
      {
        id: 'txn-usd-opening',
        date: '2026-07-01',
        template: 'opening_balance',
        description: 'USD opening',
        amount: 252.15,
        baseAmount: 252.15,
        lines: [
          {
            accountId: 'usd-account',
            direction: 'debit',
            amount: 252.15,
            currency: 'USD',
            baseAmount: 252.15
          }
        ]
      },
      {
        id: 'txn-usd-future',
        date: '2026-07-13',
        template: 'opening_balance',
        description: 'Future USD change',
        amount: 10,
        baseAmount: 10,
        lines: [
          {
            accountId: 'usd-account',
            direction: 'debit',
            amount: 10,
            currency: 'USD',
            baseAmount: 10
          }
        ]
      }
    );

    const accountModel = buildAccountsFeatureModel(workbook, {
      selectedAccountId: 'usd-account',
      asOfDate: '2026-07-12'
    });
    const dashboardModel = buildDashboardRouteViewModel(workbook, {
      range: { start: '2026-01-01', end: '2026-07-12' },
      asOfDate: '2026-07-12',
      currentDate: '2026-07-12'
    });
    const usdRow = accountModel.accountRows.find((row) => row.id === 'usd-account');
    const cashRow = accountModel.accountRows.find((row) => row.id === 'cash');

    expect(usdRow).toMatchObject({
      currency: 'USD',
      balanceCell: {
        value: 252.15,
        currency: 'USD',
        copy: '$252.15',
        baseValue: 15570.26,
        baseCurrency: 'PHP',
        baseCopy: '₱15,570.26'
      }
    });
    expect(cashRow).toMatchObject({
      currency: 'USD',
      balanceCurrency: 'PHP',
      configuredCurrency: 'USD',
      hasCurrencyMismatch: true,
      hasCurrencyIntegrityIssue: true,
      postingCurrencies: ['PHP'],
      balanceCell: {
        value: 112,
        currency: 'PHP',
        copy: '₱112.00',
        baseValue: 112
      }
    });
    expect(accountModel.selectedAccount.balanceCopy).toBe('$252.15');
    expect(accountModel.selectedAccount.historyRows).toHaveLength(1);
    expect(accountModel.summary.netWorthCopy).toBe('₱15,682.26');
    expect(dashboardModel.money.netWorth).toBe(15682.26);
    expect(
      dashboardModel.money.balanceAccounts.find((account) => account.id === 'cash')
    ).toMatchObject({
      currency: 'USD',
      balanceCurrency: 'PHP',
      configuredCurrency: 'USD',
      hasCurrencyMismatch: true
    });
  });

  it('surfaces and safely repairs a mixed-currency Cash account without changing PHP book value', () => {
    const workbook = makeWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    workbook.accounts.push({
      id: 'other-income',
      name: 'Other Income',
      group: 'income',
      subtype: 'income',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    });
    workbook.transactions = [
      {
        id: 'txn-cash-before',
        date: '2026-07-04',
        template: 'income_received',
        description: 'Existing cash',
        amount: 112,
        baseAmount: 112,
        lines: [
          {
            id: 'line-cash-before',
            accountId: 'cash',
            direction: 'debit',
            amount: 112,
            currency: 'PHP',
            baseAmount: 112
          },
          {
            id: 'line-income-before',
            accountId: 'other-income',
            direction: 'credit',
            amount: 112,
            currency: 'PHP',
            baseAmount: 112
          }
        ]
      },
      {
        id: 'txn-found-cash',
        date: '2026-07-15',
        template: 'income_received',
        description: 'Found cash',
        amount: 20,
        baseAmount: 20,
        originalCurrency: 'PHP',
        lines: [
          {
            id: 'line-found-cash',
            accountId: 'cash',
            direction: 'debit',
            amount: 0.32,
            currency: 'USD',
            baseAmount: 20
          },
          {
            id: 'line-found-income',
            accountId: 'other-income',
            direction: 'credit',
            amount: 20,
            currency: 'PHP',
            baseAmount: 20
          }
        ]
      }
    ];
    const before = structuredClone(workbook);

    const model = buildAccountsFeatureModel(workbook, { selectedAccountId: 'cash' });
    expect(model.selectedAccount).toMatchObject({
      currency: 'USD',
      balanceCurrency: 'PHP',
      balanceCopy: '₱132.00',
      hasCurrencyIntegrityIssue: true,
      postingCurrencies: ['PHP', 'USD'],
      canRepairCurrency: true
    });

    const preview = model.selectedAccount.repairPreview;
    const result = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.REPAIR_CURRENCY,
      payload: {
        accountId: 'cash',
        targetCurrency: 'PHP',
        expectedFingerprint: preview.fingerprint,
        confirmed: true
      }
    });

    expect(result.ok).toBe(true);
    expect(result.workbook.accounts.find((account) => account.id === 'cash').currency).toBe('PHP');
    expect(
      result.workbook.transactions
        .flatMap((transaction) => transaction.lines)
        .filter((line) => line.accountId === 'cash')
    ).toEqual([
      expect.objectContaining({ amount: 112, currency: 'PHP', baseAmount: 112 }),
      expect.objectContaining({ amount: 20, currency: 'PHP', baseAmount: 20 })
    ]);
    expect(
      buildAccountsFeatureModel(result.workbook, { selectedAccountId: 'cash' }).selectedAccount
    ).toMatchObject({
      currency: 'PHP',
      balanceCopy: '₱132.00',
      hasCurrencyIntegrityIssue: false
    });
    expect(workbook).toEqual(before);
  });
});

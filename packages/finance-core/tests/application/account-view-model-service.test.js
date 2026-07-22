// Locks down browser-safe account selector and route projections.

import { describe, expect, it } from 'vitest';

import {
  buildAccountRouteViewModel,
  buildAccountSelectorOptions,
  getAccountViewItems
} from '@cavalry/finance-core/application/accounts/account-view-model-service.js';
import {
  makeArchivedAccountWorkbook,
  makeNormalAccountWorkbook
} from '../fixtures/account-scenarios.js';

describe('account view model service', () => {
  it('builds active account selector options with legacy ordering', () => {
    const workbook = makeNormalAccountWorkbook();
    const options = buildAccountSelectorOptions(workbook, {
      groups: ['asset', 'liability'],
      selectedValue: 'cash',
      disabledId: 'credit-card'
    });

    expect(options.map((option) => option.value)).toEqual([
      'bank-checking',
      'cash',
      'credit-card',
      'freedom-fund',
      'gcash',
      'paypal'
    ]);
    expect(options.find((option) => option.value === 'cash')).toMatchObject({
      label: 'Cash • asset',
      selected: true,
      disabled: false
    });
    expect(options.find((option) => option.value === 'credit-card')).toMatchObject({
      label: 'Credit Card • liability',
      disabled: true
    });
  });

  it('keeps archived and system accounts at the end when included', () => {
    const workbook = makeArchivedAccountWorkbook();
    const items = getAccountViewItems(workbook, {
      groups: ['asset', 'liability', 'equity'],
      includeArchived: true
    });

    expect(items.at(-2).id).toBe('opening_balance_equity');
    expect(items.at(-1).id).toBe('old-wallet');
    expect(
      buildAccountSelectorOptions(workbook, {
        groups: 'asset'
      }).map((option) => option.value)
    ).not.toContain('old-wallet');
  });

  it('filters system accounts when requested', () => {
    const workbook = makeNormalAccountWorkbook();
    const options = buildAccountSelectorOptions(workbook, {
      groups: ['asset', 'liability', 'income', 'expense', 'equity'],
      includeSystem: false
    });

    expect(options.map((option) => option.value)).not.toContain('opening_balance_equity');
  });

  it('builds account route view model and selected account fallback', () => {
    const workbook = makeNormalAccountWorkbook();
    const model = buildAccountRouteViewModel(workbook, {
      selectedAccountId: 'missing',
      includeArchived: false
    });

    expect(model.accountCount).toBe(6);
    expect(model.balanceAccountCount).toBe(6);
    expect(model.selectedAccountId).toBe('bank-checking');
    expect(model.selectedAccount).toMatchObject({
      value: 'bank-checking',
      selected: true,
      isArchived: false
    });
  });

  it('projects native account balances and base-currency totals at the same as-of date', () => {
    const workbook = makeNormalAccountWorkbook();
    workbook.settings.usdToBaseRate = 61.75;
    workbook.transactions.push(
      {
        id: 'txn-paypal-opening',
        date: '2026-07-01',
        lines: [
          { accountId: 'paypal', direction: 'debit', amount: 252.15, baseAmount: 252.15 },
          {
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 252.15,
            baseAmount: 252.15
          }
        ]
      },
      {
        id: 'txn-paypal-future',
        date: '2026-07-13',
        lines: [
          { accountId: 'paypal', direction: 'debit', amount: 10, baseAmount: 10 },
          {
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 10,
            baseAmount: 10
          }
        ]
      }
    );

    const model = buildAccountRouteViewModel(workbook, {
      selectedAccountId: 'paypal',
      asOfDate: '2026-07-12'
    });

    expect(model.asOfDate).toBe('2026-07-12');
    expect(model.balances.native.paypal).toBe(252.15);
    expect(model.balances.historical.paypal).toBe(252.15);
    expect(model.balances.valuation.paypal).toBe(15570.26);
    expect(model.summary).toEqual({
      totalAssets: 65070.26,
      totalLiabilities: 700,
      netWorth: 64370.26
    });
  });

  it('handles missing workbooks without fabricating account rows', () => {
    expect(buildAccountSelectorOptions(null, { groups: 'asset' })).toEqual([]);
    expect(buildAccountRouteViewModel(null)).toMatchObject({
      accountCount: 0,
      balanceAccountCount: 0,
      selectedAccountId: '',
      selectedAccount: null,
      accounts: [],
      balanceAccounts: []
    });
  });

  it('keeps archived route visibility and selected archived accounts read-only', () => {
    const workbook = makeArchivedAccountWorkbook();
    const before = JSON.stringify(workbook);
    const model = buildAccountRouteViewModel(workbook, {
      selectedAccountId: 'old-wallet',
      includeArchived: true
    });

    expect(JSON.stringify(workbook)).toBe(before);
    expect(model.selectedAccountId).toBe('old-wallet');
    expect(model.balanceAccounts.map((account) => account.value)).toEqual([
      'bank-checking',
      'cash',
      'credit-card',
      'freedom-fund',
      'gcash',
      'paypal',
      'old-wallet'
    ]);
    expect(model.selectedAccount).toMatchObject({
      value: 'old-wallet',
      selected: true,
      isArchived: true
    });
  });
});

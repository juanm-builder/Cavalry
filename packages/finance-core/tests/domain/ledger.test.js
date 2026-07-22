import { describe, expect, it } from 'vitest';
import {
  getAccountBaseBalanceAsOf,
  getAssetLiabilityTotalsAsOf,
  getLedgerHistoricalBalancesAsOf,
  getLedgerNativeBalancesAsOf
} from '@cavalry/finance-core/domain/ledger/balances.js';
import {
  isTransactionBalanced,
  validateLedgerWorkbook
} from '@cavalry/finance-core/domain/ledger/validation.js';

const workbook = {
  accounts: [
    { id: 'cash', group: 'asset', currency: 'PHP' },
    { id: 'card', group: 'liability', currency: 'PHP' },
    { id: 'groceries-expense', group: 'expense', currency: 'PHP' }
  ],
  categories: [{ id: 'groceries' }],
  transactions: [
    {
      id: 'opening',
      date: '2026-01-01',
      categoryId: '',
      lines: [
        { accountId: 'cash', direction: 'debit', amount: 1000, baseAmount: 1000 },
        { accountId: 'card', direction: 'credit', amount: 1000, baseAmount: 1000 }
      ]
    },
    {
      id: 'groceries',
      date: '2026-01-05',
      categoryId: 'groceries',
      lines: [
        { accountId: 'groceries-expense', direction: 'debit', amount: 120.25, baseAmount: 120.25 },
        { accountId: 'cash', direction: 'credit', amount: 120.25, baseAmount: 120.25 }
      ]
    }
  ]
};

describe('ledger balances', () => {
  it('calculates historical balances by account and date', () => {
    expect(getLedgerHistoricalBalancesAsOf(workbook, '2026-01-04')).toEqual({
      cash: 1000,
      card: 1000,
      'groceries-expense': 0
    });
    expect(getAccountBaseBalanceAsOf(workbook, 'cash', '2026-01-31')).toBe(879.75);
  });

  it('calculates native balances from native line amounts', () => {
    expect(getLedgerNativeBalancesAsOf(workbook, '2026-01-31').cash).toBe(879.75);
  });

  it('summarizes assets, liabilities, and net worth', () => {
    expect(getAssetLiabilityTotalsAsOf(workbook, '2026-01-31')).toEqual({
      assets: 879.75,
      liabilities: 1000,
      netWorth: -120.25
    });
  });
});

describe('ledger validation', () => {
  it('recognizes balanced double-entry transactions', () => {
    expect(isTransactionBalanced(workbook.transactions[1])).toBe(true);
  });

  it('reports workbook integrity errors', () => {
    const errors = validateLedgerWorkbook({
      accounts: [{ id: 'cash' }, { id: 'expense' }],
      categories: [{ id: 'food' }],
      transactions: [
        {
          id: 'bad',
          categoryId: 'missing',
          lines: [
            { accountId: 'expense', direction: 'debit', baseAmount: 100 },
            { accountId: 'gone', direction: 'credit', baseAmount: 50 }
          ]
        },
        {
          id: 'bad',
          categoryId: 'food',
          lines: [{ accountId: 'cash', direction: 'credit', baseAmount: 1 }]
        }
      ]
    });

    expect(errors).toContain('duplicate transaction');
    expect(errors).toContain('missing account');
    expect(errors).toContain('missing category');
    expect(errors).toContain('too few lines');
    expect(errors).toContain('unbalanced transaction');
  });
});

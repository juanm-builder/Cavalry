import { describe, expect, it } from 'vitest';

import {
  getAssetLiabilityTotalsAsOf,
  getAccountBalanceSnapshotAsOf,
  getLedgerDisplayBalancesAsOf,
  getLedgerHistoricalBalances,
  getLedgerHistoricalBalancesAsOf,
  getLedgerNativeBalances,
  getLedgerNativeBalancesByCurrencyAsOf,
  getLedgerValuationBalancesAsOf
} from '@cavalry/finance-core/domain/ledger/balances.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import { validateAccountInvariants } from '@cavalry/finance-core/application/accounts/account-management-service.js';
import {
  makeArchivedAccountWorkbook,
  makeCreditCardAccountWorkbook,
  makeDirtyLegacyAccountWorkbook,
  makeNormalAccountWorkbook,
  makeTransferAccountWorkbook
} from '../fixtures/account-scenarios.js';
import { cloneFixture } from '../fixtures/core-workbook-fixtures.js';

describe('account balances', () => {
  it('expenses reduce cash or wallet balances and income increases bank balance', () => {
    const workbook = makeNormalAccountWorkbook();
    const balances = getLedgerHistoricalBalances(workbook);

    expect(balances.cash).toBe(-250);
    expect(balances['bank-checking']).toBe(49500);
    expect(summarizeLedgerActivity(workbook).income).toBe(50000);
    expect(summarizeLedgerActivity(workbook).expense).toBe(1450);
  });

  it('credit card expenses increase liability and payments reduce it under current semantics', () => {
    const workbook = makeCreditCardAccountWorkbook();
    const balances = getLedgerHistoricalBalances(workbook);

    expect(balances['credit-card']).toBe(700);
    expect(summarizeLedgerActivity(workbook).debt).toBe(500);
  });

  it('transfers move balances without counting as spending or income', () => {
    const workbook = makeTransferAccountWorkbook();
    const balances = getLedgerHistoricalBalances(workbook);
    const summary = summarizeLedgerActivity(workbook);

    expect(balances.cash).toBe(-1000);
    expect(balances['bank-checking']).toBe(1000);
    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(0);
    expect(summary.outflow).toBe(0);
  });

  it('supports date-range/as-of balances and native balance maps', () => {
    const workbook = makeNormalAccountWorkbook();

    expect(getLedgerHistoricalBalancesAsOf(workbook, '2026-06-02')['bank-checking']).toBe(50000);
    expect(getLedgerHistoricalBalancesAsOf(workbook, '2026-06-10')['bank-checking']).toBe(49500);
    expect(getLedgerNativeBalances(workbook)['bank-checking']).toBe(49500);
  });

  it('values foreign-currency account balances in base currency without changing native amounts', () => {
    const workbook = {
      currency: 'PHP',
      settings: { usdToBaseRate: 61.75 },
      accounts: [
        { id: 'usd-account', group: 'asset', currency: 'USD' },
        { id: 'usd-cash', group: 'asset', currency: 'USD' },
        { id: 'opening-equity', group: 'equity', currency: 'PHP' }
      ],
      transactions: [
        {
          id: 'legacy-usd-opening',
          date: '2026-07-01',
          lines: [
            {
              accountId: 'usd-account',
              direction: 'debit',
              amount: 252.15,
              currency: 'USD',
              baseAmount: 252.15
            },
            {
              accountId: 'opening-equity',
              direction: 'credit',
              amount: 252.15,
              currency: 'USD',
              baseAmount: 252.15
            }
          ]
        },
        {
          id: 'legacy-usd-cash',
          date: '2026-07-02',
          lines: [
            {
              accountId: 'usd-cash',
              direction: 'debit',
              amount: 112,
              currency: 'PHP',
              baseAmount: 112
            },
            {
              accountId: 'opening-equity',
              direction: 'credit',
              amount: 112,
              currency: 'PHP',
              baseAmount: 112
            }
          ]
        },
        {
          id: 'future-usd-cash',
          date: '2026-07-13',
          lines: [
            {
              accountId: 'usd-cash',
              direction: 'debit',
              amount: 10,
              currency: 'PHP',
              baseAmount: 10
            },
            {
              accountId: 'opening-equity',
              direction: 'credit',
              amount: 10,
              currency: 'PHP',
              baseAmount: 10
            }
          ]
        }
      ]
    };

    expect(getLedgerHistoricalBalancesAsOf(workbook, '2026-07-12')).toMatchObject({
      'usd-account': 252.15,
      'usd-cash': 112
    });
    expect(getLedgerNativeBalances(workbook)).toMatchObject({
      'usd-account': 252.15,
      'usd-cash': 122
    });
    expect(getLedgerNativeBalancesByCurrencyAsOf(workbook, '2026-07-12')).toMatchObject({
      'usd-account': { USD: 252.15 },
      'usd-cash': { PHP: 112 }
    });
    expect(getLedgerValuationBalancesAsOf(workbook, '2026-07-12')).toMatchObject({
      'usd-account': 15570.26,
      'usd-cash': 112
    });
    expect(getAssetLiabilityTotalsAsOf(workbook, '2026-07-12')).toEqual({
      assets: 15682.26,
      liabilities: 0,
      netWorth: 15682.26
    });
  });

  it('keeps observed posting currencies visible even when one bucket nets to zero', () => {
    const workbook = {
      currency: 'PHP',
      settings: { usdToBaseRate: 60 },
      accounts: [
        { id: 'mixed-account', group: 'asset', currency: 'USD' },
        { id: 'equity', group: 'equity', currency: 'PHP' }
      ],
      transactions: [
        {
          date: '2026-07-01',
          lines: [
            {
              accountId: 'mixed-account',
              direction: 'debit',
              amount: 100,
              currency: 'PHP',
              baseAmount: 100
            },
            {
              accountId: 'equity',
              direction: 'credit',
              amount: 100,
              currency: 'PHP',
              baseAmount: 100
            }
          ]
        },
        {
          date: '2026-07-02',
          lines: [
            {
              accountId: 'mixed-account',
              direction: 'credit',
              amount: 100,
              currency: 'PHP',
              baseAmount: 100
            },
            {
              accountId: 'equity',
              direction: 'debit',
              amount: 100,
              currency: 'PHP',
              baseAmount: 100
            }
          ]
        },
        {
          date: '2026-07-03',
          lines: [
            {
              accountId: 'mixed-account',
              direction: 'debit',
              amount: 10,
              currency: 'USD',
              baseAmount: 600
            },
            {
              accountId: 'equity',
              direction: 'credit',
              amount: 10,
              currency: 'USD',
              baseAmount: 600
            }
          ]
        }
      ]
    };

    expect(getLedgerDisplayBalancesAsOf(workbook, '2026-07-12')).toMatchObject({
      balances: { 'mixed-account': 600 },
      currencies: { 'mixed-account': 'PHP' },
      mixedCurrencyAccountIds: ['mixed-account'],
      currencyIntegrityAccountIds: ['mixed-account']
    });
  });

  it('uses historical book value for mixed or mismatched accounts in display and net worth', () => {
    const workbook = {
      currency: 'PHP',
      settings: { usdToBaseRate: 61.75 },
      accounts: [
        { id: 'cash', group: 'asset', currency: 'USD' },
        { id: 'equity', group: 'equity', currency: 'PHP' }
      ],
      transactions: [
        {
          id: 'prior-cash',
          date: '2026-07-01',
          lines: [
            {
              accountId: 'cash',
              direction: 'debit',
              amount: 112,
              currency: 'PHP',
              baseAmount: 112
            },
            {
              accountId: 'equity',
              direction: 'credit',
              amount: 112,
              currency: 'PHP',
              baseAmount: 112
            }
          ]
        },
        {
          id: 'found-cash',
          date: '2026-07-15',
          lines: [
            {
              accountId: 'cash',
              direction: 'debit',
              amount: 0.32,
              currency: 'USD',
              baseAmount: 20
            },
            {
              accountId: 'equity',
              direction: 'credit',
              amount: 20,
              currency: 'PHP',
              baseAmount: 20
            }
          ]
        }
      ]
    };

    expect(getLedgerValuationBalancesAsOf(workbook).cash).toBe(131.76);
    expect(getAccountBalanceSnapshotAsOf(workbook)).toMatchObject({
      historical: { cash: 132 },
      valuation: { cash: 131.76 },
      trustedBase: { cash: 132 },
      display: { cash: 132 },
      displayCurrency: { cash: 'PHP' },
      mixedCurrencyAccountIds: ['cash'],
      currencyIntegrityAccountIds: ['cash']
    });
    expect(getAssetLiabilityTotalsAsOf(workbook)).toEqual({
      assets: 132,
      liabilities: 0,
      netWorth: 132
    });
  });

  it('keeps archived account balances readable and flags archived references as warnings', () => {
    const workbook = makeArchivedAccountWorkbook();
    const result = validateAccountInvariants(workbook);

    expect(getLedgerHistoricalBalances(workbook)['old-wallet']).toBe(-75);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('line_archived_account');
  });

  it('flags missing account references while keeping balance calculation from crashing', () => {
    const workbook = makeDirtyLegacyAccountWorkbook();
    const result = validateAccountInvariants(workbook);
    const balances = getLedgerHistoricalBalances(workbook);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('line_missing_account');
    expect(balances['missing-account']).toBeUndefined();
  });

  it('pending drafts do not affect committed account balances', () => {
    const workbook = makeNormalAccountWorkbook();
    const withoutDrafts = cloneFixture(workbook);
    workbook.aiDrafts = [{ id: 'draft-account', proposed: { accountId: 'cash', amount: 999999 } }];
    workbook.externalDraftGroups = [
      {
        draft_group_id: 'external-account',
        drafts: [{ draft_id: 'draft', proposed: { accountId: 'cash' } }]
      }
    ];

    expect(getLedgerHistoricalBalances(workbook)).toEqual(
      getLedgerHistoricalBalances(withoutDrafts)
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildAccountCurrencyRepairPreview,
  repairAccountCurrency
} from '@cavalry/finance-core/application/accounts/account-currency-repair-service.js';
import { getAccountCurrencyIntegrity } from '@cavalry/finance-core/domain/ledger/account-currency-integrity.js';
import {
  getAccountBalanceSnapshotAsOf,
  getLedgerHistoricalBalances
} from '@cavalry/finance-core/domain/ledger/balances.js';
import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import { cloneFixture } from '../fixtures/core-workbook-fixtures.js';

function makeCorruptedCashWorkbook() {
  return {
    id: 'wb-currency-repair',
    version: 2,
    currency: 'PHP',
    settings: { usdToBaseRate: 61.75 },
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'USD', isActive: true },
      {
        id: 'opening-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'random-income',
        name: 'Random Finds Income',
        group: 'income',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'random-finds',
        name: 'Random Finds',
        type: 'income',
        linkedAccountId: 'random-income',
        isActive: true
      }
    ],
    transactions: [
      {
        id: 'txn-opening',
        date: '2026-04-01',
        monthKey: '2026-04',
        template: 'opening_balance',
        description: 'Cash opening balance',
        originalCurrency: 'PHP',
        amount: 112,
        baseAmount: 112,
        fxRateToBase: 0,
        lines: [
          {
            id: 'line-opening-cash',
            accountId: 'cash',
            direction: 'debit',
            amount: 112,
            currency: 'PHP',
            baseAmount: 112
          },
          {
            id: 'line-opening-equity',
            accountId: 'opening-equity',
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
        monthKey: '2026-07',
        template: 'income_received',
        description: 'Found cash',
        categoryId: 'random-finds',
        originalCurrency: 'PHP',
        amount: 20,
        baseAmount: 20,
        fxRateToBase: 0,
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
            accountId: 'random-income',
            direction: 'credit',
            amount: 20,
            currency: 'PHP',
            baseAmount: 20
          }
        ]
      }
    ],
    sheets: [],
    counterparties: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

describe('account currency integrity and repair', () => {
  it('reports actual posting currencies even when metadata says something else', () => {
    const integrity = getAccountCurrencyIntegrity(makeCorruptedCashWorkbook(), 'cash');

    expect(integrity).toMatchObject({
      exists: true,
      configuredCurrency: 'USD',
      postingCurrencies: ['PHP', 'USD'],
      transactionIds: ['txn-opening', 'txn-found-cash'],
      lineCount: 2,
      hasHistory: true,
      mismatched: true,
      mixed: true,
      consistent: false
    });
  });

  it('previews and atomically repairs the exact PHP 112 plus PHP 20 corruption', () => {
    const workbook = makeCorruptedCashWorkbook();
    const before = cloneFixture(workbook);
    const preview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP'
    });

    expect(preview).toMatchObject({
      ok: true,
      repairKind: 'base_currency_posting_correction',
      configuredCurrency: 'USD',
      targetCurrency: 'PHP',
      postingCurrencies: ['PHP', 'USD'],
      affectedLineCount: 2,
      changedLineCount: 1,
      affectedTransactionIds: ['txn-opening', 'txn-found-cash'],
      before: {
        historicalBaseBalance: 132,
        nativeByCurrency: { PHP: 112, USD: 0.32 }
      },
      after: {
        historicalBaseBalance: 132,
        nativeByCurrency: { PHP: 132 }
      },
      bookValueDelta: 0,
      requiresConfirmation: true
    });
    expect(preview.lineChanges[0]).toMatchObject({
      transactionId: 'txn-found-cash',
      lineId: 'line-found-cash',
      before: { currency: 'USD', amount: 0.32, baseAmount: 20 },
      after: { currency: 'PHP', amount: 20, baseAmount: 20 }
    });
    expect(workbook).toEqual(before);

    const result = repairAccountCurrency(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP',
      expectedFingerprint: preview.fingerprint,
      confirmed: true
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook).toEqual(before);
    expect(result.workbook.accounts.find((account) => account.id === 'cash').currency).toBe('PHP');
    expect(
      result.workbook.transactions
        .find((transaction) => transaction.id === 'txn-found-cash')
        .lines.find((line) => line.id === 'line-found-cash')
    ).toMatchObject({ amount: 20, currency: 'PHP', baseAmount: 20 });
    expect(getLedgerHistoricalBalances(result.workbook).cash).toBe(132);
    expect(getAccountBalanceSnapshotAsOf(result.workbook).display.cash).toBe(132);
    expect(getAccountBalanceSnapshotAsOf(result.workbook).displayCurrency.cash).toBe('PHP');
    expect(getAccountCurrencyIntegrity(result.workbook, 'cash')).toMatchObject({
      configuredCurrency: 'PHP',
      postingCurrencies: ['PHP'],
      mismatched: false,
      mixed: false,
      consistent: true
    });
    expect(
      validateLedgerInvariants(result.workbook).warnings.some(
        (warning) => warning.code === 'account_posting_currency_mismatch'
      )
    ).toBe(false);
  });

  it('requires a current preview and explicit confirmation', () => {
    const workbook = makeCorruptedCashWorkbook();
    const preview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP'
    });

    expect(
      repairAccountCurrency(workbook, {
        accountId: 'cash',
        targetCurrency: 'PHP',
        confirmed: true
      }).errors[0].code
    ).toBe('account_currency_repair_preview_required');
    expect(
      repairAccountCurrency(workbook, {
        accountId: 'cash',
        targetCurrency: 'PHP',
        expectedFingerprint: 'stale',
        confirmed: true
      }).errors[0].code
    ).toBe('account_currency_repair_stale');
    expect(
      repairAccountCurrency(workbook, {
        accountId: 'cash',
        targetCurrency: 'PHP',
        expectedFingerprint: preview.fingerprint
      }).errors[0].code
    ).toBe('account_currency_repair_confirmation_required');
  });

  it('rejects automatic mixed-history repair to a non-base currency', () => {
    const workbook = makeCorruptedCashWorkbook();
    const preview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: 'cash',
      targetCurrency: 'USD'
    });

    expect(preview.ok).toBe(false);
    expect(preview.blockers).toEqual([
      expect.objectContaining({ code: 'account_currency_repair_target_unsupported' })
    ]);
    expect(workbook.accounts.find((account) => account.id === 'cash').currency).toBe('USD');
  });

  it('uses a metadata-only repair when every historical posting already has the target currency', () => {
    const workbook = makeCorruptedCashWorkbook();
    workbook.transactions = workbook.transactions.slice(0, 1);
    const preview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP'
    });

    expect(preview).toMatchObject({
      ok: true,
      repairKind: 'metadata_only',
      changedLineCount: 0,
      bookValueDelta: 0
    });
    const result = repairAccountCurrency(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP',
      expectedFingerprint: preview.fingerprint,
      confirmed: true
    });
    expect(result.ok).toBe(true);
    expect(result.workbook.accounts.find((account) => account.id === 'cash').currency).toBe('PHP');
    expect(result.workbook.transactions[0].lines[0]).toMatchObject({
      amount: 112,
      currency: 'PHP',
      baseAmount: 112
    });
  });

  it('blocks malformed affected lines instead of guessing a replacement value', () => {
    const workbook = makeCorruptedCashWorkbook();
    workbook.transactions[1].lines[0].baseAmount = Number.NaN;
    const preview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP'
    });

    expect(preview.ok).toBe(false);
    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'account_currency_repair_invalid_line_amount' }),
        expect.objectContaining({ code: 'account_currency_repair_unbalanced_transaction' })
      ])
    );
  });
});

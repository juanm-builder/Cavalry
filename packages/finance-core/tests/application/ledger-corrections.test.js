import { getPeriodActivitySummary } from '../../src/domain/ledger/summaries.js';
import { summarizeLedgerActivity } from '../../src/domain/ledger/transactions.js';
import { describe, expect, it } from 'vitest';
import { makeBasicSpendingWorkbook } from '../fixtures/core-workbook-fixtures.js';
import {
  submitManualTransactionCommand,
  deleteLedgerTransactionCommand
} from '../../src/application/transactions/transaction-command-service.js';
import {
  buildMonthlyCashFlowReport,
  buildCategorySpendingReport
} from '../../src/application/reports/reporting-service.js';
import { buildDashboardFlowDrilldownViewModel } from '../../src/application/dashboard/dashboard-flow-drilldown-view-model-service.js';
import { getAccountBalanceSnapshotAsOf } from '../../src/domain/ledger/balances.js';

const blank = () => ({ ...makeBasicSpendingWorkbook(), transactions: [] });
const purchase = { template: 'expense_paid', primaryAccountId: 'cash', categoryId: 'food' };
const income = {
  template: 'income_received',
  primaryAccountId: 'wallet-usd',
  categoryId: 'salary'
};
function submit(workbook, fields) {
  return submitManualTransactionCommand(workbook, {
    date: '2026-06-12',
    currency: 'PHP',
    amount: 100,
    allowDuplicate: true,
    ...fields
  });
}
function post(workbook, fields) {
  const result = submit(workbook, fields);
  expect(result.ok).toBe(true);
  expect(result.transaction).toBeDefined();
  return result.workbook;
}

describe('posted balances and cash movement', () => {
  it('posts and reverses PHP/USD at the reviewed rate in a USD workbook', () => {
    const workbook = blank();
    workbook.currency = 'USD';
    workbook.fxRates = [{ fromCurrency: 'PHP', toCurrency: 'USD', rate: 0.02 }];
    const fields = { ...income, amount: 5800, fxRateToBase: 0.0172 };
    expect(submit(workbook, fields).events[0].type).toBe('confirm-currency-conversion');
    const paid = post(workbook, { ...fields, allowCurrencyConversion: true });
    expect(paid.transactions[0].baseAmount).toBe(99.76);
    expect(getAccountBalanceSnapshotAsOf(paid).display['wallet-usd']).toBe(99.76);
    const reversed = post(paid, {
      template: 'transfer',
      amount: 99.76,
      currency: 'USD',
      primaryAccountId: 'wallet-usd',
      secondaryAccountId: 'cash',
      fxRateToBase: 0.0172,
      allowCurrencyConversion: true
    });
    expect(getAccountBalanceSnapshotAsOf(reversed).display.cash).toBe(5800);
    expect(getAccountBalanceSnapshotAsOf(reversed).display['wallet-usd']).toBe(0);
  });

  it('rejects missing exchange rates and ambiguous overrides without recording a transaction', () => {
    const workbook = blank();
    workbook.settings.usdToBaseRate = 0;
    const missing = submit(workbook, { ...income, currency: 'USD' });
    expect(missing.ok).toBe(false);
    expect(missing.workbook.transactions).toHaveLength(0);
    workbook.accounts.push({ id: 'eur', currency: 'EUR', group: 'asset', name: 'Euro bank' });
    const ambiguous = submit(workbook, {
      template: 'transfer',
      primaryAccountId: 'wallet-usd',
      secondaryAccountId: 'eur',
      fxRateToBase: 58,
      allowCurrencyConversion: true
    });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.workbook.transactions).toHaveLength(0);
  });

  it('changes the sign of spending when a purchase is corrected to a refund and back', () => {
    const paid = post(blank(), purchase);
    const refund = post(paid, {
      ...purchase,
      transactionId: paid.transactions[0].id,
      template: 'merchant_refund'
    });
    expect(refund.transactions[0].eventKind).toBe('merchant_refund');
    expect(getAccountBalanceSnapshotAsOf(refund).display.cash).toBe(100);
    expect(buildCategorySpendingReport(refund).total).toBe(-100);
    refund.transactions[0].eventKind = 'purchase'; // Previously saved by the old editor.
    expect(buildCategorySpendingReport(refund).total).toBe(-100);
    const restored = post(refund, { ...purchase, transactionId: paid.transactions[0].id });
    expect(buildCategorySpendingReport(restored).total).toBe(100);
  });

  it.each(['transfer', 'debt_payment'])(
    'counts the card settlement once when paid by %s',
    (template) => {
      const charged = post(blank(), {
        ...purchase,
        template: 'expense_charged',
        primaryAccountId: 'credit-card'
      });
      const paid = post(charged, {
        template,
        date: '2026-07-01',
        primaryAccountId: 'cash',
        secondaryAccountId: 'credit-card',
        categoryId: template === 'debt_payment' ? 'credit-card-payment' : ''
      });
      const report = buildMonthlyCashFlowReport(paid);
      expect(report.months.map((month) => month.outflow)).toEqual([0, 100]);
      expect(report.summary.net).toBe(-100);
      expect(getPeriodActivitySummary(paid).outflow).toBe(100);
      expect(summarizeLedgerActivity(paid).net).toBe(-100);
      expect(buildCategorySpendingReport(paid).total).toBe(100);
      const detail = buildDashboardFlowDrilldownViewModel(paid, {
        flowType: 'outflow',
        monthKey: '2026-07'
      });
      expect(detail.summary.total).toBe(100);
      expect(detail.rows.map((row) => row.transactionId)).toEqual([paid.transactions[1].id]);
    }
  );

  it('rejects an open edit after its transaction was deleted', () => {
    const original = post(blank(), purchase);
    const id = original.transactions[0].id;
    const removed = deleteLedgerTransactionCommand(original, id).workbook;
    const result = submit(removed, { ...purchase, transactionId: id });
    expect(result.ok).toBe(false);
    expect(result.workbook).toBe(removed);
    expect(result.workbook.transactions).toHaveLength(0);
  });

  it('values the remaining foreign balance once at the current rate', () => {
    let workbook = blank();
    workbook.settings.usdToBaseRate = 56.6;
    for (let day = 1; day <= 3; day++)
      workbook = post(workbook, {
        ...income,
        currency: 'USD',
        amount: 0.01,
        date: '2026-06-0' + day,
        fxRateToBase: 56.6
      });
    const cutoff = getAccountBalanceSnapshotAsOf(workbook, '2026-06-03');
    expect(cutoff.valuation['wallet-usd']).toBe(1.7);
    expect(cutoff.historical['wallet-usd']).toBe(1.71);
    workbook = post(workbook, {
      ...purchase,
      primaryAccountId: 'wallet-usd',
      currency: 'USD',
      amount: 0.03,
      fxRateToBase: 56.6
    });
    const final = getAccountBalanceSnapshotAsOf(workbook);
    expect(final.display['wallet-usd']).toBe(0);
    expect(final.trustedBase['wallet-usd']).toBe(0);
  });
});

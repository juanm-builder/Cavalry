import { getAssetLiabilityTotalsAsOf } from '@cavalry/finance-core/domain/ledger/balances.js';
import { getLedgerTransactionBaseAmount } from '@cavalry/finance-core/domain/ledger/transactions.js';
import { getPeriodActivitySummary } from '@cavalry/finance-core/domain/ledger/summaries.js';
import { roundMoney } from '@cavalry/finance-core/domain/money.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function transactionAmount(transaction) {
  const baseAmount = getLedgerTransactionBaseAmount(transaction);
  return roundMoney(baseAmount || Number(transaction && transaction.amount) || 0);
}

function sourceEntry(sourceRef, value, rows = [], extra = {}) {
  return {
    source_ref: sourceRef,
    kind: sourceRef.split(':')[0] || 'source',
    value: roundMoney(value),
    rows: asArray(rows).filter(Boolean),
    ...extra
  };
}

export function buildAdvisorSourceRegistry(workbook, options = {}) {
  const range = options.range || {};
  const totals = getAssetLiabilityTotalsAsOf(workbook || {}, options.asOfDate || range.end || '');
  const period = getPeriodActivitySummary(workbook || {}, range);
  const sources = {
    'computed.totals.assets': sourceEntry('computed.totals.assets', totals.assets),
    'computed.totals.liabilities': sourceEntry('computed.totals.liabilities', totals.liabilities),
    'computed.totals.net_worth': sourceEntry('computed.totals.net_worth', totals.netWorth, [], {
      inputRefs: ['computed.totals.assets', 'computed.totals.liabilities']
    })
  };

  asArray(workbook && workbook.categories).forEach((category) => {
    if (!category || !category.id) {
      return;
    }
    const transactions = period.transactions.filter(
      (transaction) => transaction && transaction.categoryId === category.id
    );
    const sourceRef = `category_spend:${category.id}`;
    sources[sourceRef] = sourceEntry(
      sourceRef,
      transactions.reduce(
        (sum, transaction) => roundMoney(sum + transactionAmount(transaction)),
        0
      ),
      transactions.map((transaction) => transaction.id)
    );
  });

  asArray(workbook && workbook.transactions).forEach((transaction) => {
    if (!transaction || !transaction.id) {
      return;
    }
    const sourceRef = `transaction:${transaction.id}`;
    sources[sourceRef] = sourceEntry(sourceRef, transactionAmount(transaction), [transaction.id]);
  });
  return { sources };
}

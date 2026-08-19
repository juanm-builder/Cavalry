function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value);
}

function titleCase(value) {
  return (
    asString(value)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Transaction'
  );
}

export function formatTransactionMoney(value, currency = 'PHP') {
  const code = asString(currency || 'PHP').toUpperCase() || 'PHP';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${(Number(value) || 0).toFixed(2)} ${code}`;
  }
}

function transactionBalanceTone(account, value) {
  const amount = Number(value) || 0;
  if (!amount) return 'neutral';
  if (account?.group === 'liability') return amount > 0 ? 'bad' : 'good';
  return amount > 0 ? 'good' : 'bad';
}

function transactionTone(row) {
  const eventKind = asString(row?.eventKind || row?.contributions?.eventKind);
  if (['merchant_refund', 'income_received', 'reimbursement'].includes(eventKind)) return 'good';
  if (
    ['purchase', 'debt_interest_or_fee', 'debt_principal_payment', 'savings_contribution'].includes(
      eventKind
    )
  ) {
    return 'bad';
  }
  const template = asString(row?.template || row?.transaction?.template);
  if (['merchant_refund', 'refund', 'income_received'].includes(template)) return 'good';
  if (['expense_paid', 'expense_charged', 'debt_payment', 'liability_payment'].includes(template)) {
    return 'bad';
  }
  if (row.type === 'income') return 'good';
  if (row.type === 'refund') return 'good';
  if (row.type === 'expense') return 'bad';
  return 'info';
}

export function formatDirectionalTransactionMoney(value, currency, tone) {
  const amount = Number(value) || 0;
  const formatted = formatTransactionMoney(Math.abs(amount), currency);
  if (!amount) return formatted;
  if (tone === 'good') return `+${formatted}`;
  if (tone === 'bad') return `−${formatted}`;
  return formatted;
}

export function buildTransactionRowModel(row, options = {}) {
  const transaction = asObject(row.transaction);
  const tone = transactionTone(row);
  const isAiOrigin =
    transaction.source === 'advisor' || /^advisor:/.test(asString(transaction.reference));
  const currency = transaction.originalCurrency || transaction.currency || row.currency || 'PHP';
  const balanceAfter = options.runningBalances?.get(row.id);
  const cells = [
    { field: 'date', kind: 'text', value: row.date, className: 'transaction-cell' },
    {
      field: 'description',
      kind: 'entity',
      value: row.description || 'Untitled transaction',
      subtitle: row.templateLabel || titleCase(row.template),
      isAiOrigin,
      className: 'transaction-cell'
    },
    {
      field: 'categoryId',
      kind: 'category',
      value: row.categoryLabel || 'Uncategorized',
      tone,
      className: 'transaction-cell'
    },
    {
      field: 'primaryAccountId',
      kind: 'text',
      value: row.accountLabel || 'Workbook',
      className: 'transaction-cell'
    },
    {
      field: 'amount',
      kind: 'amount',
      value: formatDirectionalTransactionMoney(row.amount, currency, tone),
      tone,
      className: `amount ${tone} transaction-cell`
    }
  ];
  if (options.showRunningBalance && balanceAfter) {
    const balanceTone = transactionBalanceTone(options.account, balanceAfter.balance);
    cells.push({
      field: 'balanceAfter',
      kind: 'amount',
      value: formatTransactionMoney(balanceAfter.balance, options.baseCurrency || currency),
      tone: balanceTone,
      className: `amount ${balanceTone} balance-after-cell`
    });
  }
  return {
    id: row.id,
    isAiOrigin,
    canEdit: row.inlineEditable !== false,
    cells
  };
}

export function buildPeriodLabel(viewState) {
  const range = asObject(viewState && viewState.dateRange);
  if (range.start && range.end) return `${range.start} – ${range.end}`;
  if (range.start) return `From ${range.start}`;
  if (range.end) return `Through ${range.end}`;
  return 'All dates';
}

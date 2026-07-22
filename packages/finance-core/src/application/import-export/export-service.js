function asString(value) {
  return String(value == null ? '' : value).trim();
}

function csvEscape(value) {
  const raw = String(value == null ? '' : value);
  if (/[",\n\r]/.test(raw)) {
    return '"' + raw.replace(/"/g, '""') + '"';
  }
  return raw;
}

function accountById(workbook) {
  return new Map(
    (Array.isArray(workbook && workbook.accounts) ? workbook.accounts : []).map((account) => [
      asString(account && account.id),
      account
    ])
  );
}

function categoryById(workbook) {
  return new Map(
    (Array.isArray(workbook && workbook.categories) ? workbook.categories : []).map((category) => [
      asString(category && category.id),
      category
    ])
  );
}

export function formatCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function getPrimaryAccount(workbook, transaction, accounts) {
  const direct =
    transaction && transaction.primaryAccountId
      ? accounts.get(asString(transaction.primaryAccountId))
      : null;
  if (direct) {
    return direct;
  }
  const lines = Array.isArray(transaction && transaction.lines) ? transaction.lines : [];
  const template = asString(transaction && transaction.template);
  if (template === 'income_received') {
    const incomeLine = lines.find((line) => {
      const account = accounts.get(asString(line && line.accountId));
      return line && line.direction === 'debit' && account && account.group === 'asset';
    });
    return incomeLine ? accounts.get(asString(incomeLine.accountId)) : null;
  }
  if (template === 'expense_charged') {
    const liabilityLine = lines.find((line) => {
      const account = accounts.get(asString(line && line.accountId));
      return line && line.direction === 'credit' && account && account.group === 'liability';
    });
    return liabilityLine ? accounts.get(asString(liabilityLine.accountId)) : null;
  }
  const assetLine = lines.find((line) => {
    const account = accounts.get(asString(line && line.accountId));
    return line && line.direction === 'credit' && account && account.group === 'asset';
  });
  return assetLine ? accounts.get(asString(assetLine.accountId)) : null;
}

export function exportTransactionsCsv(workbook, options = {}) {
  const accounts = accountById(workbook);
  const categories = categoryById(workbook);
  const rows = [
    [
      'transaction_id',
      'date',
      'description',
      'template',
      'amount',
      'currency',
      'account_id',
      'account',
      'category_id',
      'category',
      'note',
      'reference',
      'source'
    ]
  ];
  const transactions = Array.isArray(workbook && workbook.transactions)
    ? workbook.transactions
    : [];
  transactions.forEach((transaction) => {
    if (
      options.excludeTransfers === true &&
      asString(transaction && transaction.template) === 'transfer'
    ) {
      return;
    }
    const account = getPrimaryAccount(workbook, transaction, accounts);
    const category = categories.get(asString(transaction && transaction.categoryId)) || null;
    rows.push([
      transaction && transaction.id,
      transaction && transaction.date,
      transaction && transaction.description,
      transaction && transaction.template,
      transaction && transaction.amount,
      (transaction && (transaction.originalCurrency || transaction.currency)) ||
        (workbook && workbook.currency) ||
        'PHP',
      account && account.id,
      account && account.name,
      category && category.id,
      category && category.name,
      transaction && transaction.note,
      transaction && transaction.reference,
      transaction && transaction.source
    ]);
  });
  return formatCsv(rows);
}

export function exportAccountsCsv(workbook) {
  const rows = [['account_id', 'name', 'group', 'currency', 'is_active', 'is_system']].concat(
    (Array.isArray(workbook && workbook.accounts) ? workbook.accounts : []).map((account) => [
      account && account.id,
      account && account.name,
      account && account.group,
      account && account.currency,
      account && account.isActive === false ? 'false' : 'true',
      account && account.isSystem === true ? 'true' : 'false'
    ])
  );
  return formatCsv(rows);
}

export function exportCategoriesCsv(workbook) {
  const rows = [
    ['category_id', 'name', 'type', 'currency', 'linked_account_id', 'is_active']
  ].concat(
    (Array.isArray(workbook && workbook.categories) ? workbook.categories : []).map((category) => [
      category && category.id,
      category && category.name,
      category && category.type,
      category && category.currency,
      category && category.linkedAccountId,
      category && category.isActive === false ? 'false' : 'true'
    ])
  );
  return formatCsv(rows);
}

export function exportWorkbookCsvBundle(workbook, options = {}) {
  return {
    'transactions.csv': exportTransactionsCsv(workbook, options.transactions || {}),
    'accounts.csv': exportAccountsCsv(workbook),
    'categories.csv': exportCategoriesCsv(workbook)
  };
}

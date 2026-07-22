import { getLedgerHistoricalBalancesAsOf } from '../../domain/ledger/balances.js';
import { roundMoney } from '../../domain/money.js';

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

function csv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function shouldMaskText(mode, options = {}) {
  return mode === 'redacted_details' && options.maskNames !== false;
}

function mask(value, mode, options) {
  if (!shouldMaskText(mode, options)) {
    return asString(value);
  }
  const text = asString(value);
  return text ? '[redacted]' : '';
}

function getTransactions(workbook, options = {}) {
  const start = asString(options.startDate || options.start_date);
  const end = asString(options.endDate || options.end_date);
  return (workbook.transactions || []).filter((transaction) => {
    const date = asString(transaction.date);
    if (start && date < start) return false;
    if (end && date > end) return false;
    return options.excludePrivate === true ? transaction.private !== true : true;
  });
}

export function buildChatGptContextPack(workbook, options = {}) {
  const mode = ['summary_only', 'redacted_details', 'full_details'].includes(
    asString(options.privacyMode)
  )
    ? asString(options.privacyMode)
    : 'redacted_details';
  const transactions = mode === 'summary_only' ? [] : getTransactions(workbook || {}, options);
  const transactionRows = [
    [
      'transaction_id',
      'date',
      'description',
      'amount',
      'currency',
      'category_id',
      'account_id',
      'note'
    ]
  ].concat(
    transactions.map((transaction) => [
      transaction.id,
      transaction.date,
      mask(transaction.description, mode, options),
      transaction.amount,
      transaction.originalCurrency || transaction.currency || workbook.currency || 'PHP',
      transaction.categoryId || '',
      transaction.primaryAccountId || '',
      options.excludeNotes === true ? '' : mask(transaction.note, mode, options)
    ])
  );
  const accounts = mode === 'summary_only' ? [] : workbook.accounts || [];
  const asOfDate = asString(
    options.asOfDate || options.as_of_date || options.endDate || options.end_date
  );
  const accountBalances = getLedgerHistoricalBalancesAsOf(workbook || {}, asOfDate);
  const balanceAccounts = (workbook && workbook.accounts ? workbook.accounts : []).filter(
    (account) => account && ['asset', 'liability'].includes(account.group)
  );
  const totalAssets = balanceAccounts
    .filter(
      (account) =>
        account.isActive !== false && account.isSystem !== true && account.group === 'asset'
    )
    .reduce(
      (sum, account) =>
        roundMoney(sum + Math.max(0, Number(accountBalances[account.id] || 0) || 0)),
      0
    );
  const totalLiabilities = balanceAccounts
    .filter(
      (account) =>
        account.isActive !== false && account.isSystem !== true && account.group === 'liability'
    )
    .reduce(
      (sum, account) =>
        roundMoney(sum + Math.max(0, Number(accountBalances[account.id] || 0) || 0)),
      0
    );
  const categories = mode === 'summary_only' ? [] : workbook.categories || [];
  const files = {
    'Financial_Brief.md': [
      '# Cavalry Financial Brief',
      '',
      'Workbook: ' + asString((workbook && workbook.name) || 'Cavalry'),
      'Currency: ' + asString((workbook && workbook.currency) || 'PHP'),
      'Transactions included: ' + String(transactions.length),
      'Account assets: ' +
        String(totalAssets) +
        ' ' +
        asString((workbook && workbook.currency) || 'PHP'),
      'Account liabilities: ' +
        String(totalLiabilities) +
        ' ' +
        asString((workbook && workbook.currency) || 'PHP'),
      'Account net worth: ' +
        String(roundMoney(totalAssets - totalLiabilities)) +
        ' ' +
        asString((workbook && workbook.currency) || 'PHP'),
      'Account balances as of: ' + (asOfDate || 'latest posted ledger activity'),
      '',
      'Cavalry is the source of truth. Use this context only to propose a CavalryActionPlan for changes.'
    ].join('\n'),
    'Transactions.csv': csv(transactionRows),
    'ChatGPT_Prompt.md': [
      '# Prompt',
      '',
      'You are helping with Cavalry, a personal finance app.',
      'If the user wants changes, output a JSON CavalryActionPlan v1.',
      'Do not claim the workbook changed. Cavalry will import the plan and create reviewable drafts.',
      'Use create_transaction, create_transaction_batch, create_recurring_item, update_category_assignment, or update_budget only.',
      'Never output direct apply, delete, archive, or posted-transaction actions.'
    ].join('\n')
  };
  if (accounts.length) {
    files['Accounts_Summary.csv'] = csv(
      [
        [
          'account_id',
          'display_name',
          'type',
          'subtype',
          'currency',
          'is_active',
          'is_system',
          'balance',
          'balance_currency',
          'balance_as_of',
          'source_ref'
        ]
      ].concat(
        accounts.map((account) => [
          account.id,
          mask(account.name, mode, options),
          account.group || '',
          account.subtype || '',
          account.currency || workbook.currency || 'PHP',
          account.isActive === false ? 'false' : 'true',
          account.isSystem === true ? 'true' : 'false',
          Object.prototype.hasOwnProperty.call(accountBalances, account.id)
            ? accountBalances[account.id]
            : '',
          workbook.currency || 'PHP',
          asOfDate,
          account.id ? 'account:' + account.id : ''
        ])
      )
    );
  }
  if (categories.length) {
    files['Categories.csv'] = csv(
      [['category_id', 'display_name', 'type', 'archived']].concat(
        categories.map((category) => [
          category.id,
          category.name,
          category.type || '',
          category.isActive === false ? 'true' : 'false'
        ])
      )
    );
  }
  return {
    privacy_mode: mode,
    files
  };
}

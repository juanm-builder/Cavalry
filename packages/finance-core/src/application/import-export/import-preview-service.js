import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import { buildManualLedgerTransaction } from '../../domain/ledger/transactions.js';
import { normalizeCsvHeader, parseCsv, parseCsvNumber } from './csv-import-parser.js';

const COLUMN_ALIASES = Object.freeze({
  transactionId: ['transaction_id', 'id'],
  date: ['date', 'transaction_date', 'posted_date', 'posting_date'],
  description: ['description', 'memo', 'merchant', 'payee', 'details'],
  amount: ['amount', 'transaction_amount'],
  debit: ['debit', 'withdrawal', 'spent', 'expense'],
  credit: ['credit', 'deposit', 'received', 'income'],
  currency: ['currency', 'original_currency'],
  account: ['account', 'account_name', 'primary_account'],
  accountId: ['account_id', 'primary_account_id'],
  category: ['category', 'category_name'],
  categoryId: ['category_id'],
  template: ['template', 'type', 'direction', 'transaction_type'],
  note: ['note', 'notes'],
  reference: ['reference', 'ref']
});

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function textKey(value) {
  return asString(value).toLowerCase().replace(/\s+/g, ' ');
}

function makeIssue(severity, code, message, detail = {}) {
  return Object.assign({ severity, code, message }, detail);
}

function hasError(issues) {
  return issues.some((issue) => issue.severity === 'error');
}

function hasWarning(issues) {
  return issues.some((issue) => issue.severity === 'warning');
}

function normalizeCurrency(value, workbook) {
  return (
    asString(value).toUpperCase() || asString(workbook && workbook.currency).toUpperCase() || 'PHP'
  );
}

function parseDate(value) {
  const raw = asString(value);
  if (!raw) {
    return '';
  }
  const normalized = normalizeDateKey(raw);
  if (normalized) {
    return normalized;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!slash) {
    return '';
  }
  const month = Number(slash[1]);
  const day = Number(slash[2]);
  const year = Number(slash[3]);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) {
    return '';
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function mapColumns(headers, overrides = {}) {
  const available = new Set((headers || []).map(normalizeCsvHeader).filter(Boolean));
  const mapping = {};
  Object.entries(COLUMN_ALIASES).forEach(([field, aliases]) => {
    const override = overrides[field] ? normalizeCsvHeader(overrides[field]) : '';
    if (override && available.has(override)) {
      mapping[field] = override;
      return;
    }
    mapping[field] = aliases.find((alias) => available.has(alias)) || '';
  });
  return mapping;
}

function valueFor(row, mapping, field) {
  const key = mapping[field];
  if (!(key && row && row.values)) {
    return '';
  }
  return row.values[key] == null ? '' : row.values[key];
}

function buildLookup(items, label) {
  const byId = new Map();
  const byName = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = asString(item && item.id);
    const name = textKey(item && item.name);
    if (id) {
      byId.set(id, item);
    }
    if (name) {
      const matches = byName.get(name) || [];
      matches.push(item);
      byName.set(name, matches);
    }
  });
  return { byId, byName, label };
}

function resolveLookupValue(lookup, rawId, rawName, options = {}) {
  const id = asString(rawId);
  const name = asString(rawName);
  const issues = [];
  if (id) {
    const found = lookup.byId.get(id) || null;
    if (!found) {
      issues.push(
        makeIssue(
          'error',
          `${lookup.label}_id_not_found`,
          `No ${lookup.label} matches the provided ID.`,
          { value: id }
        )
      );
      return { value: null, issues };
    }
    if (found.isActive === false && options.allowArchived !== true) {
      issues.push(
        makeIssue('error', `${lookup.label}_archived`, `The matched ${lookup.label} is archived.`, {
          value: id
        })
      );
    }
    return { value: found, issues };
  }
  if (!name) {
    issues.push(
      makeIssue(
        'error',
        `${lookup.label}_missing`,
        `Choose a ${lookup.label} for this imported row.`
      )
    );
    return { value: null, issues };
  }
  const matches = lookup.byName.get(textKey(name)) || [];
  if (!matches.length) {
    issues.push(
      makeIssue(
        'error',
        `${lookup.label}_not_found`,
        `No ${lookup.label} matches the imported name.`,
        { value: name }
      )
    );
    return { value: null, issues };
  }
  if (matches.length > 1) {
    issues.push(
      makeIssue(
        'error',
        `${lookup.label}_ambiguous`,
        `More than one ${lookup.label} matches the imported name.`,
        { value: name }
      )
    );
    return { value: null, issues };
  }
  const found = matches[0];
  if (found.isActive === false && options.allowArchived !== true) {
    issues.push(
      makeIssue('error', `${lookup.label}_archived`, `The matched ${lookup.label} is archived.`, {
        value: name
      })
    );
  }
  return { value: found, issues };
}

function parseAmount(row, mapping) {
  const issues = [];
  const debitRaw = asString(valueFor(row, mapping, 'debit'));
  const creditRaw = asString(valueFor(row, mapping, 'credit'));
  const hasDebit = debitRaw !== '';
  const hasCredit = creditRaw !== '';
  if (hasDebit || hasCredit) {
    const debit = hasDebit ? parseCsvNumber(debitRaw) : 0;
    const credit = hasCredit ? parseCsvNumber(creditRaw) : 0;
    if (hasDebit && !Number.isFinite(debit)) {
      issues.push(makeIssue('error', 'invalid_debit', 'Debit amount is not a valid number.'));
    }
    if (hasCredit && !Number.isFinite(credit)) {
      issues.push(makeIssue('error', 'invalid_credit', 'Credit amount is not a valid number.'));
    }
    if (Number.isFinite(debit) && debit > 0 && Number.isFinite(credit) && credit > 0) {
      issues.push(
        makeIssue(
          'error',
          'both_debit_and_credit',
          'A row cannot have both debit and credit amounts.'
        )
      );
    }
    if (!hasError(issues)) {
      if (credit > 0) {
        return { amount: roundMoney(credit), direction: 'income', issues };
      }
      if (debit > 0) {
        return { amount: roundMoney(debit), direction: 'expense', issues };
      }
      issues.push(makeIssue('error', 'amount_missing', 'Enter a positive debit or credit amount.'));
    }
    return { amount: 0, direction: '', issues };
  }

  const raw = asString(valueFor(row, mapping, 'amount'));
  const amount = parseCsvNumber(raw);
  if (!Number.isFinite(amount) || amount === 0) {
    return {
      amount: 0,
      direction: '',
      issues: [makeIssue('error', 'amount_invalid', 'Amount must be a non-zero number.')]
    };
  }
  return {
    amount: roundMoney(Math.abs(amount)),
    direction: amount < 0 ? 'expense' : '',
    issues
  };
}

function templateFromText(value) {
  const key = textKey(value).replace(/[\s-]+/g, '_');
  if (['income', 'income_received', 'credit', 'deposit', 'received'].includes(key))
    return 'income_received';
  if (['expense', 'expense_paid', 'debit', 'withdrawal', 'paid', 'payment'].includes(key))
    return 'expense_paid';
  if (['expense_charged', 'charge', 'charged', 'credit_card'].includes(key))
    return 'expense_charged';
  if (['transfer', 'debt_payment', 'liability_payment', 'opening_balance'].includes(key))
    return key;
  return '';
}

function deriveTemplate({ explicitTemplate, amountDirection, account, category, issues }) {
  const template = templateFromText(explicitTemplate);
  if (template) {
    if (
      template === 'transfer' ||
      template === 'debt_payment' ||
      template === 'liability_payment' ||
      template === 'opening_balance'
    ) {
      issues.push(
        makeIssue(
          'error',
          'unsupported_template',
          'CSV import currently supports income and expense rows only.',
          { template }
        )
      );
      return '';
    }
    return template;
  }
  if (category && category.type === 'income') {
    return 'income_received';
  }
  if (category && category.type === 'expense') {
    if (account && account.group === 'liability') {
      return 'expense_charged';
    }
    return 'expense_paid';
  }
  if (amountDirection === 'income') {
    return 'income_received';
  }
  if (amountDirection === 'expense') {
    if (account && account.group === 'liability') {
      return 'expense_charged';
    }
    return 'expense_paid';
  }
  issues.push(
    makeIssue(
      'error',
      'ambiguous_direction',
      'The row needs an income or expense template, category, or signed amount.'
    )
  );
  return '';
}

function validateResolvedShape(account, category, template, issues) {
  if (category && !category.linkedAccountId) {
    issues.push(
      makeIssue(
        'error',
        'category_missing_linked_account',
        'The matched category is missing a linked ledger account.',
        {
          categoryId: category.id
        }
      )
    );
  }
  if (template === 'income_received') {
    if (!(category && category.type === 'income')) {
      issues.push(
        makeIssue('error', 'category_type_mismatch', 'Income imports require an income category.')
      );
    }
    if (!(account && account.group === 'asset')) {
      issues.push(
        makeIssue('error', 'account_type_mismatch', 'Income imports require an asset account.')
      );
    }
  }
  if (template === 'expense_paid') {
    if (!(category && category.type === 'expense')) {
      issues.push(
        makeIssue('error', 'category_type_mismatch', 'Expense imports require an expense category.')
      );
    }
    if (!(account && account.group === 'asset')) {
      issues.push(
        makeIssue('error', 'account_type_mismatch', 'Paid expenses require an asset account.')
      );
    }
  }
  if (template === 'expense_charged') {
    if (!(category && category.type === 'expense')) {
      issues.push(
        makeIssue(
          'error',
          'category_type_mismatch',
          'Charged expenses require an expense category.'
        )
      );
    }
    if (!(account && account.group === 'liability')) {
      issues.push(
        makeIssue('error', 'account_type_mismatch', 'Charged expenses require a liability account.')
      );
    }
  }
}

function getPrimaryAccountId(workbook, transaction) {
  const accountsById = new Map(
    (Array.isArray(workbook && workbook.accounts) ? workbook.accounts : []).map((account) => [
      asString(account.id),
      account
    ])
  );
  const template = asString(transaction && transaction.template);
  if (transaction && transaction.primaryAccountId) {
    return asString(transaction.primaryAccountId);
  }
  const lines = Array.isArray(transaction && transaction.lines) ? transaction.lines : [];
  if (template === 'income_received') {
    const line = lines.find(
      (item) =>
        item.direction === 'debit' &&
        accountsById.get(asString(item.accountId)) &&
        accountsById.get(asString(item.accountId)).group === 'asset'
    );
    return line ? asString(line.accountId) : '';
  }
  if (template === 'expense_charged') {
    const line = lines.find(
      (item) =>
        item.direction === 'credit' &&
        accountsById.get(asString(item.accountId)) &&
        accountsById.get(asString(item.accountId)).group === 'liability'
    );
    return line ? asString(line.accountId) : '';
  }
  const line = lines.find(
    (item) =>
      item.direction === 'credit' &&
      accountsById.get(asString(item.accountId)) &&
      accountsById.get(asString(item.accountId)).group === 'asset'
  );
  return line ? asString(line.accountId) : '';
}

function findDuplicateTransaction(workbook, candidate) {
  const candidateAccountId = getPrimaryAccountId(workbook, candidate);
  const candidateDescription = textKey(candidate && candidate.description);
  return (
    (Array.isArray(workbook && workbook.transactions) ? workbook.transactions : []).find(
      (transaction) => {
        return (
          asString(transaction && transaction.date) === asString(candidate && candidate.date) &&
          roundMoney(Number(transaction && transaction.amount) || 0) ===
            roundMoney(Number(candidate && candidate.amount) || 0) &&
          asString(transaction && transaction.categoryId) ===
            asString(candidate && candidate.categoryId) &&
          getPrimaryAccountId(workbook, transaction) === candidateAccountId &&
          textKey(transaction && transaction.description) === candidateDescription
        );
      }
    ) || null
  );
}

function createPreviewId(prefix, index, rowNumber) {
  return `${prefix}_preview_${String(rowNumber)}_${String(index)}`;
}

function buildRowPreview(workbook, row, rowIndex, mapping, options) {
  const issues = Array.isArray(row.issues) ? row.issues.slice() : [];
  const accountLookup = buildLookup(workbook && workbook.accounts, 'account');
  const categoryLookup = buildLookup(workbook && workbook.categories, 'category');
  const date = parseDate(valueFor(row, mapping, 'date'));
  if (!date) {
    issues.push(makeIssue('error', 'date_invalid', 'Enter a valid transaction date.'));
  }
  const amountResult = parseAmount(row, mapping);
  issues.push(...amountResult.issues);
  const accountMatch = resolveLookupValue(
    accountLookup,
    valueFor(row, mapping, 'accountId'),
    valueFor(row, mapping, 'account'),
    options
  );
  const categoryMatch = resolveLookupValue(
    categoryLookup,
    valueFor(row, mapping, 'categoryId'),
    valueFor(row, mapping, 'category'),
    options
  );
  issues.push(...accountMatch.issues, ...categoryMatch.issues);
  const template = deriveTemplate({
    explicitTemplate: valueFor(row, mapping, 'template'),
    amountDirection: amountResult.direction,
    account: accountMatch.value,
    category: categoryMatch.value,
    issues
  });
  validateResolvedShape(accountMatch.value, categoryMatch.value, template, issues);

  const fields = {
    template,
    date,
    description: asString(valueFor(row, mapping, 'description')),
    amount: amountResult.amount,
    currency: normalizeCurrency(valueFor(row, mapping, 'currency'), workbook),
    primaryAccountId: accountMatch.value ? asString(accountMatch.value.id) : '',
    categoryId: categoryMatch.value ? asString(categoryMatch.value.id) : '',
    note: String(valueFor(row, mapping, 'note') || ''),
    reference:
      asString(valueFor(row, mapping, 'reference')) ||
      `csv:${String(row.lineNumber || rowIndex + 2)}`
  };

  let transaction = null;
  if (!hasError(issues)) {
    try {
      transaction = buildManualLedgerTransaction(workbook, fields, null, rowIndex, {
        source: 'csv_import',
        reference: fields.reference,
        createId: (prefix, index) => createPreviewId(prefix, index, row.lineNumber || rowIndex + 2)
      });
      const duplicate = findDuplicateTransaction(workbook, transaction);
      if (duplicate) {
        issues.push(
          makeIssue(
            'warning',
            'duplicate_candidate',
            'This row looks like an existing transaction.',
            {
              transactionId: duplicate.id
            }
          )
        );
      }
    } catch (error) {
      issues.push(
        makeIssue(
          'error',
          'transaction_build_failed',
          error && error.message ? error.message : 'Unable to build this transaction.'
        )
      );
    }
  }

  const status = hasError(issues) || hasWarning(issues) ? 'needs_review' : 'ready';
  return {
    id: `row_${String(row.lineNumber || rowIndex + 2)}`,
    sourceLineNumber: row.lineNumber || rowIndex + 2,
    status,
    issues,
    fields,
    transaction
  };
}

function summarizeRows(rows, parseResult) {
  return {
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === 'ready').length,
    needsReviewRows: rows.filter((row) => row.status === 'needs_review').length,
    duplicateWarnings: rows.filter((row) =>
      row.issues.some((issue) => issue.code === 'duplicate_candidate')
    ).length,
    errorCount:
      (parseResult.errors || []).filter((issue) => issue.severity === 'error').length +
      rows.reduce(
        (sum, row) => sum + row.issues.filter((issue) => issue.severity === 'error').length,
        0
      ),
    warningCount:
      (parseResult.errors || []).filter((issue) => issue.severity === 'warning').length +
      rows.reduce(
        (sum, row) => sum + row.issues.filter((issue) => issue.severity === 'warning').length,
        0
      )
  };
}

export function buildImportPreview(workbook, csvText, options = {}) {
  const parseResult = typeof csvText === 'string' ? parseCsv(csvText) : csvText;
  const mapping = mapColumns(parseResult && parseResult.normalizedHeaders, options.mapping || {});
  const rows = (parseResult && Array.isArray(parseResult.rows) ? parseResult.rows : []).map(
    (row, index) => {
      return buildRowPreview(workbook || {}, row, index, mapping, options);
    }
  );
  const parseErrors = parseResult && Array.isArray(parseResult.errors) ? parseResult.errors : [];
  return {
    ok:
      parseErrors.every((issue) => issue.severity !== 'error') &&
      rows.every((row) => row.status === 'ready'),
    mapping,
    headers: parseResult && Array.isArray(parseResult.headers) ? parseResult.headers : [],
    parseIssues: parseErrors,
    rows,
    summary: summarizeRows(rows, { errors: parseErrors })
  };
}

import { buildManualLedgerTransaction } from '../../domain/ledger/transactions.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function makeIssue(severity, code, message, detail = {}) {
  return Object.assign({ severity, code, message }, detail);
}

function makeApplyCreateId(row, rowIndex, options) {
  return function createId(prefix, index) {
    if (typeof options.createId === 'function') {
      return options.createId(prefix, index, row, rowIndex);
    }
    const line = String(row && row.sourceLineNumber ? row.sourceLineNumber : rowIndex + 1).replace(
      /[^a-zA-Z0-9]+/g,
      '_'
    );
    return `${prefix}_csv_${line}_${String(index)}`;
  };
}

function getRequestedRows(preview, options = {}) {
  const rows = Array.isArray(preview && preview.rows) ? preview.rows : [];
  const requestedIds =
    Array.isArray(options.rowIds) && options.rowIds.length
      ? new Set(options.rowIds.map(asString))
      : null;
  if (!requestedIds) {
    return rows.filter((row) => row && row.status === 'ready');
  }
  return rows.filter((row) => requestedIds.has(asString(row && row.id)));
}

function validateRequestedRows(preview, rows, options = {}) {
  const issues = [];
  const allRows = Array.isArray(preview && preview.rows) ? preview.rows : [];
  if (Array.isArray(options.rowIds) && options.rowIds.length) {
    const foundIds = new Set(rows.map((row) => asString(row && row.id)));
    options.rowIds.map(asString).forEach((id) => {
      if (!foundIds.has(id)) {
        issues.push(
          makeIssue('error', 'row_not_found', 'Requested import row was not found.', { rowId: id })
        );
      }
    });
  }
  allRows.forEach((row) => {
    if (rows.includes(row) && row.status !== 'ready') {
      issues.push(
        makeIssue('error', 'row_not_ready', 'Only ready import rows can be applied.', {
          rowId: row.id,
          sourceLineNumber: row.sourceLineNumber
        })
      );
    }
  });
  return issues;
}

export function applyImportPreview(workbook, preview, options = {}) {
  if (!workbook || typeof workbook !== 'object') {
    throw new Error('A workbook is required before applying an import preview.');
  }
  const rows = getRequestedRows(preview, options);
  const issues = validateRequestedRows(preview, rows, options);
  if (issues.length) {
    const error = new Error(issues[0].message);
    error.issues = issues;
    throw error;
  }
  const existingTransactions = Array.isArray(workbook.transactions) ? workbook.transactions : [];
  const existingIds = new Set(
    existingTransactions
      .map((transaction) => asString(transaction && transaction.id))
      .filter(Boolean)
  );
  const pendingIds = new Set();
  const startIndex = existingTransactions.length;
  const transactions = rows.map((row, index) => {
    const fields = Object.assign({}, row.fields || {});
    const transaction = buildManualLedgerTransaction(workbook, fields, null, startIndex + index, {
      source: 'csv_import',
      reference: fields.reference || `csv:${String(row.sourceLineNumber || index + 1)}`,
      createId: makeApplyCreateId(row, index, options)
    });
    const id = asString(transaction && transaction.id);
    if (!id || existingIds.has(id) || pendingIds.has(id)) {
      throw new Error('CSV import generated a duplicate transaction id.');
    }
    pendingIds.add(id);
    return transaction;
  });
  if (!Array.isArray(workbook.transactions)) {
    workbook.transactions = [];
  }
  workbook.transactions.push(...transactions);
  return {
    ok: true,
    appliedCount: transactions.length,
    skippedCount:
      (Array.isArray(preview && preview.rows) ? preview.rows.length : 0) - transactions.length,
    transactionIds: transactions.map((transaction) => transaction.id),
    transactions
  };
}

export function cancelImportPreview(preview) {
  return {
    ok: true,
    canceled: true,
    appliedCount: 0,
    rowCount: Array.isArray(preview && preview.rows) ? preview.rows.length : 0
  };
}

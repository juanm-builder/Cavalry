import {
  applyImportPreview,
  buildImportPreview,
  buildPortableWorkbookHtml,
  cancelImportPreview,
  exportWorkbookCsvBundle
} from '@cavalry/finance-core';
import {
  cloneWorkbook,
  commandError,
  commandOk
} from '@cavalry/finance-core/application/types/command-result.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value);
}

function safeFileStem(value) {
  return (
    asString(value || 'cavalry-workbook')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cavalry-workbook'
  );
}

function formatMoney(value, currency = 'PHP') {
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

function buildIssueModel(issue) {
  const data = asObject(issue);
  const detail = data.value || data.transactionId || data.template || data.rowId || '';
  return {
    tone: data.severity === 'error' ? 'status-bad' : 'status-warn',
    copy: `${asString(data.message || data.code || 'Review row')}${detail ? ` (${asString(detail)})` : ''}`
  };
}

function buildRowModel(workbook, row, index) {
  const data = asObject(row);
  const fields = asObject(data.fields);
  const issues = asArray(data.issues).map(buildIssueModel);
  const ready = data.status === 'ready';
  return {
    id: data.id || data.rowId || String(data.sourceLineNumber || index),
    sourceLineNumber: String(data.sourceLineNumber || ''),
    statusTone: ready ? 'status-good' : 'status-warn',
    statusLabel: ready ? 'Ready' : 'Needs Review',
    date: asString(fields.date),
    description: asString(fields.description),
    amount: fields.amount
      ? formatMoney(fields.amount, fields.currency || (workbook && workbook.currency))
      : '',
    account: asString(fields.primaryAccountId),
    category: asString(fields.categoryId),
    issues: issues.length ? issues : [{ tone: 'status-good', copy: 'Clean' }]
  };
}

export function createCsvImportSession(workbook, input = {}) {
  const text = asString(input.text);
  const fileName = asString(input.fileName || 'transactions.csv') || 'transactions.csv';
  try {
    return {
      fileName,
      preview: buildImportPreview(workbook || {}, text, asObject(input.options)),
      result: null,
      error: ''
    };
  } catch (error) {
    return {
      fileName,
      preview: {
        ok: false,
        mapping: {},
        parseIssues: [
          {
            severity: 'error',
            code: 'csv_preview_failed',
            message: error && error.message ? error.message : String(error)
          }
        ],
        rows: [],
        summary: {
          totalRows: 0,
          readyRows: 0,
          needsReviewRows: 0,
          duplicateWarnings: 0,
          warningCount: 0,
          errorCount: 1
        }
      },
      result: null,
      error: error && error.message ? error.message : String(error)
    };
  }
}

export function buildCsvImportPreviewModel(workbook, session) {
  if (!session) {
    return null;
  }
  const preview = asObject(session.preview);
  const summary = asObject(preview.summary);
  const rows = asArray(preview.rows);
  const reviewRows = rows.filter((row) => row && row.status !== 'ready');
  const readyRows = Number(summary.readyRows) || 0;
  const totalRows = Number(summary.totalRows) || rows.length;
  const duplicateWarnings = Number(summary.duplicateWarnings) || 0;
  const result = session.result || null;
  const displayRows = reviewRows.length ? reviewRows : rows.slice(0, 12);
  return {
    fileName: asString(session.fileName || 'transactions.csv'),
    result,
    canApply: !result && readyRows >= 1,
    summaryCopy: `${readyRows} of ${totalRows} rows ready${duplicateWarnings ? ` • ${duplicateWarnings} duplicate warning${duplicateWarnings === 1 ? '' : 's'}` : ''}`,
    resultMessage: result
      ? `Applied ${Number(result.appliedCount) || 0} ready rows. Skipped ${Number(result.skippedCount) || 0} rows that still need review.`
      : '',
    errorMessage: asString(session.error),
    reviewRowCount: reviewRows.length,
    stats: [
      {
        id: 'ready',
        label: 'Ready Rows',
        value: String(readyRows),
        subtitle: 'Will be applied',
        icon: 'check_circle',
        tone: 'good'
      },
      {
        id: 'review',
        label: 'Review Rows',
        value: String(reviewRows.length),
        subtitle: 'Held back',
        icon: 'report',
        tone: reviewRows.length ? 'bad' : 'good'
      },
      {
        id: 'warnings',
        label: 'Warnings',
        value: String(Number(summary.warningCount) || 0),
        subtitle: 'Duplicates included',
        icon: 'warning',
        tone: duplicateWarnings ? 'warn' : 'info'
      },
      {
        id: 'errors',
        label: 'Errors',
        value: String(Number(summary.errorCount) || 0),
        subtitle: 'Must be fixed in CSV',
        icon: 'error',
        tone: summary.errorCount ? 'bad' : 'good'
      }
    ],
    mapping: Object.entries(asObject(preview.mapping)).map(([field, column]) => ({
      field,
      copy: `${field}: ${column || 'not mapped'}`
    })),
    parseIssues: asArray(preview.parseIssues).map(buildIssueModel),
    rows: displayRows.map((row, index) => buildRowModel(workbook, row, index))
  };
}

export function applyCsvImportPreviewCommand(workbook, session, options = {}) {
  if (!(session && session.preview)) {
    return commandError(workbook, {
      code: 'csv_preview_missing',
      message: 'Preview a CSV file before applying rows.'
    });
  }
  const nextWorkbook = cloneWorkbook(workbook);
  try {
    const importResult = applyImportPreview(nextWorkbook, session.preview, options);
    return commandOk(nextWorkbook, {
      events: [
        {
          type: 'transactions-imported',
          transactionIds: importResult.transactionIds,
          appliedCount: importResult.appliedCount
        },
        { type: 'schedule-save' },
        { type: 'navigate', route: 'ledger' },
        { type: 'render' }
      ],
      importResult
    });
  } catch (error) {
    const firstIssue = error && Array.isArray(error.issues) ? error.issues[0] : null;
    return commandError(workbook, {
      code: (firstIssue && firstIssue.code) || 'csv_import_failed',
      message:
        (firstIssue && firstIssue.message) ||
        (error && error.message ? error.message : String(error))
    });
  }
}

export function cancelCsvImportPreviewCommand(workbook, session) {
  const importResult = cancelImportPreview(session && session.preview);
  return commandOk(workbook, {
    events: [{ type: 'close-modal' }],
    importResult
  });
}

export function buildTransactionExportIntent(workbook, kind) {
  const stem = safeFileStem(workbook && workbook.name);
  if (kind === 'csv-bundle') {
    return {
      type: 'export/requested',
      payload: {
        kind: 'csv-bundle',
        suggestedName: `${stem}-csv`,
        files: exportWorkbookCsvBundle(workbook || {})
      }
    };
  }
  return {
    type: 'export/requested',
    payload: {
      kind: 'workbook-html',
      suggestedName: `${stem}.html`,
      mimeType: 'text/html;charset=utf-8',
      contents: buildPortableWorkbookHtml(workbook || {})
    }
  };
}

export function buildCsvFileRequestIntent() {
  return {
    type: 'import/file-requested',
    payload: {
      kind: 'transactions-csv',
      accept: '.csv,text/csv'
    }
  };
}

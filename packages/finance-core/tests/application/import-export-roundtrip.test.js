import { describe, expect, it } from 'vitest';

import { exportTransactionsCsv } from '@cavalry/finance-core/application/import-export/export-service.js';
import { applyImportPreview } from '@cavalry/finance-core/application/import-export/import-apply-service.js';
import { buildImportPreview } from '@cavalry/finance-core/application/import-export/import-preview-service.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import { cloneFixture, makeIncomeAndExpenseWorkbook } from '../fixtures/core-workbook-fixtures.js';

describe('import/export roundtrip', () => {
  it('roundtrips exported income and expense rows through preview and explicit apply', () => {
    const source = cloneFixture(makeIncomeAndExpenseWorkbook());
    const csv = exportTransactionsCsv(source, { excludeTransfers: true });
    const target = cloneFixture(source);
    target.transactions = [];

    const preview = buildImportPreview(target, csv);
    const result = applyImportPreview(target, preview);
    const sourceSummary = summarizeLedgerActivity(source);
    const targetSummary = summarizeLedgerActivity(target);

    expect(preview.summary.readyRows).toBe(source.transactions.length);
    expect(result.appliedCount).toBe(source.transactions.length);
    expect(target.transactions).toHaveLength(source.transactions.length);
    expect(targetSummary.income).toBe(sourceSummary.income);
    expect(targetSummary.expense).toBe(sourceSummary.expense);
    expect(targetSummary.net).toBe(sourceSummary.net);
  });
});

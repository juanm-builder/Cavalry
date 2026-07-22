import { describe, expect, it } from 'vitest';

import {
  applyImportPreview,
  cancelImportPreview
} from '@cavalry/finance-core/application/import-export/import-apply-service.js';
import { buildImportPreview } from '@cavalry/finance-core/application/import-export/import-preview-service.js';
import { cloneFixture, makeMinimalWorkbook } from '../fixtures/core-workbook-fixtures.js';

describe('import apply service', () => {
  it('applies only ready preview rows through an explicit mutation step', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const preview = buildImportPreview(
      workbook,
      [
        'date,description,amount,account,category',
        '2026-06-02,Coffee,-250,Cash,Food',
        '2026-06-03,Missing,-100,Unknown,Food'
      ].join('\n')
    );

    const result = applyImportPreview(workbook, preview);

    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(workbook.transactions).toHaveLength(1);
    expect(workbook.transactions[0].source).toBe('csv_import');
    expect(workbook.transactions[0].description).toBe('Coffee');
  });

  it('throws before mutation when asked to apply a non-ready row', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const preview = buildImportPreview(
      workbook,
      ['date,description,amount,account,category', '2026-06-02,Coffee,-250,Unknown,Food'].join('\n')
    );
    const before = JSON.stringify(workbook);

    expect(() => applyImportPreview(workbook, preview, { rowIds: [preview.rows[0].id] })).toThrow(
      'Only ready import rows can be applied.'
    );
    expect(JSON.stringify(workbook)).toBe(before);
  });

  it('supports canceling a preview without changing the workbook', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const preview = buildImportPreview(
      workbook,
      ['date,description,amount,account,category', '2026-06-02,Coffee,-250,Cash,Food'].join('\n')
    );
    const before = JSON.stringify(workbook);

    expect(cancelImportPreview(preview)).toEqual({
      ok: true,
      canceled: true,
      appliedCount: 0,
      rowCount: 1
    });
    expect(JSON.stringify(workbook)).toBe(before);
  });
});

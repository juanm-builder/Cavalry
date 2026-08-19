// Locks down the import preview review table, summary cards, and apply/cancel actions after extraction.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ImportPreviewModal } from '../../src/renderer/features/import-export/ImportPreviewModal.jsx';

function makeImportPreviewModel(overrides = {}) {
  return Object.assign(
    {
      fileName: 'transactions.csv',
      summaryCopy: '1 of 2 rows ready • 1 duplicate warning',
      canApply: true,
      reviewRowCount: 1,
      stats: [
        {
          id: 'ready',
          label: 'Ready Rows',
          value: '1',
          subtitle: 'Will be applied',
          icon: 'check_circle',
          tone: 'good'
        },
        {
          id: 'review',
          label: 'Review Rows',
          value: '1',
          subtitle: 'Held back',
          icon: 'report',
          tone: 'bad'
        },
        {
          id: 'warnings',
          label: 'Warnings',
          value: '1',
          subtitle: 'Duplicates included',
          icon: 'warning',
          tone: 'warn'
        },
        {
          id: 'errors',
          label: 'Errors',
          value: '0',
          subtitle: 'Must be fixed in CSV',
          icon: 'error',
          tone: 'good'
        }
      ],
      mapping: [
        { field: 'date', copy: 'date: Date' },
        { field: 'amount', copy: 'amount: Amount' }
      ],
      parseIssues: [{ tone: 'status-warn', copy: 'Duplicate transaction (txn-1)' }],
      rows: [
        {
          id: 'row-2',
          sourceLineNumber: '2',
          statusTone: 'status-warn',
          statusLabel: 'Needs Review',
          date: '2026-06-01',
          description: 'Coffee',
          amount: 'PHP 250.00',
          account: 'cash',
          category: 'food',
          issues: [{ tone: 'status-bad', copy: 'Missing account' }]
        }
      ]
    },
    overrides
  );
}

function renderImportPreviewModal(model = makeImportPreviewModel()) {
  return renderToStaticMarkup(React.createElement(ImportPreviewModal, { model }));
}

describe('ImportPreviewModal', () => {
  it('renders CSV preview summary, mapping, rejected rows, and apply action', () => {
    const html = renderImportPreviewModal();

    expect(html).toContain('data-react-modal="csv-import-preview"');
    expect(html).toContain('CSV Import Preview');
    expect(html).toContain('transactions.csv');
    expect(html).toContain('1 of 2 rows ready');
    expect(html).toContain('Ready Rows');
    expect(html).toContain('date: Date');
    expect(html).toContain('Rejected Row Report');
    expect(html).toContain('Needs Review');
    expect(html).toContain('Missing account');
    expect(html).toContain('Apply Ready Rows');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('data-action=');
    expect(html).not.toContain('disabled=""');
  });

  it('switches to close-only copy after rows are applied', () => {
    const html = renderImportPreviewModal(
      makeImportPreviewModel({
        result: { appliedCount: 1, skippedCount: 1 },
        resultMessage: 'Applied 1 ready rows. Skipped 1 rows that still need review.',
        canApply: false
      })
    );

    expect(html).toContain('Applied 1 ready rows.');
    expect(html).toContain('Close');
    expect(html).toContain('disabled=""');
  });

  it('renders an empty row state for previews with nothing to review', () => {
    const html = renderImportPreviewModal(
      makeImportPreviewModel({
        reviewRowCount: 0,
        rows: []
      })
    );

    expect(html).toContain('No rows to review.');
  });
});

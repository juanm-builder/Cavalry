import { describe, expect, it } from 'vitest';

import { formatDraftProposedRows } from '../../src/renderer/features/drafts/draft-review-controller.js';
import { formatUiDateTime } from '../../src/renderer/shared/date-format.js';

describe('presentation formatters', () => {
  it('formats ISO timestamps while preserving non-date labels', () => {
    expect(formatUiDateTime('2026-07-03T08:41:07.359Z', { locale: 'en-US' })).toMatch(
      /Jul 3, 2026/
    );
    expect(formatUiDateTime('2026-07-01', { locale: 'en-US' })).toBe('Jul 1, 2026');
    expect(formatUiDateTime('09:00')).toBe('09:00');
    expect(formatUiDateTime('')).toBe('');
  });

  it('turns structured draft changes into readable review copy instead of raw JSON', () => {
    const rows = formatDraftProposedRows(
      {
        mode: 'ledger_cleanup_v1',
        categoryChanges: [
          {
            action: 'create',
            clientId: 'father_income',
            name: 'Income from Father',
            type: 'income'
          }
        ],
        counterpartyChanges: [],
        transactionPatches: [
          {
            transactionId: 'txn-private-id',
            categoryId: 'father_income',
            counterpartyName: 'Dad'
          }
        ]
      },
      {
        workbook: {
          transactions: [{ id: 'txn-private-id', description: 'Money from Dad' }]
        }
      }
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'mode',
          label: 'Review method',
          value: 'Ledger Cleanup V1',
          editable: true
        }),
        expect.objectContaining({
          key: 'categoryChanges.0.name',
          label: 'Category change 1 · Name',
          value: 'Income from Father',
          editable: true
        }),
        expect.objectContaining({
          key: 'transactionPatches.0.transactionId',
          label: 'Transaction update 1 · Transaction',
          value: 'Money from Dad',
          editable: true
        }),
        expect.objectContaining({
          key: 'transactionPatches.0.categoryId',
          value: 'Father Income',
          editable: true
        })
      ])
    );
    expect(rows.some((row) => row.key === 'counterpartyChanges')).toBe(false);
    expect(rows.every((row) => row.description)).toBe(true);
    expect(rows.map((row) => row.value).join(' ')).not.toContain('txn-private-id');
    expect(rows.map((row) => row.value).join(' ')).not.toContain('{');
  });
});

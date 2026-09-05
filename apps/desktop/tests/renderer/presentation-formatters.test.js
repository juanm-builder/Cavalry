import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { formatDraftProposedRows } from '../../src/renderer/features/drafts/draft-review-controller.js';
import { formatUiDateTime } from '../../src/renderer/shared/date-format.js';
import { formatCurrencyAmount } from '../../src/renderer/shared/currency-format.js';

describe('presentation formatters', () => {
  it.each(['America/Los_Angeles', 'Asia/Manila'])('%s preserves calendar days', (timeZone) => {
    const moduleUrl = new URL('../../src/renderer/shared/date-format.js', import.meta.url).href;
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { formatUiDateTime } from ${JSON.stringify(moduleUrl)};
         console.log(formatUiDateTime('2026-07-01'));
         console.log(formatUiDateTime('2024-02-29'));`
      ],
      { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' }
    );
    expect(result.trim().split('\n')).toEqual(['Jul 1, 2026', 'Feb 29, 2024']);
    expect(
      formatUiDateTime('2026-07-01T00:00:00Z', {
        format: { timeZone: 'America/Los_Angeles' }
      })
    ).toBe('Jun 30, 2026, 5:00 PM');
  });

  it('keeps currency symbols, rounding, signs, and two decimal places unchanged', () => {
    for (const currency of ['PHP', 'USD', 'EUR', 'JPY', 'KWD', 'usd']) {
      const expected = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      for (const amount of [0, -0, 1.005, -1200.255, 1234567.89]) {
        expect(formatCurrencyAmount(amount, currency)).toBe(expected.format(amount));
      }
    }
    expect(() => formatCurrencyAmount(1, 'invalid')).toThrow(RangeError);
    expect(formatCurrencyAmount(1, 'USD')).toBe('$1.00');
  });

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

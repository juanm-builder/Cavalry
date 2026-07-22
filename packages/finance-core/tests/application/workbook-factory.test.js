import { describe, expect, it } from 'vitest';

import {
  createWorkbook,
  deserializeWorkbookFromFile,
  serializeWorkbookForSave
} from '../../src/index.js';

describe('workbook factory', () => {
  it('creates a deterministic valid schema-v2 workbook', () => {
    let sequence = 0;
    const workbook = createWorkbook(
      { name: 'New Plan', currency: 'php' },
      {
        now: () => '2026-07-10T03:00:00.000Z',
        createId: (prefix) => `${prefix}_${++sequence}`
      }
    );

    expect(workbook).toMatchObject({
      id: 'workbook_1',
      version: 2,
      name: 'New Plan',
      year: 2026,
      currency: 'PHP',
      createdAt: '2026-07-10T03:00:00.000Z'
    });
    expect(workbook.sheets[0]).toMatchObject({ monthKey: '2026-07', monthIndex: 6 });
    expect(workbook.recurringReconciliations).toEqual([]);
    expect(workbook.accounts.some((account) => account.subtype === 'opening_balance')).toBe(true);
    expect(
      workbook.categories.every((category) =>
        workbook.accounts.some((account) => account.id === category.linkedAccountId)
      )
    ).toBe(true);

    const serialized = serializeWorkbookForSave(workbook, { rejectInvalid: true });
    const loaded = deserializeWorkbookFromFile(serialized.html, { rejectInvalid: true });
    expect(loaded.validation.ok).toBe(true);
    expect(loaded.workbook.id).toBe(workbook.id);
    expect(loaded.workbook.recurringReconciliations).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deserializeWorkbookFromFile, serializeWorkbookForSave } from '@cavalry/finance-core';
import { describe, expect, it } from 'vitest';

const fixturePath = fileURLToPath(
  new URL('../../examples/workbooks/mock-worksheet.html', import.meta.url)
);

describe('portable workbook example', () => {
  it('is a real schema-v2 import fixture that survives a portable round trip', () => {
    const fixtureText = readFileSync(fixturePath, 'utf8');
    const loaded = deserializeWorkbookFromFile(fixtureText, {
      rejectInvalid: true
    });

    expect(loaded.validation.ok).toBe(true);
    expect(loaded.workbook).toMatchObject({
      id: 'workbook_mock_operations_2026',
      version: 2,
      name: 'Mock Operations Worksheet',
      currency: 'PHP'
    });
    expect(loaded.workbook.transactions.map((transaction) => transaction.id)).toEqual([
      'txn_opening_balance',
      'txn_salary_june',
      'txn_northstar_hosting',
      'txn_ledgerworks_studio',
      'txn_brightline_analytics',
      'txn_metro_office_supply',
      'txn_acme_contractors',
      'txn_signal_peak_media',
      'txn_clearpath_legal',
      'txn_reserve_transfer'
    ]);
    expect(loaded.workbook.transactions.every((transaction) => transaction.source === 'mock')).toBe(
      true
    );

    const portablePayload = JSON.stringify(loaded.workbook);
    expect(fixtureText).not.toMatch(/data:image|;base64,/i);
    expect(portablePayload).not.toMatch(/dataUrl|attachment|receipt|originalFileName/i);
    expect(loaded.workbook.advisorThreads).toEqual([]);
    expect(loaded.workbook.aiDrafts).toEqual([]);
    expect(loaded.workbook.advisorDraftGroups).toEqual([]);
    expect(loaded.workbook.settings).toMatchObject({
      activeAdvisorThreadId: '',
      fileAutosave: {
        enabled: false,
        fileName: '',
        lastSavedAt: '',
        lastError: ''
      },
      lastSavedAt: ''
    });

    const serialized = serializeWorkbookForSave(loaded.workbook, { rejectInvalid: true });
    const roundTripped = deserializeWorkbookFromFile(serialized.html, { rejectInvalid: true });
    expect(roundTripped.workbook.transactions).toHaveLength(loaded.workbook.transactions.length);
    expect(roundTripped.workbook.accounts).toHaveLength(loaded.workbook.accounts.length);
  });
});

import { getAccountUsage } from '../../src/application/accounts/account-management-service.js';
import { describe, expect, it } from 'vitest';
import {
  getStatementCheck,
  saveStatementCheck,
  validStatementCheckHistory
} from '../../src/application/accounts/statement-check-service.js';
import {
  serializeWorkbookForSave,
  deserializeWorkbookFromFile
} from '../../src/application/workbook/workbook-persistence-service.js';
import { makeBasicSpendingWorkbook } from '../fixtures/core-workbook-fixtures.js';

describe('account statement checks', () => {
  it('checks the statement in account currency through the closing date and saves only a match', () => {
    const workbook = makeBasicSpendingWorkbook();
    expect(getStatementCheck(workbook, 'cash', '2026-06-01', '-250.00')).toMatchObject({
      matches: true,
      ledgerBalance: -250,
      difference: 0,
      currency: 'PHP'
    });
    expect(getStatementCheck(workbook, 'credit-card', '2026-06-03', 1200)).toMatchObject({
      matches: true,
      ledgerBalance: 1200
    });
    expect(getStatementCheck(workbook, 'cash', '2026-06-02', -325)).toMatchObject({
      matches: false,
      ledgerBalance: -330,
      difference: 5
    });
    expect(saveStatementCheck(workbook, 'cash', '2026-06-02', -325).ok).toBe(false);
    const saved = saveStatementCheck(workbook, 'cash', '2026-06-01', -250).workbook;
    expect(workbook.accounts[0].statementChecks).toBeUndefined();
    expect(saved.transactions).toBe(workbook.transactions);
    expect(saveStatementCheck(saved, 'cash', '2026-06-01', -250).workbook).toBe(saved);
    const next = saveStatementCheck(saved, 'cash', '2026-06-02', -330).workbook;
    const history = next.accounts.find((account) => account.id === 'cash').statementChecks;
    expect(history.map((item) => item.date)).toEqual(['2026-06-02', '2026-06-01']);
    const restored = deserializeWorkbookFromFile(
      serializeWorkbookForSave(next, { rejectInvalid: true }).html,
      { rejectInvalid: true }
    ).workbook;
    expect(restored.accounts.find((account) => account.id === 'cash').statementChecks).toEqual(
      history
    );
    // Backdate a previously later purchase. The saved statement remains what the bank reported.
    const revised = {
      ...restored,
      transactions: restored.transactions.map((tx) =>
        tx.id === 'txn-transport-cash' ? { ...tx, date: '2026-06-01' } : tx
      )
    };
    expect(getStatementCheck(revised, 'cash', history[1].date, history[1].balance)).toMatchObject({
      matches: false,
      difference: 80
    });
  });

  it('supports zero and refuses invalid dates, ambiguous currency, and invalid amounts', () => {
    const workbook = makeBasicSpendingWorkbook();
    expect(getStatementCheck(workbook, 'cash', '2024-02-29', 0).matches).toBe(true);
    const empty = { ...workbook, transactions: [] };
    const checked = saveStatementCheck(empty, 'cash', '2024-02-29', 0).workbook;
    expect(getAccountUsage(checked, 'cash')).toMatchObject({
      hasReferences: true,
      hasNonOpeningReferences: true
    });

    for (const invalid of ['2026-02-29', '2026-02-31', '', null])
      expect(getStatementCheck(workbook, 'cash', invalid, 0).ok).toBe(false);
    for (const invalid of ['', null, true, Infinity, 0.001, '1e3'])
      expect(getStatementCheck(workbook, 'cash', '2026-02-28', invalid).ok).toBe(false);
    expect(getStatementCheck(workbook, 'food-expense', '2026-06-01', 250).ok).toBe(false);
    const line = workbook.transactions[0].lines.find((item) => item.accountId === 'cash');
    line.currency = 'USD';
    expect(getStatementCheck(workbook, 'cash', '2026-06-02', -330)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/currency/)
    });
    expect(validStatementCheckHistory([null])).toBe(false);
    const entry = { date: '2026-06-01', currency: 'PHP', balance: 0 };
    expect(validStatementCheckHistory([entry, entry])).toBe(false);
  });
});

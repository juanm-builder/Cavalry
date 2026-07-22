import { describe, expect, it } from 'vitest';
import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import {
  normalizeWorkbookIdentity,
  normalizeWorkbookSettings
} from '@cavalry/finance-core/domain/workbook/normalize.js';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '@cavalry/finance-core/domain/workbook/portable.js';
import {
  makeDirtyLegacyWorkbook,
  makeDraftIsolationWorkbook,
  makeIncomeAndExpenseWorkbook,
  makeMinimalWorkbook
} from '../fixtures/core-workbook-fixtures.js';

function roundtrip(workbook) {
  return parsePortableWorkbookText(buildPortableWorkbookHtml(workbook));
}

describe('workbook save/load and normalization stability', () => {
  it('roundtrips a minimal workbook without requiring UI-only fields', () => {
    const workbook = makeMinimalWorkbook();
    const parsed = roundtrip(workbook);

    expect(parsed).toEqual(workbook);
    expect(validateLedgerInvariants(parsed).ok).toBe(true);
  });

  it('preserves transaction-heavy workbook IDs, amounts, dates, accounts, categories, and totals', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const beforeSummary = summarizeLedgerActivity(workbook);
    const parsed = roundtrip(workbook);
    const afterSummary = summarizeLedgerActivity(parsed);

    expect(parsed.transactions.map((transaction) => transaction.id)).toEqual(
      workbook.transactions.map((transaction) => transaction.id)
    );
    expect(parsed.transactions.map((transaction) => transaction.amount)).toEqual(
      workbook.transactions.map((transaction) => transaction.amount)
    );
    expect(parsed.transactions.map((transaction) => transaction.date)).toEqual(
      workbook.transactions.map((transaction) => transaction.date)
    );
    expect(parsed.accounts.map((account) => account.id)).toEqual(
      workbook.accounts.map((account) => account.id)
    );
    expect(parsed.categories.map((category) => category.id)).toEqual(
      workbook.categories.map((category) => category.id)
    );
    expect(afterSummary).toMatchObject(beforeSummary);
  });

  it('keeps dirty legacy data inspectable so invariants can report the problems', () => {
    const parsed = roundtrip(makeDirtyLegacyWorkbook());
    const result = validateLedgerInvariants(parsed);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('transaction_missing_category');
    expect(result.errors.map((error) => error.code)).toContain('transaction_invalid_date');
  });

  it('roundtrips drafts without converting them into committed transactions', () => {
    const workbook = makeDraftIsolationWorkbook();
    const parsed = roundtrip(workbook);

    expect(parsed.aiDrafts).toHaveLength(2);
    expect(parsed.externalDraftGroups).toHaveLength(1);
    expect(parsed.transactions).toHaveLength(workbook.transactions.length);
    expect(summarizeLedgerActivity(parsed).expense).toBe(2029);
  });

  it('normalizes identity/settings metadata through domain helpers', () => {
    const identity = normalizeWorkbookIdentity(
      {
        name: '  Family  ',
        currency: 'php',
        year: 2026
      },
      {
        uid: () => 'wb-fixed',
        now: () => new Date('2026-06-30T00:00:00.000Z')
      }
    );
    const settings = normalizeWorkbookSettings(
      {
        settings: {
          usdToBaseRate: '58',
          hiddenMonthlyMetrics: { cashflow: true },
          activeAdvisorThreadId: 'thread-legacy'
        }
      },
      {
        dashboardLayout: [{ id: 'summary', visible: true }],
        subscriptionReviewDecisions: {}
      }
    );

    expect(identity).toMatchObject({
      id: 'wb-fixed',
      name: 'Family',
      currency: 'PHP',
      year: 2026
    });
    expect(settings.usdToBaseRate).toBe(58);
    expect(settings.hiddenMonthlyMetrics).toEqual({ cashflow: true });
  });
});

// Locks down browser-safe submit decisions before renderer side effects run.

import { describe, expect, it } from 'vitest';

import { buildManualTransactionSubmitIntent } from '@cavalry/finance-core/application/transactions/transaction-submit-intent-service.js';
import {
  cloneFixture,
  makeDraftIsolationWorkbook,
  makeRefundWorkbook
} from '../fixtures/core-workbook-fixtures.js';

function makeWorkbook() {
  const workbook = makeDraftIsolationWorkbook();
  workbook.recurringItems = [
    {
      id: 'rec_netflix',
      kind: 'subscription',
      name: 'Netflix',
      categoryId: 'food',
      isActive: true
    }
  ];
  return workbook;
}

describe('transaction submit intent service', () => {
  it('builds manual composer input and source options without mutating the workbook', () => {
    const workbook = makeWorkbook();
    const before = cloneFixture(workbook);
    const intent = buildManualTransactionSubmitIntent(workbook, {
      template: 'expense_paid',
      amount: '120',
      currency: 'php',
      date: '2026-06-30',
      description: '  Coffee  ',
      categoryId: 'food',
      primaryAccountId: 'cash',
      counterpartyName: '  Cafe Rider  ',
      counterpartyKind: 'MERCHANT',
      note: '  receipt  '
    });

    expect(intent.error).toBeNull();
    expect(intent).toMatchObject({
      existingIndex: -1,
      isEdit: false,
      nextRoute: 'ledger',
      sourceOptions: {
        reference: '',
        source: 'manual'
      }
    });
    expect(intent.composerInput).toMatchObject({
      template: 'expense_paid',
      amount: '120',
      currency: 'php',
      date: '2026-06-30',
      description: 'Coffee',
      categoryId: 'food',
      primaryAccountId: 'cash',
      counterpartyName: 'Cafe Rider',
      counterpartyKind: 'merchant',
      note: 'receipt',
      recurringItemId: ''
    });
    expect(workbook).toEqual(before);
  });

  it('normalizes recurring create decisions without owning recurring mutation', () => {
    const intent = buildManualTransactionSubmitIntent(makeWorkbook(), {
      amount: '120',
      date: '2026-06-30',
      categoryId: 'food',
      primaryAccountId: 'cash',
      recurringTrackingMode: 'create',
      recurringKind: 'subscription',
      recurringFrequency: 'biweekly'
    });

    expect(intent.error).toBeNull();
    expect(intent.recurringTracking).toMatchObject({
      mode: 'create',
      kind: 'subscription',
      frequency: 'Every 2 Weeks',
      linkedRecurringItemId: '',
      shouldCreate: true,
      shouldLink: false
    });
  });

  it('validates recurring link targets and passes linked IDs into composer input', () => {
    const valid = buildManualTransactionSubmitIntent(makeWorkbook(), {
      amount: '120',
      date: '2026-06-30',
      categoryId: 'food',
      primaryAccountId: 'cash',
      recurringTrackingMode: 'link',
      recurringItemId: ' rec_netflix ',
      recurringOccurrenceDate: '2026-06-30'
    });
    const invalid = buildManualTransactionSubmitIntent(makeWorkbook(), {
      recurringTrackingMode: 'link',
      recurringItemId: 'missing'
    });

    expect(valid.error).toBeNull();
    expect(valid.composerInput.recurringItemId).toBe('rec_netflix');
    expect(valid.recurringTracking).toMatchObject({
      mode: 'link',
      selectedRecurringItemId: 'rec_netflix',
      linkedRecurringItemId: 'rec_netflix',
      occurrenceDate: '2026-06-30',
      shouldCreate: false,
      shouldLink: true
    });
    expect(invalid.error).toEqual({
      code: 'missing_recurring_item',
      message: 'Choose a valid bill or subscription tracker.'
    });
    expect(invalid.composerInput.recurringItemId).toBe('');
    expect(invalid.recurringTracking.shouldLink).toBe(false);
  });

  it('reports assignment errors before renderer submit side effects run', () => {
    const expenseWithIncomeCategory = buildManualTransactionSubmitIntent(makeWorkbook(), {
      template: 'expense_paid',
      amount: '120',
      date: '2026-06-30',
      categoryId: 'salary',
      primaryAccountId: 'cash'
    });
    const cardExpenseWithCashAccount = buildManualTransactionSubmitIntent(makeWorkbook(), {
      template: 'expense_charged',
      amount: '120',
      date: '2026-06-30',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    expect(expenseWithIncomeCategory.error).toEqual({
      code: 'invalid_expense_category',
      field: 'categoryId',
      message: 'Pick an expense category.'
    });
    expect(cardExpenseWithCashAccount.error).toEqual({
      code: 'invalid_charged_expense_account',
      field: 'primaryAccountId',
      message: 'Choose a liability account such as a credit card.'
    });
  });

  it('warns on duplicate-like manual creates but not edits', () => {
    const workbook = makeWorkbook();
    const duplicate = buildManualTransactionSubmitIntent(workbook, {
      template: 'expense_paid',
      amount: '250',
      currency: 'PHP',
      date: '2026-06-01',
      description: '  lunch  ',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    const edit = buildManualTransactionSubmitIntent(workbook, {
      transactionId: 'txn-food-cash',
      template: 'expense_paid',
      amount: '120',
      currency: 'PHP',
      date: '2026-06-20',
      description: 'Lunch',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    expect(duplicate.duplicateWarning).toMatchObject({
      code: 'possible_duplicate_transaction',
      transactionId: 'txn-food-cash'
    });
    expect(duplicate.duplicateWarning.confirmMessage).toContain('Post anyway?');
    expect(edit.duplicateWarning).toBeNull();
  });

  it('preserves edit detection and suppresses create/link side-effect intents for edits', () => {
    const workbook = makeWorkbook();
    const existing = workbook.transactions[0];
    const intent = buildManualTransactionSubmitIntent(workbook, {
      transactionId: existing.id,
      recurringTrackingMode: 'create',
      recurringKind: 'subscription'
    });

    expect(intent).toMatchObject({
      transactionId: existing.id,
      existingIndex: 0,
      isEdit: true
    });
    expect(intent.recurringTracking.shouldCreate).toBe(false);
    expect(intent.advisor.shouldMarkPosted).toBe(false);
  });

  it('recognizes metadata-only refund edits as preserving their existing postings', () => {
    const workbook = makeRefundWorkbook();
    const existing = workbook.transactions.find(
      (transaction) => transaction.id === 'txn-refund-unclear'
    );
    const intent = buildManualTransactionSubmitIntent(workbook, {
      transactionId: existing.id,
      template: existing.template,
      amount: existing.amount,
      currency: existing.originalCurrency,
      date: existing.date,
      description: 'Store refund received',
      categoryId: existing.categoryId,
      primaryAccountId: 'cash'
    });

    expect(intent.error).toBeNull();
    expect(intent).toMatchObject({
      isEdit: true,
      preserveExistingPostings: true,
      currencyConversionWarning: null
    });
  });

  it('builds Advisor source metadata and bills route fallback without side effects', () => {
    const intent = buildManualTransactionSubmitIntent(makeWorkbook(), {
      advisorThreadId: 'thread_1',
      advisorMessageId: 'message_1',
      advisorActionId: 'action_1',
      sourceRoute: 'bills'
    });

    expect(intent.nextRoute).toBe('bills');
    expect(intent.sourceOptions).toEqual({
      reference: 'advisor:thread_1:message_1:action_1',
      source: 'advisor'
    });
    expect(intent.advisor).toMatchObject({
      threadId: 'thread_1',
      messageId: 'message_1',
      actionId: 'action_1',
      shouldMarkPosted: true
    });
  });

  it('identifies transactions captured through Notes', () => {
    const intent = buildManualTransactionSubmitIntent(makeWorkbook(), {
      sourceRoute: 'notes'
    });

    expect(intent.nextRoute).toBe('ledger');
    expect(intent.sourceOptions).toEqual({
      reference: '',
      source: 'notes'
    });
  });

  it('stays free of direct DOM, Electron, provider, and workbook mutation behavior', () => {
    const source = buildManualTransactionSubmitIntent.toString();

    expect(source).not.toContain('window.');
    expect(source).not.toContain('document.');
    expect(source).not.toContain('ipcRenderer');
    expect(source).not.toContain('scheduleSave');
    expect(source).not.toContain('render(');
    expect(source).not.toContain('confirm(');
  });
});

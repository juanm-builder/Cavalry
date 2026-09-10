import { describe, expect, it, vi } from 'vitest';
import { makeBasicSpendingWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { getRecurringOccurrencesForSheet } from '@cavalry/finance-core';
import {
  executeCavalryAssistantTool,
  getCavalryAssistantToolDefinitions
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import {
  confirmationReplayArguments,
  pendingConfirmationFromResult
} from '../../src/renderer/features/assistant/cavalry-assistant-confirmations.js';
import { cavalryAssistantActionReceiptMessage } from '../../src/renderer/features/assistant/cavalry-assistant-action-results.js';
import { createBillsController } from '../../src/renderer/features/recurring/bills-controller.js';
import { buildBillsRouteModel } from '../../src/renderer/features/recurring/bills-route-model.js';

function harness() {
  let workbook = structuredClone(makeBasicSpendingWorkbook());
  workbook.recurringItems = [
    {
      id: 'streaming',
      name: 'Streaming',
      kind: 'subscription',
      categoryId: 'subscriptions',
      accountId: 'bank',
      amount: 500,
      currency: 'PHP',
      frequency: 'Monthly',
      anchorDate: '2026-09-15',
      autoRenew: true,
      isActive: true,
      note: 'Keep this note'
    }
  ];
  let sequence = 0;
  const commitCommandResult = vi.fn((result) => {
    workbook = result.workbook;
    return {
      workbook,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true }
    };
  });
  const context = {
    getWorkbook: () => workbook,
    commitCommandResult,
    services: { createId: () => `recurring-test-${++sequence}`, defaultDate: () => '2026-09-10' }
  };
  return {
    get workbook() {
      return workbook;
    },
    context,
    commitCommandResult,
    call: (name, args, approved = false) =>
      executeCavalryAssistantTool(
        { name, arguments: args },
        { ...context, approvedByUser: approved }
      )
  };
}

const createArgs = {
  name: 'Video Plus',
  kind: 'subscription',
  category: 'Subscriptions',
  account: 'Bank',
  amount: 300,
  dueDate: '2026-10-01',
  frequency: 'Monthly'
};
function row(workbook, month, id = 'streaming') {
  return getRecurringOccurrencesForSheet(workbook, { monthKey: month }).find(
    (item) => item.recurringItemId === id
  );
}
function replay(name, args, result) {
  return confirmationReplayArguments(
    pendingConfirmationFromResult({ toolResults: [{ toolName: name, arguments: args, result }] })
  );
}

describe('Cavalry recurring capability month and safety semantics', () => {
  it('publishes one feature-owned copy of each recurring write tool and keeps approval flags private', () => {
    const definitions = getCavalryAssistantToolDefinitions();
    for (const name of ['create_bill', 'update_bill', 'archive_bill']) {
      const matches = definitions.filter((definition) => definition.name === name);
      expect(matches).toHaveLength(1);
      expect(matches[0].cavalry.capabilityId).toBe('recurring.trackers');
      expect(matches[0].parameters.properties).not.toHaveProperty('confirmed');
      expect(matches[0].parameters.properties).not.toHaveProperty('allowDuplicate');
    }
  });

  it('starts next month without adding current-month obligations and preserves the ledger', async () => {
    const h = harness();
    const transactions = structuredClone(h.workbook.transactions);
    const result = await h.call('create_bill', createArgs);
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      data: { merchantSubscriptionChanged: false }
    });
    const id = result.data.recurringItem.id;
    expect(row(h.workbook, '2026-09', id)).toBeUndefined();
    expect(row(h.workbook, '2026-10', id)).toMatchObject({
      dueDate: '2026-10-01',
      originalAmount: 300
    });
    expect(h.workbook.transactions).toEqual(transactions);
  });

  it('creates a current-month-only one-time tracker without another charge next month', async () => {
    const h = harness();
    const result = await h.call('create_bill', {
      ...createArgs,
      dueDate: '2026-09-15',
      frequency: 'One-time'
    });
    const id = result.data.recurringItem.id;
    expect(row(h.workbook, '2026-09', id)).toBeDefined();
    expect(row(h.workbook, '2026-10', id)).toBeUndefined();
  });

  it.each([
    [{ amount: undefined }, 'recurring.amount-required'],
    [{ dueDate: '' }, 'recurring.date-required'],
    [{ dueDate: '2026-02-31' }, 'recurring.date-invalid'],
    [{ endDate: '2026-09-30' }, 'recurring.end-date-invalid'],
    [{ frequency: 'sometimes' }, 'recurring.frequency-invalid'],
    [{ amount: 0.001 }, 'recurring.amount-invalid'],
    [{ amount: -5 }, 'recurring.amount-invalid'],
    [{ accountId: 'missing', account: undefined }, 'reference_not_found']
  ])('rejects invalid or missing input without a save: %o', async (patch, code) => {
    const h = harness();
    const args = { ...createArgs, ...patch };
    Object.keys(args).forEach((key) => {
      if (args[key] === undefined) delete args[key];
    });
    const result = await h.call('create_bill', args);
    expect(result).toMatchObject({ ok: false, changed: false });
    expect(result.errors.some((error) => error.code === code)).toBe(true);
    expect(h.commitCommandResult).not.toHaveBeenCalled();
  });

  it('confirms a duplicate using the exact proposed amount/account/date and host-only approval', async () => {
    const h = harness();
    const args = { ...createArgs, name: 'Streaming' };
    const pending = await h.call('create_bill', { ...args, allowDuplicate: true });
    expect(pending).toMatchObject({
      status: 'confirmation_required',
      changed: false,
      confirmation: { field: 'allowDuplicate' }
    });
    expect(pending.confirmation.message).toContain('300');
    const canonical = replay('create_bill', args, pending);
    expect(canonical.accountId).toBe('bank');
    expect(canonical).not.toHaveProperty('account');
    const saved = await h.call('create_bill', canonical, true);
    expect(saved.ok).toBe(true);
    expect(h.workbook.recurringItems.filter((item) => item.name === 'Streaming')).toHaveLength(2);
  });

  it('changes one month while retaining surrounding months, the anchor and unrelated metadata', async () => {
    const h = harness();
    const result = await h.call('update_bill', {
      bill: 'Streaming',
      amount: 650,
      dueDate: '2026-10-20',
      scope: 'month',
      monthKey: '2026-10'
    });
    expect(result).toMatchObject({
      ok: true,
      data: { scope: 'month', monthKey: '2026-10', recurringItem: { amount: 650 } }
    });
    expect(row(h.workbook, '2026-09')).toMatchObject({
      originalAmount: 500,
      dueDate: '2026-09-15'
    });
    expect(row(h.workbook, '2026-10')).toMatchObject({
      originalAmount: 650,
      dueDate: '2026-10-20'
    });
    expect(row(h.workbook, '2026-11')).toMatchObject({
      originalAmount: 500,
      dueDate: '2026-11-15'
    });
    expect(h.workbook.recurringItems[0]).toMatchObject({
      amount: 500,
      anchorDate: '2026-09-15',
      note: 'Keep this note',
      autoRenew: true
    });
  });

  it('changes future months and payment defaults without rewriting earlier months', async () => {
    const h = harness();
    const result = await h.call('update_bill', {
      bill: 'Streaming',
      amount: 700,
      scope: 'from_month',
      monthKey: '2026-10'
    });
    expect(result.ok).toBe(true);
    expect(row(h.workbook, '2026-09').originalAmount).toBe(500);
    expect(row(h.workbook, '2026-10').originalAmount).toBe(700);
    expect(row(h.workbook, '2027-01').originalAmount).toBe(700);
    const paid = await h.call('pay_bill', { bill: 'Streaming', date: '2026-10-15' });
    expect(paid.ok).toBe(true);
    expect(h.workbook.transactions.at(-1)).toMatchObject({
      amount: 700,
      recurringItemId: 'streaming',
      recurringOccurrenceDate: '2026-10-15'
    });
  });

  it('replaces later conflicting prices and due dates from a month onward while preserving unrelated exceptions', async () => {
    const h = harness();
    h.workbook.recurringItems[0].scheduleChanges = {
      '2026-11': { amount: 799, anchorDate: '2026-11-25', accountId: 'cash' }
    };
    h.workbook.recurringItems[0].monthOverrides = {
      '2026-09': { amount: 550 },
      '2026-10': { amount: 899, anchorDate: '2026-10-22', note: 'October note' },
      '2026-12': { amount: 999, anchorDate: '2026-12-28', note: 'December note' }
    };
    const result = await h.call('update_bill', {
      bill: 'Streaming',
      amount: 699,
      dueDate: '2026-10-20',
      scope: 'from_month',
      monthKey: '2026-10'
    });
    expect(result.ok).toBe(true);
    expect(row(h.workbook, '2026-09')).toMatchObject({
      originalAmount: 550,
      dueDate: '2026-09-15'
    });
    for (const month of ['2026-10', '2026-11', '2026-12', '2027-01']) {
      expect(row(h.workbook, month)).toMatchObject({ originalAmount: 699, dueDate: `${month}-20` });
    }
    expect(row(h.workbook, '2026-11').accountId).toBe('cash');
    expect(h.workbook.recurringItems[0].monthOverrides).toEqual({
      '2026-09': { amount: 550 },
      '2026-10': { note: 'October note' },
      '2026-12': { note: 'December note' }
    });
  });

  it.each([
    [{ scope: 'month' }, 'recurring.month-required'],
    [{ monthKey: '2026-10' }, 'recurring.scope-required'],
    [{ scope: 'month', monthKey: 'October' }, 'recurring.month-required'],
    [{ scope: 'month', monthKey: '2026-08' }, 'recurring.month-not-scheduled'],
    [
      { scope: 'month', monthKey: '2026-10', dueDate: '2026-11-01' },
      'recurring.month-date-mismatch'
    ],
    [
      { scope: 'month', monthKey: '2026-10', frequency: 'Weekly' },
      'recurring.month-schedule-invalid'
    ]
  ])('rejects unclear or contradictory month changes: %o', async (patch, code) => {
    const h = harness();
    const result = await h.call('update_bill', { bill: 'Streaming', amount: 600, ...patch });
    expect(result).toMatchObject({ ok: false, changed: false });
    expect(result.errors.some((error) => error.code === code)).toBe(true);
    expect(h.commitCommandResult).not.toHaveBeenCalled();
  });

  it('skips only one month after canonical confirmation and does not claim merchant cancellation', async () => {
    const h = harness();
    const beforeTransactions = structuredClone(h.workbook.transactions);
    const args = { bill: 'Streaming', scope: 'month', monthKey: '2026-10' };
    const pending = await h.call('archive_bill', args);
    expect(pending.confirmation.message).toMatch(/only for 2026-10.*merchant separately/i);
    expect(h.commitCommandResult).not.toHaveBeenCalled();
    const canonical = replay('archive_bill', args, pending);
    h.workbook.recurringItems.push({
      ...h.workbook.recurringItems[0],
      id: 'other',
      name: 'Streaming'
    });
    const result = await h.call('archive_bill', canonical, true);
    expect(result).toMatchObject({
      ok: true,
      data: { recurringItem: { id: 'streaming' }, merchantSubscriptionChanged: false }
    });
    expect(row(h.workbook, '2026-10')).toBeUndefined();
    expect(row(h.workbook, '2026-11')).toBeDefined();
    expect(row(h.workbook, '2026-10', 'other')).toBeDefined();
    expect(h.workbook.transactions).toEqual(beforeTransactions);
  });

  it('stops from a month forward while preserving earlier occurrences and recorded payments', async () => {
    const h = harness();
    h.workbook.recurringItems[0].monthOverrides = {
      '2026-09': { amount: 550, isActive: true },
      '2026-11': { amount: 599, isActive: true }
    };
    h.workbook.recurringItems[0].scheduleChanges = {
      '2026-12': { amount: 700, isActive: true }
    };
    const args = { recurringItemId: 'streaming', scope: 'from_month', monthKey: '2026-10' };
    const pending = await h.call('archive_bill', args);
    await h.call('archive_bill', replay('archive_bill', args, pending), true);
    expect(row(h.workbook, '2026-09')).toBeDefined();
    expect(row(h.workbook, '2026-10')).toBeUndefined();
    expect(row(h.workbook, '2026-11')).toBeUndefined();
    expect(row(h.workbook, '2027-01')).toBeUndefined();
    expect(h.workbook.recurringItems[0].isActive).toBe(true);
    expect(h.workbook.recurringItems[0].monthOverrides).toEqual({
      '2026-09': { amount: 550, isActive: true },
      '2026-11': { amount: 599 }
    });
    expect(h.workbook.recurringItems[0].scheduleChanges['2026-12']).toEqual({ amount: 700 });
  });

  it('clarifies duplicate names but accepts exact IDs, and rejects conflicting account aliases', async () => {
    const h = harness();
    h.workbook.recurringItems.push({ ...h.workbook.recurringItems[0], id: 'other' });
    const ambiguous = await h.call('update_bill', { bill: 'Streaming', amount: 800 });
    expect(ambiguous).toMatchObject({ ok: false, changed: false });
    const saved = await h.call('update_bill', { recurringItemId: 'streaming', amount: 800 });
    expect(saved.ok).toBe(true);
    expect(h.workbook.recurringItems[1].amount).toBe(500);
    const conflict = await h.call('update_bill', {
      recurringItemId: 'streaming',
      accountId: 'bank',
      account: 'Cash'
    });
    expect(conflict.errors[0].code).toBe('recurring.conflicting-references');
  });

  it('reports failed persistence instead of claiming the tracker was saved', async () => {
    const h = harness();
    h.commitCommandResult.mockImplementationOnce(() => {
      throw new Error('Synthetic save failed');
    });
    const result = await h.call('update_bill', { recurringItemId: 'streaming', amount: 900 });
    expect(result).toMatchObject({ ok: false, changed: false, status: 'commit_failed' });
    expect(h.workbook.recurringItems[0].amount).toBe(500);
  });

  it.each([
    'Check Streaming then change only the October charge to 599; keep November onward at 499.',
    'Change the expected October charge to 599.',
    'Record a planned payment for Streaming next month.',
    'I have not paid Streaming yet; update the expected charge.',
    'Pay Streaming.'
  ])(
    'does not record money when the request only changes a schedule or is unclear: %s',
    async (question) => {
      const h = harness();
      h.context.question = question;
      const original = structuredClone(h.workbook.transactions);
      const result = await h.call('pay_bill', {
        bill: 'Streaming',
        amount: 599,
        date: '2026-10-15'
      });
      expect(result).toMatchObject({
        ok: false,
        changed: false,
        errors: [{ code: 'recurring.payment-intent-required' }]
      });
      expect(h.workbook.transactions).toEqual(original);
      expect(h.commitCommandResult).not.toHaveBeenCalled();
    }
  );

  it.each([
    'I paid the October charge for Streaming.',
    'I prepaid Streaming for October.',
    'Record an actual payment for Streaming.',
    'Streaming charged me for October.'
  ])('allows explicit actual payment intent: %s', async (question) => {
    const h = harness();
    h.context.question = question;
    const result = await h.call('pay_bill', { bill: 'Streaming', amount: 500, date: '2026-10-15' });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result.receipt.accounts.some((account) => account.name === 'Bank')).toBe(true);
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).not.toMatch(/\bline[_ -]/i);
  });

  it('returns a deterministic receipt that states month scope, account, cadence, and actual due date', async () => {
    const h = harness();
    const result = await h.call('update_bill', {
      bill: 'Streaming',
      amount: 599,
      scope: 'month',
      monthKey: '2026-10'
    });
    const message = cavalryAssistantActionReceiptMessage(result.receipt);
    expect(message).toContain('Cavalry tracker for 2026-10 only (other months unchanged)');
    expect(message).toContain('PHP 599');
    expect(message).toContain('Bank');
    expect(message).toContain('due 2026-10-15');
  });

  it('shows the projected month but edits a consistent baseline rule and preserves all schedule metadata on manual save', () => {
    const h = harness();
    const item = h.workbook.recurringItems[0];
    item.endDate = '2027-04-30';
    item.monthOverrides = {
      '2026-10': { amount: 599, name: 'October special', accountId: 'cash' }
    };
    item.scheduleChanges = { '2026-11': { amount: 700 } };
    h.workbook.sheets = [
      { id: 'october', monthKey: '2026-10', name: 'October', budgets: [], budgetLineItems: [] }
    ];
    const model = buildBillsRouteModel(
      h.workbook,
      { sheetId: 'october' },
      { currentDate: '2026-09-10' }
    );
    const projected = model.rows.find((entry) => entry.recurringItemId === 'streaming');
    expect(projected).toMatchObject({
      name: 'October special',
      originalAmount: 599,
      accountId: 'cash'
    });
    expect(projected.editorValues).toMatchObject({
      name: 'Streaming',
      amount: '500',
      accountId: 'bank',
      dueDate: '2026-09-15',
      endDate: '2027-04-30',
      scope: 'series'
    });
    const command = createBillsController().handleAction(h.workbook, {
      type: 'save-recurring-item',
      payload: { ...projected.editorValues, note: 'Edited manually' }
    });
    expect(command.ok).toBe(true);
    expect(command.workbook.recurringItems[0]).toMatchObject({
      endDate: item.endDate,
      monthOverrides: item.monthOverrides,
      scheduleChanges: item.scheduleChanges,
      note: 'Edited manually'
    });
    expect(row(command.workbook, '2026-10').originalAmount).toBe(599);
    expect(row(command.workbook, '2026-11').originalAmount).toBe(700);
    expect(row(command.workbook, '2027-05')).toBeUndefined();
  });
});

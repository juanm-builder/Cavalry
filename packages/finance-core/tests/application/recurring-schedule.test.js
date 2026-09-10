import { describe, expect, it } from 'vitest';
import {
  getRecurringOccurrenceDatesForMonth,
  getRecurringOccurrencesForSheet,
  getRecurringScheduleSummary
} from '../../src/application/recurring/recurring-analysis-service.js';
import { normalizeRecurringItemForCommand } from '../../src/application/recurring/recurring-command-service.js';
import {
  getRecurringItemForMonth,
  normalizeRecurringDateKey
} from '../../src/application/recurring/recurring-schedule.js';
import {
  deserializeWorkbookFromFile,
  normalizeLoadedWorkbook,
  serializeWorkbookForSave
} from '../../src/application/workbook/workbook-persistence-service.js';
import { makeBasicSpendingWorkbook } from '../fixtures/core-workbook-fixtures.js';

const tracker = (extra = {}) => ({
  id: 'streaming',
  name: 'Streaming',
  kind: 'subscription',
  amount: 500,
  currency: 'PHP',
  categoryId: 'subscriptions',
  accountId: 'bank',
  anchorDate: '2026-09-15',
  frequency: 'Monthly',
  isActive: true,
  ...extra
});

describe('date-bounded recurring schedules', () => {
  it.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-01-00', '0000-01-01'])(
    'rejects impossible date %s',
    (date) => {
      expect(normalizeRecurringDateKey(date)).toBe('');
    }
  );

  it('accepts leap days and clamps monthly day 31 without moving the anchor', () => {
    expect(normalizeRecurringDateKey('2028-02-29')).toBe('2028-02-29');
    const item = tracker({ anchorDate: '2026-01-31' });
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-02')).toEqual(['2026-02-28']);
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-03')).toEqual(['2026-03-31']);
  });

  it('excludes months before a future start and after an inclusive end', () => {
    const item = tracker({ anchorDate: '2026-10-15', endDate: '2026-11-15' });
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-09')).toEqual([]);
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-10')).toEqual(['2026-10-15']);
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-11')).toEqual(['2026-11-15']);
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-12')).toEqual([]);
    expect(getRecurringScheduleSummary(item, '2026-12-01')).toEqual({
      anchorDate: '2026-10-15',
      currentOccurrenceDate: '2026-11-15',
      nextExpectedDate: ''
    });
  });

  it('limits a one-time tracker to its one month and stops weekly schedules at the end date', () => {
    const once = tracker({ frequency: 'One-time' });
    expect(getRecurringOccurrenceDatesForMonth(once, '2026-09')).toEqual(['2026-09-15']);
    expect(getRecurringOccurrenceDatesForMonth(once, '2026-10')).toEqual([]);
    expect(
      getRecurringOccurrenceDatesForMonth(
        tracker({ frequency: 'Weekly', anchorDate: '2026-09-01', endDate: '2026-09-15' }),
        '2026-09'
      )
    ).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
  });

  it('projects one-month amounts, accounts and due dates without changing neighboring months', () => {
    const item = tracker({
      monthOverrides: { '2026-10': { amount: 650, accountId: 'cash', anchorDate: '2026-10-20' } }
    });
    const workbook = { ...makeBasicSpendingWorkbook(), recurringItems: [item] };
    expect(getRecurringOccurrencesForSheet(workbook, { monthKey: '2026-09' })[0]).toMatchObject({
      originalAmount: 500,
      accountId: 'bank',
      dueDate: '2026-09-15'
    });
    expect(getRecurringOccurrencesForSheet(workbook, { monthKey: '2026-10' })[0]).toMatchObject({
      originalAmount: 650,
      accountId: 'cash',
      dueDate: '2026-10-20'
    });
    expect(getRecurringOccurrencesForSheet(workbook, { monthKey: '2026-11' })[0]).toMatchObject({
      originalAmount: 500,
      accountId: 'bank',
      dueDate: '2026-11-15'
    });
    expect(item.amount).toBe(500);
  });

  it('applies future changes from their month while retaining earlier history and explicit exceptions', () => {
    const item = tracker({
      scheduleChanges: { '2026-10': { amount: 600 }, '2026-12': { amount: 700 } },
      monthOverrides: { '2026-11': { amount: 0 }, '2027-01': { isActive: false } }
    });
    expect(
      ['2026-09', '2026-10', '2026-11', '2026-12', '2027-02'].map(
        (month) => getRecurringItemForMonth(item, month).amount
      )
    ).toEqual([500, 600, 0, 700, 700]);
    expect(getRecurringOccurrenceDatesForMonth(item, '2027-01')).toEqual([]);
    expect(getRecurringOccurrenceDatesForMonth(item, '2027-02')).toEqual(['2027-02-15']);
  });

  it('retains schedule changes and month exceptions through normalization and reload', () => {
    const item = tracker({
      endDate: '2027-04-30',
      scheduleChanges: { '2026-10': { amount: 600 } },
      monthOverrides: { '2026-11': { isActive: false } }
    });
    const normalized = normalizeRecurringItemForCommand(item);
    const reloaded = normalizeLoadedWorkbook(
      JSON.parse(JSON.stringify({ ...makeBasicSpendingWorkbook(), recurringItems: [normalized] }))
    );
    expect(reloaded.recurringItems[0]).toMatchObject({
      endDate: '2027-04-30',
      scheduleChanges: item.scheduleChanges,
      monthOverrides: item.monthOverrides
    });
    expect(getRecurringOccurrenceDatesForMonth(reloaded.recurringItems[0], '2026-11')).toEqual([]);
    expect(getRecurringItemForMonth(reloaded.recurringItems[0], '2026-12').amount).toBe(600);
    const saved = serializeWorkbookForSave(reloaded);
    const portable = deserializeWorkbookFromFile(saved.html).workbook;
    expect(portable.recurringItems[0]).toMatchObject({
      endDate: '2027-04-30',
      scheduleChanges: item.scheduleChanges,
      monthOverrides: item.monthOverrides
    });
    expect(getRecurringOccurrenceDatesForMonth(portable.recurringItems[0], '2026-11')).toEqual([]);
    expect(getRecurringItemForMonth(portable.recurringItems[0], '2026-12').amount).toBe(600);
  });

  it('keeps a globally archived tracker inactive even when an earlier exception restored a month', () => {
    const item = tracker({
      isActive: false,
      scheduleChanges: { '2026-10': { isActive: true, amount: 600 } },
      monthOverrides: { '2026-11': { isActive: true, amount: 650 } }
    });
    expect(getRecurringItemForMonth(item, '2026-10')).toMatchObject({
      isActive: false,
      amount: 600
    });
    expect(getRecurringItemForMonth(item, '2026-11')).toMatchObject({
      isActive: false,
      amount: 650
    });
    expect(getRecurringOccurrenceDatesForMonth(item, '2026-11')).toEqual([]);
  });
});

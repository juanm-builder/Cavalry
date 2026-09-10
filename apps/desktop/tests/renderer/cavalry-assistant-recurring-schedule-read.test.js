import { describe, expect, it, vi } from 'vitest';
import { makeBasicSpendingWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { executeCavalryAssistantTool } from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import { buildCavalryAssistantCitations } from '../../src/renderer/features/assistant/cavalry-assistant-references.js';

function harness() {
  const workbook = structuredClone(makeBasicSpendingWorkbook());
  const tracker = {
    kind: 'subscription',
    categoryId: 'subscriptions',
    accountId: 'bank',
    currency: 'PHP',
    frequency: 'Monthly',
    autoRenew: true,
    isActive: true
  };
  workbook.recurringItems = [
    {
      ...tracker,
      id: 'stream',
      name: 'Stream',
      amount: 499,
      anchorDate: '2026-10-05',
      monthOverrides: { '2026-10': { amount: 599 }, '2026-11': { isActive: false } },
      scheduleChanges: { '2026-11': { amount: 699 } }
    },
    {
      ...tracker,
      id: 'september',
      name: 'September Only',
      amount: 199,
      anchorDate: '2026-09-15',
      endDate: '2026-09-30'
    },
    { ...tracker, id: 'next', name: 'Next Month', amount: 299, anchorDate: '2026-10-20' }
  ];
  const commit = vi.fn();
  return {
    workbook,
    commit,
    call: (args) =>
      executeCavalryAssistantTool(
        { name: 'list_recurring_bills', arguments: args },
        {
          getWorkbook: () => workbook,
          commitCommandResult: commit,
          services: { defaultDate: () => '2026-09-10' }
        }
      )
  };
}

describe('resolved recurring schedule reads', () => {
  it('grounds a multi-month answer while retaining every effective amount under the same tracker ID', async () => {
    const h = harness();
    const months = ['2026-12', '2026-10', '2026-11'];
    const result = await h.call({ monthKeys: months });
    const toolResults = [{ ok: true, result }];
    const answer = buildCavalryAssistantCitations({
      text: [
        '| Tracker | Month | Expected amount | Date |',
        '| --- | --- | --- | --- |',
        '| Stream | October 2026 | PHP 599 | October 5 [[source:recurringItem:stream]] |',
        '| Stream | November 2026 | PHP 0 | No charge scheduled [[source:recurringItem:stream]] |',
        '| Stream | December 2026 | PHP 699 | December 5 [[source:recurringItem:stream]] |'
      ].join('\n'),
      toolResults
    });
    expect(answer.text).not.toContain("I couldn't verify");
    expect(answer.references).toHaveLength(3);
    for (const reference of answer.references) {
      expect(reference.source_refs).toEqual(['recurringItem:stream']);
      const detail = reference.detail.records[0].detail;
      expect(detail.schedules).toMatchObject([
        { monthKey: '2026-10', amount: 599, scheduledTotal: 599, dueDates: ['2026-10-05'] },
        {
          monthKey: '2026-11',
          amount: 0,
          scheduledTotal: 0,
          dueDates: [],
          scheduleStatus: 'no_charge_scheduled'
        },
        { monthKey: '2026-12', amount: 699, scheduledTotal: 699, dueDates: ['2026-12-05'] }
      ]);
      expect(detail).not.toHaveProperty('amount');
      expect(detail).not.toHaveProperty('dueDate');
    }
    const separateResults = await Promise.all(
      months.map(async (monthKey) => ({ ok: true, result: await h.call({ monthKey }) }))
    );
    const rangeAnswer = buildCavalryAssistantCitations({
      text: 'Stream schedule covers October through December 2026. [[source:recurringItem:stream]]',
      toolResults: separateResults
    });
    expect(rangeAnswer.text).not.toContain("I couldn't verify");
    expect(rangeAnswer.references[0].detail.records[0].detail.schedules).toHaveLength(3);
    expect(
      buildCavalryAssistantCitations({
        text: 'Stream schedule covers September through December 2026. [[source:recurringItem:stream]]',
        toolResults
      }).text
    ).toContain("I couldn't verify");
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('computes every requested month without requiring the model to apply baseline patches', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    const result = await h.call({ monthKeys: ['2026-09', '2026-10', '2026-11', '2026-12'] });
    expect(result).toMatchObject({ ok: true, changed: false });
    const row = (month, id) =>
      result.data.schedules
        .find((entry) => entry.monthKey === month)
        .recurringItems.find((entry) => entry.id === id);
    expect(row('2026-10', 'stream')).toMatchObject({
      amount: 599,
      nativeAmount: 599,
      scheduledTotal: 599,
      dueDates: ['2026-10-05'],
      scheduleStatus: 'scheduled'
    });
    expect(row('2026-11', 'stream')).toMatchObject({
      amount: 0,
      nativeAmount: 0,
      scheduledTotal: 0,
      dueDates: [],
      isActive: false,
      scheduleStatus: 'no_charge_scheduled'
    });
    expect(row('2026-12', 'stream')).toMatchObject({
      amount: 699,
      nativeAmount: 699,
      baseAmount: 699,
      scheduledTotal: 699,
      dueDates: ['2026-12-05'],
      isActive: true
    });
    expect(row('2026-12', 'stream')).not.toHaveProperty('scheduleChanges');
    expect(row('2026-12', 'stream')).not.toHaveProperty('monthOverrides');
    expect(row('2026-09', 'september')).toMatchObject({ amount: 199, dueDates: ['2026-09-15'] });
    expect(row('2026-10', 'september')).toMatchObject({
      amount: 0,
      dueDates: [],
      scheduledTotal: 0
    });
    expect(row('2026-09', 'next')).toMatchObject({ amount: 0, dueDates: [] });
    expect(row('2026-10', 'next')).toMatchObject({ amount: 299, dueDates: ['2026-10-20'] });
    expect(row('2026-11', 'next')).toMatchObject({ amount: 299, dueDates: ['2026-11-20'] });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('supports one explicit month while the default is explicitly the real calendar month', async () => {
    const h = harness();
    const december = await h.call({ monthKey: '2026-12' });
    expect(december.data).toMatchObject({ monthKey: '2026-12' });
    expect(december.data.recurringItems.find((item) => item.id === 'stream').amount).toBe(699);
    expect((await h.call({})).data).toMatchObject({ monthKey: '2026-09' });
  });

  it.each([
    { monthKey: '2026-13' },
    { monthKeys: ['2026-12', 'next month'] },
    { monthKeys: [] },
    { monthKey: '2026-12', monthKeys: ['2026-11'] }
  ])('rejects invalid month requests instead of silently answering for today: %o', async (args) => {
    const h = harness();
    expect(await h.call(args)).toMatchObject({ ok: false, changed: false });
    expect(h.commit).not.toHaveBeenCalled();
  });
});

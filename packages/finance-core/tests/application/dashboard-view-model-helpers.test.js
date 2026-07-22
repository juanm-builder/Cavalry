import { describe, expect, it } from 'vitest';

import {
  asArray,
  asString,
  clonePlain,
  formatDisplayDate,
  formatMonthValue,
  formatVisibleDateRangeLabel,
  getDashboardSpendingRangeLabel,
  getTemplateLabel,
  normalizeMonthValue,
  titleCaseLabel
} from '@cavalry/finance-core/application/dashboard/dashboard-view-model-helpers.js';

describe('dashboard view-model helpers', () => {
  it('normalizes plain display primitives', () => {
    expect(asString('  hello  ')).toBe('hello');
    expect(asString(null)).toBe('');
    expect(asArray(['a'])).toEqual(['a']);
    expect(asArray('a')).toEqual([]);

    const source = { nested: { amount: 12 } };
    const copy = clonePlain(source);
    copy.nested.amount = 15;
    expect(source.nested.amount).toBe(12);
  });

  it('formats month and visible date range labels', () => {
    expect(normalizeMonthValue('2026-07')).toBe('2026-07');
    expect(normalizeMonthValue('2026-13')).toBe('');
    expect(formatDisplayDate('2026-07-08')).toBe('July 8, 2026');
    expect(formatDisplayDate('bad')).toBe('bad');
    expect(formatMonthValue('2026-07')).toBe('July 2026');
    expect(formatMonthValue('bad')).toBe('');
    expect(formatVisibleDateRangeLabel({ start: '2026-07-08', end: '2026-07-08' })).toBe(
      'July 8, 2026'
    );
    expect(formatVisibleDateRangeLabel({ start: '2026-07-01', end: '2026-07-08' })).toBe(
      'July 1 - 8, 2026'
    );
    expect(formatVisibleDateRangeLabel({ start: '2026-06-30', end: '2026-07-08' })).toBe(
      'June 30 - July 8, 2026'
    );
    expect(formatVisibleDateRangeLabel({ start: '', end: '' })).toBe('Visible period');
  });

  it('formats dashboard labels without changing service semantics', () => {
    expect(getDashboardSpendingRangeLabel({ startMonth: '2026-07', endMonth: '2026-07' })).toBe(
      'July 2026'
    );
    expect(getDashboardSpendingRangeLabel({ startMonth: '2026-06', endMonth: '2026-07' })).toBe(
      'June 2026 - July 2026'
    );
    expect(getDashboardSpendingRangeLabel(null)).toBe('All months');
    expect(titleCaseLabel('cash-flow_bucket', 'Flow')).toBe('Cash Flow Bucket');
    expect(titleCaseLabel('', 'Flow')).toBe('Flow');
    expect(getTemplateLabel('expense_charged')).toBe('Expense Charged');
    expect(getTemplateLabel('custom_template')).toBe('custom template');
    expect(getTemplateLabel('')).toBe('Manual');
  });
});

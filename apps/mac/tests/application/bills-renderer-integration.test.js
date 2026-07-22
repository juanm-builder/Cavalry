import { describe, expect, it, vi } from 'vitest';

import { createBillsController } from '../../src/renderer/features/recurring/bills-controller.js';
import { buildBillsRouteModel } from '../../src/renderer/features/recurring/bills-route-model.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function makeWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.sheets = [
    { id: 'sheet-june', name: 'June', monthIndex: 5, budgets: [], budgetLineItems: [] }
  ];
  workbook.recurringItems = [
    {
      id: 'recurring-netflix',
      kind: 'subscription',
      name: 'Netflix',
      categoryId: 'subscriptions',
      accountId: 'bank',
      amount: 549,
      currency: 'PHP',
      frequency: 'Monthly',
      anchorDate: '2026-06-20',
      autoRenew: true,
      isActive: true,
      note: ''
    }
  ];
  return workbook;
}

describe('Bills renderer integration', () => {
  it('builds its display model from production finance-core services', () => {
    const model = buildBillsRouteModel(
      makeWorkbook(),
      {
        sheetId: 'sheet-june',
        search: 'netflix',
        sort: 'amount'
      },
      { currentDate: '2026-06-15' }
    );

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      recurringItemId: 'recurring-netflix',
      name: 'Netflix',
      status: 'Upcoming',
      actions: { canPay: true, canEdit: true, canArchive: true }
    });
    expect(model.filters).toMatchObject({ search: 'netflix', sort: 'amount' });
  });

  it('keeps route data serializable instead of returning action HTML', () => {
    const model = buildBillsRouteModel(makeWorkbook(), {}, { currentDate: '2026-06-15' });
    const serialized = JSON.stringify(model);

    expect(JSON.parse(serialized)).toEqual(model);
    expect(serialized).not.toContain('data-action');
    expect(serialized).not.toContain('registerRowsHtml');
    expect(serialized).not.toContain('dueNextPanelHtml');
    expect(serialized).not.toContain('filterPanelHtml');
  });

  it('returns immutable recurring mutation results for the command executor', () => {
    const workbook = makeWorkbook();
    const controller = createBillsController({ currentDate: '2026-06-15' });
    const result = controller.handleAction(workbook, {
      type: 'archive-recurring-item',
      payload: { recurringItemId: 'recurring-netflix' }
    });

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.recurringItems[0].isActive).toBe(false);
    expect(workbook.recurringItems[0].isActive).toBe(true);
    expect(result.events).toContainEqual({ type: 'schedule-save' });
  });

  it('routes subscription review through the injected Advisor intent boundary', () => {
    const workbook = makeWorkbook();
    const advisorIntent = vi.fn((operation, payload) => ({
      type: 'advisor-test-intent',
      payload: { operation, ...payload }
    }));
    const controller = createBillsController({ currentDate: '2026-06-15', advisorIntent });
    const result = controller.handleAction(workbook, {
      type: 'scan-subscription-review',
      payload: { sheetId: 'sheet-june' }
    });

    expect(result.workbook).toBe(workbook);
    expect(result.events[0]).toEqual({
      type: 'advisor-test-intent',
      payload: {
        operation: 'recurring-scan',
        workbookId: workbook.id,
        sheetId: 'sheet-june',
        includeIgnored: false
      }
    });
  });
});

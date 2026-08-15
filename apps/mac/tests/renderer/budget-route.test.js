import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildBudgetRouteViewModel } from '@cavalry/finance-core/application/budgets/budget-route-view-model-service.js';
import { BudgetRoute } from '../../src/renderer/features/budgets/BudgetRoute.jsx';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function makeBudgetWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.sheets = [
    {
      id: 'sheet-june',
      name: 'June',
      monthIndex: 5,
      budgets: [
        { categoryId: 'food', planned: 200 },
        { categoryId: 'subscriptions', planned: 600 }
      ],
      budgetLineItems: []
    }
  ];
  return workbook;
}

function makeRouteModel(workbook = makeBudgetWorkbook()) {
  return Object.assign(
    {},
    buildBudgetRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    }),
    {
      currency: workbook.currency,
      periodLabel: 'June 1 - June 30, 2026',
      sheet: workbook.sheets[0]
    }
  );
}

function renderBudgetRoute(model = makeRouteModel()) {
  return renderToStaticMarkup(React.createElement(BudgetRoute, { model }));
}

describe('BudgetRoute', () => {
  it('renders a calm at-a-glance Monthly Plan story', () => {
    const html = renderBudgetRoute();

    expect(html).toContain('data-react-route="budgets"');
    expect(html).toContain('Monthly Plan');
    expect(html).toContain('Monthly Plan overview');
    expect(html).toContain('Income plan');
    expect(html).toContain('Spending plan');
    expect(html).toContain('Recurring');
    expect(html).toContain('Unallocated');
    expect(html).toMatch(/On track|Over plan/);
    expect(html).toContain('Spent this month');
    expect(html).toContain('Safe today');
    expect(html).toContain('Daily plan');
    expect(html).not.toContain('Budget Usage');
    expect(html).not.toContain('data-action=');
  });

  it('shows one plan section at a time instead of a duplicate usage dashboard', () => {
    const html = renderBudgetRoute();

    expect(html).toContain('Your plan');
    expect(html).toContain('Monthly Plan sections');
    expect(html).toContain('Food');
    expect(html).toContain('Subscriptions');
    expect(html).toContain('aria-label="Create budget"');
    expect(html).not.toContain('budget-usage-key');
    expect(html).not.toContain('Insights from Cavalry');
    expect(html).not.toContain('Spending Breakdown');
  });

  it('renders a focused empty state with a single create action', () => {
    const emptyModel = makeRouteModel();
    emptyModel.categoryRows = [];
    emptyModel.spendingRows = [];
    const html = renderBudgetRoute(emptyModel);

    expect(html).toContain('No plan entries yet.');
    expect(html).toContain('Add your first amount to build this month’s plan.');
    expect(html).toContain('aria-label="Create budget"');
  });
});

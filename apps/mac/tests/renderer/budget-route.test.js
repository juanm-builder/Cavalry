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
  it('renders one actionable budget status story', () => {
    const html = renderBudgetRoute();

    expect(html).toContain('data-react-route="budgets"');
    expect(html).toContain('Budget');
    expect(html).toContain('Budget status');
    expect(html).toMatch(/On Track|Over Budget/);
    expect(html).toContain('Spent');
    expect(html).toContain('Safe to spend today');
    expect(html).toContain('Days elapsed');
    expect(html).toContain('Remaining today');
    expect(html).not.toContain('Add Budget');
    expect(html).not.toContain('Daily Average');
    expect(html).not.toContain('data-action=');
  });

  it('renders an impact-ordered, health-colored usage bar', () => {
    const html = renderBudgetRoute();

    expect(html).toContain('Budget Usage');
    expect(html).toContain('Food');
    expect(html).toContain('Subscriptions');
    expect(html).toContain('budget-usage-key');
    expect(html).not.toContain('Sort budget usage');
    expect(html).not.toContain('Review Overspending');
    expect(html).toContain('Categories');
    expect(html).toContain('aria-label="Create budget"');
    expect(html).not.toContain('Insights from Cavalry');
    expect(html).not.toContain('Budget by Category');
    expect(html).not.toContain('Spending Breakdown');
  });

  it('renders budget usage empty states', () => {
    const html = renderBudgetRoute();
    expect(html).toContain('Budget Usage');

    const emptyModel = makeRouteModel();
    emptyModel.categoryRows = [];
    emptyModel.spendingRows = [];
    const emptyHtml = renderBudgetRoute(emptyModel);

    expect(emptyHtml).toContain('No category budgets yet.');
    expect(emptyHtml).toContain('aria-label="Create budget"');
  });
});

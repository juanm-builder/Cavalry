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
    expect(html).toContain('Expected income');
    expect(html).toContain('Planned spending');
    expect(html).toContain('Left to save');
    expect(html).toContain('Monthly actuals');
    expect(html).not.toContain('Safe today');
    expect(html).not.toContain('Daily plan');
    expect(html).not.toContain('Total allocated');
    expect(html).not.toContain('Budget Usage');
    expect(html).not.toContain('data-action=');
  });

  it('shows the combined plan with category details and totals', () => {
    const html = renderBudgetRoute();
    const foodDescription = html.match(
      /aria-describedby="([^"]+)" class="budget-category-list-row"/
    );
    const foodDescriptionId = foodDescription?.[1] || '';

    expect(html).toContain('Your plan');
    expect(html).toContain('Monthly Plan sections');
    expect(html).toContain('Food');
    expect(html).toContain('Subscriptions');
    expect(html).toContain('aria-label="Add spending plan"');
    expect(foodDescription).not.toBeNull();
    expect(html).not.toContain('aria-label="Open Food budget details"');
    expect(html).toContain(`class="sr-only" id="${foodDescriptionId}">Plan: `);
    expect(html).toContain('. Spent: ');
    expect(html).toContain('. Status: ');
    expect(html).not.toContain('budget-usage-key');
    expect(html).not.toContain('Insights from Cavalry');
    expect(html).not.toContain('Spending Breakdown');
  });

  it('renders one add row for the empty spending section', () => {
    const emptyModel = makeRouteModel();
    emptyModel.categoryRows = [];
    emptyModel.spendingRows = [];
    const html = renderBudgetRoute(emptyModel);

    expect(html).toContain('Add a budget');
    expect(html.match(/aria-label="Add spending plan"/g)).toHaveLength(1);
    expect(html).not.toContain('No plan entries yet.');
  });
});

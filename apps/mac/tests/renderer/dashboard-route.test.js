import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildDashboardRouteViewModel } from '@cavalry/finance-core/application/dashboard/dashboard-route-view-model-service.js';
import { formatVisibleDateRangeLabel } from '@cavalry/finance-core/application/dashboard/dashboard-view-model-helpers.js';
import { DashboardRoute } from '../../src/renderer/features/dashboard/DashboardRoute.jsx';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function makeDashboardWorkbook() {
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
  workbook.settings.dashboardLayout = [
    { id: 'command', visible: true },
    { id: 'flows', visible: true },
    { id: 'money_shape', visible: true },
    { id: 'monthly_rhythm', visible: true },
    { id: 'recent_activity', visible: true }
  ];
  return workbook;
}

function makeCategoryLookup(workbook) {
  return workbook.categories.reduce((lookup, category) => {
    lookup[category.id] = {
      id: category.id,
      name: category.name,
      type: category.type
    };
    return lookup;
  }, {});
}

function makeRouteModel(workbook = makeDashboardWorkbook(), overrides = {}) {
  const range = overrides.range || {
    start: '2026-06-01',
    end: '2026-06-30'
  };
  return Object.assign(
    {},
    buildDashboardRouteViewModel(workbook, {
      range,
      asOfDate: range.end,
      currentDate: '2026-06-15'
    }),
    {
      currency: workbook.currency,
      periodLabel: formatVisibleDateRangeLabel(range),
      layout: overrides.layout || workbook.settings.dashboardLayout,
      categoryLookup: makeCategoryLookup(workbook)
    }
  );
}

function renderDashboardRoute(model = makeRouteModel()) {
  return renderToStaticMarkup(React.createElement(DashboardRoute, { model }));
}

describe('DashboardRoute', () => {
  it('renders dashboard sections and action affordances from the route model', () => {
    const model = makeRouteModel();
    const html = renderDashboardRoute(model);
    const netFlowValue = Number(model.stats.cards.find((card) => card.id === 'net_flow')?.value);
    const netFlowDirection = netFlowValue > 0 ? 'positive' : netFlowValue < 0 ? 'negative' : 'zero';

    expect(html).toContain('data-react-route="dashboard"');
    expect(html).toContain('Dashboard');
    expect(html).toContain('Customize');
    expect(html).toContain('Export');
    expect(html).toContain('data-dashboard-module="command"');
    expect(html).toContain('Net Worth');
    expect(html).toContain('Total Inflows');
    expect(html).toContain('Total Outflows');
    expect(html).toContain('Net Flow');
    expect(html).toContain(`aria-label="Net flow, ${netFlowDirection}, `);
    expect(html).toContain('class="dashboard-flow-connector" role="group"');
    expect(html).not.toContain('class="dashboard-flow-connector" aria-hidden="true"');
    expect(html).toContain('Dashboard average period');
    expect(html).toContain('Yearly');
    expect(html).toContain('Average spending per year');
    expect(html).toContain('Average spending per month');
    expect(html).toContain('Average spending per week');
    expect(html).not.toContain('Weekly avg');
    expect(html).not.toContain('data-action=');
  });

  it('renders the timeline, spending, and account drilldowns', () => {
    const html = renderDashboardRoute();

    expect(html).toContain('Cash-flow timeline');
    expect(html).not.toContain('Bigger picture');
    expect(html).not.toContain('Monthly income and expenses across the current year');
    expect(html).toContain('Spending by category');
    expect(html).not.toContain('Where it goes');
    expect(html).not.toContain('Your position, cash flow');
    expect(html).not.toContain('>Position</span>');
    expect(html).not.toMatch(/class="amount">[^<]+ · \d+%/);
    expect(html).toContain('Assets &amp; obligations');
    expect(html).not.toContain('Monthly Net Movement');
    expect(html).not.toContain('Transactions in Range');
  });

  it('uses semantic tones for negative and zero position values', () => {
    const negativeModel = makeRouteModel();
    negativeModel.timeframes = {};
    negativeModel.stats.cards = negativeModel.stats.cards.map((card) =>
      card.id === 'net_worth' ? { ...card, value: -1250 } : card
    );
    const negativeHtml = renderDashboardRoute(negativeModel);
    expect(negativeHtml).toContain(
      '<span class="dashboard-kicker">Net Worth</span><strong class="bad">'
    );

    const zeroModel = makeRouteModel();
    zeroModel.timeframes = {};
    zeroModel.stats.cards = zeroModel.stats.cards.map((card) =>
      ['net_worth', 'total_inflows', 'total_outflows', 'net_flow'].includes(card.id)
        ? { ...card, value: 0 }
        : card
    );
    const zeroHtml = renderDashboardRoute(zeroModel);
    expect(zeroHtml).toContain(
      '<span class="dashboard-kicker">Net Worth</span><strong class="neutral">'
    );
    expect(zeroHtml).toContain('dashboard-flow-summary-item neutral');
  });

  it('respects dashboard layout ordering and hidden layout empty state', () => {
    const customHtml = renderDashboardRoute(
      makeRouteModel(makeDashboardWorkbook(), {
        layout: [
          { id: 'recent_activity', visible: true },
          { id: 'command', visible: true },
          { id: 'flows', visible: false }
        ]
      })
    );

    expect(customHtml.indexOf('data-dashboard-module="recent_activity"')).toBeLessThan(
      customHtml.indexOf('data-dashboard-module="command"')
    );
    expect(customHtml).not.toContain('data-dashboard-module="flows"');

    const hiddenHtml = renderDashboardRoute(
      makeRouteModel(makeDashboardWorkbook(), {
        layout: [
          { id: 'command', visible: false },
          { id: 'flows', visible: false }
        ]
      })
    );

    expect(hiddenHtml).toContain('Dashboard Hidden');
    expect(hiddenHtml).toContain('Customize Dashboard');
  });
});

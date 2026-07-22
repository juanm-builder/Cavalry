import { describe, expect, it } from 'vitest';

import { buildAdvisorEvidenceWorkspace } from '@cavalry/advisor/application/advisor/evidence-workspace.js';
import { buildAdvisorSourceRegistry } from '@cavalry/advisor/application/advisor/source-registry.js';

function makeWorkbook() {
  return {
    accounts: [
      { id: 'cash', group: 'asset' },
      { id: 'card', group: 'liability' },
      { id: 'income', group: 'income' },
      { id: 'expense', group: 'expense' },
      { id: 'equity', group: 'equity' }
    ],
    categories: [
      { id: 'salary', type: 'income' },
      { id: 'food', type: 'expense' }
    ],
    transactions: [
      {
        id: 'opening',
        date: '2026-06-01',
        amount: 1000,
        baseAmount: 1000,
        lines: [
          { accountId: 'cash', direction: 'debit', baseAmount: 1000 },
          { accountId: 'equity', direction: 'credit', baseAmount: 1000 }
        ]
      },
      {
        id: 'salary',
        date: '2026-06-03',
        amount: 500,
        baseAmount: 500,
        categoryId: 'salary',
        lines: [
          { accountId: 'cash', direction: 'debit', baseAmount: 500 },
          { accountId: 'income', direction: 'credit', baseAmount: 500 }
        ]
      },
      {
        id: 'food',
        date: '2026-06-04',
        amount: 120,
        baseAmount: 120,
        categoryId: 'food',
        lines: [
          { accountId: 'expense', direction: 'debit', baseAmount: 120 },
          { accountId: 'cash', direction: 'credit', baseAmount: 120 }
        ]
      },
      {
        id: 'card-food',
        date: '2026-06-05',
        amount: 80,
        baseAmount: 80,
        categoryId: 'food',
        lines: [
          { accountId: 'expense', direction: 'debit', baseAmount: 80 },
          { accountId: 'card', direction: 'credit', baseAmount: 80 }
        ]
      }
    ]
  };
}

describe('Advisor source registry', () => {
  it('grounds computed totals in their dependencies and preserves category and transaction provenance', () => {
    const registry = buildAdvisorSourceRegistry(makeWorkbook(), {
      range: { start: '2026-06-01', end: '2026-06-30' },
      asOfDate: '2026-06-05'
    });

    expect(registry.sources['computed.totals.assets'].value).toBe(1380);
    expect(registry.sources['computed.totals.liabilities'].value).toBe(80);
    expect(registry.sources['computed.totals.net_worth']).toMatchObject({
      value: 1300,
      inputRefs: ['computed.totals.assets', 'computed.totals.liabilities']
    });
    expect(registry.sources['category_spend:food']).toMatchObject({
      value: 200,
      rows: ['food', 'card-food']
    });
    expect(registry.sources['transaction:food']).toMatchObject({ value: 120, rows: ['food'] });
  });

  it('can attach the computed registry to the evidence workspace', () => {
    const workspace = buildAdvisorEvidenceWorkspace({
      workbook: makeWorkbook(),
      range: { start: '2026-06-01', end: '2026-06-30' },
      asOfDate: '2026-06-05',
      summary: {},
      toolResults: [],
      actions: []
    });

    expect(workspace.sourceRegistry['computed.totals.net_worth'].inputRefs).toEqual([
      'computed.totals.assets',
      'computed.totals.liabilities'
    ]);
  });
});

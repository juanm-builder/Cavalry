// Locks down browser-safe category selector and route projections.

import { describe, expect, it } from 'vitest';

import {
  buildCategoryRouteViewModel,
  buildCategorySelectorOptions,
  getCategoryViewItems
} from '@cavalry/finance-core/application/categories/category-view-model-service.js';
import { makeNormalAccountWorkbook } from '../fixtures/account-scenarios.js';

function makeWorkbook() {
  const workbook = makeNormalAccountWorkbook();
  workbook.categories.push(
    {
      id: 'emergency-fund',
      name: 'Emergency Fund',
      type: 'savings',
      currency: 'PHP',
      isActive: true,
      linkedAccountId: 'cash'
    },
    {
      id: 'old-food',
      name: 'Old Food',
      type: 'expense',
      currency: 'PHP',
      isActive: false,
      linkedAccountId: 'food-expense'
    }
  );
  return workbook;
}

function categorySelectorValues(workbook, options) {
  return buildCategorySelectorOptions(workbook, options).map((option) => option.value);
}

describe('category view model service', () => {
  it('builds active expense selector options for expense templates', () => {
    const options = buildCategorySelectorOptions(makeWorkbook(), {
      template: 'expense_paid',
      selectedValue: 'food'
    });

    expect(options.map((option) => option.value)).toEqual(['food']);
    expect(options[0]).toMatchObject({
      label: 'Food • expense',
      selected: true,
      isArchived: false,
      linkedAccountId: 'food-expense'
    });
  });

  it('uses template category types for income, debt, savings, and transfer selectors', () => {
    const workbook = makeWorkbook();

    expect(categorySelectorValues(workbook, { template: 'income_received' })).toEqual(['salary']);
    expect(categorySelectorValues(workbook, { template: 'debt_payment' })).toEqual([
      'credit-card-payment'
    ]);
    expect(categorySelectorValues(workbook, { categoryTypes: ['savings'] })).toEqual([
      'emergency-fund'
    ]);
    expect(buildCategorySelectorOptions(workbook, { template: 'transfer' })).toEqual([]);
  });

  it('keeps hidden categories out of selectors by default', () => {
    const workbook = makeWorkbook();

    expect(
      getCategoryViewItems(workbook, {
        template: 'expense_paid'
      }).map((category) => category.id)
    ).toEqual(['food']);
    expect(
      getCategoryViewItems(workbook, {
        template: 'expense_paid',
        includeHidden: true
      }).map((category) => category.id)
    ).toEqual(['food', 'old-food']);
  });

  it('builds route view model with hidden categories sorted last', () => {
    const workbook = makeWorkbook();
    const before = JSON.stringify(workbook);
    const model = buildCategoryRouteViewModel(workbook, {
      includeHidden: true
    });

    expect(JSON.stringify(workbook)).toBe(before);
    expect(model.categoryCount).toBe(5);
    expect(model.hiddenCount).toBe(1);
    expect(model.categories.map((category) => category.value)).toEqual([
      'credit-card-payment',
      'food',
      'salary',
      'emergency-fund',
      'old-food'
    ]);
    expect(model.categories.at(-1)).toMatchObject({
      value: 'old-food',
      label: 'Old Food',
      isArchived: true
    });
  });

  it('handles missing workbooks and unknown templates defensively', () => {
    expect(buildCategorySelectorOptions(null, { template: 'expense_paid' })).toEqual([]);
    expect(buildCategoryRouteViewModel(null, { includeHidden: true })).toEqual({
      categoryCount: 0,
      hiddenCount: 0,
      categories: []
    });
    expect(categorySelectorValues(makeWorkbook(), { template: 'not_real' })).toEqual(['food']);
  });
});

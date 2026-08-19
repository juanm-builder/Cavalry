// Locks down category route markup, visibility toggle state, and action affordances.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CategoryRoute } from '../../src/renderer/features/categories/CategoryRoute.jsx';

function makeCategoryModel() {
  return {
    currency: 'PHP',
    periodLabel: 'June 2026',
    showHidden: true,
    spendingRows: [
      { category: { id: 'food', name: 'Food' }, total: 1450 },
      { category: { id: 'old-food', name: 'Old Food' }, total: 75 }
    ],
    categoryRows: [
      {
        id: 'food',
        name: 'Food',
        description: 'Supermarket, groceries, household items',
        icon: 'shopping_cart',
        tone: 'good',
        typeTone: 'bad',
        typeLabel: 'Expense',
        bucketLabel: 'Unassigned',
        transactionCount: 2,
        spent: 1450,
        percent: 95.1,
        isArchived: false
      },
      {
        id: 'old-food',
        name: 'Old Food',
        description: 'Old category',
        icon: 'category',
        tone: 'warn',
        typeTone: 'bad',
        typeLabel: 'Expense',
        bucketLabel: 'Archived',
        transactionCount: 1,
        spent: 75,
        percent: 4.9,
        isArchived: true
      }
    ]
  };
}

function renderCategoryRoute(model = makeCategoryModel()) {
  return renderToStaticMarkup(React.createElement(CategoryRoute, { model }));
}

describe('CategoryRoute', () => {
  it('renders the category gallery, controls, and show-hidden state', () => {
    const html = renderCategoryRoute();

    expect(html).toContain('data-react-route="categories"');
    expect(html).toContain('>Categories</h1>');
    expect(html).not.toContain('Add Category');
    expect(html).toContain('aria-label="Create category"');
    expect(html).toContain('Group categories by');
    expect(html).toContain('Grid view');
    expect(html).not.toContain('June 2026');
    expect(html).toContain('95.1% of activity');
    expect(html).toContain('Food');
    expect(html).toContain('Old Food');
    expect(html).toContain('checked=""');
  });

  it('renders category row action affordances without delegated attributes', () => {
    const html = renderCategoryRoute();

    expect(html).toContain('aria-label="Edit category"');
    expect(html).toContain('aria-label="Hide category"');
    expect(html).toContain('aria-label="Delete category"');
    expect(html).not.toContain('data-action=');
    expect(html).toContain('category-card is-archived');
  });

  it('renders savings and debt progress as positive signed amounts', () => {
    const model = makeCategoryModel();
    model.categoryRows.push(
      {
        id: 'emergency-fund',
        name: 'Emergency Fund',
        typeTone: 'info',
        typeLabel: 'Savings',
        amountTone: 'good',
        activityLabel: 'Saved',
        transactionCount: 1,
        spent: 300,
        percent: 12,
        isArchived: false
      },
      {
        id: 'card-paydown',
        name: 'Card Paydown',
        typeTone: 'warn',
        typeLabel: 'Debt',
        amountTone: 'good',
        activityLabel: 'Paid down',
        transactionCount: 1,
        spent: 200,
        percent: 8,
        isArchived: false
      }
    );

    const html = renderCategoryRoute(model);
    expect(html).toContain('class="category-card-amount good">+₱300.00</b>');
    expect(html).toContain('Saved · 12% of activity');
    expect(html).toContain('class="category-card-amount good">+₱200.00</b>');
    expect(html).toContain('Paid down · 8% of activity');
  });

  it('renders empty states without fabricating rows', () => {
    const html = renderCategoryRoute({
      currency: 'PHP',
      periodLabel: 'Current workbook',
      showHidden: false,
      spendingRows: [],
      categoryRows: []
    });

    expect(html).toContain('No visible categories');
    expect(html).toContain('Create a category or adjust your filters');
    expect(html).not.toContain('data-action="open-category-editor"');
  });
});

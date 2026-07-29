import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { makeTransactionTableWorkbook } from '@cavalry/finance-core/test-fixtures/transaction-table-scenarios.js';
import { TransactionRoute } from '../../src/renderer/features/transactions/TransactionRoute.jsx';
import { createTransactionControllerState } from '../../src/renderer/features/transactions/transaction-controller.js';
import { buildTransactionFeatureModel } from '../../src/renderer/features/transactions/transaction-model.js';

function makeTransactionModel(overrides = {}) {
  const workbook = makeTransactionTableWorkbook();
  const state = createTransactionControllerState({
    filterOpen: true,
    view: {
      type: 'expense',
      search: '',
      page: 1,
      pageSize: 3,
      sort: { key: 'date', direction: 'desc' },
      ...overrides
    }
  });
  return buildTransactionFeatureModel(workbook, state);
}

function renderTransactionRoute(model = makeTransactionModel()) {
  return renderToStaticMarkup(React.createElement(TransactionRoute, { model }));
}

describe('TransactionRoute', () => {
  it('renders serializable transaction stats, filters, and JSX table cells', () => {
    const html = renderTransactionRoute();

    expect(html).toContain('data-react-route="transactions"');
    expect(html).toContain('Transactions');
    expect(html).toContain('Total Income');
    expect(html).toContain('Total Expenses');
    expect(html).not.toContain('Add Transaction');
    expect(html).toContain('aria-label="Create transaction"');
    expect(html).toContain('Import CSV');
    expect(html).toContain('class="active"');
    expect(html).toContain('ledger-filter-form');
    expect(html).toContain('Archived card fee');
    expect(html).toContain('Missing category');
    expect(html).toContain('class="amount bad transaction-cell"');
    expect(html).not.toContain('inline-edit-cell');
    expect(html).toContain('Minimum date range');
    expect(html).toContain('Maximum amount range');
    expect(html).toContain('transaction-sort-button');
    expect(html).toContain('type="search"');
    expect(html).toContain('Search transactions');
    expect(html).toContain('transaction-search-control');
    expect(html).not.toContain('<th>Type</th>');
    expect(html).not.toContain('<label>Transactions</label>');
    expect(html).not.toContain('mini-icon');
    expect(html).not.toContain('data-inline-transaction-input');
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('keeps income and expense summaries populated when a type tab is active', () => {
    const html = renderTransactionRoute(makeTransactionModel({ type: 'income' }));

    expect(html).toContain('<label>Total Income</label><b>₱50,000.00</b>');
    expect(html).toContain('<label>Total Expenses</label><b>₱1,850.00</b>');
  });

  it('uses the funding account rather than the category posting account in expense details', () => {
    const workbook = makeTransactionTableWorkbook();
    const buildDetail = (transactionId) =>
      buildTransactionFeatureModel(
        workbook,
        createTransactionControllerState({
          view: { type: 'expense', page: 1, pageSize: 20 },
          modal: { type: 'detail', transactionId }
        })
      ).modal;

    expect(buildDetail('txn-coffee')).toMatchObject({
      account: 'Cash',
      accountLabel: 'Paid from',
      category: 'Food',
      movementLabel: 'Paid from Cash',
      beforeLabel: 'Cash balance before',
      beforeBalance: '₱0.00',
      accountChange: '-₱250.00',
      afterLabel: 'Cash balance after',
      afterBalance: '-₱250.00'
    });
    expect(buildDetail('txn-card')).toMatchObject({
      account: 'Credit Card',
      accountLabel: 'Charged to',
      category: 'Shopping',
      movementLabel: 'Charged to Credit Card',
      beforeLabel: 'Balance owed before',
      beforeBalance: '₱0.00',
      accountChange: '+₱1,200.00',
      afterLabel: 'Balance owed after',
      afterBalance: '₱1,200.00',
      afterTone: 'bad'
    });
  });

  it('renders rows and pagination without an action column or delegated attributes', () => {
    const html = renderTransactionRoute(
      makeTransactionModel({
        type: 'all',
        page: 2,
        pageSize: 2
      })
    );

    expect(html).not.toContain('<th class="action-header">Actions</th>');
    expect(html).not.toContain('aria-label="Transaction actions"');
    expect(html).not.toContain('class="action-cell"');
    expect(html).toContain('Page 1');
    expect(html).toContain('Transaction rows per page');
    expect(html).toContain('3-4 of 7');
    expect(html).not.toContain('data-action=');
  });

  it('adds a running balance column when an account is selected', () => {
    const html = renderTransactionRoute(
      makeTransactionModel({
        type: 'all',
        accountId: 'cash'
      })
    );

    expect(html).toContain('Balance after');
    expect(html).toContain('balance-after-cell');
    expect(html).toContain('transaction-table-with-balance');
  });

  it('marks AI-added transactions with a sparkle without highlighting the row', () => {
    const workbook = makeTransactionTableWorkbook();
    workbook.transactions[0].source = 'advisor';
    workbook.transactions[0].reference = 'advisor:companion:salary';
    const state = createTransactionControllerState({
      view: { type: 'all', page: 1, pageSize: 20, sort: { key: 'date', direction: 'asc' } }
    });
    const html = renderTransactionRoute(buildTransactionFeatureModel(workbook, state));

    expect(html).toContain('aria-label="Added by Cavalry"');
    expect(html).toContain('title="Added by Cavalry">✨</span>');
    expect(html).not.toContain('transaction-ai-origin');
    expect(html).not.toContain('transaction-origin-pill');
  });

  it('renders empty transaction state without pagination', () => {
    const html = renderTransactionRoute(
      makeTransactionModel({
        type: 'all',
        search: 'not-present',
        page: 1
      })
    );

    expect(html).toContain('No transactions match this view.');
    expect(html).toContain('aria-label="Create transaction"');
    expect(html).not.toContain('aria-label="View transaction detail"');
    expect(html).not.toContain('table-pagination');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BillsRoute } from '../../src/renderer/features/recurring/BillsRoute.jsx';

function makeRow(overrides = {}) {
  return {
    id: 'recurring-netflix:2026-07-20:0',
    recurringItemId: 'recurring-netflix',
    name: 'Netflix',
    kind: 'subscription',
    categoryId: 'subscriptions',
    dueDate: '2026-07-20',
    dueDateCopy: 'July 20, 2026',
    relativeDateLabel: 'In 5 days',
    amountCopy: 'PHP 549.00',
    status: 'Upcoming',
    tone: 'warn',
    icon: 'movie',
    metaLabel: 'Subscription • Subscriptions • Card • Monthly',
    note: '',
    transaction: null,
    actions: { canPay: true, canEdit: true, canArchive: true, canOpenTransaction: false },
    editorValues: {
      recurringItemId: 'recurring-netflix',
      kind: 'subscription',
      name: 'Netflix',
      categoryId: 'subscriptions',
      accountId: 'card',
      amount: '549',
      currency: 'PHP',
      frequency: 'Monthly',
      dueDate: '2026-07-20',
      autoRenew: true,
      isActive: true,
      note: ''
    },
    ...overrides
  };
}

function makeBillsModel(overrides = {}) {
  const row = makeRow();
  return {
    header: {
      sheetOptions: [
        { value: 'sheet-july', label: 'July 2026' },
        { value: 'sheet-august', label: 'August 2026' }
      ],
      sheetId: 'sheet-july',
      scanIcon: 'manage_search',
      scanLabel: 'Find recurring charges'
    },
    currency: 'PHP',
    today: '2026-07-15',
    summaryPills: [
      {
        tone: 'bad',
        status: 'overdue',
        label: 'Overdue',
        value: 'PHP 2,000.00',
        detail: '1 items'
      },
      {
        tone: 'warn',
        status: 'due',
        label: 'Due Soon',
        value: 'PHP 2,549.00',
        detail: '2 this week'
      },
      { tone: 'good', status: 'paid', label: 'Paid', value: 'PHP 1,699.00', detail: '1 cleared' }
    ],
    periodLabel: 'July 2026',
    rowCount: 1,
    filters: {
      filterKind: 'subscription',
      accountId: 'card',
      categoryId: 'subscriptions',
      status: 'due',
      date: '2026-07-20',
      search: 'netflix',
      sort: 'amount'
    },
    filterOpen: true,
    filterOptions: {
      accounts: [
        { value: '', label: 'All Accounts' },
        { value: 'card', label: 'Card' }
      ],
      categories: [
        { value: '', label: 'All Categories' },
        { value: 'subscriptions', label: 'Subscriptions' }
      ],
      statuses: [
        { value: 'all', label: 'All Statuses' },
        { value: 'due', label: 'Due' }
      ],
      sorts: [
        { value: 'dueDate', label: 'Sort: Due Date' },
        { value: 'amount', label: 'Sort: Amount' }
      ]
    },
    filterChips: ['Search: netflix', 'Due', 'Subscriptions', 'Card'],
    rows: [row],
    hasRows: true,
    pagination: {
      visible: true,
      rowsPerPage: 10,
      totalPages: 3,
      currentPage: 2,
      showingStart: 11,
      showingEnd: 20,
      rowCount: 30
    },
    dueNextGroups: [{ label: 'Later', rows: [row] }],
    recurring: { monthlyCount: 4, monthlyTotalCopy: 'PHP 5,748.00' },
    editorOptions: {
      currency: 'PHP',
      categories: [{ value: 'subscriptions', label: 'Subscriptions' }],
      accounts: [{ value: 'card', label: 'Card' }],
      frequencies: ['Monthly', 'Yearly']
    },
    subscriptionReview: { candidates: [] },
    ...overrides
  };
}

function renderBillsRoute(model = makeBillsModel()) {
  return renderToStaticMarkup(React.createElement(BillsRoute, { model }));
}

describe('BillsRoute', () => {
  it('renders structured bill, filter, status, and due models without HTML islands', () => {
    const html = renderBillsRoute();

    expect(html).toContain('data-react-route="bills"');
    expect(html).toContain('Bills &amp; Subscriptions');
    expect(html).not.toContain('Know what’s due');
    expect(html).toContain('class="bill-search-field"');
    expect(html).toContain('aria-label="Search bills"');
    expect(html).toContain('class="bill-search-submit"');
    expect(html).toContain('bill-filter-panel');
    expect(html).toContain('bill-register-row warn');
    expect(html).toContain('Netflix');
    expect(html).toContain('Post linked transaction');
    expect(html).toContain('bill-due-next-card');
    expect(html).toContain('PHP 5,748.00 monthly equivalent.');
    expect(html).not.toContain('Add Bill / Subscription');
    expect(html).not.toContain('data-action=');
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders pagination and rows-per-page controls', () => {
    const html = renderBillsRoute();

    expect(html).toContain('Showing 11 to 20 of 30 items');
    expect(html).toContain('data-cavalry-icon="chevron_left"');
    expect(html).toContain('data-cavalry-icon="chevron_right"');
    expect(html).toContain('aria-label="Bills rows per page"');
  });

  it('renders serializable empty states when no rows or due items match', () => {
    const html = renderBillsRoute(
      makeBillsModel({
        rows: [],
        hasRows: false,
        rowCount: 0,
        filterOpen: false,
        filterChips: ['All recurring items'],
        pagination: { visible: false },
        dueNextGroups: []
      })
    );

    expect(html).toContain('No bills match this view.');
    expect(html).toContain('No upcoming bills.');
    expect(html).toContain('aria-label="Create bill or subscription"');
    expect(html).not.toContain('bills-table-footer');
  });

  it('renders a visible, stateful recurring-charge finder', () => {
    const html = renderBillsRoute(
      makeBillsModel({
        header: {
          sheetOptions: [],
          sheetId: 'sheet-july',
          scanDisabled: true,
          scanIcon: 'hourglass_top',
          scanLabel: 'Looking · 40%'
        }
      })
    );

    expect(html).toContain('Looking · 40%');
    expect(html).toContain('bills-scan-button');
    expect(html).toContain('disabled');
  });

  it('renders recurring suggestions as review-first cards', () => {
    const html = renderBillsRoute(
      makeBillsModel({
        subscriptionReview: {
          status: 'complete',
          candidates: [
            {
              id: 'candidate-chatgpt',
              name: 'ChatGPT Pro',
              kind: 'subscription',
              amountCopy: 'PHP 6,490.00',
              frequency: 'Monthly',
              transactionCount: 3,
              confidenceLabel: 'Strong pattern'
            }
          ]
        }
      })
    );

    expect(html).toContain('Possible recurring charges');
    expect(html).toContain('ChatGPT Pro');
    expect(html).toContain('Strong pattern');
    expect(html).toContain('>Review</button>');
    expect(html).toContain('Review each suggestion before Cavalry adds anything.');
  });

  it('renders a possible transaction match for review without presenting the item as paid', () => {
    const row = makeRow({
      status: 'Expected charge not recorded',
      relativeDateLabel: 'Expected charge not recorded',
      transaction: null,
      possibleTransaction: {
        id: 'possible-netflix',
        date: '2026-07-20',
        description: 'Netflix',
        amount: 549
      },
      possibleMatchLabel: 'Possible transaction match — review before marking paid',
      metaLabel:
        'Subscription • Subscriptions • Card • Monthly • Possible transaction match — review before marking paid',
      actions: {
        canPay: true,
        canEdit: true,
        canArchive: true,
        canOpenTransaction: false,
        canReviewPossibleTransaction: true
      }
    });
    const html = renderBillsRoute(
      makeBillsModel({ rows: [row], dueNextGroups: [{ label: 'Unrecorded', rows: [row] }] })
    );

    expect(html).toContain('Expected charge not recorded');
    expect(html).toContain('Possible transaction match — review before marking paid');
    expect(html).toContain('aria-label="Review possible matching transaction"');
    expect(html).not.toContain('aria-label="View paid transaction"');
  });

  it('renders an explained candidate with visible confirm, reject, and view actions', () => {
    const row = makeRow({
      status: 'Overdue',
      tone: 'bad',
      relativeDateLabel: '2 days overdue',
      reconciliation: {
        state: 'candidate',
        source: 'scored',
        statusLabel: 'Review match',
        title: 'Likely transaction found',
        detail: '',
        explanation: 'Same merchant, amount, account, and billing date.',
        transaction: {
          id: 'transaction-chatgpt',
          date: '2026-07-14',
          description: 'ChatGPT Pro',
          amountCopy: 'PHP 6,490.00',
          accountName: 'RCBC Credit Card'
        },
        canConfirm: true,
        canReject: true,
        canUndo: false
      }
    });
    const html = renderBillsRoute(makeBillsModel({ rows: [row], dueNextGroups: [] }));

    expect(html).toContain('bill-register-row info has-reconciliation');
    expect(html).toContain('data-reconciliation-state="candidate"');
    expect(html).toContain('status-pill info">Review match');
    expect(html).toContain('Likely transaction found');
    expect(html).toContain('ChatGPT Pro • Jul 14 • PHP 6,490.00 • RCBC Credit Card');
    expect(html).toContain('Same merchant, amount, account, and billing date.');
    expect(html).toContain('>Not this</button>');
    expect(html).toContain('>View</button>');
    expect(html).toContain('>Confirm match</button>');
    expect(html).toContain('2 days overdue');
    expect(html).not.toContain('aria-label="Post linked transaction"');
  });

  it('renders matched and partial reconciliation proof with model-provided status language', () => {
    const matched = makeRow({
      status: 'Overdue',
      tone: 'bad',
      relativeDateLabel: '3 days overdue',
      actions: {
        canPay: false,
        canEdit: true,
        canArchive: true,
        canOpenTransaction: true
      },
      reconciliation: {
        state: 'matched',
        source: 'automatic',
        statusLabel: 'Charged',
        title: 'Matched automatically',
        detail: '',
        explanation: 'Same merchant, amount, account, and billing date.',
        transaction: {
          id: 'transaction-chatgpt',
          date: '2026-07-14',
          description: 'ChatGPT Pro',
          amountCopy: 'PHP 6,490.00',
          accountName: 'RCBC Credit Card'
        },
        canConfirm: false,
        canReject: false,
        canUndo: true
      }
    });
    const partial = makeRow({
      id: 'recurring-rent:2026-07-20:0',
      recurringItemId: 'recurring-rent',
      name: 'Rent',
      status: 'Partial',
      relativeDateLabel: '2 days overdue',
      reconciliation: {
        state: 'partial',
        source: 'confirmed',
        statusLabel: 'Partially paid',
        title: 'Partial payment recorded',
        detail: 'PHP 5,000.00 of PHP 12,000.00',
        explanation: 'PHP 7,000.00 remains.',
        transaction: {
          id: 'transaction-rent-partial',
          date: '2026-07-18',
          description: 'Rent part 1',
          amountCopy: 'PHP 5,000.00',
          accountName: 'Bank'
        },
        canConfirm: false,
        canReject: false,
        canUndo: false
      }
    });
    const html = renderBillsRoute(
      makeBillsModel({ rows: [matched, partial], rowCount: 2, dueNextGroups: [] })
    );

    expect(html).toContain('data-reconciliation-state="matched"');
    expect(html).toContain('status-pill good">Charged');
    expect(html).toContain('Matched automatically');
    expect(html).toContain('ChatGPT Pro • Jul 14 • PHP 6,490.00 • RCBC Credit Card');
    expect(html).toContain('aria-label="View matched transaction"');
    expect(html).toContain('aria-label="Undo matched transaction"');
    expect(html).not.toContain('3 days overdue');
    expect(html).toContain('data-reconciliation-state="partial"');
    expect(html).toContain('status-pill warn">Partially paid');
    expect(html).toContain('2 days overdue');
    expect(html).toContain('Partial payment recorded');
    expect(html).toContain('PHP 7,000.00 remains.');
  });
});

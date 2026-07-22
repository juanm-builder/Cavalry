// Locks read-only route filtering, summary, and pagination before renderer extraction.

import { describe, expect, it } from 'vitest';

import {
  applyBillsFiltersAndSort,
  buildBillsRouteViewModel
} from '@cavalry/finance-core/application/recurring/bills-route-view-model-service.js';

function makeRow(overrides = {}) {
  return Object.assign(
    {
      id: 'row-netflix',
      name: 'Netflix',
      kind: 'subscription',
      category: { id: 'subscriptions', name: 'Subscriptions' },
      categoryId: 'subscriptions',
      accountId: 'card',
      dueDate: '2026-07-05',
      amount: 549,
      frequency: 'Monthly',
      status: 'Upcoming',
      paymentMethod: 'Credit Card',
      note: ''
    },
    overrides
  );
}

describe('Bills route view-model service', () => {
  it('builds route summaries, due-next rows, monthly totals, and pagination without mutating rows', () => {
    const rows = [
      makeRow({
        id: 'row-overdue',
        name: 'Meralco',
        kind: 'bill',
        category: { id: 'utilities', name: 'Utilities' },
        categoryId: 'utilities',
        dueDate: '2026-07-01',
        amount: 2000,
        status: 'Overdue'
      }),
      makeRow({
        id: 'row-due-week',
        name: 'Netflix',
        dueDate: '2026-07-05',
        amount: 549,
        status: 'Upcoming'
      }),
      makeRow({
        id: 'row-later',
        name: 'Gym',
        kind: 'bill',
        category: { id: 'fitness', name: 'Fitness' },
        categoryId: 'fitness',
        dueDate: '2026-07-25',
        amount: 1500,
        status: 'Upcoming'
      }),
      makeRow({
        id: 'row-paid',
        name: 'Internet',
        kind: 'bill',
        dueDate: '2026-07-02',
        amount: 1699,
        status: 'Paid'
      })
    ];
    const before = JSON.stringify(rows);
    const viewModel = buildBillsRouteViewModel(rows, {
      today: '2026-07-01',
      page: 1,
      rowsPerPage: 2
    });

    expect(JSON.stringify(rows)).toBe(before);
    expect(viewModel.summary).toEqual({
      paidCount: 1,
      upcomingCount: 2,
      overdueCount: 1,
      unrecordedCount: 0,
      reviewCount: 0,
      partialCount: 0,
      dueWeekCount: 1,
      totalPaid: 1699,
      totalDueWeek: 549,
      totalOverdue: 2000,
      totalUnrecorded: 0,
      totalReview: 0,
      totalPartial: 0
    });
    expect(viewModel.dueNextRows.map((row) => row.id)).toEqual([
      'row-overdue',
      'row-due-week',
      'row-later'
    ]);
    expect(viewModel.recurring).toEqual({
      monthlyCount: 4,
      monthlyTotal: 5748
    });
    expect(viewModel.pagination).toMatchObject({
      rowsPerPage: 5,
      totalPages: 1,
      currentPage: 1,
      showingStart: 1,
      showingEnd: 4
    });
  });

  it('filters by kind, account, category, status, date, and search', () => {
    const rows = [
      makeRow({
        id: 'row-netflix',
        name: 'Netflix',
        categoryId: 'subscriptions',
        accountId: 'card',
        status: 'Upcoming',
        dueDate: '2026-07-05',
        note: 'Streaming'
      }),
      makeRow({
        id: 'row-rent',
        name: 'Rent',
        kind: 'bill',
        categoryId: 'housing',
        accountId: 'bank',
        status: 'Overdue',
        dueDate: '2026-07-01'
      }),
      makeRow({
        id: 'row-internet',
        name: 'Internet',
        kind: 'bill',
        categoryId: 'utilities',
        accountId: 'bank',
        status: 'Paid',
        dueDate: '2026-07-02'
      })
    ];

    expect(
      buildBillsRouteViewModel(rows, { filterKind: 'subscription' }).rows.map((row) => row.id)
    ).toEqual(['row-netflix']);
    expect(
      buildBillsRouteViewModel(rows, { filterKind: 'bill' }).rows.map((row) => row.id)
    ).toEqual(['row-rent', 'row-internet']);
    expect(buildBillsRouteViewModel(rows, { accountId: 'bank' }).rows.map((row) => row.id)).toEqual(
      ['row-rent', 'row-internet']
    );
    expect(
      buildBillsRouteViewModel(rows, { categoryId: 'utilities' }).rows.map((row) => row.id)
    ).toEqual(['row-internet']);
    expect(buildBillsRouteViewModel(rows, { status: 'due' }).rows.map((row) => row.id)).toEqual([
      'row-rent',
      'row-netflix'
    ]);
    expect(buildBillsRouteViewModel(rows, { status: 'paid' }).rows.map((row) => row.id)).toEqual([
      'row-internet'
    ]);
    expect(
      buildBillsRouteViewModel(rows, { date: '2026-07-01' }).rows.map((row) => row.id)
    ).toEqual(['row-rent']);
    expect(
      buildBillsRouteViewModel(rows, { search: 'streaming' }).rows.map((row) => row.id)
    ).toEqual(['row-netflix']);
  });

  it('preserves current sort options and clamps page metadata', () => {
    const rows = [
      makeRow({
        id: 'row-b',
        name: 'Bravo',
        amount: 300,
        status: 'Paid',
        dueDate: '2026-07-03',
        category: { id: 'z', name: 'Zed' }
      }),
      makeRow({
        id: 'row-a',
        name: 'Alpha',
        amount: 100,
        status: 'Upcoming',
        dueDate: '2026-07-02',
        category: { id: 'a', name: 'Alpha Category' }
      }),
      makeRow({
        id: 'row-c',
        name: 'Charlie',
        amount: 200,
        status: 'Overdue',
        dueDate: '2026-07-01',
        category: { id: 'm', name: 'Middle' }
      }),
      makeRow({
        id: 'row-d',
        name: 'Delta',
        amount: 400,
        status: 'Upcoming',
        dueDate: '2026-07-04',
        category: { id: 'b', name: 'Beta' }
      }),
      makeRow({
        id: 'row-e',
        name: 'Echo',
        amount: 500,
        status: 'Paid',
        dueDate: '2026-07-05',
        category: { id: 'e', name: 'Echo' }
      }),
      makeRow({
        id: 'row-f',
        name: 'Foxtrot',
        amount: 600,
        status: 'Upcoming',
        dueDate: '2026-07-06',
        category: { id: 'f', name: 'Foxtrot' }
      })
    ];

    expect(applyBillsFiltersAndSort(rows, { sort: 'name' }).map((row) => row.id)).toEqual([
      'row-a',
      'row-b',
      'row-c',
      'row-d',
      'row-e',
      'row-f'
    ]);
    expect(applyBillsFiltersAndSort(rows, { sort: 'amount' }).map((row) => row.id)).toEqual([
      'row-f',
      'row-e',
      'row-d',
      'row-b',
      'row-c',
      'row-a'
    ]);
    expect(applyBillsFiltersAndSort(rows, { sort: 'category' }).map((row) => row.id)).toEqual([
      'row-a',
      'row-d',
      'row-e',
      'row-f',
      'row-c',
      'row-b'
    ]);

    const page = buildBillsRouteViewModel(rows, {
      page: 2,
      rowsPerPage: 5
    });

    expect(page.pageRows.map((row) => row.id)).toEqual(['row-f']);
    expect(page.pagination).toMatchObject({
      rowsPerPage: 5,
      totalPages: 2,
      currentPage: 2,
      startIndex: 5,
      showingStart: 6,
      showingEnd: 6
    });
  });

  it('keeps unrecorded expected charges separate from overdue and due-soon totals', () => {
    const rows = [
      makeRow({
        id: 'row-unrecorded',
        dueDate: '2026-07-01',
        amount: 6490,
        status: 'Expected charge not recorded'
      }),
      makeRow({ id: 'row-upcoming', dueDate: '2026-07-05', amount: 549, status: 'Upcoming' })
    ];
    const viewModel = buildBillsRouteViewModel(rows, { today: '2026-07-01' });

    expect(viewModel.summary).toMatchObject({
      overdueCount: 0,
      unrecordedCount: 1,
      dueWeekCount: 1,
      totalOverdue: 0,
      totalUnrecorded: 6490,
      totalDueWeek: 549
    });
    expect(buildBillsRouteViewModel(rows, { status: 'unrecorded' }).rows).toEqual([
      expect.objectContaining({ id: 'row-unrecorded' })
    ]);
    expect(buildBillsRouteViewModel(rows, { status: 'due' }).rows.map((row) => row.id)).toEqual([
      'row-unrecorded',
      'row-upcoming'
    ]);
  });

  it('groups review, partial, and unrecorded rows as attention without double-counting debt', () => {
    const rows = [
      makeRow({ id: 'row-review', amount: 1000, status: 'Review match' }),
      makeRow({
        id: 'row-partial',
        amount: 2000,
        remainingAmount: 750,
        status: 'Partial'
      }),
      makeRow({
        id: 'row-unrecorded',
        amount: 3000,
        status: 'Expected charge not recorded'
      }),
      makeRow({ id: 'row-overdue', amount: 4000, status: 'Overdue' }),
      makeRow({
        id: 'row-statement',
        amount: 5000,
        kind: 'bill',
        status: 'Upcoming',
        category: { id: 'card-payment', name: 'Card Payment', type: 'debt' }
      })
    ];
    const viewModel = buildBillsRouteViewModel(rows, { today: '2026-07-01' });

    expect(
      buildBillsRouteViewModel(rows, { status: 'attention' }).rows.map((row) => row.id)
    ).toEqual(['row-review', 'row-partial', 'row-unrecorded']);
    expect(buildBillsRouteViewModel(rows, { status: 'due' }).rows.map((row) => row.id)).toEqual([
      'row-partial',
      'row-unrecorded',
      'row-overdue',
      'row-statement'
    ]);
    expect(viewModel.summary).toMatchObject({
      reviewCount: 1,
      partialCount: 1,
      unrecordedCount: 1,
      totalReview: 1000,
      totalPartial: 750,
      totalUnrecorded: 3000
    });
    expect(viewModel.recurring).toEqual({ monthlyCount: 4, monthlyTotal: 10000 });
  });

  it('returns stable empty route metadata', () => {
    expect(
      buildBillsRouteViewModel([], {
        filterKind: 'unexpected',
        status: 'bad',
        sort: 'bad',
        page: 10
      })
    ).toMatchObject({
      filters: {
        filterKind: 'all',
        status: 'all',
        sort: 'dueDate'
      },
      rowCount: 0,
      rows: [],
      pageRows: [],
      dueNextRows: [],
      pagination: {
        totalPages: 1,
        currentPage: 1,
        showingStart: 0,
        showingEnd: 0
      }
    });
  });
});

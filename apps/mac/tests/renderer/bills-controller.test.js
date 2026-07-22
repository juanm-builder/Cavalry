import { describe, expect, it, vi } from 'vitest';

import {
  BILLS_ACTIONS,
  createBillsController
} from '../../src/renderer/features/recurring/bills-controller.js';
import {
  buildBillsRouteBaseModel,
  buildBillsRouteModel,
  buildBillsRouteModelFromBase
} from '../../src/renderer/features/recurring/bills-route-model.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

const TODAY = '2026-06-15';

function makeRecurringWorkbook(count = 3) {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.sheets = [
    { id: 'sheet-june', name: 'June', monthIndex: 5, budgets: [], budgetLineItems: [] }
  ];
  workbook.recurringItems = Array.from({ length: count }, (_value, index) => ({
    id: `recurring-${index + 1}`,
    kind: index === 1 ? 'subscription' : 'bill',
    name: index === 1 ? 'Netflix' : `Bill ${index + 1}`,
    categoryId: index === 1 ? 'subscriptions' : 'food',
    accountId: 'bank',
    amount: 100 + index,
    currency: 'PHP',
    frequency: 'Monthly',
    anchorDate: `2026-06-${String(index + 10).padStart(2, '0')}`,
    autoRenew: index === 1,
    isActive: true,
    note: ''
  }));
  workbook.transactions.push({
    id: 'paid-recurring-one',
    date: '2026-06-10',
    monthKey: '2026-06',
    template: 'expense_paid',
    description: 'Bill 1',
    categoryId: 'food',
    recurringItemId: 'recurring-1',
    amount: 100,
    baseAmount: 100,
    originalCurrency: 'PHP',
    lines: [
      { accountId: 'food-expense', direction: 'debit', amount: 100, baseAmount: 100 },
      { accountId: 'bank', direction: 'credit', amount: 100, baseAmount: 100 }
    ]
  });
  return workbook;
}

describe('bills route model', () => {
  it('derives deterministic paid, overdue, upcoming, filter, sort, and due views', () => {
    const workbook = makeRecurringWorkbook();
    const original = cloneFixture(workbook);
    const model = buildBillsRouteModel(workbook, { sheetId: 'sheet-june' }, { currentDate: TODAY });

    expect(model.rows.map((row) => [row.name, row.status])).toEqual([
      ['Bill 1', 'Paid'],
      ['Netflix', 'Expected charge not recorded'],
      ['Bill 3', 'Overdue']
    ]);
    expect(model.summaryPills.map((pill) => pill.status)).toEqual([
      'attention',
      'overdue',
      'due',
      'paid'
    ]);
    expect(model.dueNextGroups.map((group) => group.label)).toEqual(['Overdue', 'Unrecorded']);
    expect(model.filterOptions.categories.some((option) => option.value === 'subscriptions')).toBe(
      true
    );
    expect(model).not.toHaveProperty('registerRowsHtml');
    expect(model).not.toHaveProperty('filterPanelHtml');
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    expect(workbook).toEqual(original);
  });

  it('automatically reconciles a unique high-confidence transaction', () => {
    const workbook = makeRecurringWorkbook();
    workbook.transactions.push({
      id: 'possible-netflix-payment',
      date: '2026-06-11',
      monthKey: '2026-06',
      template: 'expense_paid',
      description: 'Netflix',
      categoryId: 'subscriptions',
      amount: 101,
      baseAmount: 101,
      originalCurrency: 'PHP',
      lines: [
        {
          accountId: 'subscriptions-expense',
          direction: 'debit',
          amount: 101,
          baseAmount: 101
        },
        { accountId: 'bank', direction: 'credit', amount: 101, baseAmount: 101 }
      ]
    });

    const model = buildBillsRouteModel(workbook, { sheetId: 'sheet-june' }, { currentDate: TODAY });
    const netflix = model.rows.find((row) => row.recurringItemId === 'recurring-2');

    expect(netflix).toMatchObject({
      status: 'Paid',
      transaction: { id: 'possible-netflix-payment' },
      possibleTransaction: null,
      reconciliation: {
        state: 'matched',
        source: 'automatic',
        statusLabel: 'Paid',
        canUndo: true
      },
      actions: {
        canPay: false,
        canOpenTransaction: true,
        canReviewPossibleTransaction: false
      }
    });
  });

  it('holds a plausible but lower-confidence transaction for explicit review', () => {
    const workbook = makeRecurringWorkbook();
    workbook.transactions.push({
      id: 'possible-netflix-payment',
      date: '2026-06-11',
      monthKey: '2026-06',
      template: 'expense_paid',
      description: 'Streaming service',
      categoryId: 'subscriptions',
      amount: 101,
      baseAmount: 101,
      originalCurrency: 'PHP',
      lines: [
        {
          accountId: 'subscriptions-expense',
          direction: 'debit',
          amount: 101,
          baseAmount: 101
        },
        { accountId: 'bank', direction: 'credit', amount: 101, baseAmount: 101 }
      ]
    });

    const model = buildBillsRouteModel(workbook, { sheetId: 'sheet-june' }, { currentDate: TODAY });
    const netflix = model.rows.find((row) => row.recurringItemId === 'recurring-2');

    expect(netflix).toMatchObject({
      status: 'Review match',
      transaction: null,
      possibleTransaction: { id: 'possible-netflix-payment' },
      reconciliation: {
        state: 'candidate',
        statusLabel: 'Review match',
        canConfirm: true,
        canReject: true
      },
      actions: {
        canPay: false,
        canOpenTransaction: false,
        canReviewPossibleTransaction: true
      }
    });
  });

  it('reconciles a card statement against an asset-to-liability payment without treating it as expense', () => {
    const workbook = makeRecurringWorkbook(0);
    workbook.accounts.push({
      id: 'rcbc-card',
      name: 'RCBC Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      currency: 'PHP',
      isActive: true
    });
    workbook.categories.push({
      id: 'card-payment',
      name: 'Credit Card Payment',
      type: 'debt',
      currency: 'PHP',
      isActive: true
    });
    workbook.recurringItems.push({
      id: 'recurring-rcbc-statement',
      kind: 'bill',
      name: 'RCBC statement',
      categoryId: 'card-payment',
      accountId: 'rcbc-card',
      amount: 10000,
      currency: 'PHP',
      frequency: 'Monthly',
      anchorDate: '2026-06-15',
      isActive: true
    });
    workbook.transactions.push({
      id: 'rcbc-statement-payment',
      date: '2026-06-15',
      template: 'transfer',
      description: 'RCBC statement',
      amount: 10000,
      baseAmount: 10000,
      originalCurrency: 'PHP',
      lines: [
        { accountId: 'rcbc-card', direction: 'debit', amount: 10000, baseAmount: 10000 },
        { accountId: 'bank', direction: 'credit', amount: 10000, baseAmount: 10000 }
      ]
    });

    const model = buildBillsRouteModel(workbook, { sheetId: 'sheet-june' }, { currentDate: TODAY });
    const statement = model.rows.find((row) => row.recurringItemId === 'recurring-rcbc-statement');

    expect(statement).toMatchObject({
      status: 'Paid',
      paymentTemplate: 'transfer',
      expectedTransactionKind: 'liability_payment',
      transaction: { id: 'rcbc-statement-payment' },
      reconciliation: {
        state: 'matched',
        statusLabel: 'Settled'
      }
    });
    expect(model.filterOptions.categories).toContainEqual(
      expect.objectContaining({ value: 'card-payment', type: 'debt' })
    );
  });

  it('reconciles a payment posted across a calendar-month boundary', () => {
    const workbook = makeRecurringWorkbook(1);
    workbook.recurringItems[0].anchorDate = '2026-06-30';
    workbook.transactions = [
      {
        id: 'july-posted-bill',
        date: '2026-07-01',
        template: 'expense_paid',
        description: 'Bill 1',
        categoryId: 'food',
        amount: 100,
        baseAmount: 100,
        originalCurrency: 'PHP',
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 100, baseAmount: 100 },
          { accountId: 'bank', direction: 'credit', amount: 100, baseAmount: 100 }
        ]
      }
    ];

    const model = buildBillsRouteModel(
      workbook,
      { sheetId: 'sheet-june' },
      { currentDate: '2026-07-02' }
    );

    expect(model.rows[0]).toMatchObject({
      dueDate: '2026-06-30',
      status: 'Paid',
      transaction: { id: 'july-posted-bill', date: '2026-07-01' },
      reconciliation: { state: 'matched', source: 'automatic' }
    });
  });

  it('does not reuse one transaction for weekly occurrences across month views', () => {
    const workbook = makeRecurringWorkbook(1);
    workbook.sheets.push({
      id: 'sheet-july',
      name: 'July',
      monthIndex: 6,
      budgets: [],
      budgetLineItems: []
    });
    workbook.recurringItems[0] = {
      ...workbook.recurringItems[0],
      frequency: 'Weekly',
      anchorDate: '2026-06-30'
    };
    workbook.transactions = [
      {
        id: 'weekly-month-edge',
        date: '2026-07-01',
        template: 'expense_paid',
        description: 'Bill 1',
        categoryId: 'food',
        amount: 100,
        baseAmount: 100,
        originalCurrency: 'PHP',
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 100, baseAmount: 100 },
          { accountId: 'bank', direction: 'credit', amount: 100, baseAmount: 100 }
        ]
      }
    ];

    const june = buildBillsRouteModel(
      workbook,
      { sheetId: 'sheet-june' },
      { currentDate: '2026-07-08' }
    );
    const july = buildBillsRouteModel(
      workbook,
      { sheetId: 'sheet-july' },
      { currentDate: '2026-07-08' }
    );

    expect(june.rows.some((row) => row.status === 'Paid')).toBe(false);
    expect(july.rows.some((row) => row.status === 'Paid')).toBe(false);
    expect(june.rows[0]).toMatchObject({
      status: 'Review match',
      possibleTransaction: { id: 'weekly-month-edge' }
    });
    expect(july.rows[0]).toMatchObject({
      status: 'Review match',
      possibleTransaction: { id: 'weekly-month-edge' }
    });
  });

  it('suppresses a matched transaction after undo and keeps that decision across rebuilds', () => {
    const workbook = makeRecurringWorkbook(1);
    const automatic = buildBillsRouteModel(
      workbook,
      { sheetId: 'sheet-june' },
      { currentDate: TODAY }
    );
    const matchedRow = automatic.rows[0];
    expect(matchedRow.reconciliation).toMatchObject({
      state: 'matched',
      source: 'legacy',
      transaction: { id: 'paid-recurring-one' }
    });

    const controller = createBillsController({ currentDate: TODAY });
    const undone = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.undoMatch,
      payload: {
        recurringItemId: matchedRow.recurringItemId,
        occurrenceDate: matchedRow.dueDate,
        transactionId: matchedRow.reconciliation.transaction.id
      }
    });
    const rebuilt = buildBillsRouteModel(
      undone.workbook,
      { sheetId: 'sheet-june' },
      { currentDate: TODAY }
    );

    expect(rebuilt.rows[0]).toMatchObject({
      status: 'Overdue',
      transaction: null,
      possibleTransaction: null,
      reconciliation: { state: 'unmatched' }
    });
  });

  it('keeps an existing same-tracker transaction reconciled after the due date moves', () => {
    const workbook = makeRecurringWorkbook(1);
    workbook.transactions[workbook.transactions.length - 1].recurringOccurrenceDate = '2026-06-10';
    workbook.recurringReconciliations = [
      {
        id: 'old-bill-one-occurrence',
        recurringItemId: 'recurring-1',
        occurrenceDate: '2026-06-10',
        transactionId: 'paid-recurring-one',
        decision: 'matched',
        method: 'explicit',
        allocatedBaseAmount: 100,
        confidence: 100
      }
    ];
    const controller = createBillsController({ currentDate: TODAY });

    const updated = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload: {
        recurringItemId: 'recurring-1',
        kind: 'bill',
        name: 'Bill 1',
        categoryId: 'food',
        accountId: 'bank',
        amount: 100,
        currency: 'PHP',
        frequency: 'Monthly',
        dueDate: '2026-06-11',
        autoRenew: false,
        isActive: true,
        note: ''
      }
    });
    const rebuilt = buildBillsRouteModel(
      updated.workbook,
      { sheetId: 'sheet-june' },
      { currentDate: TODAY }
    );

    expect(updated.ok).toBe(true);
    expect(rebuilt.rows[0]).toMatchObject({
      dueDate: '2026-06-11',
      status: 'Paid',
      transaction: { id: 'paid-recurring-one' },
      reconciliation: { state: 'matched', source: 'legacy' }
    });
  });

  it('prefills only the remaining native amount for a partial foreign-currency bill', () => {
    const workbook = makeRecurringWorkbook(1);
    workbook.fxRates = [{ fromCurrency: 'EUR', toCurrency: 'PHP', rate: 60 }];
    workbook.recurringItems[0] = {
      ...workbook.recurringItems[0],
      amount: 20,
      currency: 'EUR'
    };
    const transactionIndex = workbook.transactions.findIndex(
      (transaction) => transaction.id === 'paid-recurring-one'
    );
    workbook.transactions[transactionIndex] = {
      ...workbook.transactions[transactionIndex],
      amount: 600,
      baseAmount: 600,
      originalCurrency: 'PHP',
      lines: workbook.transactions[transactionIndex].lines.map((line) => ({
        ...line,
        amount: 600,
        baseAmount: 600
      }))
    };
    workbook.recurringReconciliations = [
      {
        id: 'partial-bill-one',
        recurringItemId: 'recurring-1',
        occurrenceDate: '2026-06-10',
        transactionId: 'paid-recurring-one',
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 600,
        confidence: 100
      }
    ];

    const model = buildBillsRouteModel(workbook, { sheetId: 'sheet-june' }, { currentDate: TODAY });

    expect(model.rows[0]).toMatchObject({
      amount: 1200,
      currency: 'EUR',
      remainingAmount: 600,
      paymentAmount: 10,
      reconciliation: { state: 'partial', canUndo: true },
      actions: { canPay: true, canOpenTransaction: true }
    });
  });

  it('offers an existing second payment for review instead of prompting duplicate entry', () => {
    const workbook = makeRecurringWorkbook(1);
    workbook.transactions.push({
      id: 'bill-one-remainder',
      date: '2026-06-10',
      template: 'expense_paid',
      description: 'Bill 1',
      categoryId: 'food',
      amount: 40,
      baseAmount: 40,
      originalCurrency: 'PHP',
      lines: [
        { accountId: 'food-expense', direction: 'debit', amount: 40, baseAmount: 40 },
        { accountId: 'bank', direction: 'credit', amount: 40, baseAmount: 40 }
      ]
    });
    workbook.recurringReconciliations = [
      {
        id: 'bill-one-partial',
        recurringItemId: 'recurring-1',
        occurrenceDate: '2026-06-10',
        transactionId: 'paid-recurring-one',
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 60,
        confidence: 100
      }
    ];

    const model = buildBillsRouteModel(workbook, { sheetId: 'sheet-june' }, { currentDate: TODAY });

    expect(model.rows[0]).toMatchObject({
      status: 'Partial',
      possibleTransaction: { id: 'bill-one-remainder' },
      reconciliation: {
        state: 'partial',
        pendingCandidate: {
          state: 'candidate',
          transaction: { id: 'bill-one-remainder' },
          canConfirm: true,
          canReject: true
        }
      },
      actions: { canPay: false, canReviewPossibleTransaction: true }
    });
  });

  it('applies search, sorting, and pagination through the finance-core model', () => {
    const workbook = makeRecurringWorkbook(12);
    const page = buildBillsRouteModel(
      workbook,
      {
        sheetId: 'sheet-june',
        sort: 'amount',
        page: 2,
        rowsPerPage: 5
      },
      { clock: { today: () => TODAY } }
    );
    const search = buildBillsRouteModel(
      workbook,
      {
        sheetId: 'sheet-june',
        search: 'netflix'
      },
      { currentDate: TODAY }
    );

    expect(page.rowCount).toBe(12);
    expect(page.rows).toHaveLength(5);
    expect(page.pagination).toMatchObject({ currentPage: 2, rowsPerPage: 5, totalPages: 3 });
    expect(search.rows.map((row) => row.name)).toEqual(['Netflix']);
    expect(search.filterChips).toEqual(['Search: netflix']);
  });
});

describe('bills controller', () => {
  it('reuses reconciled base rows for filter, sort, and page-only changes', () => {
    const workbook = makeRecurringWorkbook(12);
    const buildBaseModel = vi.fn(buildBillsRouteBaseModel);
    const buildModelFromBase = vi.fn(buildBillsRouteModelFromBase);
    const controller = createBillsController({
      currentDate: TODAY,
      buildBaseModel,
      buildModelFromBase
    });

    const first = controller.buildModel(workbook, {
      sheetId: 'sheet-june',
      page: 1,
      rowsPerPage: 5
    });
    const filtered = controller.buildModel(workbook, {
      sheetId: 'sheet-june',
      search: 'netflix',
      sort: 'amount',
      page: 2,
      rowsPerPage: 5
    });

    expect(buildBaseModel).toHaveBeenCalledTimes(1);
    expect(buildModelFromBase).toHaveBeenCalledTimes(2);
    expect(first.rowCount).toBe(12);
    expect(filtered.rows.map((row) => row.name)).toEqual(['Netflix']);
  });

  it('confirms, rejects, and undoes occurrence matches with persisted decisions', () => {
    const workbook = makeRecurringWorkbook();
    const original = cloneFixture(workbook);
    const transactionId = workbook.transactions.find(
      (transaction) => transaction.id === 'paid-recurring-one'
    ).id;
    const controller = createBillsController({
      currentDate: TODAY,
      createId: () => 'reconciliation-one',
      clock: { now: () => '2026-06-15T08:00:00.000Z' }
    });
    const payload = {
      rowId: 'recurring-1:2026-06-10:0',
      recurringItemId: 'recurring-1',
      occurrenceDate: '2026-06-10',
      transactionId
    };

    const confirmed = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.confirmMatch,
      payload
    });

    expect(confirmed.ok).toBe(true);
    expect(confirmed.workbook).not.toBe(workbook);
    expect(confirmed.workbook.recurringReconciliations).toEqual([
      expect.objectContaining({
        id: 'reconciliation-one',
        recurringItemId: 'recurring-1',
        occurrenceDate: '2026-06-10',
        transactionId,
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 100
      })
    ]);

    const rejected = controller.handleAction(confirmed.workbook, {
      type: BILLS_ACTIONS.undoMatch,
      payload
    });
    expect(rejected.workbook.recurringReconciliations).toEqual([
      expect.objectContaining({ decision: 'rejected', allocatedBaseAmount: 0 })
    ]);

    const explicitlyRejected = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.rejectMatch,
      payload
    });
    expect(explicitlyRejected.workbook.recurringReconciliations[0]).toMatchObject({
      decision: 'rejected',
      transactionId
    });
    expect(workbook).toEqual(original);
  });

  it('creates, updates, and archives recurring items with new workbook identity', () => {
    const workbook = makeRecurringWorkbook();
    const original = cloneFixture(workbook);
    const controller = createBillsController({
      currentDate: TODAY,
      createId: () => 'recurring-new'
    });
    const payload = {
      kind: 'subscription',
      name: 'Phone Plan',
      categoryId: 'subscriptions',
      accountId: 'bank',
      amount: 599,
      currency: 'PHP',
      frequency: 'Monthly',
      dueDate: '2026-06-20',
      autoRenew: true,
      isActive: true,
      note: 'Family plan'
    };

    const created = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload
    });
    expect(created.ok).toBe(true);
    expect(created.workbook).not.toBe(workbook);
    expect(created.workbook.recurringItems.at(-1)).toMatchObject({
      id: 'recurring-new',
      name: 'Phone Plan',
      autoRenew: true
    });

    const updated = controller.handleAction(created.workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload: { ...payload, recurringItemId: 'recurring-new', amount: 699 }
    });
    expect(updated.workbook).not.toBe(created.workbook);
    expect(updated.workbook.recurringItems.find((item) => item.id === 'recurring-new').amount).toBe(
      699
    );

    const archived = controller.handleAction(updated.workbook, {
      type: BILLS_ACTIONS.archiveRecurring,
      payload: { recurringItemId: 'recurring-new' }
    });
    expect(archived.workbook).not.toBe(updated.workbook);
    expect(
      archived.workbook.recurringItems.find((item) => item.id === 'recurring-new').isActive
    ).toBe(false);
    expect(workbook).toEqual(original);
  });

  it('creates liability-settlement bills but rejects debt subscriptions or asset targets', () => {
    const workbook = makeRecurringWorkbook();
    workbook.accounts.push({
      id: 'rcbc-card',
      name: 'RCBC Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      currency: 'PHP',
      isActive: true
    });
    workbook.categories.push({
      id: 'card-payment',
      name: 'Credit Card Payment',
      type: 'debt',
      currency: 'PHP',
      isActive: true
    });
    const controller = createBillsController({
      currentDate: TODAY,
      createId: () => 'recurring-card-statement'
    });
    const payload = {
      kind: 'bill',
      name: 'RCBC statement',
      categoryId: 'card-payment',
      accountId: 'rcbc-card',
      amount: 10000,
      currency: 'PHP',
      frequency: 'Monthly',
      dueDate: '2026-06-15',
      isActive: true
    };

    const created = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload
    });
    const subscription = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload: { ...payload, kind: 'subscription' }
    });
    const wrongAccount = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload: { ...payload, accountId: 'bank' }
    });

    expect(created.ok).toBe(true);
    expect(created.workbook.recurringItems.at(-1)).toMatchObject({
      id: 'recurring-card-statement',
      categoryId: 'card-payment',
      accountId: 'rcbc-card'
    });
    expect(subscription.errors[0].code).toBe('recurring.debt-subscription-invalid');
    expect(wrongAccount.errors[0].code).toBe('recurring.liability-account-required');
  });

  it('emits filter/view and injected scan intents without mutating the workbook', () => {
    const workbook = makeRecurringWorkbook();
    const advisorIntent = vi.fn((operation, payload) => ({
      type: 'test/advisor',
      payload: { operation, ...payload }
    }));
    const controller = createBillsController({ currentDate: TODAY, advisorIntent });

    const filtered = controller.handleAction(
      workbook,
      {
        type: 'apply-bills-filter',
        payload: { search: 'netflix', status: 'due', categoryId: 'subscriptions' }
      },
      { viewState: {} }
    );
    expect(filtered.workbook).toBe(workbook);
    expect(filtered.events[0]).toEqual({
      type: 'bills/view-state-change-requested',
      payload: {
        patch: {
          accountId: '',
          categoryId: 'subscriptions',
          status: 'due',
          date: '',
          search: 'netflix',
          page: 1
        }
      }
    });

    const scan = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.scan,
      payload: { sheetId: 'sheet-june', includeIgnored: true }
    });
    expect(scan.workbook).toBe(workbook);
    expect(scan.events[0]).toEqual({
      type: 'test/advisor',
      payload: {
        operation: 'recurring-scan',
        workbookId: workbook.id,
        sheetId: 'sheet-june',
        includeIgnored: true
      }
    });
  });

  it('returns validation failures without replacing the workbook', () => {
    const workbook = makeRecurringWorkbook();
    const controller = createBillsController({ currentDate: TODAY });
    const result = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload: { name: '', amount: -1 }
    });

    expect(result).toMatchObject({
      ok: false,
      workbook,
      events: [],
      errors: [{ code: 'recurring.name-required' }]
    });
  });

  it('rejects a recurring tracker without an active expense category', () => {
    const workbook = makeRecurringWorkbook();
    const controller = createBillsController({ currentDate: TODAY });
    const result = controller.handleAction(workbook, {
      type: BILLS_ACTIONS.saveRecurring,
      payload: {
        kind: 'subscription',
        name: 'ChatGPT Pro',
        amount: 6490,
        currency: 'PHP',
        frequency: 'Monthly',
        dueDate: '2026-06-14',
        autoRenew: true
      }
    });

    expect(result).toMatchObject({
      ok: false,
      workbook,
      errors: [{ code: 'recurring.category-invalid' }]
    });
  });
});

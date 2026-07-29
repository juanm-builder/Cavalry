import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppRouter } from '../../src/renderer/app/AppRouter.jsx';
import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { AccountRoute } from '../../src/renderer/features/accounts/AccountRoute.jsx';
import { DashboardRoute } from '../../src/renderer/features/dashboard/DashboardRoute.jsx';
import { ImportPreviewModal } from '../../src/renderer/features/import-export/ImportPreviewModal.jsx';
import { BillsRoute } from '../../src/renderer/features/recurring/BillsRoute.jsx';
import { SettingsRoute } from '../../src/renderer/features/settings/SettingsRoute.jsx';

function makeWorkbook() {
  return {
    id: 'workbook-actions',
    version: 2,
    name: 'Action Tests',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [],
    categories: [],
    transactions: [],
    sheets: []
  };
}

function makeBudgetModel() {
  return {
    currency: 'PHP',
    periodLabel: 'June 2026',
    range: { start: '2026-06-01', end: '2026-06-30' },
    sheet: { id: 'sheet-june' },
    summary: {},
    categoryRows: [],
    spendingRows: []
  };
}

function makeBillsModel(overrides = {}) {
  return {
    header: {
      sheetId: 'sheet-june',
      sheetOptions: [
        { value: 'sheet-june', label: 'June 2026' },
        { value: 'sheet-july', label: 'July 2026' }
      ],
      scanLabel: 'Scan Transactions',
      scanDisabled: false
    },
    filters: {
      filterKind: 'all',
      search: '',
      sort: 'dueDate'
    },
    sortOptions: [
      { value: 'dueDate', label: 'Due date' },
      { value: 'name', label: 'Name' }
    ],
    summaryPills: [
      { status: 'overdue', tone: 'bad', label: 'Overdue', value: '1', detail: 'Needs attention' }
    ],
    filterOpen: false,
    hasRows: false,
    rowCount: 0,
    pagination: {
      visible: true,
      currentPage: 1,
      totalPages: 3,
      showingStart: 1,
      showingEnd: 10,
      rowCount: 25,
      rowsPerPage: 10
    },
    ...overrides
  };
}

function makeBillRow(overrides = {}) {
  return {
    id: 'recurring-chatgpt:2026-07-14:0',
    recurringItemId: 'recurring-chatgpt',
    name: 'ChatGPT Pro',
    kind: 'subscription',
    categoryId: 'subscriptions',
    accountId: 'rcbc-card',
    amount: 6490,
    amountCopy: 'PHP 6,490.00',
    currency: 'PHP',
    dueDate: '2026-07-14',
    dueDateCopy: 'July 14, 2026',
    relativeDateLabel: '2 days overdue',
    status: 'Overdue',
    tone: 'bad',
    icon: 'sync',
    metaLabel: 'Subscription • Subscriptions • RCBC Credit Card • Monthly',
    note: '',
    transaction: null,
    actions: {
      canPay: true,
      canEdit: true,
      canArchive: true,
      canOpenTransaction: false
    },
    ...overrides
  };
}

describe('feature action callbacks', () => {
  it('forwards AppRouter actions without exposing DOM events', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <AppRouter
        routeId="accounts"
        routeModels={{ accounts: { summary: {}, accountRows: [], selectedAccount: null } }}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: /^Create account/ }));

    expect(onAction).toHaveBeenCalledWith({
      type: 'open-account-create',
      payload: {}
    });
  });

  it('opens the selected account transactions from Accounts', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <AccountRoute
        model={{
          summary: {},
          accountRows: [],
          selectedAccount: {
            id: 'bank',
            name: 'Bank',
            typeLabel: 'Asset Account',
            institution: 'Bank',
            balanceCopy: 'PHP 100.00',
            historyRows: []
          }
        }}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Transactions' }));

    expect(onAction).toHaveBeenCalledWith({
      type: 'open-account-transactions',
      payload: { accountId: 'bank' }
    });
  });

  it('captures composite dashboard drilldown payloads', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <DashboardRoute
        onAction={onAction}
        model={{
          currency: 'PHP',
          periodLabel: 'June 2026',
          range: { start: '2026-06-01', end: '2026-06-30' },
          layout: [{ id: 'flows', visible: true }],
          monthlyFlow: {
            maxFlowAmount: 1000,
            rows: [
              {
                id: 'sheet-june',
                monthKey: '2026-06',
                monthLabel: 'June',
                range: { start: '2026-06-01', end: '2026-06-30' },
                totals: { income: 1000, outflow: 250 },
                transactions: [
                  {
                    id: 'salary-transaction',
                    date: '2026-06-15',
                    description: 'Salary',
                    categoryId: 'salary',
                    baseAmount: 1000,
                    flowKind: 'inflow'
                  }
                ]
              }
            ]
          },
          spendingSummary: {
            rows: [
              {
                category: { id: 'food', name: 'Food' },
                total: 250,
                transactions: [
                  {
                    id: 'food-transaction',
                    date: '2026-06-16',
                    description: 'Lunch',
                    categoryId: 'food',
                    baseAmount: 250,
                    flowKind: 'expense'
                  }
                ]
              }
            ]
          },
          categoryLookup: {
            food: { id: 'food', name: 'Food', type: 'expense' },
            salary: { id: 'salary', name: 'Salary', type: 'income' }
          }
        }}
      />
    );

    const juneInflows = screen.getByRole('button', { name: 'June inflows' });
    await user.hover(juneInflows);
    expect(screen.getByText('Salary')).not.toBeNull();
    await user.click(juneInflows);
    expect(screen.getByRole('dialog', { name: 'June inflows transaction summary' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'View full details' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'open-transaction-detail',
      payload: { transactionId: 'salary-transaction' }
    });
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);

    await user.click(screen.getByRole('button', { name: /Food/ }));
    expect(
      screen.getByRole('dialog', { name: 'Food spending transaction summary' })
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'View full details' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'open-transaction-detail',
      payload: { transactionId: 'food-transaction' }
    });

    expect(screen.getByText('Yearly')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next average period' }));
    expect(screen.getByText('Monthly')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next average period' }));
    expect(screen.getByText('Weekly')).not.toBeNull();
    expect(screen.getByText('Average spending per year')).not.toBeNull();
    expect(screen.getByText('Average spending per month')).not.toBeNull();
    expect(screen.getByText('Average spending per week')).not.toBeNull();
  });

  it('changes Money Timeline points with the dashboard average period', async () => {
    const user = userEvent.setup();
    const makeRow = (id, label, shortLabel, range, monthKey = '') => ({
      id,
      periodKey: id,
      label,
      shortLabel,
      monthKey,
      range,
      totals: { income: 100, outflow: 40, actualNet: 60 }
    });
    render(
      <DashboardRoute
        model={{
          currency: 'PHP',
          periodLabel: 'July 2026',
          layout: [{ id: 'flows', visible: true }],
          timeline: {
            series: {
              weekly: [
                makeRow('week-mon', 'Monday, Jul 6', 'Mon', {
                  start: '2026-07-06',
                  end: '2026-07-06'
                })
              ],
              monthly: [
                makeRow('month-day-1', 'Wednesday, Jul 1', '1', {
                  start: '2026-07-01',
                  end: '2026-07-01'
                })
              ],
              yearly: [
                makeRow(
                  'year-jan',
                  'January',
                  'Jan',
                  { start: '2026-01-01', end: '2026-01-31' },
                  '2026-01'
                )
              ]
            }
          },
          spendingSummary: { rows: [] }
        }}
      />
    );

    expect(screen.getByRole('button', { name: 'January inflows' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next average period' }));
    expect(screen.getByRole('button', { name: 'Wednesday, Jul 1 inflows' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next average period' }));
    expect(screen.getByRole('button', { name: 'Monday, Jul 6 inflows' })).not.toBeNull();
  });

  it('captures checkbox and select values as serializable payloads', async () => {
    const user = userEvent.setup();
    const accountAction = vi.fn();
    const { unmount } = render(
      <AccountRoute
        onAction={accountAction}
        model={{ summary: {}, accountRows: [], selectedAccount: null, showArchived: false }}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Active only' }));
    expect(accountAction).toHaveBeenCalledWith({
      type: 'toggle-archived-accounts',
      payload: { checked: false }
    });
    unmount();

    const billsAction = vi.fn();
    render(<BillsRoute onAction={billsAction} model={makeBillsModel()} />);
    await user.selectOptions(screen.getByLabelText('Bills month'), 'sheet-july');
    expect(billsAction).toHaveBeenLastCalledWith({
      type: 'set-bills-sheet',
      payload: { value: 'sheet-july' }
    });
    await user.selectOptions(screen.getByLabelText('Bills rows per page'), '25');
    expect(billsAction).toHaveBeenLastCalledWith({
      type: 'set-bills-rows-per-page',
      payload: { value: 25 }
    });
    await user.click(screen.getByRole('button', { name: /Overdue/ }));
    expect(billsAction).toHaveBeenLastCalledWith({
      type: 'set-bills-status',
      payload: { billsStatus: 'overdue' }
    });
  });

  it('emits serializable reconciliation review and undo payloads', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const transaction = {
      id: 'transaction-chatgpt',
      date: '2026-07-14',
      description: 'ChatGPT Pro',
      amountCopy: 'PHP 6,490.00',
      accountName: 'RCBC Credit Card'
    };
    const candidate = makeBillRow({
      reconciliation: {
        state: 'candidate',
        source: 'scored',
        statusLabel: 'Review match',
        title: 'Likely transaction found',
        detail: 'ChatGPT Pro • Jul 14 • PHP 6,490.00 • RCBC Credit Card',
        explanation: 'Same merchant, amount, account, and billing date.',
        transaction,
        canConfirm: true,
        canReject: true,
        canUndo: false
      }
    });
    const rendered = render(
      <BillsRoute onAction={onAction} model={makeBillsModel({ rows: [candidate], rowCount: 1 })} />
    );
    const matchPayload = {
      rowId: 'recurring-chatgpt:2026-07-14:0',
      recurringItemId: 'recurring-chatgpt',
      occurrenceDate: '2026-07-14',
      transactionId: 'transaction-chatgpt'
    };

    await user.click(screen.getByRole('button', { name: 'Not this' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'reject-recurring-transaction-match',
      payload: matchPayload
    });
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'open-transaction-detail',
      payload: { transactionId: 'transaction-chatgpt' }
    });
    await user.click(screen.getByRole('button', { name: 'Confirm match' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'confirm-recurring-transaction-match',
      payload: matchPayload
    });

    const matched = makeBillRow({
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
        detail: 'ChatGPT Pro • Jul 14 • PHP 6,490.00 • RCBC Credit Card',
        explanation: 'Same merchant, amount, account, and billing date.',
        transaction,
        canConfirm: false,
        canReject: false,
        canUndo: true
      }
    });
    rendered.rerender(
      <BillsRoute onAction={onAction} model={makeBillsModel({ rows: [matched], rowCount: 1 })} />
    );
    await user.click(rendered.container.querySelector('summary[aria-label="Bill actions"]'));
    await user.click(screen.getByRole('button', { name: 'Undo matched transaction' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'undo-recurring-transaction-match',
      payload: matchPayload
    });
  });

  it('preserves the complete bill payment preset when opening the transaction composer', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const debtPayment = makeBillRow({
      id: 'recurring-card-statement:2026-07-25:0',
      recurringItemId: 'recurring-card-statement',
      name: 'RCBC Card Statement',
      categoryId: 'card-payment',
      accountId: 'rcbc-card',
      fundingAccountId: 'bpi-bank',
      amount: 12000,
      currency: 'PHP',
      dueDate: '2026-07-25',
      expectedTransactionKind: 'liability_payment',
      paymentTemplate: 'transfer'
    });
    const rendered = render(
      <BillsRoute
        onAction={onAction}
        model={makeBillsModel({ rows: [debtPayment], rowCount: 1 })}
      />
    );

    await user.click(rendered.container.querySelector('summary[aria-label="Bill actions"]'));
    await user.click(screen.getByRole('button', { name: 'Post linked transaction' }));

    expect(onAction).toHaveBeenLastCalledWith({
      type: 'pay-bill-row',
      payload: {
        sheetId: 'sheet-june',
        recurringItemId: 'recurring-card-statement',
        dueDate: '2026-07-25',
        billRowId: 'recurring-card-statement:2026-07-25:0',
        amount: 12000,
        currency: 'PHP',
        description: 'RCBC Card Statement',
        categoryId: 'card-payment',
        primaryAccountId: 'bpi-bank',
        secondaryAccountId: 'rcbc-card',
        template: 'transfer',
        sourceRoute: 'bills',
        recurringTrackingMode: 'link',
        recurringOccurrenceDate: '2026-07-25'
      }
    });
  });

  it('posts only the remaining amount and can undo a partial reconciliation', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const transaction = {
      id: 'transaction-rent-deposit',
      date: '2026-07-10',
      description: 'Rent deposit',
      amountCopy: 'PHP 8,000.00',
      accountName: 'BPI'
    };
    const partial = makeBillRow({
      id: 'recurring-rent:2026-07-15:0',
      recurringItemId: 'recurring-rent',
      name: 'Rent',
      kind: 'bill',
      amount: 20000,
      paymentAmount: 12000,
      amountCopy: 'PHP 20,000.00',
      categoryId: 'housing',
      accountId: 'bpi-bank',
      dueDate: '2026-07-15',
      actions: {
        canPay: true,
        canEdit: true,
        canArchive: true,
        canOpenTransaction: true
      },
      reconciliation: {
        state: 'partial',
        source: 'explicit',
        statusLabel: 'Partially paid',
        title: 'Partial payment recorded',
        transaction,
        canConfirm: false,
        canReject: false,
        canUndo: true
      }
    });
    const rendered = render(
      <BillsRoute onAction={onAction} model={makeBillsModel({ rows: [partial], rowCount: 1 })} />
    );

    await user.click(rendered.container.querySelector('summary[aria-label="Bill actions"]'));
    await user.click(screen.getByRole('button', { name: 'Post linked transaction' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'pay-bill-row',
      payload: expect.objectContaining({
        recurringItemId: 'recurring-rent',
        amount: 12000,
        recurringOccurrenceDate: '2026-07-15'
      })
    });

    await user.click(screen.getByRole('button', { name: 'Undo matched transaction' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'undo-recurring-transaction-match',
      payload: {
        rowId: 'recurring-rent:2026-07-15:0',
        recurringItemId: 'recurring-rent',
        occurrenceDate: '2026-07-15',
        transactionId: 'transaction-rent-deposit'
      }
    });
  });

  it('confirms a suggested remaining payment on a partial bill', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const proofTransaction = {
      id: 'transaction-rent-first',
      date: '2026-07-10',
      description: 'Rent first payment',
      amountCopy: 'PHP 8,000.00',
      accountName: 'BPI'
    };
    const candidateTransaction = {
      id: 'transaction-rent-second',
      date: '2026-07-15',
      description: 'Rent balance',
      amountCopy: 'PHP 12,000.00',
      accountName: 'BPI'
    };
    const partial = makeBillRow({
      id: 'recurring-rent:2026-07-15:0',
      recurringItemId: 'recurring-rent',
      name: 'Rent',
      kind: 'bill',
      amount: 20000,
      amountCopy: 'PHP 20,000.00',
      categoryId: 'housing',
      accountId: 'bpi-bank',
      dueDate: '2026-07-15',
      actions: {
        canPay: false,
        canEdit: true,
        canArchive: true,
        canOpenTransaction: true,
        canReviewPossibleTransaction: true
      },
      reconciliation: {
        state: 'partial',
        source: 'manual',
        statusLabel: 'Partially paid',
        title: 'Partial payment recorded',
        transaction: proofTransaction,
        canUndo: true,
        pendingCandidate: {
          state: 'candidate',
          source: 'scored',
          statusLabel: 'Review match',
          title: 'Likely remaining payment found',
          transaction: candidateTransaction,
          canConfirm: true,
          canReject: true,
          canUndo: false
        }
      }
    });
    render(
      <BillsRoute onAction={onAction} model={makeBillsModel({ rows: [partial], rowCount: 1 })} />
    );

    expect(screen.queryByRole('button', { name: 'Post linked transaction' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm match' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'confirm-recurring-transaction-match',
      payload: {
        rowId: 'recurring-rent:2026-07-15:0',
        recurringItemId: 'recurring-rent',
        occurrenceDate: '2026-07-15',
        transactionId: 'transaction-rent-second'
      }
    });
  });

  it('serializes model-authoritative Advisor fields for lifecycle actions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(
      <SettingsRoute
        onAction={onAction}
        model={{
          workbook: {},
          files: {},
          advisor: {
            settings: {
              provider: 'custom',
              endpoint: 'http://127.0.0.1:8080/v1',
              model: 'qwen-local',
              localModelPath: '/models/qwen.gguf',
              mmprojPath: '/models/mmproj.gguf',
              contextWindowTokens: 4096
            },
            toggle: { label: 'Start Model', disabled: false },
            contextOptions: [{ value: 4096, label: '4K' }],
            microphone: {}
          }
        }}
      />
    );

    const provider = container.querySelector('select[name="provider"]');
    await user.click(screen.getByRole('tab', { name: /Assistant/ }));
    await user.click(screen.getByRole('button', { name: 'Clear vision projector' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'clear-mmproj',
      payload: {}
    });
    await user.click(screen.getAllByRole('button', { name: /Browse/ })[0]);
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'choose-local-model',
      payload: expect.objectContaining({
        provider: 'custom',
        localModelPath: '/models/qwen.gguf',
        mmprojPath: '/models/mmproj.gguf'
      })
    });
    await user.selectOptions(provider, 'openai');
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'set-advisor-provider',
      payload: { value: 'openai' }
    });
    expect(provider.value).toBe('custom');

    await user.click(screen.getByRole('button', { name: /Start Model/ }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'toggle-advisor-server',
      payload: expect.objectContaining({
        provider: 'custom',
        localModelPath: '/models/qwen.gguf',
        mmprojPath: '/models/mmproj.gguf',
        contextWindowTokens: '4096'
      })
    });
    expect(onAction.mock.calls.at(-1)[0].payload).not.toHaveProperty('endpoint');
    expect(onAction.mock.calls.at(-1)[0].payload).not.toHaveProperty('model');
  });

  it('removes the retired subscription scan and distinguishes import outcomes', async () => {
    const user = userEvent.setup();
    const billsAction = vi.fn();
    const { unmount } = render(
      <BillsRoute
        onAction={billsAction}
        model={makeBillsModel({ header: { ...makeBillsModel().header, scanDisabled: true } })}
      />
    );
    expect(screen.queryByRole('button', { name: /Scan Transactions/ })).toBeNull();
    expect(billsAction).not.toHaveBeenCalled();
    unmount();

    const importAction = vi.fn();
    const preview = render(
      <ImportPreviewModal
        onAction={importAction}
        model={{ canApply: true, rows: [], stats: [], mapping: [] }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(importAction).toHaveBeenLastCalledWith({
      type: 'cancel-csv-import-preview',
      payload: {}
    });
    await user.click(screen.getByRole('button', { name: /Apply Ready Rows/ }));
    expect(importAction).toHaveBeenLastCalledWith({
      type: 'apply-csv-import-preview',
      payload: {}
    });
    preview.unmount();

    render(
      <ImportPreviewModal
        onAction={importAction}
        model={{ result: true, canApply: false, rows: [], stats: [], mapping: [] }}
      />
    );
    const modalActions = document.querySelector('.modal-actions');
    await user.click(within(modalActions).getByRole('button', { name: 'Close' }));
    expect(importAction).toHaveBeenLastCalledWith({
      type: 'close-modal',
      payload: {}
    });
  });

  it('routes sidebar navigation through the workbook session reducer', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <AppShell
        initialWorkbook={makeWorkbook()}
        routeId="budgets"
        routeModels={{
          budgets: makeBudgetModel(),
          categories: { currency: 'PHP', categoryRows: [], spendingRows: [] }
        }}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Categories' }));

    expect(document.querySelector('[data-react-route="categories"]')).not.toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});

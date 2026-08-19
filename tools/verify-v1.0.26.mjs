import assert from 'node:assert/strict';

import {
  buildManualLedgerTransaction,
  summarizeLedgerActivity
} from '../packages/finance-core/src/domain/ledger/transactions.js';
import { isTransactionBalanced } from '../packages/finance-core/src/domain/ledger/validation.js';
import { getLedgerHistoricalBalances } from '../packages/finance-core/src/domain/ledger/balances.js';
import {
  buildTransactionCalculationReceipt,
  getTransactionContributions
} from '../packages/finance-core/src/domain/ledger/transaction-contributions.js';
import { validateLedgerInvariants } from '../packages/finance-core/src/domain/ledger/invariants.js';
import { buildBudgetRouteViewModel } from '../packages/finance-core/src/application/budgets/budget-route-view-model-service.js';
import { buildBillsRouteViewModel } from '../packages/finance-core/src/application/recurring/bills-route-view-model-service.js';
import {
  buildRecurringCandidates,
  getRecurringScheduleSummary
} from '../packages/finance-core/src/application/recurring/recurring-analysis-service.js';
import { normalizeLoadedWorkbook } from '../packages/finance-core/src/application/workbook/workbook-persistence-service.js';
import { makeIncomeAndExpenseWorkbook } from '../packages/finance-core/tests/fixtures/core-workbook-fixtures.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

check('merchant refund reverses expense and stays balanced', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  const refund = buildManualLedgerTransaction(workbook, {
    template: 'refund',
    description: 'Returned lunch',
    amount: 50,
    date: '2026-06-19',
    categoryId: 'food',
    primaryAccountId: 'cash',
    currency: 'PHP'
  });
  assert.equal(refund.template, 'merchant_refund');
  assert.equal(refund.eventKind, 'merchant_refund');
  assert.equal(refund.lines[0].direction, 'debit');
  assert.equal(refund.lines[1].direction, 'credit');
  assert.equal(isTransactionBalanced(refund), true);
  workbook.transactions.push(refund);
  const summary = summarizeLedgerActivity(workbook);
  assert.equal(summary.expense, 1979);
  assert.equal(summary.categoryTotals.food, 200);
  const receipt = buildTransactionCalculationReceipt(workbook, workbook.transactions, {
    metric: 'expense',
    range: { start: '2026-06-01', end: '2026-06-30' },
    categoryId: 'food'
  });
  assert.equal(receipt.value, 200);
  assert.ok(receipt.contributions.some((item) => item.signedBaseAmount === -50));
});

check('credit-card refund reduces the liability without inventing cash flow', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  const before = getLedgerHistoricalBalances(workbook)['credit-card'];
  const refund = buildManualLedgerTransaction(workbook, {
    template: 'merchant_refund',
    description: 'Card reversal',
    amount: 300,
    date: '2026-06-20',
    categoryId: 'food',
    primaryAccountId: 'credit-card',
    currency: 'PHP'
  });
  workbook.transactions.push(refund);
  const contribution = getTransactionContributions(workbook, refund);
  assert.equal(contribution.metrics.expense, -300);
  assert.equal(contribution.metrics.cashFlow, 0);
  assert.equal(getLedgerHistoricalBalances(workbook)['credit-card'], before - 300);
});

check('missing FX is excluded and explicitly reported', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  const transaction = {
    id: 'unresolved-fx',
    date: '2026-06-21',
    monthKey: '2026-06',
    template: 'expense_paid',
    description: 'Unresolved USD purchase',
    categoryId: 'food',
    amount: 10,
    originalCurrency: 'USD',
    lines: []
  };
  const contribution = getTransactionContributions(workbook, transaction);
  assert.equal(contribution.resolved, false);
  assert.equal(contribution.signedBaseAmount, 0);
  assert.ok(
    contribution.warnings.some((warning) => warning.code === 'transaction_missing_fx_rate')
  );
});

check('monthly plan keeps manual limits and recurring commitments separate', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  workbook.sheets = [
    {
      id: 'sheet-2026-06',
      name: 'June 2026',
      monthKey: '2026-06',
      monthIndex: 5,
      budgets: [
        { categoryId: 'food', planned: 1000 },
        { categoryId: 'savings', planned: 500 },
        { categoryId: 'debt', planned: 250 },
        { categoryId: 'salary', planned: 50000 },
        { categoryId: 'missing-category', planned: 75 }
      ],
      budgetLineItems: [],
      entries: []
    }
  ];
  workbook.categories.push(
    {
      id: 'savings',
      name: 'Emergency fund',
      type: 'savings',
      linkedAccountId: '',
      isActive: true
    },
    {
      id: 'debt',
      name: 'Card principal',
      type: 'debt',
      linkedAccountId: '',
      isActive: true
    }
  );
  workbook.recurringItems = [
    {
      id: 'weekly-meals',
      name: 'Meal plan',
      kind: 'bill',
      categoryId: 'food',
      accountId: 'cash',
      amount: 100,
      currency: 'PHP',
      frequency: 'Weekly',
      startDate: '2026-06-01',
      isActive: true
    }
  ];
  const model = buildBudgetRouteViewModel(workbook, {
    range: { start: '2026-06-01', end: '2026-06-30' },
    currentDate: '2026-06-15'
  });
  assert.equal(model.summary.totalBudget, 1000);
  assert.equal(model.summary.committedSpending, 500);
  assert.equal(model.summary.plannedSavings, 500);
  assert.equal(model.summary.plannedDebt, 250);
  assert.equal(model.summary.plannedIncome, 50000);
  assert.equal(model.summary.plannedOutflow, 1750);
  assert.equal(model.summary.unallocated, 48250);
  const missing = model.categoryRows.find((row) => row.categoryId === 'missing-category');
  assert.equal(missing.isMissing, true);
  assert.equal(missing.includedInPlanTotals, false);
  assert.equal(missing.trustedPlanned, 0);
  const food = model.categoryRows.find((row) => row.categoryId === 'food');
  assert.equal(food.planned, 1000);
  assert.equal(food.committed, 500);
  assert.equal(food.receipt.value, food.actual);
  assert.equal(model.trust.headlineReconcilesToVisibleRows, true);
});

check('partial-month ranges do not pretend a full monthly plan applies', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  workbook.sheets = [
    {
      id: 'sheet-2026-06',
      name: 'June 2026',
      monthKey: '2026-06',
      monthIndex: 5,
      budgets: [{ categoryId: 'food', planned: 1000 }],
      budgetLineItems: [],
      entries: []
    }
  ];
  const model = buildBudgetRouteViewModel(workbook, {
    range: { start: '2026-06-10', end: '2026-06-20' },
    currentDate: '2026-06-15'
  });
  assert.equal(model.summary.totalBudget, 0);
  assert.deepEqual(model.planVsActual.planScope.excludedPartialMonthKeys, ['2026-06']);
  assert.ok(model.trust.warnings.some((warning) => warning.code === 'partial_month_plan_excluded'));
});

check('bills headline scope ignores transient table filters', () => {
  const rows = [
    {
      id: 'a',
      recurringItemId: 'a',
      name: 'Rent',
      kind: 'bill',
      status: 'Overdue',
      amount: 1000,
      dueDate: '2026-06-01',
      frequency: 'Monthly',
      category: { type: 'expense' }
    },
    {
      id: 'b',
      recurringItemId: 'b',
      name: 'Music',
      kind: 'subscription',
      status: 'Upcoming',
      amount: 120,
      dueDate: '2026-06-18',
      frequency: 'Monthly',
      category: { type: 'expense' }
    }
  ];
  const all = buildBillsRouteViewModel(rows, { today: '2026-06-15' });
  const searched = buildBillsRouteViewModel(rows, { today: '2026-06-15', search: 'Music' });
  assert.deepEqual(searched.summary, all.summary);
  assert.notDeepEqual(searched.viewSummary, all.viewSummary);
  assert.equal(searched.rowCount, 1);
});

check('bills monthly equivalent normalizes cadence and preserves zero remaining', () => {
  const rows = [
    {
      id: 'weekly-1',
      recurringItemId: 'weekly',
      name: 'Weekly',
      kind: 'bill',
      status: 'Upcoming',
      amount: 120,
      dueDate: '2026-06-20',
      frequency: 'Weekly',
      category: { type: 'expense' }
    },
    {
      id: 'weekly-2',
      recurringItemId: 'weekly',
      name: 'Weekly',
      kind: 'bill',
      status: 'Upcoming',
      amount: 120,
      dueDate: '2026-06-27',
      frequency: 'Weekly',
      category: { type: 'expense' }
    },
    {
      id: 'annual',
      recurringItemId: 'annual',
      name: 'Annual',
      kind: 'subscription',
      status: 'Upcoming',
      amount: 1200,
      dueDate: '2026-06-30',
      frequency: 'Yearly',
      category: { type: 'expense' }
    },
    {
      id: 'partial-zero',
      recurringItemId: 'partial',
      name: 'Partial',
      kind: 'bill',
      status: 'Partial',
      amount: 500,
      remainingAmount: 0,
      dueDate: '2026-06-18',
      frequency: 'Monthly',
      category: { type: 'expense' }
    }
  ];
  const model = buildBillsRouteViewModel(rows, { today: '2026-06-15' });
  assert.equal(model.recurring.monthlyEquivalentCount, 3);
  assert.equal(model.recurring.monthlyEquivalentTotal, 1120);
  assert.equal(model.summary.totalPartial, 0);
});

check('recurring-charge finder creates reviewable suggestions without auto-adding them', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  workbook.sheets = [
    {
      id: 'sheet-2026-08',
      name: 'August 2026',
      monthKey: '2026-08',
      monthIndex: 7,
      budgets: [],
      budgetLineItems: [],
      entries: []
    }
  ];
  workbook.recurringItems = [];
  ['2026-06-14', '2026-07-14', '2026-08-14'].forEach((date) => {
    workbook.transactions.push(
      buildManualLedgerTransaction(workbook, {
        template: 'expense_paid',
        description: 'ChatGPT Pro',
        amount: 6490,
        date,
        categoryId: 'subscriptions',
        primaryAccountId: 'bank',
        currency: 'PHP'
      })
    );
  });
  const candidate = buildRecurringCandidates(workbook, { asOfDate: '2026-08-15' }).find(
    (item) => item.name === 'ChatGPT Pro'
  );
  assert.ok(candidate);
  assert.equal(candidate.classification, 'likely_subscription');
  assert.equal(candidate.amount, 6490);
  assert.equal(candidate.suggestedFrequency, 'Monthly');
  assert.equal(candidate.lastSeenDate, '2026-08-14');
  assert.equal(candidate.transactionCount, 3);
  const schedule = getRecurringScheduleSummary(
    { frequency: candidate.suggestedFrequency, anchorDate: candidate.lastSeenDate },
    '2026-08-15'
  );
  assert.equal(schedule.nextExpectedDate, '2026-09-14');
  assert.equal(workbook.recurringItems.length, 0);
});

check('workbook normalization gives legacy sheets durable month keys', () => {
  const workbook = normalizeLoadedWorkbook(
    {
      id: 'legacy',
      name: 'Legacy',
      year: 2026,
      currency: 'PHP',
      accounts: [],
      categories: [],
      transactions: [],
      sheets: [{ id: 'january', name: 'January', monthIndex: 0 }],
      recurringItems: []
    },
    { createId: (prefix, index) => `${prefix}-${index}` }
  );
  assert.equal(workbook.sheets[0].monthKey, '2026-01');
  assert.equal(workbook.sheets[0].monthIndex, 0);
});

check('ledger invariants recognize refund templates', () => {
  const workbook = makeIncomeAndExpenseWorkbook();
  const refund = buildManualLedgerTransaction(workbook, {
    template: 'merchant_refund',
    description: 'Refund',
    amount: 50,
    date: '2026-06-19',
    categoryId: 'food',
    primaryAccountId: 'cash',
    currency: 'PHP'
  });
  workbook.transactions.push(refund);
  const result = validateLedgerInvariants(clone(workbook));
  assert.equal(result.errors.length, 0);
  assert.equal(
    result.warnings.some((warning) => warning.code === 'transaction_unknown_template'),
    false
  );
});

console.log(`\nVerified ${checks.length} Cavalry v1.0.26 trust-critical behaviors.`);

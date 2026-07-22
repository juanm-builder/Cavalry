export function cloneFixture(value) {
  return JSON.parse(JSON.stringify(value));
}

export function makeMinimalWorkbook() {
  return {
    id: 'wb-minimal',
    version: 2,
    name: 'Minimal Workbook',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening_balance_equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'food-expense',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    sheets: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

export function makeCoreAccounts() {
  return [
    { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
    { id: 'bank', name: 'Bank', group: 'asset', currency: 'PHP', isActive: true },
    { id: 'wallet-usd', name: 'USD Wallet', group: 'asset', currency: 'USD', isActive: true },
    { id: 'credit-card', name: 'Credit Card', group: 'liability', currency: 'PHP', isActive: true },
    {
      id: 'salary-income',
      name: 'Salary Income',
      group: 'income',
      currency: 'PHP',
      isActive: true
    },
    { id: 'food-expense', name: 'Food Expense', group: 'expense', currency: 'PHP', isActive: true },
    {
      id: 'transport-expense',
      name: 'Transport Expense',
      group: 'expense',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'shopping-expense',
      name: 'Shopping Expense',
      group: 'expense',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'utilities-expense',
      name: 'Utilities Expense',
      group: 'expense',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'subscriptions-expense',
      name: 'Subscriptions Expense',
      group: 'expense',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'debt-payment-expense',
      name: 'Debt Payment',
      group: 'expense',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'opening_balance_equity',
      name: 'Opening Balance Equity',
      group: 'equity',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    }
  ];
}

export function makeCoreCategories() {
  return [
    {
      id: 'salary',
      name: 'Salary',
      type: 'income',
      currency: 'PHP',
      linkedAccountId: 'salary-income',
      isActive: true
    },
    {
      id: 'food',
      name: 'Food',
      type: 'expense',
      currency: 'PHP',
      linkedAccountId: 'food-expense',
      isActive: true
    },
    {
      id: 'transport',
      name: 'Transport',
      type: 'expense',
      currency: 'PHP',
      linkedAccountId: 'transport-expense',
      isActive: true
    },
    {
      id: 'shopping',
      name: 'Shopping',
      type: 'expense',
      currency: 'PHP',
      linkedAccountId: 'shopping-expense',
      isActive: true
    },
    {
      id: 'utilities',
      name: 'Utilities',
      type: 'expense',
      currency: 'PHP',
      linkedAccountId: 'utilities-expense',
      isActive: true
    },
    {
      id: 'subscriptions',
      name: 'Subscriptions',
      type: 'expense',
      currency: 'PHP',
      linkedAccountId: 'subscriptions-expense',
      isActive: true
    },
    {
      id: 'credit-card-payment',
      name: 'Credit Card Payment',
      type: 'debt',
      currency: 'PHP',
      linkedAccountId: 'debt-payment-expense',
      isActive: true
    },
    {
      id: 'archived-shopping',
      name: 'Old Shopping',
      type: 'expense',
      currency: 'PHP',
      linkedAccountId: 'shopping-expense',
      isActive: false
    }
  ];
}

export function makeLine(accountId, direction, amount, note = '') {
  return {
    id: `line-${accountId}-${direction}-${String(amount).replace(/\./g, '-')}`,
    accountId,
    direction,
    amount,
    currency: 'PHP',
    baseAmount: amount,
    note
  };
}

export function makeTransaction(overrides = {}) {
  const amount = Number(overrides.amount || 0) || 0;
  return {
    id: overrides.id || 'txn-fixture',
    date: overrides.date || '2026-06-01',
    monthKey: overrides.monthKey || (overrides.date || '2026-06-01').slice(0, 7),
    template: overrides.template || 'expense_paid',
    description: overrides.description || 'Fixture transaction',
    reference: overrides.reference || '',
    categoryId: overrides.categoryId || '',
    counterpartyId: overrides.counterpartyId || '',
    recurringItemId: overrides.recurringItemId || '',
    originalCurrency: overrides.originalCurrency || 'PHP',
    amount,
    baseAmount: typeof overrides.baseAmount === 'number' ? overrides.baseAmount : amount,
    fxRateToBase: overrides.fxRateToBase || 0,
    note: overrides.note || '',
    source: overrides.source || 'manual',
    lines: overrides.lines || []
  };
}

export function makeBasicSpendingWorkbook() {
  return {
    id: 'wb-spending',
    version: 2,
    name: 'Basic Spending Workbook',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: makeCoreAccounts(),
    categories: makeCoreCategories(),
    counterparties: [],
    transactions: [
      makeTransaction({
        id: 'txn-food-cash',
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'Lunch',
        categoryId: 'food',
        amount: 250,
        lines: [
          makeLine('food-expense', 'debit', 250, 'Category debit'),
          makeLine('cash', 'credit', 250, 'Cash payment')
        ]
      }),
      makeTransaction({
        id: 'txn-transport-cash',
        date: '2026-06-02',
        template: 'expense_paid',
        description: 'Train fare',
        categoryId: 'transport',
        amount: 80,
        lines: [makeLine('transport-expense', 'debit', 80), makeLine('cash', 'credit', 80)]
      }),
      makeTransaction({
        id: 'txn-card-shopping',
        date: '2026-06-03',
        template: 'expense_charged',
        description: 'Card purchase',
        categoryId: 'shopping',
        amount: 1200,
        lines: [
          makeLine('shopping-expense', 'debit', 1200),
          makeLine('credit-card', 'credit', 1200)
        ]
      }),
      makeTransaction({
        id: 'txn-subscription',
        date: '2026-06-04',
        template: 'expense_paid',
        description: 'Streaming',
        categoryId: 'subscriptions',
        amount: 499,
        lines: [makeLine('subscriptions-expense', 'debit', 499), makeLine('bank', 'credit', 499)]
      })
    ],
    sheets: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

export function makeIncomeAndExpenseWorkbook() {
  const workbook = makeBasicSpendingWorkbook();
  workbook.id = 'wb-income-expense';
  workbook.name = 'Income and Expense Workbook';
  workbook.transactions.unshift(
    makeTransaction({
      id: 'txn-salary',
      date: '2026-06-01',
      template: 'income_received',
      description: 'Salary',
      categoryId: 'salary',
      amount: 50000,
      lines: [makeLine('bank', 'debit', 50000), makeLine('salary-income', 'credit', 50000)]
    })
  );
  return workbook;
}

export function makeTransferWorkbook() {
  const workbook = makeMinimalWorkbook();
  workbook.id = 'wb-transfer';
  workbook.name = 'Transfer Workbook';
  workbook.accounts = [
    { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
    { id: 'bank', name: 'Bank', group: 'asset', currency: 'PHP', isActive: true },
    {
      id: 'opening_balance_equity',
      name: 'Opening Balance Equity',
      group: 'equity',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    }
  ];
  workbook.categories = [];
  workbook.transactions = [
    makeTransaction({
      id: 'txn-transfer',
      date: '2026-06-10',
      template: 'transfer',
      description: 'Move cash to bank',
      amount: 1000,
      lines: [makeLine('bank', 'debit', 1000), makeLine('cash', 'credit', 1000)]
    })
  ];
  return workbook;
}

export function makeRefundWorkbook() {
  const workbook = makeBasicSpendingWorkbook();
  workbook.id = 'wb-refund-decision';
  workbook.name = 'Refund Decision Workbook';
  workbook.transactions.push(
    makeTransaction({
      id: 'txn-refund-unclear',
      date: '2026-06-05',
      template: 'refund',
      description: 'Store refund candidate',
      categoryId: 'food',
      amount: 50,
      lines: [makeLine('cash', 'debit', 50), makeLine('food-expense', 'credit', 50)]
    })
  );
  return workbook;
}

export function makeMultiCurrencyWorkbook() {
  const workbook = makeMinimalWorkbook();
  workbook.id = 'wb-multi-currency';
  workbook.name = 'Multi Currency Workbook';
  workbook.settings.usdToBaseRate = 58;
  workbook.accounts = makeCoreAccounts();
  workbook.categories = makeCoreCategories();
  workbook.transactions = [
    makeTransaction({
      id: 'txn-usd-expense',
      date: '2026-06-11',
      template: 'expense_paid',
      description: 'USD software',
      categoryId: 'utilities',
      originalCurrency: 'USD',
      amount: 10,
      baseAmount: 580,
      fxRateToBase: 58,
      lines: [
        {
          id: 'line-usd-utilities',
          accountId: 'utilities-expense',
          direction: 'debit',
          amount: 10,
          currency: 'USD',
          baseAmount: 580,
          note: 'Category debit'
        },
        {
          id: 'line-usd-cash',
          accountId: 'cash',
          direction: 'credit',
          amount: 580,
          currency: 'PHP',
          baseAmount: 580,
          note: 'Cash payment'
        }
      ]
    })
  ];
  return workbook;
}

export function makeDirtyLegacyWorkbook() {
  return {
    id: 'wb-dirty',
    name: 'Dirty Legacy Workbook',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: '58' },
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'old-card', name: 'Old Card', group: 'liability', currency: 'PHP', isActive: false },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'old-food',
        name: 'Old Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: false
      }
    ],
    transactions: [
      {
        id: 'dirty-string-amount',
        date: '2026-06-12',
        monthKey: '2026-06',
        template: 'expense_paid',
        description: 'String amount candidate',
        categoryId: 'food',
        amount: '125.50',
        baseAmount: 125.5,
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: '125.50', baseAmount: 125.5 },
          { accountId: 'cash', direction: 'credit', amount: '125.50', baseAmount: 125.5 }
        ]
      },
      {
        id: 'dirty-missing-category',
        date: '2026-06-13',
        monthKey: '2026-06',
        template: 'expense_paid',
        description: 'Missing category candidate',
        categoryId: 'missing-category',
        amount: 75,
        baseAmount: 75,
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 75, baseAmount: 75 },
          { accountId: 'cash', direction: 'credit', amount: 75, baseAmount: 75 }
        ]
      },
      {
        id: 'dirty-unknown-template',
        date: '2026-06-14',
        monthKey: '2026-06',
        template: 'refund',
        description: 'Unknown template candidate',
        categoryId: 'food',
        amount: 30,
        baseAmount: 30,
        lines: [
          { accountId: 'cash', direction: 'debit', amount: 30, baseAmount: 30 },
          { accountId: 'food-expense', direction: 'credit', amount: 30, baseAmount: 30 }
        ]
      },
      {
        id: 'dirty-invalid-date',
        date: 'June 14 2026',
        monthKey: '2026-06',
        template: 'expense_paid',
        description: 'Malformed date candidate',
        categoryId: 'food',
        amount: 60,
        baseAmount: 60,
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 60, baseAmount: 60 },
          { accountId: 'cash', direction: 'credit', amount: 60, baseAmount: 60 }
        ]
      }
    ],
    sheets: [],
    aiDrafts: []
  };
}

export function makeDraftIsolationWorkbook() {
  const workbook = makeIncomeAndExpenseWorkbook();
  workbook.id = 'wb-draft-isolation';
  workbook.aiDrafts = [
    {
      id: 'draft-food',
      status: 'pending',
      operation: 'create',
      objectType: 'transaction',
      proposed: { description: 'Draft food', amount: 999, categoryId: 'food' }
    },
    {
      id: 'draft-rejected',
      status: 'rejected',
      operation: 'create',
      objectType: 'transaction',
      proposed: { description: 'Rejected draft', amount: 888, categoryId: 'food' }
    }
  ];
  workbook.externalDraftGroups = [
    {
      draft_group_id: 'external-group-one',
      status: 'pending',
      drafts: [{ draft_id: 'external-draft-one', proposed: { amount: 777 } }]
    }
  ];
  return workbook;
}

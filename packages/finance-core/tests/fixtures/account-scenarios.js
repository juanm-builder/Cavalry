import { cloneFixture, makeLine, makeTransaction } from './core-workbook-fixtures.js';

export function makeAccountScenarioBase() {
  return {
    id: 'wb-account-base',
    version: 2,
    name: 'Account Scenario Workbook',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening_balance_equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
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
    transactions: [
      makeTransaction({
        id: 'txn-food-cash',
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'Lunch',
        categoryId: 'food',
        amount: 250,
        lines: [makeLine('food-expense', 'debit', 250), makeLine('cash', 'credit', 250)]
      })
    ],
    sheets: [],
    recurringItems: [],
    aiDrafts: [],
    externalDraftGroups: [],
    advisorDraftGroups: []
  };
}

export function makeMinimalAccountWorkbook() {
  return makeAccountScenarioBase();
}

export function makeNormalAccountWorkbook() {
  const workbook = makeAccountScenarioBase();
  workbook.id = 'wb-account-normal';
  workbook.accounts = [
    {
      id: 'cash',
      name: 'Cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      openedDate: '2026-01-01',
      isActive: true
    },
    {
      id: 'gcash',
      name: 'GCash',
      group: 'asset',
      subtype: 'wallet',
      currency: 'PHP',
      openedDate: '2026-01-01',
      isActive: true
    },
    {
      id: 'bank-checking',
      name: 'Bank Checking',
      group: 'asset',
      subtype: 'bank',
      currency: 'PHP',
      openedDate: '2026-01-01',
      isActive: true
    },
    {
      id: 'freedom-fund',
      name: 'Freedom Fund',
      group: 'asset',
      subtype: 'savings',
      currency: 'PHP',
      openedDate: '2026-01-01',
      isActive: true
    },
    {
      id: 'credit-card',
      name: 'Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      currency: 'PHP',
      openedDate: '2026-01-01',
      isActive: true
    },
    {
      id: 'paypal',
      name: 'PayPal',
      group: 'asset',
      subtype: 'wallet',
      currency: 'USD',
      openedDate: '2026-01-01',
      isActive: true
    },
    {
      id: 'salary-income',
      name: 'Salary Income',
      group: 'income',
      subtype: 'income',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'food-expense',
      name: 'Food Expense',
      group: 'expense',
      subtype: 'expense',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'debt-payment-expense',
      name: 'Debt Payment',
      group: 'expense',
      subtype: 'debt',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'opening_balance_equity',
      name: 'Opening Balance Equity',
      group: 'equity',
      subtype: 'opening_balance',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    }
  ];
  workbook.categories = [
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
      id: 'credit-card-payment',
      name: 'Credit Card Payment',
      type: 'debt',
      currency: 'PHP',
      linkedAccountId: 'debt-payment-expense',
      isActive: true
    }
  ];
  workbook.transactions = [
    makeTransaction({
      id: 'txn-salary-bank',
      date: '2026-06-01',
      template: 'income_received',
      description: 'Salary',
      categoryId: 'salary',
      amount: 50000,
      lines: [makeLine('bank-checking', 'debit', 50000), makeLine('salary-income', 'credit', 50000)]
    }),
    makeTransaction({
      id: 'txn-food-cash',
      date: '2026-06-02',
      template: 'expense_paid',
      description: 'Lunch',
      categoryId: 'food',
      amount: 250,
      lines: [makeLine('food-expense', 'debit', 250), makeLine('cash', 'credit', 250)]
    }),
    makeTransaction({
      id: 'txn-card-food',
      date: '2026-06-03',
      template: 'expense_charged',
      description: 'Card groceries',
      categoryId: 'food',
      amount: 1200,
      lines: [makeLine('food-expense', 'debit', 1200), makeLine('credit-card', 'credit', 1200)]
    }),
    makeTransaction({
      id: 'txn-card-payment',
      date: '2026-06-10',
      template: 'debt_payment',
      description: 'Credit card payment',
      categoryId: 'credit-card-payment',
      amount: 500,
      lines: [makeLine('credit-card', 'debit', 500), makeLine('bank-checking', 'credit', 500)]
    })
  ];
  return workbook;
}

export function makeArchivedAccountWorkbook() {
  const workbook = makeNormalAccountWorkbook();
  workbook.id = 'wb-account-archived';
  workbook.accounts.push({
    id: 'old-wallet',
    name: 'Old Wallet',
    group: 'asset',
    subtype: 'wallet',
    currency: 'PHP',
    openedDate: '2025-01-01',
    isActive: false
  });
  workbook.transactions.push(
    makeTransaction({
      id: 'txn-old-wallet',
      date: '2026-05-20',
      template: 'expense_paid',
      description: 'Old wallet food',
      categoryId: 'food',
      amount: 75,
      lines: [makeLine('food-expense', 'debit', 75), makeLine('old-wallet', 'credit', 75)]
    })
  );
  // Archived accounts stay in workbook/history but normal selectors hide them.
  return workbook;
}

export function makeDuplicateishAccountWorkbook() {
  const workbook = makeAccountScenarioBase();
  workbook.id = 'wb-account-duplicateish';
  workbook.accounts = [
    { id: 'rcb', name: 'RCB', group: 'asset', subtype: 'bank', currency: 'PHP', isActive: true },
    { id: 'rcbc', name: 'RCBC', group: 'asset', subtype: 'bank', currency: 'PHP', isActive: true },
    {
      id: 'rcbc-card',
      name: 'RCBC Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'cash-upper',
      name: 'Cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'cash-lower',
      name: 'cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'opening_balance_equity',
      name: 'Opening Balance Equity',
      group: 'equity',
      subtype: 'opening_balance',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    }
  ];
  return workbook;
}

export function makeTransferAccountWorkbook() {
  const workbook = makeAccountScenarioBase();
  workbook.id = 'wb-account-transfer';
  workbook.accounts = [
    { id: 'cash', name: 'Cash', group: 'asset', subtype: 'cash', currency: 'PHP', isActive: true },
    {
      id: 'bank-checking',
      name: 'Bank Checking',
      group: 'asset',
      subtype: 'bank',
      currency: 'PHP',
      isActive: true
    },
    {
      id: 'opening_balance_equity',
      name: 'Opening Balance Equity',
      group: 'equity',
      subtype: 'opening_balance',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    }
  ];
  workbook.categories = [];
  workbook.transactions = [
    makeTransaction({
      id: 'txn-transfer',
      date: '2026-06-15',
      template: 'transfer',
      description: 'Move cash to bank',
      amount: 1000,
      lines: [makeLine('bank-checking', 'debit', 1000), makeLine('cash', 'credit', 1000)]
    })
  ];
  return workbook;
}

export function makeCreditCardAccountWorkbook() {
  const workbook = makeNormalAccountWorkbook();
  workbook.id = 'wb-account-credit-card';
  return workbook;
}

export function makeDirtyLegacyAccountWorkbook() {
  const workbook = makeAccountScenarioBase();
  workbook.id = 'wb-account-dirty';
  workbook.accounts = [
    { id: '', name: '', group: '', currency: '', legacyType: 'cash' },
    {
      id: 'legacy-bank',
      displayName: 'Legacy Bank',
      group: 'asset',
      currency: 'PHP',
      unknownField: 'kept'
    },
    {
      id: 'archived-card',
      name: 'Archived Card',
      group: 'liability',
      currency: 'PHP',
      isActive: false
    },
    { id: 'food-expense', name: 'Food Expense', group: 'expense', currency: 'PHP', isActive: true }
  ];
  workbook.transactions = [
    makeTransaction({
      id: 'txn-missing-account',
      date: '2026-06-12',
      template: 'expense_paid',
      description: 'Missing account reference',
      categoryId: 'food',
      amount: 60,
      lines: [makeLine('food-expense', 'debit', 60), makeLine('missing-account', 'credit', 60)]
    }),
    makeTransaction({
      id: 'txn-archived-account',
      date: '2026-06-13',
      template: 'expense_charged',
      description: 'Archived card reference',
      categoryId: 'food',
      amount: 100,
      lines: [makeLine('food-expense', 'debit', 100), makeLine('archived-card', 'credit', 100)]
    })
  ];
  return workbook;
}

export function cloneAccountScenario(workbook) {
  return cloneFixture(workbook);
}

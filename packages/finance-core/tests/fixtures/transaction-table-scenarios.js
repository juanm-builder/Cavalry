import {
  cloneFixture,
  makeCoreAccounts,
  makeCoreCategories,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeTransaction
} from './core-workbook-fixtures.js';

export function makeTransactionTableWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.name = 'Transaction Table Workbook';
  workbook.accounts = makeCoreAccounts();
  workbook.categories = makeCoreCategories();
  workbook.accounts.find((account) => account.id === 'wallet-usd').isActive = false;
  workbook.categories.find((category) => category.id === 'archived-shopping').isActive = false;
  workbook.transactions = [
    makeTransaction({
      id: 'txn-salary',
      date: '2026-06-01',
      template: 'income_received',
      description: 'Salary payroll',
      categoryId: 'salary',
      amount: 50000,
      lines: [makeLine('bank', 'debit', 50000), makeLine('salary-income', 'credit', 50000)]
    }),
    makeTransaction({
      id: 'txn-coffee',
      date: '2026-06-02',
      template: 'expense_paid',
      description: 'Coffee beans',
      categoryId: 'food',
      amount: 250,
      note: 'morning bag',
      lines: [makeLine('food-expense', 'debit', 250), makeLine('cash', 'credit', 250)]
    }),
    makeTransaction({
      id: 'txn-card',
      date: '2026-06-03',
      template: 'expense_charged',
      description: 'Card groceries',
      categoryId: 'shopping',
      amount: 1200,
      lines: [makeLine('shopping-expense', 'debit', 1200), makeLine('credit-card', 'credit', 1200)]
    }),
    makeTransaction({
      id: 'txn-transfer',
      date: '2026-06-04',
      template: 'transfer',
      description: 'Move to bank',
      amount: 1000,
      categoryId: '',
      lines: [makeLine('bank', 'debit', 1000), makeLine('cash', 'credit', 1000)]
    }),
    makeTransaction({
      id: 'txn-archived',
      date: '2026-06-05',
      template: 'expense_paid',
      description: 'Archived card fee',
      categoryId: 'archived-shopping',
      amount: 400,
      lines: [makeLine('shopping-expense', 'debit', 400), makeLine('wallet-usd', 'credit', 400)]
    }),
    makeTransaction({
      id: 'txn-missing',
      date: '2026-06-06',
      template: 'expense_paid',
      description: 'Missing category/account row',
      categoryId: 'missing-category',
      amount: 75,
      lines: [
        makeLine('food-expense', 'debit', 75),
        {
          id: 'line-missing-account',
          accountId: 'missing-account',
          direction: 'credit',
          amount: 75,
          currency: 'PHP',
          baseAmount: 75
        }
      ]
    }),
    makeTransaction({
      id: 'txn-uncategorized',
      date: '2026-06-07',
      template: 'manual_journal',
      description: 'Uncategorized adjustment',
      categoryId: '',
      amount: 30,
      lines: [makeLine('cash', 'debit', 30), makeLine('bank', 'credit', 30)]
    })
  ];
  return workbook;
}

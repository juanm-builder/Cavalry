import {
  cloneFixture,
  makeCoreCategories,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeTransaction
} from './core-workbook-fixtures.js';

export function scenarioBasicExpense() {
  return {
    fields: {
      template: 'expense_paid',
      description: 'Coffee',
      amount: 120,
      date: '2026-06-20',
      categoryId: 'food',
      primaryAccountId: 'cash',
      currency: 'PHP'
    },
    expected: {
      template: 'expense_paid',
      categoryId: 'food',
      debitAccountId: 'food-expense',
      creditAccountId: 'cash',
      baseAmount: 120
    }
  };
}

export function scenarioBasicIncome() {
  return {
    fields: {
      template: 'income_received',
      description: 'June salary',
      amount: 50000,
      date: '2026-06-15',
      categoryId: 'salary',
      primaryAccountId: 'bank',
      currency: 'PHP'
    },
    expected: {
      template: 'income_received',
      categoryId: 'salary',
      debitAccountId: 'bank',
      creditAccountId: 'salary-income',
      baseAmount: 50000
    }
  };
}

export function scenarioTransfer() {
  return {
    fields: {
      template: 'transfer',
      description: 'Move to bank',
      amount: 1000,
      date: '2026-06-16',
      primaryAccountId: 'cash',
      secondaryAccountId: 'bank',
      currency: 'PHP'
    },
    expected: {
      template: 'transfer',
      categoryId: '',
      debitAccountId: 'bank',
      creditAccountId: 'cash',
      baseAmount: 1000
    }
  };
}

export function scenarioCreditCardExpense() {
  return {
    fields: {
      template: 'expense_charged',
      description: 'Card groceries',
      amount: 900,
      date: '2026-06-17',
      categoryId: 'food',
      primaryAccountId: 'credit-card',
      currency: 'PHP'
    },
    expected: {
      template: 'expense_charged',
      categoryId: 'food',
      debitAccountId: 'food-expense',
      creditAccountId: 'credit-card',
      baseAmount: 900
    }
  };
}

export function scenarioUsdExpense() {
  return {
    fields: {
      template: 'expense_paid',
      description: 'USD hosting',
      amount: 10,
      date: '2026-06-18',
      categoryId: 'utilities',
      primaryAccountId: 'cash',
      currency: 'USD',
      fxRateToBase: 58
    },
    expected: {
      template: 'expense_paid',
      categoryId: 'utilities',
      debitAccountId: 'utilities-expense',
      creditAccountId: 'cash',
      baseAmount: 580
    }
  };
}

export function makeCategoryEditWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.categories = makeCoreCategories();
  workbook.transactions = [
    makeTransaction({
      id: 'txn-edit',
      date: '2026-06-10',
      template: 'expense_paid',
      description: 'Original food',
      categoryId: 'food',
      amount: 300,
      lines: [makeLine('food-expense', 'debit', 300), makeLine('cash', 'credit', 300)]
    })
  ];
  return workbook;
}

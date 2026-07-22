import { roundMoney } from '../money.js';

export function isTransactionBalanced(transaction) {
  const lines = transaction && transaction.lines ? transaction.lines : [];
  const debitBase = roundMoney(
    lines
      .filter((line) => line.direction === 'debit')
      .reduce((sum, line) => sum + (Number(line.baseAmount) || 0), 0)
  );
  const creditBase = roundMoney(
    lines
      .filter((line) => line.direction === 'credit')
      .reduce((sum, line) => sum + (Number(line.baseAmount) || 0), 0)
  );
  return Math.abs(debitBase - creditBase) < 0.01;
}

export function validateLedgerWorkbook(workbook) {
  const errors = [];
  const accountIds = new Set(
    (workbook && workbook.accounts ? workbook.accounts : []).map((account) => account.id)
  );
  const categoryIds = new Set(
    (workbook && workbook.categories ? workbook.categories : []).map((category) => category.id)
  );
  const transactionIds = new Set();
  (workbook && workbook.transactions ? workbook.transactions : []).forEach((transaction) => {
    if (transactionIds.has(transaction.id)) {
      errors.push('duplicate transaction');
    }
    transactionIds.add(transaction.id);
    if (!transaction.lines || transaction.lines.length < 2) {
      errors.push('too few lines');
    }
    if (!isTransactionBalanced(transaction)) {
      errors.push('unbalanced transaction');
    }
    if (transaction.categoryId && !categoryIds.has(transaction.categoryId)) {
      errors.push('missing category');
    }
    (transaction.lines || []).forEach((line) => {
      if (!accountIds.has(line.accountId)) {
        errors.push('missing account');
      }
    });
  });
  return errors;
}

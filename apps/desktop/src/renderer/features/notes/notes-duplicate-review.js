const text = (value) => String(value ?? '').trim();
const description = (value) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const money = (value) => Math.round((Number(value) || 0) * 100);
const list = (value) => (Array.isArray(value) ? value : []);

function primaryAccountId(workbook, transaction) {
  const direction = transaction.template === 'income_received' ? 'debit' : 'credit';
  const group = transaction.template === 'expense_charged' ? 'liability' : 'asset';
  return text(
    list(transaction.lines).find(
      (line) =>
        line.direction === direction &&
        list(workbook.accounts).some(
          (account) => text(account.id) === text(line.accountId) && account.group === group
        )
    )?.accountId
  );
}

export function withNotesDuplicateReview(workbook, entry) {
  const issues = list(entry.issues).filter((issue) => issue.code !== 'existing_transaction_review');
  const duplicate =
    !entry.manuallyReviewed &&
    list(workbook.transactions).find(
      (transaction) =>
        text(transaction.id) !== text(entry.transactionId) &&
        text(transaction.template) === text(entry.template) &&
        text(transaction.date) === text(entry.date) &&
        money(transaction.amount) === money(entry.amount) &&
        money(entry.amount) > 0 &&
        text(
          transaction.originalCurrency || transaction.currency || workbook.currency
        ).toUpperCase() === text(entry.currency || workbook.currency).toUpperCase() &&
        text(transaction.categoryId) === text(entry.categoryId) &&
        description(transaction.description) === description(entry.description) &&
        primaryAccountId(workbook, transaction) === text(entry.primaryAccountId)
    );
  if (duplicate)
    issues.push({
      code: 'existing_transaction_review',
      field: 'review',
      message:
        'A matching transaction is already recorded. Confirm details only if this is another purchase.'
    });
  return { ...entry, issues };
}

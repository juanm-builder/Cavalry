const text = (value) => String(value ?? '').trim();
const description = (value) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const money = (value) => Math.round((Number(value) || 0) * 100);
const list = (value) => (Array.isArray(value) ? value : []);

function primaryAccountId(workbook, transaction) {
  if (transaction.template === 'transfer')
    return text(list(transaction.lines).find((line) => line.direction === 'credit')?.accountId);
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
        (entry.template === 'transfer' ||
          description(transaction.description) === description(entry.description)) &&
        primaryAccountId(workbook, transaction) === text(entry.primaryAccountId) &&
        (entry.template !== 'transfer' ||
          text(list(transaction.lines).find((line) => line.direction === 'debit')?.accountId) ===
            text(entry.secondaryAccountId))
    );
  if (duplicate)
    issues.push({
      code: 'existing_transaction_review',
      field: 'review',
      message:
        'A matching transaction is already recorded. Confirm details only if this is another transaction.'
    });
  return { ...entry, issues };
}

export function withNotesBatchDuplicateReview(entries) {
  const seen = new Set();
  return list(entries).map((entry) => {
    if (entry.template !== 'transfer' || entry.transactionId) return entry;
    const key = JSON.stringify([
      entry.date,
      text(entry.currency).toUpperCase(),
      money(entry.amount),
      text(entry.primaryAccountId),
      text(entry.secondaryAccountId)
    ]);
    const issues = list(entry.issues).filter(
      (item) => item.code !== 'batch_transfer_duplicate_review'
    );
    if (!entry.manuallyReviewed && seen.has(key))
      issues.push({
        code: 'batch_transfer_duplicate_review',
        field: 'review',
        message:
          'This transfer appears twice in the note. Confirm details only if both transfers happened.'
      });
    seen.add(key);
    return { ...entry, issues };
  });
}

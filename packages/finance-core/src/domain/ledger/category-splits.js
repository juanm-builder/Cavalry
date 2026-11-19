import { roundMoney } from '../money.js';

function cents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  return amount > 0 && Number.isSafeInteger(minor) && minor / 100 === amount ? minor : NaN;
}

function invalidSplit(message) {
  return { code: 'invalid_category_splits', field: 'categorySplits', message };
}

export function getCategorySplitIssue(workbook, fields, existingTransaction) {
  const splits = fields.categorySplits;
  if (splits === undefined || (Array.isArray(splits) && splits.length === 0)) return null;
  if (!['expense_paid', 'expense_charged'].includes(fields.template)) {
    return invalidSplit('Only purchases can be split across categories.');
  }
  if (!Array.isArray(splits) || splits.length < 2)
    return invalidSplit('Choose at least two expense categories.');
  const previousCategories = new Set(
    (Array.isArray(existingTransaction?.categorySplits)
      ? existingTransaction.categorySplits
      : []
    ).map((split) => split?.categoryId)
  );
  const seen = new Set();
  let sum = 0;
  for (const split of splits) {
    if (typeof split?.categoryId !== 'string' || !split.categoryId) {
      return invalidSplit('Choose an expense category for every part of the purchase.');
    }
    const category = workbook?.categories?.find((item) => item?.id === split?.categoryId);
    if (
      !category ||
      category.type !== 'expense' ||
      (category.isActive === false && !previousCategories.has(category.id))
    ) {
      return invalidSplit('Choose an expense category for every part of the purchase.');
    }
    const account = workbook.accounts?.find((item) => item?.id === category.linkedAccountId);
    if (account?.group !== 'expense')
      return invalidSplit('Each category needs a linked expense account.');
    if (seen.has(category.id))
      return invalidSplit('Choose a different category for each part of the purchase.');
    seen.add(category.id);
    const minor = cents(split.amount);
    if (!(minor > 0))
      return invalidSplit(
        'Enter a positive amount with up to two decimal places for every category.'
      );
    sum += minor;
  }
  if (sum !== cents(fields.amount))
    return invalidSplit('The category amounts must add up to the purchase total.');
  return null;
}

export function getStoredCategorySplitIssue(workbook, transaction) {
  if (transaction?.categorySplits === undefined) return null;
  const splits = transaction.categorySplits;
  if (!Array.isArray(splits) || splits.length < 2)
    return invalidSplit('A stored split must contain at least two categories.');
  const issue = getCategorySplitIssue(workbook, transaction, transaction);
  if (issue) return issue;
  if (splits.some((split) => typeof split.amount !== 'number'))
    return invalidSplit('Stored split amounts must be numbers.');
  if (
    transaction.eventKind &&
    !['purchase', 'debt_interest_or_fee'].includes(transaction.eventKind)
  )
    return invalidSplit('Split categories require an expense transaction.');
  if (transaction.categoryId !== splits[0].categoryId)
    return invalidSplit('The primary category must match the first split.');
  const lines = transaction.lines;
  if (!Array.isArray(lines) || lines.length !== splits.length + 1)
    return invalidSplit('Split purchases need one debit per category and one funding credit.');
  const funding = lines[lines.length - 1];
  const account = workbook.accounts?.find((item) => item?.id === funding?.accountId);
  const group = transaction.template === 'expense_charged' ? 'liability' : 'asset';
  if (
    account?.group !== group ||
    funding?.direction !== 'credit' ||
    !Number.isFinite(transaction.baseAmount) ||
    transaction.baseAmount < 0 ||
    funding.baseAmount !== transaction.baseAmount ||
    funding.currency !== account.currency ||
    !Number.isFinite(funding.amount) ||
    funding.amount < 0 ||
    (funding.currency === transaction.originalCurrency && funding.amount !== transaction.amount) ||
    (funding.currency === workbook.currency && funding.amount !== transaction.baseAmount) ||
    (transaction.originalCurrency === workbook.currency &&
      transaction.baseAmount !== transaction.amount) ||
    (transaction.originalCurrency === workbook.currency &&
      funding.currency === 'USD' &&
      funding.currency !== workbook.currency &&
      transaction.fxRateToBase > 0 &&
      funding.amount !== roundMoney(transaction.amount * (1 / transaction.fxRateToBase))) ||
    (transaction.originalCurrency === 'USD' &&
      workbook.currency !== 'USD' &&
      transaction.fxRateToBase > 0 &&
      transaction.baseAmount !== roundMoney(transaction.amount * transaction.fxRateToBase))
  ) {
    return invalidSplit(
      'The funding credit must match the purchase total in the funding account currency.'
    );
  }
  const allocations = getTransactionCategoryAllocations(transaction);
  for (const [index, allocation] of allocations.entries()) {
    const category = workbook.categories.find((item) => item?.id === allocation.categoryId);
    const line = lines[index];
    const previouslyLinked =
      Array.isArray(category.previousLinkedAccountIds) &&
      category.previousLinkedAccountIds.includes(line?.accountId);
    if (
      !line ||
      line.direction !== 'debit' ||
      (line.accountId !== category.linkedAccountId && !previouslyLinked) ||
      !workbook.accounts?.some((item) => item?.id === line.accountId && item.group === 'expense') ||
      line.currency !== transaction.originalCurrency ||
      line.amount !== allocation.amount ||
      line.baseAmount !== allocation.baseAmount
    ) {
      return invalidSplit('Each split debit must match its expense category and allocated amount.');
    }
  }
  return null;
}

export function sameCategorySplits(left, right, ordered = false) {
  const a = left ?? [];
  const b = right ?? [];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const amounts = ordered
    ? null
    : new Map(b.map((split) => [split?.categoryId, Number(split?.amount)]));
  return a.every((split, index) =>
    ordered
      ? split?.categoryId === b[index]?.categoryId &&
        Number(split?.amount) === Number(b[index]?.amount)
      : amounts.get(split?.categoryId) === Number(split?.amount)
  );
}

export function transactionHasCategory(transaction, categoryId) {
  return (
    transaction?.categoryId === categoryId ||
    (Array.isArray(transaction?.categorySplits) &&
      transaction.categorySplits.some((split) => split?.categoryId === categoryId))
  );
}

export function getTransactionCategoryAllocations(
  transaction,
  baseAmount = transaction?.baseAmount
) {
  const splits = transaction?.categorySplits;
  const amount = Number(transaction?.amount) || 0;
  const total = roundMoney(Number(baseAmount) || 0);
  if (!Array.isArray(splits) || !splits.length) {
    return [
      { categoryId: transaction?.categoryId || '__uncategorized', amount, baseAmount: total }
    ];
  }
  const totalCents = Math.round(Math.abs(total) * 100);
  const nativeCents = Math.round(amount * 100);
  let cumulative = 0;
  let priorBaseCents = 0;
  // Rounding cumulative shares makes the posted debits sum to the funding credit,
  // including when an individual FX conversion falls between two cents.
  return splits.map((split, index) => {
    const nativeAmount = Number(split?.amount) || 0;
    cumulative += Math.round(nativeAmount * 100);
    const nextBaseCents =
      index === splits.length - 1
        ? totalCents
        : nativeCents > 0
          ? Math.round((totalCents * cumulative) / nativeCents)
          : 0;
    const baseShare = (nextBaseCents - priorBaseCents) / 100;
    priorBaseCents = nextBaseCents;
    return {
      categoryId: split?.categoryId || '__uncategorized',
      amount: nativeAmount,
      baseAmount: total < 0 ? -baseShare : baseShare
    };
  });
}

export function addCategoryTotals(totals, allocations) {
  for (const { categoryId, baseAmount } of allocations) {
    totals[categoryId] = roundMoney((totals[categoryId] || 0) + baseAmount);
  }
}

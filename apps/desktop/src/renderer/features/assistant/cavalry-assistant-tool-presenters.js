import {
  getAccountBalances,
  getAccountUsage,
  getCategoryUsageSummary,
  roundMoney
} from '@cavalry/finance-core';

import { asArray, asObject, asText } from './cavalry-assistant-tool-definitions.js';

function collection(workbook, name) {
  return asArray(workbook && workbook[name]);
}

export function summarizeTransaction(transaction) {
  if (!transaction) return null;
  return {
    id: asText(transaction.id),
    date: asText(transaction.date),
    description: asText(transaction.description),
    template: asText(transaction.template),
    amount: Number(transaction.amount) || 0,
    baseAmount: Number(transaction.baseAmount) || 0,
    currency: asText(transaction.originalCurrency || transaction.currency),
    categoryId: asText(transaction.categoryId),
    counterpartyId: asText(transaction.counterpartyId),
    recurringItemId: asText(transaction.recurringItemId),
    recurringOccurrenceDate: asText(transaction.recurringOccurrenceDate),
    note: asText(transaction.note),
    reference: asText(transaction.reference),
    source: asText(transaction.source),
    lines: asArray(transaction.lines).map((line) => ({
      id: asText(line?.id),
      accountId: asText(line?.accountId),
      direction: asText(line?.direction),
      amount: Number(line?.amount) || 0,
      baseAmount: Number(line?.baseAmount) || 0,
      currency: asText(line?.currency)
    }))
  };
}

export function accountBalanceProjection(account, workbook, balances) {
  const accountId = asText(account?.id);
  const baseCurrency = asText(workbook?.currency).toUpperCase() || 'PHP';
  const configuredCurrency = asText(account?.currency).toUpperCase() || baseCurrency;
  const displayCurrency = asText(balances?.displayCurrency?.[accountId]) || configuredCurrency;
  const displayBalance = roundMoney(
    balances?.display?.[accountId] ?? balances?.native?.[accountId] ?? 0
  );
  const baseBalance = roundMoney(
    balances?.trustedBase?.[accountId] ??
      balances?.historical?.[accountId] ??
      balances?.valuation?.[accountId] ??
      0
  );
  const hasCurrencyIntegrityIssue = asArray(balances?.currencyIntegrityAccountIds).includes(
    accountId
  );
  const postingCurrencies = Object.keys(balances?.nativeByCurrency?.[accountId] || {}).sort();
  return {
    balance: displayBalance,
    currency: displayCurrency,
    configuredCurrency,
    baseBalance,
    baseCurrency,
    postingCurrencies,
    currencyIntegrityIssue: hasCurrencyIntegrityIssue,
    currencyMismatch: hasCurrencyIntegrityIssue || displayCurrency !== configuredCurrency,
    mixedCurrency: asArray(balances?.mixedCurrencyAccountIds).includes(accountId)
  };
}

export function summarizeAccount(account, workbook, options = {}) {
  if (!account) return null;
  const balances =
    options.balances || getAccountBalances(workbook, { asOfDate: asText(options.asOfDate) });
  const projection = accountBalanceProjection(account, workbook, balances);
  const usage = getAccountUsage(workbook, account.id);
  return {
    id: asText(account.id),
    name: asText(account.name),
    group: asText(account.group),
    subtype: asText(account.subtype),
    currency: projection.currency,
    configuredCurrency: projection.configuredCurrency,
    institution: asText(account.institution),
    institutionId: asText(account.institutionId),
    note: asText(account.note),
    openedDate: asText(account.openedDate),
    placementDate: asText(account.placementDate),
    maturityDate: asText(account.maturityDate),
    interestRate: Number(account.interestRate) || 0,
    estimatedMaturityAmount: Number(account.estimatedMaturityAmount) || 0,
    isActive: account.isActive !== false,
    isSystem: account.isSystem === true,
    balance: projection.balance,
    baseBalance: projection.baseBalance,
    baseCurrency: projection.baseCurrency,
    postingCurrencies: projection.postingCurrencies,
    currencyIntegrityIssue: projection.currencyIntegrityIssue,
    currencyMismatch: projection.currencyMismatch,
    mixedCurrency: projection.mixedCurrency,
    transactionCount: Number(usage.transactionCount) || 0
  };
}

export function summarizeCategory(category, workbook) {
  if (!category) return null;
  const usage = getCategoryUsageSummary(workbook, category.id);
  const linkedAccount = collection(workbook, 'accounts').find(
    (account) => asText(account && account.id) === asText(category.linkedAccountId)
  );
  return {
    id: asText(category.id),
    name: asText(category.name),
    type: asText(category.type),
    icon: asText(category.icon),
    color: asText(category.color),
    description: asText(category.description),
    plannerBucketId: asText(category.plannerBucketId),
    autoCategorizeRules: asArray(category.autoCategorizeRules).map((rule) => ({
      field: asText(rule?.field),
      operator: asText(rule?.operator),
      value: asText(rule?.value)
    })),
    isActive: category.isActive !== false,
    isSystem: category.isSystem === true,
    linkedAccountId: asText(category.linkedAccountId),
    linkedAccountName: asText(linkedAccount && linkedAccount.name),
    transactionCount: Number(usage.transactionCount) || 0,
    referenceCount: Number(usage.totalReferences) || 0
  };
}

export function summarizeRecurring(item) {
  if (!item) return null;
  return {
    id: asText(item.id),
    name: asText(item.name),
    kind: asText(item.kind),
    categoryId: asText(item.categoryId),
    accountId: asText(item.accountId),
    amount: Number(item.amount) || 0,
    currency: asText(item.currency),
    frequency: asText(item.frequency),
    anchorDate: asText(item.anchorDate || item.dueDate),
    autoRenew: item.autoRenew === true,
    isActive: item.isActive !== false,
    note: asText(item.note)
  };
}

export function summarizeCounterparty(counterparty) {
  if (!counterparty) return null;
  return {
    id: asText(counterparty.id),
    name: asText(counterparty.name),
    kind: asText(counterparty.kind),
    note: asText(counterparty.note),
    isActive: counterparty.isActive !== false
  };
}

export function transactionRow(row, workbook) {
  const accountNames = new Map(
    collection(workbook, 'accounts').map((account) => [asText(account.id), asText(account.name)])
  );
  return {
    id: asText(row.id),
    date: asText(row.date),
    description: asText(row.description),
    note: asText(row.note),
    template: asText(row.template),
    type: asText(row.type),
    eventKind: asText(row.eventKind),
    flowKind: asText(row.flowKind),
    amount: Number(row.amount) || 0,
    baseAmount: Number(row.baseAmount) || 0,
    signedBaseAmount: Number(row.signedBaseAmount) || 0,
    effects: {
      income: Number(row.contributions?.metrics?.income) || 0,
      expense: Number(row.contributions?.metrics?.expense) || 0,
      outflow: Number(row.contributions?.metrics?.outflow) || 0,
      categoryBudget: Number(row.contributions?.metrics?.categoryBudget) || 0,
      cashFlow: Number(row.contributions?.metrics?.cashFlow) || 0
    },
    contributionResolved: row.contributions?.resolved !== false,
    contributionWarnings: asArray(row.contributions?.warnings).map((warning) => ({
      code: asText(warning?.code),
      message: asText(warning?.message)
    })),
    hasMissingReference: row.hasMissingReference === true,
    categoryMissing: row.categoryMissing === true,
    missingAccountIds: asArray(row.missingAccountIds).map(asText),
    currency: asText(row.currency),
    categoryId: asText(row.categoryId),
    categoryName: asText(row.categoryLabel),
    accountId: asText(row.accountId),
    accountName: asText(row.accountLabel),
    counterpartyId: asText(row.transaction?.counterpartyId),
    counterpartyName: asText(row.counterpartyLabel),
    recurringItemId: asText(row.transaction?.recurringItemId),
    reference: asText(row.transaction?.reference),
    source: asText(row.transaction?.source),
    lines: asArray(row.transaction?.lines).map((line) => ({
      accountId: asText(line?.accountId),
      accountName: accountNames.get(asText(line?.accountId)) || '',
      direction: asText(line?.direction),
      amount: Number(line?.amount) || 0,
      baseAmount: Number(line?.baseAmount) || 0,
      currency: asText(line?.currency)
    }))
  };
}

export function safeEventList(events) {
  const idKeys = [
    'transactionId',
    'accountId',
    'categoryId',
    'recurringItemId',
    'counterpartyId',
    'sheetId'
  ];
  return asArray(events).map((event) => {
    const source = asObject(event);
    const payload = asObject(source.payload);
    const summary = { type: asText(source.type) };
    idKeys.forEach((key) => {
      const value = source[key] ?? payload[key];
      if (asText(value)) summary[key] = asText(value);
    });
    return summary;
  });
}

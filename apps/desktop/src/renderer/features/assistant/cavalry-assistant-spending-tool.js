import { buildTransactionTableView } from '@cavalry/finance-core';

import { asText, clampInteger, clonePlain } from './cavalry-assistant-tool-definitions.js';
import { envelope, resolveArgument, resolutionFailure } from './cavalry-assistant-tool-support.js';

const SPENDING_GROUP_KEYS = Object.freeze({
  category: (row) => asText(row.categoryLabel) || 'Uncategorized',
  counterparty: (row) => asText(row.counterpartyLabel) || 'No counterparty',
  account: (row) => asText(row.accountLabel) || 'No account',
  month: (row) => asText(row.date).slice(0, 7) || 'Undated'
});

export async function summarizeSpending(environment) {
  const args = environment.arguments;
  const workbook = environment.workbook;
  const groupBy = Object.prototype.hasOwnProperty.call(SPENDING_GROUP_KEYS, asText(args.groupBy))
    ? asText(args.groupBy)
    : 'category';
  const account = resolveArgument(workbook, args, {
    collection: 'accounts',
    keys: ['accountId', 'account'],
    label: 'Account',
    optional: true
  });
  if (!account.ok) return resolutionFailure(environment, account);
  const category = resolveArgument(workbook, args, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category',
    optional: true
  });
  if (!category.ok) return resolutionFailure(environment, category);
  const type = asText(args.type) || 'expense';
  const view = buildTransactionTableView(workbook, {
    type,
    accountId: account.id,
    categoryId: category.id,
    start: asText(args.start),
    end: asText(args.end),
    page: 1,
    pageSize: 1
  });
  const limit = clampInteger(args.limit, 1, 50, 20);
  const groupKey = SPENDING_GROUP_KEYS[groupBy];
  const groups = new Map();
  const trustedRows = view.allRows.filter(
    (row) => row.hasMissingReference !== true && row.contributions?.resolved !== false
  );
  trustedRows.forEach((row) => {
    const label = groupKey(row);
    const group = groups.get(label) || {
      label,
      total: 0,
      transactionCount: 0,
      firstDate: asText(row.date),
      lastDate: asText(row.date)
    };
    const signedAmount = Number(row.signedBaseAmount);
    const contributionAmount = Number.isFinite(signedAmount)
      ? signedAmount
      : Number(row.baseAmount) || 0;
    group.total = Math.round((group.total + contributionAmount) * 100) / 100;
    group.transactionCount += 1;
    const date = asText(row.date);
    if (date && (!group.firstDate || date < group.firstDate)) group.firstDate = date;
    if (date && (!group.lastDate || date > group.lastDate)) group.lastDate = date;
    groups.set(label, group);
  });
  const sortedGroups = Array.from(groups.values()).sort((left, right) => right.total - left.total);
  const visibleGroups = sortedGroups.slice(0, limit);
  const omittedGroups = sortedGroups.slice(limit);
  const grandTotal = sortedGroups.reduce((total, group) => total + group.total, 0);
  visibleGroups.forEach((group) => {
    group.share = grandTotal ? Math.round((group.total / grandTotal) * 1000) / 10 : 0;
  });
  const evidenceSourceRefs = trustedRows.map(
    (row) => `transaction:${encodeURIComponent(asText(row.id))}`
  );
  const evidenceSetId = `spending-summary-${asText(environment.toolCallId) || 'result'}`;
  const range = { start: asText(args.start), end: asText(args.end) };
  return envelope(environment.toolName, environment.toolCallId, {
    data: {
      groupBy,
      type,
      range,
      currency: asText(workbook.currency),
      filters: {
        accountId: account.id,
        categoryId: category.id
      },
      totals: clonePlain(view.totals),
      grandTotal: Math.round(grandTotal * 100) / 100,
      groups: visibleGroups,
      groupCount: sortedGroups.length,
      ...(omittedGroups.length
        ? {
            omitted: {
              groupCount: omittedGroups.length,
              total:
                Math.round(omittedGroups.reduce((total, group) => total + group.total, 0) * 100) /
                100
            }
          }
        : {}),
      transactionCount: trustedRows.length,
      matchedTransactionCount: view.allRows.length,
      unresolvedTransactionCount: view.allRows.length - trustedRows.length,
      evidenceSetId,
      evidenceSets: [
        {
          id: evidenceSetId,
          label: `Spending grouped by ${groupBy}`,
          kind: 'transaction',
          calculation: {
            operation: 'grouped_spending_totals',
            groupBy,
            type,
            range,
            transactionCount: evidenceSourceRefs.length,
            groupCount: sortedGroups.length
          }
        }
      ]
    },
    referenceData: {
      evidenceSets: [
        {
          id: evidenceSetId,
          kind: 'transaction',
          source_refs: evidenceSourceRefs
        }
      ]
    }
  });
}

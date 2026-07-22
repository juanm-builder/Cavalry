import { buildRecurringAnalysis } from '@cavalry/finance-core';

import { asArray, asText } from './cavalry-assistant-tool-definitions.js';
import { summarizeTransaction } from './cavalry-assistant-tool-presenters.js';

function recurringEvidenceStatus(candidate) {
  if (candidate.alreadyTracked) return 'confirmed_linked_charges';
  if (candidate.decision === 'not_subscription') return 'non_recurring';
  if (candidate.classification === 'likely_subscription') return 'likely_recurring';
  if (candidate.classification === 'maybe_subscription') return 'uncertain_recurring';
  if (candidate.classification === 'variable_expense') return 'variable_expense';
  return 'non_recurring';
}

function trackedRecurringEvidenceStatus(item) {
  if (item.isActive === false) return 'inactive_tracker';
  if (item.activityStatus === 'recent_charge_evidence') {
    return 'active_tracker_recent_charge';
  }
  if (item.activityStatus === 'stale_charge_evidence') {
    return 'active_tracker_stale_charge';
  }
  return 'active_tracker_no_linked_charge';
}

function countsBy(items, field) {
  return asArray(items).reduce((counts, item) => {
    const key = asText(item && item[field]) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function createRecurringAnalysisTools({ currentDate, envelope, recurringItemsWithLabels }) {
  async function listRecurringBills(environment) {
    const asOfDate = currentDate(environment.workbook, environment.services);
    const rows = recurringItemsWithLabels(
      environment.workbook,
      environment.arguments.includeArchived === true,
      asOfDate
    );
    return envelope(environment.toolName, environment.toolCallId, {
      data: { recurringItems: rows, count: rows.length, asOfDate }
    });
  }

  async function analyzeRecurringExpenses(environment) {
    const workbook = environment.workbook;
    const asOfDate = currentDate(workbook, environment.services);
    const analysis = buildRecurringAnalysis(workbook, {
      asOfDate,
      includeFalsePositives: true,
      includeIgnored: environment.arguments.includeIgnored === true
    });
    const recurringItems = asArray(analysis.recurringItems).map((item) => ({
      ...item,
      evidenceStatus: trackedRecurringEvidenceStatus(item)
    }));
    const recurringCandidates = asArray(analysis.candidates).map((candidate) => {
      const transactions = asArray(candidate.transactions)
        .map(summarizeTransaction)
        .filter(Boolean);
      const amounts = transactions.map((transaction) => Number(transaction.baseAmount));
      const finiteAmounts = amounts.filter(Number.isFinite);
      const evidenceSetId = `recurring-pattern-${asText(candidate.id)}`;
      return {
        id: asText(candidate.id),
        decisionKey: asText(candidate.decisionKey),
        decision: asText(candidate.decision),
        name: asText(candidate.name),
        evidenceStatus: recurringEvidenceStatus(candidate),
        classification: asText(candidate.classification),
        confidence: Number(candidate.confidence) || 0,
        reason: asText(candidate.reason),
        amount: Number(candidate.amount) || 0,
        baseAmount: Number(candidate.amount) || 0,
        amountRange: finiteAmounts.length
          ? { minimum: Math.min(...finiteAmounts), maximum: Math.max(...finiteAmounts) }
          : null,
        baseAmountRange: finiteAmounts.length
          ? { minimum: Math.min(...finiteAmounts), maximum: Math.max(...finiteAmounts) }
          : null,
        amountSpreadPercent: Number(candidate.amountSpreadPercent) || 0,
        currency: asText(candidate.currency),
        baseCurrency: asText(candidate.currency),
        suggestedFrequency: asText(candidate.suggestedFrequency),
        rhythm: asText(candidate.rhythm),
        rhythmConfidence: Number(candidate.rhythmConfidence) || 0,
        transactionCount: Number(candidate.transactionCount) || transactions.length,
        firstSeenDate: asText(candidate.firstSeenDate),
        lastSeenDate: asText(candidate.lastSeenDate),
        asOfDate: asText(candidate.asOfDate || asOfDate),
        activityStatus: asText(candidate.activityStatus),
        daysSinceLastSeen:
          candidate.daysSinceLastSeen == null ||
          !Number.isFinite(Number(candidate.daysSinceLastSeen))
            ? null
            : Number(candidate.daysSinceLastSeen),
        staleAfterDays: Number(candidate.staleAfterDays) || 0,
        isStale: candidate.isStale === true,
        categoryId: asText(candidate.categoryId),
        categoryName: asText(candidate.categoryName),
        accountId: asText(candidate.accountId),
        accountName: asText(candidate.accountName),
        alreadyTracked: candidate.alreadyTracked === true,
        existingRecurringItemId: asText(candidate.existingRecurringItemId),
        linkedTrackerStatus: asText(candidate.linkedTrackerStatus) || 'unknown',
        evidenceSetId,
        source_refs: transactions.map(
          (transaction) => `transaction:${encodeURIComponent(transaction.id)}`
        ),
        transactions
      };
    });
    return envelope(environment.toolName, environment.toolCallId, {
      data: {
        asOfDate,
        currency: asText(analysis.currency),
        recurringItems,
        recurringCandidates,
        evidenceSets: recurringCandidates.map((candidate) => ({
          id: candidate.evidenceSetId,
          label: `${candidate.name} recurring-pattern evidence`,
          kind: 'transaction',
          source_refs: candidate.source_refs,
          records: candidate.transactions,
          inference: {
            evidenceStatus: candidate.evidenceStatus,
            classification: candidate.classification,
            confidence: candidate.confidence,
            reason: candidate.reason,
            amount: candidate.amount,
            baseAmount: candidate.baseAmount,
            amountRange: candidate.amountRange,
            baseAmountRange: candidate.baseAmountRange,
            amountSpreadPercent: candidate.amountSpreadPercent,
            currency: candidate.currency,
            baseCurrency: candidate.baseCurrency,
            suggestedFrequency: candidate.suggestedFrequency,
            rhythm: candidate.rhythm,
            firstSeenDate: candidate.firstSeenDate,
            lastSeenDate: candidate.lastSeenDate,
            asOfDate: candidate.asOfDate,
            activityStatus: candidate.activityStatus,
            daysSinceLastSeen: candidate.daysSinceLastSeen,
            staleAfterDays: candidate.staleAfterDays,
            isStale: candidate.isStale,
            linkedTrackerStatus: candidate.linkedTrackerStatus,
            transactionCount: candidate.transactionCount
          }
        })),
        counts: {
          trackedItems: recurringItems.length,
          activeTrackers: recurringItems.filter((item) => item.isActive !== false).length,
          inactiveTrackers: recurringItems.filter((item) => item.isActive === false).length,
          confirmedLinkedCharges: recurringCandidates.filter(
            (item) => item.evidenceStatus === 'confirmed_linked_charges'
          ).length,
          likelyRecurring: recurringCandidates.filter(
            (item) => item.evidenceStatus === 'likely_recurring'
          ).length,
          uncertainRecurring: recurringCandidates.filter(
            (item) => item.evidenceStatus === 'uncertain_recurring'
          ).length,
          variableExpenses: recurringCandidates.filter(
            (item) => item.evidenceStatus === 'variable_expense'
          ).length,
          nonRecurring: recurringCandidates.filter(
            (item) => item.evidenceStatus === 'non_recurring'
          ).length,
          staleCandidateEvidence: recurringCandidates.filter((item) => item.isStale).length,
          byEvidenceStatus: countsBy([...recurringItems, ...recurringCandidates], 'evidenceStatus'),
          candidateActivity: countsBy(recurringCandidates, 'activityStatus')
        }
      }
    });
  }

  return { analyzeRecurringExpenses, listRecurringBills };
}

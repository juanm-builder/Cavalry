import {
  confirmRecurringReconciliationCommand,
  getRecurringOccurrencesForSheet,
  getRecurringScheduleSummary,
  reconcileRecurringOccurrences,
  submitManualTransactionCommand
} from '@cavalry/finance-core';
import { getRecurringItemForMonth } from '@cavalry/finance-core/application/recurring/recurring-schedule.js';

import { asText, hasOwn } from './cavalry-assistant-tool-definitions.js';
import {
  collection,
  commitCommand,
  currentDate,
  envelope,
  errorItem,
  failure,
  resolutionFailure,
  resolveArgument,
  safeEventList,
  summarizeRecurring,
  summarizeTransaction,
  transactionArguments
} from './cavalry-assistant-tool-support.js';

function recurringOccurrenceDateNearest(item, postingDate) {
  const schedule = getRecurringScheduleSummary(item, postingDate);
  const postingTime = Date.parse(`${asText(postingDate)}T00:00:00Z`);
  return [schedule.currentOccurrenceDate, schedule.nextExpectedDate]
    .filter(Boolean)
    .sort((left, right) => {
      const leftDistance = Math.abs(Date.parse(`${left}T00:00:00Z`) - postingTime);
      const rightDistance = Math.abs(Date.parse(`${right}T00:00:00Z`) - postingTime);
      return leftDistance - rightDistance || left.localeCompare(right);
    })[0];
}

function shiftedMonthKey(date, offset) {
  const month = new Date(`${asText(date).slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(month.getTime())) return '';
  month.setUTCMonth(month.getUTCMonth() + offset);
  return month.toISOString().slice(0, 7);
}

function recurringOccurrencesForReconciliation(workbook, occurrenceDate) {
  const virtualSheets = [-1, 0, 1]
    .map((offset) => shiftedMonthKey(occurrenceDate, offset))
    .filter(Boolean)
    .map((monthKey) => ({ monthKey }));
  const occurrences = [...collection(workbook, 'sheets'), ...virtualSheets].flatMap((sheet) =>
    getRecurringOccurrencesForSheet(workbook, sheet)
  );
  return [
    ...occurrences
      .reduce((byOccurrence, occurrence) => {
        const key = `${asText(occurrence && occurrence.recurringItemId)}::${asText(
          occurrence && occurrence.dueDate
        )}`;
        if (!byOccurrence.has(key)) byOccurrence.set(key, occurrence);
        return byOccurrence;
      }, new Map())
      .values()
  ];
}

function reconciliationCommandServices(services = {}) {
  return {
    ...(typeof services.createId === 'function'
      ? { createId: (...args) => services.createId(...args) }
      : {}),
    ...(services.clock && typeof services.clock.now === 'function'
      ? { now: () => services.clock.now() }
      : typeof services.now === 'function'
        ? { now: () => services.now() }
        : services.now
          ? { now: services.now }
          : {})
  };
}

function existingBillPaymentData(recurringItem, occurrenceDate, reconciliation, workbook) {
  const transaction =
    reconciliation.transaction || reconciliation.settlement?.allocations?.[0]?.transaction || null;
  return {
    recurringItem: summarizeRecurring(recurringItem),
    transaction: summarizeTransaction(transaction, workbook),
    occurrenceDate,
    alreadyRecorded: true,
    reconciliation: {
      decision: 'matched',
      method: reconciliation.matchType || 'stored',
      confidence: Number(reconciliation.candidate?.confidence) || 100
    }
  };
}

function applyRemainingPaymentDefault(prepared, occurrence, reconciliation, args) {
  if (reconciliation.decision !== 'partial' || reconciliation.candidate || hasOwn(args, 'amount')) {
    return;
  }
  const expectedBaseAmount = Number(occurrence && occurrence.amount) || 0;
  const originalAmount = Number(occurrence && occurrence.originalAmount) || expectedBaseAmount;
  const remainingBaseAmount = Number(reconciliation.settlement?.remainingBaseAmount) || 0;
  const remainingAmount =
    expectedBaseAmount > 0
      ? Math.round(((originalAmount * remainingBaseAmount) / expectedBaseAmount) * 100) / 100
      : remainingBaseAmount;
  if (remainingAmount > 0) prepared.payload.amount = remainingAmount;
}

export async function payBill(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  const request = asText(environment.context?.question);
  if (request) {
    const reportedPayment =
      /\b(?:i|we)\s+(?:(?:have|already|just)\s+)*(?:paid|prepaid)\b|\b(?:was|were|has been|have been)\s+(?:already\s+)?(?:paid|charged)\b|\bcharged\s+(?:me|us|my\s+card)\b/i.test(
        request
      );
    const explicitRecord =
      /\b(?:record|log|enter|add|mark)\b[\s\S]{0,80}\b(?:payment|prepayment|paid|actual charge)\b/i.test(
        request
      );
    const negated =
      /\b(?:do not|don't|don’t|never)\s+(?:record|log|enter|add|pay)\b|\b(?:haven't|haven’t|have not|had not|didn't|did not|not yet|not)\s+(?:been\s+)?(?:paid|prepaid|charged)\b/i.test(
        request
      );
    const plannedOnly =
      /\b(?:expected|planned|scheduled|upcoming)\b/i.test(request) && !reportedPayment;
    if (negated || (!reportedPayment && (!explicitRecord || plannedOnly))) {
      return failure(
        environment,
        'validation_failed',
        'recurring.payment-intent-required',
        'Changing an expected charge does not record a payment. Has this already been paid, or should I only update the tracker?'
      );
    }
  }
  const resolved = resolveArgument(workbook, args, {
    collection: 'recurringItems',
    keys: ['recurringItemId', 'bill'],
    label: 'Bill or subscription'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  const sourceItem = resolved.value;
  if (sourceItem.isActive === false) {
    return failure(
      environment,
      'validation_failed',
      'recurring_item_inactive',
      'Restore this bill or subscription before recording a payment.',
      'bill'
    );
  }

  const postingDate = asText(args.date) || currentDate(workbook, environment.services);
  const occurrenceDate = recurringOccurrenceDateNearest(sourceItem, postingDate);
  if (!occurrenceDate) {
    return failure(
      environment,
      'validation_failed',
      'recurring_occurrence_unavailable',
      'Choose a valid posting date for a bill or subscription with a valid schedule.',
      'date'
    );
  }

  const recurringItem = getRecurringItemForMonth(sourceItem, occurrenceDate.slice(0, 7));

  const transactionArgs = {
    ...args,
    ...(hasOwn(args, 'accountId') ? { primaryAccountId: args.accountId } : {}),
    ...(hasOwn(args, 'account') ? { primaryAccount: args.account } : {})
  };
  const prepared = transactionArguments(workbook, transactionArgs, {
    transactionId: '',
    template: 'expense_paid',
    amount: Number(recurringItem.amount) || 0,
    currency: asText(recurringItem.currency || workbook.currency) || 'PHP',
    date: currentDate(workbook, environment.services),
    fxRateToBase: 0,
    description: asText(recurringItem.name) || 'Bill payment',
    categoryId: asText(recurringItem.categoryId),
    primaryAccountId: asText(recurringItem.accountId),
    secondaryAccountId: '',
    counterpartyId: asText(recurringItem.counterpartyId),
    counterpartyName: '',
    counterpartyKind: 'biller',
    note: asText(recurringItem.note),
    recurringItemId: resolved.id,
    recurringOccurrenceDate: occurrenceDate,
    recurringTrackingMode: 'link',
    sourceRoute: 'bills',
    allowDuplicate: false
  });
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);

  const category = collection(workbook, 'categories').find(
    (item) => asText(item && item.id) === asText(prepared.payload.categoryId)
  );
  if (!(category && category.type === 'expense' && category.isActive !== false)) {
    return failure(
      environment,
      'validation_failed',
      'recurring_expense_category_required',
      'Choose an active expense category before recording this payment.',
      'category'
    );
  }
  const account = collection(workbook, 'accounts').find(
    (item) => asText(item && item.id) === asText(prepared.payload.primaryAccountId)
  );
  if (!(
    account &&
    account.isActive !== false &&
    (account.group === 'asset' || account.group === 'liability')
  )) {
    return failure(
      environment,
      'validation_failed',
      'recurring_payment_account_required',
      'Choose an active asset or liability payment account before recording this payment.',
      'account'
    );
  }
  prepared.payload.template = account.group === 'liability' ? 'expense_charged' : 'expense_paid';

  const allOccurrences = recurringOccurrencesForReconciliation(workbook, occurrenceDate);
  const occurrence = allOccurrences.find(
    (candidate) =>
      asText(candidate && candidate.recurringItemId) === resolved.id &&
      asText(candidate && candidate.dueDate) === occurrenceDate
  );
  if (!occurrence) {
    return failure(
      environment,
      'validation_failed',
      'recurring_occurrence_unavailable',
      'Cavalry could not resolve the scheduled occurrence for this payment.',
      'date'
    );
  }
  const occurrenceIndex = allOccurrences.indexOf(occurrence);
  const reconciliation = reconcileRecurringOccurrences(
    workbook,
    allOccurrences,
    collection(workbook, 'transactions')
  ).results[occurrenceIndex];
  if (reconciliation.decision === 'matched' && reconciliation.transaction) {
    const data = existingBillPaymentData(recurringItem, occurrenceDate, reconciliation, workbook);
    if (reconciliation.matchType === 'stored') {
      return envelope(environment.toolName, environment.toolCallId, { data });
    }
    const candidate = reconciliation.candidate;
    const command = confirmRecurringReconciliationCommand(
      workbook,
      {
        recurringItemId: resolved.id,
        occurrenceDate,
        transactionId: reconciliation.transaction.id,
        method: reconciliation.matchType || 'automatic',
        confidence: Number(candidate && candidate.confidence) || 100,
        matchSignals: candidate && candidate.signals
      },
      reconciliationCommandServices(environment.services)
    );
    const commandResult = command.ok
      ? {
          ok: true,
          workbook: command.workbook,
          record: command.record,
          events: [
            {
              type: 'recurring/reconciliation-confirmed',
              payload: {
                recurringItemId: resolved.id,
                occurrenceDate,
                transactionId: reconciliation.transaction.id
              }
            },
            { type: 'schedule-save' },
            { type: 'render' }
          ],
          warnings: [],
          errors: []
        }
      : {
          ok: false,
          workbook,
          events: [],
          warnings: [],
          errors: [command.error]
        };
    return commitCommand(
      environment,
      commandResult,
      'assistant_bill_reconciled',
      (_next, committed) => ({ ...data, events: safeEventList(committed.events) })
    );
  }
  if (
    reconciliation.candidate &&
    (reconciliation.decision === 'review' || reconciliation.decision === 'partial') &&
    args.allowDuplicate !== true
  ) {
    const candidate = reconciliation.candidate;
    const message =
      reconciliation.decision === 'partial'
        ? 'This occurrence is partly paid and Cavalry found another possible matching transaction. Review that match before recording another payment.'
        : 'Cavalry found a possible matching transaction. Review that match before recording another payment.';
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'confirmation_required',
      data: {
        recurringItem: summarizeRecurring(recurringItem),
        occurrenceDate,
        candidateTransaction: summarizeTransaction(candidate.transaction, workbook),
        reconciliation: {
          decision: reconciliation.decision,
          confidence: Number(candidate.confidence) || 0,
          remainingAmount: Number(reconciliation.settlement?.remainingBaseAmount) || 0
        }
      },
      errors: [errorItem('recurring_match_needs_review', message, 'allowDuplicate')],
      confirmation: {
        required: true,
        field: 'allowDuplicate',
        action: 'post a new payment despite the possible recurring match',
        message: `${message} Record another payment anyway?`
      }
    });
  }

  applyRemainingPaymentDefault(prepared, occurrence, reconciliation, args);
  const result = submitManualTransactionCommand(workbook, prepared.payload, environment.services);
  return commitCommand(environment, result, 'assistant_bill_paid', (next, command) => ({
    recurringItem: summarizeRecurring(recurringItem),
    transaction: summarizeTransaction(command.transaction, next),
    occurrenceDate,
    events: safeEventList(command.events)
  }));
}

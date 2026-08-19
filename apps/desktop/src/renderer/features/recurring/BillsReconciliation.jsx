import React from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function emit(onAction, type, payload = {}) {
  return typeof onAction === 'function' ? onAction({ type, payload }) : undefined;
}

function formatReconciliationDate(value) {
  const source = asText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) return source;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ][month - 1];
  return monthLabel && day >= 1 && day <= 31 ? `${monthLabel} ${day}` : source;
}

export function getRowReconciliation(row) {
  const provided = row && row.reconciliation;
  const allowedStates = ['matched', 'candidate', 'partial', 'unmatched'];
  if (provided && allowedStates.includes(provided.state)) {
    return {
      ...provided,
      transaction: provided.transaction || null
    };
  }

  if (row && row.possibleTransaction) {
    const transaction = row.possibleTransaction;
    return {
      state: 'candidate',
      source: 'legacy-possible-match',
      statusLabel: 'Review match',
      title: 'Possible transaction match',
      detail: [
        transaction.description,
        formatReconciliationDate(transaction.date),
        transaction.amountCopy || row.amountCopy,
        transaction.accountName
      ]
        .filter(Boolean)
        .join(' • '),
      explanation:
        row.possibleMatchLabel || 'Review this transaction before marking the occurrence complete.',
      transaction,
      canConfirm: false,
      canReject: false,
      canUndo: false
    };
  }

  return { state: 'unmatched', transaction: null };
}

export function getReconciliationTone(reconciliation, fallbackTone) {
  if (reconciliation.state === 'matched') return 'good';
  if (reconciliation.state === 'candidate') return 'info';
  if (reconciliation.state === 'partial') return 'warn';
  return fallbackTone || 'warn';
}

function getReconciliationTitle(reconciliation) {
  if (reconciliation.title) return reconciliation.title;
  if (reconciliation.state === 'candidate') return 'Likely transaction found';
  if (reconciliation.state === 'partial') return 'Partially matched';
  return reconciliation.source === 'automatic' ? 'Matched automatically' : 'Transaction matched';
}

function getReconciliationDetail(reconciliation) {
  if (reconciliation.detail) return reconciliation.detail;
  const transaction = reconciliation.transaction || {};
  return [
    transaction.description,
    formatReconciliationDate(transaction.date),
    transaction.amountCopy,
    transaction.accountName
  ]
    .filter(Boolean)
    .join(' • ');
}

export function getReconciliationPayload(row, reconciliation) {
  return {
    rowId: asText(row.id),
    recurringItemId: asText(row.recurringItemId),
    occurrenceDate: asText(row.dueDate),
    transactionId: asText(reconciliation.transaction && reconciliation.transaction.id)
  };
}

export function ReconciliationProof({ reconciliation }) {
  const title = getReconciliationTitle(reconciliation);
  const detail = getReconciliationDetail(reconciliation);
  const explanation = asText(reconciliation.explanation);
  const tone = getReconciliationTone(reconciliation, 'warn');
  return (
    <div
      className={`bill-reconciliation-proof ${tone}`}
      data-reconciliation-state={reconciliation.state}
    >
      <Icon name={reconciliation.state === 'partial' ? 'pending_actions' : 'check_circle'} />
      <span>
        <strong>{title}</strong>
        {detail || explanation ? (
          <small>{[detail, explanation].filter(Boolean).join(' • ')}</small>
        ) : null}
      </span>
    </div>
  );
}

export function ReconciliationReview({ row, reconciliation, onAction }) {
  const transactionId = asText(reconciliation.transaction && reconciliation.transaction.id);
  const payload = getReconciliationPayload(row, reconciliation);
  return (
    <section
      aria-label={`Review transaction match for ${row.name}`}
      className="bill-reconciliation-review"
      data-reconciliation-state="candidate"
    >
      <Icon className="bill-reconciliation-review-icon" name="rule" />
      <div className="bill-reconciliation-review-copy">
        <strong>{getReconciliationTitle(reconciliation)}</strong>
        {getReconciliationDetail(reconciliation) ? (
          <span>{getReconciliationDetail(reconciliation)}</span>
        ) : null}
        {reconciliation.explanation ? <small>{reconciliation.explanation}</small> : null}
      </div>
      <div className="bill-reconciliation-review-actions">
        {reconciliation.canReject ? (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => emit(onAction, 'reject-recurring-transaction-match', payload)}
          >
            Not this
          </button>
        ) : null}
        {transactionId ? (
          <button
            className="btn"
            type="button"
            onClick={() => emit(onAction, 'open-transaction-detail', { transactionId })}
          >
            View
          </button>
        ) : null}
        {reconciliation.canConfirm ? (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => emit(onAction, 'confirm-recurring-transaction-match', payload)}
          >
            Confirm match
          </button>
        ) : null}
      </div>
    </section>
  );
}

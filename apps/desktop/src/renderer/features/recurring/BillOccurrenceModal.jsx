import React from 'react';
import { createPortal } from 'react-dom';
import { PrivateValue } from '../../shared/PrivateValue.jsx';
import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import {
  getReconciliationPayload,
  getReconciliationTone,
  getRowReconciliation
} from './BillsReconciliation.jsx';

function shortDate(value) {
  return String(value || '').replace(/^([A-Za-z]{3})[a-z]+ /, '$1 ');
}

function transactionDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value || '';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T00:00:00Z`));
}

function emit(onAction, type, payload = {}) {
  return typeof onAction === 'function' ? onAction({ type, payload }) : undefined;
}

function TransactionMatch({ row, reconciliation, onAction }) {
  const transaction = reconciliation.transaction;
  if (!transaction) return null;
  const candidate = reconciliation.state === 'candidate';
  const explanation = reconciliation.explanation || reconciliation.detail;
  const source =
    reconciliation.source === 'automatic'
      ? 'Automatic'
      : reconciliation.source === 'manual'
        ? 'Confirmed'
        : 'Linked';
  return (
    <section className="bill-detail-match" data-reconciliation-state={reconciliation.state}>
      <div className="bill-detail-match-heading">
        <h4>{candidate ? reconciliation.title || 'Review match' : 'Matched transaction'}</h4>
        {!candidate ? (
          <span
            className={`bill-detail-match-source ${reconciliation.state === 'matched' ? 'good' : ''}`}
          >
            {reconciliation.state === 'matched' ? <CavalryIcon name="check_circle" /> : null}
            {source}
          </span>
        ) : null}
      </div>
      <div className="bill-detail-transaction">
        <CavalryIcon name="receipt_long" />
        <div>
          <PrivateValue as="strong">{transaction.description || row.name}</PrivateValue>
          <PrivateValue as="small">
            {[transactionDate(transaction.date), transaction.accountName]
              .filter(Boolean)
              .join(' · ')}
          </PrivateValue>
        </div>
        <PrivateValue as="strong" className="bill-detail-transaction-amount">
          {transaction.amountCopy}
        </PrivateValue>
      </div>
      {explanation ? (
        <details className="bill-detail-evidence">
          <summary>
            <CavalryIcon name="chevron_right" />
            Why this matched
          </summary>
          <PrivateValue as="p">{explanation}</PrivateValue>
        </details>
      ) : null}
      {candidate ? (
        <div className="bill-detail-review-actions">
          {reconciliation.canReject ? (
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() =>
                emit(
                  onAction,
                  'reject-recurring-transaction-match',
                  getReconciliationPayload(row, reconciliation)
                )
              }
            >
              Not this
            </button>
          ) : null}
          <button
            className="btn"
            type="button"
            onClick={() =>
              emit(onAction, 'open-transaction-detail', { transactionId: transaction.id })
            }
          >
            View transaction
          </button>
          {reconciliation.canConfirm ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() =>
                emit(
                  onAction,
                  'confirm-recurring-transaction-match',
                  getReconciliationPayload(row, reconciliation)
                )
              }
            >
              Confirm match
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function BillOccurrenceModal({ row, onAction, onEdit, onClose }) {
  const dismiss = useModalDismiss(() => onClose(true), Boolean(row));
  if (!row) return null;
  const reconciliation = getRowReconciliation(row);
  const linkedTransaction =
    row.transaction ||
    (['matched', 'partial'].includes(reconciliation.state) ? reconciliation.transaction : null);
  const status =
    reconciliation.statusLabel ||
    (row.status === 'Expected charge not recorded' ? 'Not recorded' : row.status);
  const content = (
    <div className="modal-backdrop" data-modal-backdrop="true" onMouseDown={dismiss}>
      <PrivateValue
        as="div"
        aria-label={`${row.name} occurrence details`}
        aria-modal="true"
        className="modal-card bill-occurrence-modal"
        role="dialog"
      >
        <div className="bill-detail-header">
          <CavalryIcon
            className="bill-detail-recurring-icon"
            name={row.kind === 'subscription' ? 'sync' : 'receipt_long'}
          />
          <div>
            <PrivateValue as="h3">{row.name}</PrivateValue>
            <PrivateValue as="p">
              {[row.frequency, row.paymentMethod].filter(Boolean).join(' · ')}
            </PrivateValue>
          </div>
          <button
            aria-label="Close occurrence details"
            className="btn btn-icon bill-detail-close"
            onClick={() => onClose(true)}
            type="button"
          >
            <CavalryIcon name="close" />
          </button>
        </div>
        <div className="bill-detail-summary">
          <div>
            <PrivateValue as="strong" className="bill-detail-amount">
              {row.amountCopy || row.dueAmountCopy}
            </PrivateValue>
            <span className="bill-detail-label">Expected amount</span>
          </div>
          <PrivateValue
            as="span"
            className={`bill-detail-status ${getReconciliationTone(reconciliation, row.tone)}`}
          >
            {reconciliation.state === 'matched' ? <CavalryIcon name="check_circle" /> : null}
            {status}
          </PrivateValue>
        </div>
        <dl className="bill-detail-facts">
          <div>
            <dt>Expected date</dt>
            <PrivateValue as="dd">{shortDate(row.dueDateCopy || row.dueDate)}</PrivateValue>
          </div>
          <div>
            <dt>Category</dt>
            <PrivateValue as="dd">{row.categoryName || 'Uncategorized'}</PrivateValue>
          </div>
        </dl>
        {reconciliation.state === 'partial' ? (
          <PrivateValue as="p" className="bill-detail-partial">
            {reconciliation.detail} recorded · {row.dueAmountCopy} remains
          </PrivateValue>
        ) : null}
        {['matched', 'partial', 'candidate'].includes(reconciliation.state) ? (
          <TransactionMatch row={row} reconciliation={reconciliation} onAction={onAction} />
        ) : (
          <p className="bill-detail-unmatched">No transaction recorded yet.</p>
        )}
        {reconciliation.pendingCandidate ? (
          <TransactionMatch
            row={row}
            reconciliation={reconciliation.pendingCandidate}
            onAction={onAction}
          />
        ) : null}
        <div className="bill-detail-footer">
          <button className="btn" onClick={() => onEdit(row)} type="button">
            <CavalryIcon name="edit" />
            Edit recurring rule
          </button>
          {linkedTransaction ? (
            <button
              className="btn btn-primary"
              onClick={() =>
                emit(onAction, 'open-transaction-detail', { transactionId: linkedTransaction.id })
              }
              type="button"
            >
              <CavalryIcon name="receipt_long" />
              View transaction
            </button>
          ) : null}
        </div>
      </PrivateValue>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

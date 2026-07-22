import React from 'react';
import { createPortal } from 'react-dom';

import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

function DetailField({ label, value, className = '' }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={className}>{value || '—'}</dd>
    </div>
  );
}

export function AccountTransactionDetailModal({ transaction, onClose }) {
  const dismiss = useModalDismiss(onClose, !!transaction);
  if (!transaction || typeof document === 'undefined') return null;

  const title = transaction.description || 'Transaction';
  const changeTone = transaction.changeTone || (Number(transaction.change) >= 0 ? 'good' : 'bad');

  return createPortal(
    <div
      className="modal-backdrop account-transaction-detail-backdrop"
      data-react-modal="account-transaction-detail"
      onMouseDown={dismiss}
    >
      <section
        aria-label={`Transaction details for ${title}`}
        aria-modal="true"
        className="modal-card account-transaction-detail-modal"
        role="dialog"
      >
        <header className="account-transaction-detail-header">
          <div className="account-transaction-detail-heading">
            <span className={`account-transaction-detail-mark ${changeTone}`}>
              <Icon name={transaction.icon || 'receipt_long'} />
            </span>
            <div>
              <span className="account-transaction-detail-kicker">Transaction details</span>
              <h2>{title}</h2>
              <p>
                {transaction.date || 'No date'}
                {transaction.typeLabel ? ` · ${transaction.typeLabel}` : ''}
              </p>
            </div>
          </div>
          <button
            aria-label="Close transaction details"
            autoFocus
            className="btn btn-icon"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="account-transaction-detail-impact">
          <span>Impact on {transaction.accountName || 'this account'}</span>
          <strong className={changeTone}>{transaction.changeCopy || '—'}</strong>
        </div>

        <section aria-label="Balance impact" className="account-transaction-balance-flow">
          <div>
            <span>Balance before</span>
            <strong>{transaction.beforeBalanceCopy || '—'}</strong>
          </div>
          <div className={`account-transaction-flow-change ${changeTone}`}>
            <Icon name="arrow_forward" />
            <small>Change</small>
            <b>{transaction.changeCopy || '—'}</b>
          </div>
          <div>
            <span>Balance after</span>
            <strong className={transaction.balanceTone || ''}>
              {transaction.balanceCopy || '—'}
            </strong>
          </div>
        </section>

        <dl className="account-transaction-detail-list">
          <DetailField label="Account" value={transaction.accountName} />
          <DetailField label="Category" value={transaction.categoryName} />
          <DetailField label="Transaction total" value={transaction.amountCopy} />
          {transaction.relatedAccountCopy ? (
            <DetailField label="Related account" value={transaction.relatedAccountCopy} />
          ) : null}
          <DetailField
            className="account-transaction-note"
            label="Note"
            value={transaction.note || 'No note added'}
          />
        </dl>

        <footer className="modal-actions account-transaction-detail-actions">
          <button className="btn btn-primary" onClick={onClose} type="button">
            Done
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

import { PrivateValue } from '../../shared/PrivateValue.jsx';
import React from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';

import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function DetailField({ label, value, className = '' }) {
  return (
    <div>
      <PrivateValue as="dt">{label}</PrivateValue>
      <PrivateValue as="dd" className={className}>
        {value || '—'}
      </PrivateValue>
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
      <PrivateValue
        as="section"
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
            <div className="account-transaction-detail-copy">
              <span className="account-transaction-detail-kicker">Transaction details</span>
              <PrivateValue as="h2" title={title}>
                {title}
              </PrivateValue>
              <PrivateValue as="p">
                {transaction.date || 'No date'}
                {transaction.typeLabel ? ` · ${transaction.typeLabel}` : ''}
              </PrivateValue>
            </div>
          </div>
          <button
            aria-label="Close transaction details"
            autoFocus
            className="btn btn-icon account-transaction-detail-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="account-transaction-detail-impact">
          <PrivateValue as="span">
            Impact on {transaction.accountName || 'this account'}
          </PrivateValue>
          <PrivateValue as="strong" className={changeTone}>
            {transaction.changeCopy || '—'}
          </PrivateValue>
        </div>

        <section aria-label="Balance impact" className="account-transaction-balance-flow">
          <div>
            <span>Balance before</span>
            <PrivateValue as="strong">{transaction.beforeBalanceCopy || '—'}</PrivateValue>
          </div>
          <div className={`account-transaction-flow-change ${changeTone}`}>
            <Icon name="arrow_forward" />
            <small>Change</small>
            <PrivateValue as="b">{transaction.changeCopy || '—'}</PrivateValue>
          </div>
          <div>
            <span>Balance after</span>
            <PrivateValue as="strong" className={transaction.balanceTone || ''}>
              {transaction.balanceCopy || '—'}
            </PrivateValue>
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
      </PrivateValue>
    </div>,
    document.body
  );
}

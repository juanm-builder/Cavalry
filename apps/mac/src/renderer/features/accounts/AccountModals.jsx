import React, { useEffect } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function ModalFrame({ title, error, children, onCancel, className = '' }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <section
        aria-labelledby="account-modal-title"
        aria-modal="true"
        className={`modal-card account-create-modal ${className}`}
        role="dialog"
      >
        <div className="page-header">
          <h2 id="account-modal-title">{title}</h2>
          <button aria-label="Close" className="btn btn-icon" onClick={onCancel} type="button">
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <div className="panel-note status-bad" role="alert">
            {error}
          </div>
        ) : null}
        {children}
      </section>
    </div>
  );
}
export { AccountCreateWizard } from './AccountCreateWizard.jsx';

function formatCurrency(value, currency) {
  const code = String(currency || 'PHP').toUpperCase();
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${code} ${(Number(value) || 0).toFixed(2)}`;
  }
}

export function AccountCurrencyRepairModal({ account, preview, error, onCancel, onConfirm }) {
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const canConfirm = preview?.ok === true && preview?.requiresConfirmation === true;
  const postingCurrencies = Array.isArray(preview?.postingCurrencies)
    ? preview.postingCurrencies.join(', ')
    : '';
  return (
    <ModalFrame
      className="account-currency-repair-modal"
      error={error}
      onCancel={onCancel}
      title="Review Currency Repair"
    >
      <div className="stack-list">
        <div className="panel-note status-warn" role="alert">
          <strong>This corrects a setup mistake; it does not convert money.</strong>
          <br />
          Cavalry will keep every transaction’s existing {preview?.baseCurrency ||
            'base-currency'}{' '}
          book value and will not apply an exchange rate.
        </div>
        <div className="account-detail-grid">
          <span>Account</span>
          <b>{account?.name || preview?.accountName || 'Account'}</b>
          <span>Current setting</span>
          <b>{preview?.configuredCurrency || '—'}</b>
          <span>Ledger postings</span>
          <b>{postingCurrencies || 'No recorded currency'}</b>
          <span>Correct setting</span>
          <b>{preview?.targetCurrency || '—'}</b>
          <span>Transactions affected</span>
          <b>{preview?.affectedTransactionCount ?? 0}</b>
          <span>Book value before</span>
          <b>{formatCurrency(preview?.before?.historicalBaseBalance, preview?.baseCurrency)}</b>
          <span>Book value after</span>
          <b>{formatCurrency(preview?.after?.historicalBaseBalance, preview?.baseCurrency)}</b>
        </div>
        {blockers.length ? (
          <div className="panel-note status-bad" role="alert">
            <strong>Automatic repair is not safe for this account.</strong>
            <ul>
              {blockers.map((blocker, index) => (
                <li key={`${blocker?.code || 'blocker'}-${index}`}>
                  {blocker?.message || String(blocker)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} type="button">
            {canConfirm ? 'Cancel' : 'Close'}
          </button>
          {canConfirm ? (
            <button className="btn btn-primary" onClick={onConfirm} type="button">
              Correct Account to {preview.targetCurrency}
            </button>
          ) : null}
        </div>
      </div>
    </ModalFrame>
  );
}

export function AccountConfirmationModal({ mode, account, error, onCancel, onConfirm }) {
  const content = {
    archive: {
      title: 'Archive Account',
      button: 'Archive Account',
      copy: 'The account will stay in workbook history but will no longer appear in normal entry choices.'
    },
    restore: {
      title: 'Restore Account',
      button: 'Restore Account',
      copy: 'The account will become available for new transactions again.'
    },
    retire: {
      title: 'Retire Liability Account',
      button: 'Retire Account',
      copy: 'The liability will remain in historical reports and be hidden from new entries.'
    },
    delete: {
      title: 'Delete Account',
      button: 'Delete Account',
      copy: account?.hasReferences
        ? 'This account is referenced, so Cavalry will archive it instead of deleting history.'
        : 'Unused accounts can be permanently deleted. Opening-balance-only setup entries are removed with them.'
    }
  }[mode];
  return (
    <ModalFrame error={error} onCancel={onCancel} title={content.title}>
      <div className="stack-list">
        <p className="panel-note">
          <strong>{account?.name}</strong>
          <br />
          {content.copy}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} type="button">
            {content.button}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

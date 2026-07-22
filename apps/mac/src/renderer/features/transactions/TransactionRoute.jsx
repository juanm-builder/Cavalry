import React from 'react';

import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';
import { InstitutionMark } from '../../shared/InstitutionSelect.jsx';
import { ImportPreviewModal } from '../import-export/ImportPreviewModal.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import { TransactionEditModal } from './TransactionEditModal.jsx';
import { FilterSidePanel, InlineFilterToolbar } from './TransactionFilters.jsx';

function Icon({ name, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded${className ? ` ${className}` : ''}`}
    >
      {name}
    </span>
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function PageHeader({ title, subtitle, children }) {
  return (
    <section className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      <div className="page-actions">{children}</div>
    </section>
  );
}

function StatCard({ label, value, subtitle, icon, tone, action, payload = {} }) {
  const actions = useActionBindings();
  const body = (
    <>
      <div className="finance-stat-copy">
        <label>{label}</label>
        <b>{value}</b>
        <span>{subtitle || ''}</span>
      </div>
      {icon ? <Icon className="finance-stat-icon" name={icon} /> : null}
    </>
  );
  const className = `finance-stat-card ${tone || ''}${action ? ' finance-stat-action' : ''}`;
  if (action) {
    return (
      <button className={className} type="button" {...actions.action(action, payload)}>
        {body}
      </button>
    );
  }
  return <article className={className}>{body}</article>;
}

function TypeTabs({ activeType }) {
  const actions = useActionBindings();
  const types = [
    ['all', 'All Transactions'],
    ['income', 'Income'],
    ['expense', 'Expenses'],
    ['transfer', 'Transfers']
  ];
  return (
    <div className="pill-tabs">
      {types.map(([type, label]) => (
        <button
          key={type}
          className={activeType === type ? 'active' : ''}
          type="button"
          {...actions.action('set-ledger-type', { ledgerType: type })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TransactionCell({ cell }) {
  const data = asObject(cell);
  const className = data.className || 'transaction-cell';
  if (data.kind === 'entity') {
    return (
      <td className={className}>
        <div className="entity-cell inline-entity-cell transaction-entity-cell">
          <span>
            <strong>{data.value || ''}</strong>
            <small className="transaction-origin-line">
              {data.subtitle || ''}
              {data.isAiOrigin ? (
                <span
                  aria-label="Added by Cavalry"
                  className="transaction-origin-emoji"
                  role="img"
                  title="Added by Cavalry"
                >
                  ✨
                </span>
              ) : null}
            </small>
          </span>
        </div>
      </td>
    );
  }
  if (data.kind === 'category') {
    return (
      <td className={className}>
        <span className={`category-dot ${data.tone || 'info'}`} />
        {data.value || 'Uncategorized'}
      </td>
    );
  }
  if (data.kind === 'status') {
    return (
      <td className={className}>
        <span className={`status-pill ${data.tone || 'info'}`}>{data.value || 'Transaction'}</span>
      </td>
    );
  }
  return <td className={className}>{data.value || ''}</td>;
}

function TransactionTable({
  rows = [],
  emptyState,
  selectedTransactionId = '',
  showRunningBalance = false
}) {
  const actions = useActionBindings();
  const createBinding = actions.action('open-ledger-composer');

  const createEntry = (
    <button
      aria-label="Create transaction"
      className="transaction-create-entry"
      type="button"
      {...createBinding}
    >
      <span className="transaction-create-entry-icon">
        <Icon name="add" />
      </span>
      <span>
        <strong>Create transaction</strong>
        <small>Record a new money movement</small>
      </span>
    </button>
  );

  function openTransaction(row, event) {
    if (event.target.closest('button, details, summary, a, input, select')) return;
    actions.action('open-transaction-detail', { transactionId: row.id }).onClick?.(event);
  }

  if (!rows.length) {
    return (
      <div className="transaction-empty-register">
        {createEntry}
        <div className="empty-state compact-empty">
          <strong>{emptyState || 'No transactions match this view.'}</strong>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`table-shell finance-table-shell${showRunningBalance ? ' transaction-table-with-balance' : ''}`}
    >
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Category</th>
            <th>Account</th>
            <th className="amount">Amount</th>
            {showRunningBalance ? <th className="amount">Balance after</th> : null}
          </tr>
        </thead>
        <tbody>
          <tr className="transaction-create-row">
            <td colSpan={showRunningBalance ? 6 : 5}>{createEntry}</td>
          </tr>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`transaction-row${
                row.id === selectedTransactionId ? ' transaction-selected' : ''
              }`}
              onClick={(event) => openTransaction(row, event)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') openTransaction(row, event);
              }}
              tabIndex="0"
            >
              {asArray(row.cells).map((cell) => (
                <TransactionCell key={cell.field} cell={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ pagination }) {
  const data = asObject(pagination);
  const actions = useActionBindings();
  if (!data.visible) {
    return null;
  }
  return (
    <div className="table-pagination">
      <button
        className="btn"
        type="button"
        {...actions.action('ledger-prev-page')}
        disabled={data.currentPage <= 1}
      >
        <Icon name="chevron_left" />
        Previous
      </button>
      {data.currentPage > 1 ? (
        <button className="btn" type="button" {...actions.action('ledger-first-page')}>
          <Icon name="first_page" />
          Page 1
        </button>
      ) : null}
      <span className="table-page-copy">{data.copy}</span>
      <label className="rows-per-page">
        Rows per page:
        <select
          aria-label="Transaction rows per page"
          value={String(data.pageSize || 12)}
          {...actions.change('set-ledger-page-size', {}, { valueType: 'number' })}
        >
          <option value="12">12</option>
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
      </label>
      <button
        className="btn"
        type="button"
        {...actions.action('ledger-next-page')}
        disabled={data.currentPage >= data.totalPages}
      >
        Next
        <Icon name="chevron_right" />
      </button>
    </div>
  );
}

function ModalHeader({ badge, title, detail }) {
  const actions = useActionBindings();
  return (
    <div className="panel-header">
      <div>
        <div className="badge">
          <Icon name="receipt_long" />
          {badge}
        </div>
        <h3>{title}</h3>
        {detail ? <p>{detail}</p> : null}
      </div>
      <button
        className="btn btn-icon"
        type="button"
        {...actions.action('close-modal')}
        title="Close"
        aria-label="Close"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

function MessageList({ errors = [], warnings = [] }) {
  const messages = [
    ...asArray(errors).map((item) => ({ ...item, tone: 'status-bad' })),
    ...asArray(warnings).map((item) => ({ ...item, tone: 'status-warn' }))
  ];
  if (!messages.length) return null;
  return (
    <div className="stack-list" role="alert">
      {messages.map((message, index) => (
        <div key={`${message.code || 'message'}-${index}`} className={`panel-note ${message.tone}`}>
          {message.message || String(message)}
        </div>
      ))}
    </div>
  );
}

function warningConfirmationCopy(warnings, fallback = 'Post Anyway') {
  return asArray(warnings).some(
    (warning) => warning?.code === 'account_currency_conversion_confirmation_required'
  )
    ? 'Confirm Conversion & Post'
    : fallback;
}

function LegacyComposerModal({ modal }) {
  const data = asObject(modal);
  const draft = asObject(data.draft);
  const options = asObject(data.options);
  const actions = useActionBindings();
  const closeModal = actions.action('close-modal');
  const dismiss = useModalDismiss(closeModal.onClick);
  const needsSecondary = ['transfer', 'debt_payment', 'liability_payment'].includes(draft.template);
  const selectedAccountCurrencies = [draft.primaryAccountId, draft.secondaryAccountId]
    .map(
      (accountId) =>
        asArray(options.accounts).find((account) => account.value === accountId)?.currency
    )
    .filter(Boolean);
  const showFxRate =
    draft.currency === 'USD' ||
    selectedAccountCurrencies.some((currency) => currency !== draft.currency);
  const fieldBinding = (field, bindingOptions) =>
    actions.change('transaction-composer-change', { field }, bindingOptions);
  return (
    <div className="modal-backdrop" data-react-modal="transaction-composer" onMouseDown={dismiss}>
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-label={data.title || 'Transaction editor'}
      >
        <ModalHeader
          badge={data.mode === 'edit' ? 'Edit Transaction' : 'New Transaction'}
          title={data.title}
          detail="Post a balanced transaction. Nothing is saved until this form succeeds."
        />
        <div className="stack-list">
          <div className="field-grid">
            <div className="field">
              <label htmlFor="transaction-template">Type</label>
              <select
                id="transaction-template"
                value={draft.template || 'expense_paid'}
                {...fieldBinding('template')}
              >
                {asArray(options.templates).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="transaction-date">Date</label>
              <input
                id="transaction-date"
                type="date"
                value={draft.date || ''}
                {...fieldBinding('date')}
              />
            </div>
            <div className="field">
              <label htmlFor="transaction-description">Description</label>
              <input
                id="transaction-description"
                type="text"
                value={draft.description || ''}
                {...fieldBinding('description')}
              />
            </div>
            <div className="field">
              <label htmlFor="transaction-amount">Amount</label>
              <FinancialValueInput
                allowNegative={false}
                id="transaction-amount"
                min="0"
                value={draft.amount || ''}
                {...fieldBinding('amount')}
              />
            </div>
            <div className="field">
              <label htmlFor="transaction-currency">Currency</label>
              <select
                id="transaction-currency"
                value={draft.currency || 'PHP'}
                {...fieldBinding('currency')}
              >
                {asArray(options.currencies).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="transaction-category">Category</label>
              <CategorizedSelect
                aria-label="Category"
                id="transaction-category"
                options={options.categories}
                placeholder="Choose category"
                value={draft.categoryId || ''}
                {...fieldBinding('categoryId')}
              />
            </div>
            <div className="field">
              <label htmlFor="transaction-primary-account">Primary account</label>
              <select
                id="transaction-primary-account"
                value={draft.primaryAccountId || ''}
                {...fieldBinding('primaryAccountId')}
              >
                <option value="">Choose account</option>
                {asArray(options.accounts).map((option) => (
                  <option disabled={option.disabled} key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {needsSecondary ? (
              <div className="field">
                <label htmlFor="transaction-secondary-account">Secondary account</label>
                <select
                  id="transaction-secondary-account"
                  value={draft.secondaryAccountId || ''}
                  {...fieldBinding('secondaryAccountId')}
                >
                  <option value="">Choose account</option>
                  {asArray(options.accounts).map((option) => (
                    <option disabled={option.disabled} key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {showFxRate ? (
              <div className="field">
                <label htmlFor="transaction-fx-rate">FX rate to base</label>
                <input
                  id="transaction-fx-rate"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.fxRateToBase || ''}
                  {...fieldBinding('fxRateToBase')}
                />
              </div>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="transaction-note">Note</label>
            <textarea
              id="transaction-note"
              rows="3"
              value={draft.note || ''}
              {...fieldBinding('note')}
            />
          </div>
          <MessageList errors={data.errors} warnings={data.warnings} />
          <div className="modal-actions">
            <button className="btn" type="button" {...actions.action('close-modal')}>
              Cancel
            </button>
            {asArray(data.warnings).length ? (
              <button
                className="btn btn-primary"
                type="button"
                {...actions.action('confirm-transaction-warnings')}
              >
                {warningConfirmationCopy(data.warnings)}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                {...actions.action('submit-transaction')}
              >
                <Icon name="save" />
                {data.mode === 'edit' ? 'Save Changes' : 'Add Transaction'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionKindBadge({ kind }) {
  const data = asObject(kind);
  if (!data.label) return null;
  return (
    <div className={`transaction-kind-badge ${data.tone || 'info'}`}>
      <Icon name={data.icon || 'receipt_long'} />
      <span>{data.label}</span>
    </div>
  );
}

function TransactionWizardHeader({ modal }) {
  const data = asObject(modal);
  const actions = useActionBindings();
  const canGoBack = data.step !== 'type';
  return (
    <header className="transaction-wizard-header">
      <div className="transaction-wizard-title">
        {canGoBack ? (
          <button
            aria-label="Back"
            className="btn btn-icon transaction-wizard-back"
            type="button"
            {...actions.action('transaction-composer-back')}
          >
            <Icon name="arrow_back" />
          </button>
        ) : null}
        <h2>{data.title || 'Add Transaction'}</h2>
      </div>
      <button
        aria-label="Close"
        className="btn btn-icon transaction-wizard-close"
        title="Close"
        type="button"
        {...actions.action('close-modal')}
      >
        <Icon name="close" />
      </button>
    </header>
  );
}

function TransactionTypeStep({ modal }) {
  const data = asObject(modal);
  const actions = useActionBindings();
  return (
    <div className="transaction-wizard-step transaction-type-step">
      <p className="transaction-wizard-prompt">What kind of transaction is this?</p>
      <div className="transaction-type-options">
        {asArray(data.kindOptions).map((option) => (
          <button
            aria-label={option.label}
            aria-pressed={data.kind?.kind === option.kind}
            className={`transaction-type-option ${option.tone || 'info'}`}
            key={option.template}
            type="button"
            {...actions.action('choose-transaction-type', { template: option.template })}
          >
            <span className="transaction-type-icon">
              <Icon name={option.icon} />
            </span>
            <span className="transaction-type-copy">
              <strong>{option.label}</strong>
              <span>{option.description}</span>
              <small>{option.example}</small>
            </span>
            <Icon className="transaction-type-chevron" name="chevron_right" />
          </button>
        ))}
      </div>
      <MessageList errors={data.errors} />
      <div className="transaction-wizard-cancel">
        <button className="btn" type="button" {...actions.action('close-modal')}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TransactionAccountField({
  field,
  id,
  label,
  value,
  options,
  selected,
  disabledOptionId = '',
  placeholder = 'Choose account'
}) {
  const actions = useActionBindings();
  return (
    <div className="field transaction-account-field">
      <label htmlFor={id}>{label}</label>
      <div className="transaction-account-control">
        <span className="transaction-create-account-mark">
          <InstitutionMark
            fallbackIcon={selected?.icon || 'account_balance_wallet'}
            institutionId={selected?.institutionId}
          />
        </span>
        <select
          id={id}
          value={value || ''}
          {...actions.change('transaction-composer-change', { field })}
        >
          <option value="">{placeholder}</option>
          {asArray(options).map((option) => (
            <option
              disabled={option.disabled || option.value === disabledOptionId}
              key={option.value}
              value={option.value}
            >
              {option.name || option.label} · {option.contextLabel} — {option.balanceLabel}
              {option.hasCurrencyIntegrityIssue ? ' · Repair currency first' : ''}
            </option>
          ))}
        </select>
        {selected ? (
          <small>
            {selected.contextLabel} · {selected.balanceLabel}
            {selected.contextKind === 'credit_card' ? ' owed' : ''}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function TransactionDetailsStep({ modal }) {
  const data = asObject(modal);
  const draft = asObject(data.draft);
  const kind = asObject(data.kind);
  const options = asObject(data.options);
  const selection = asObject(data.selection);
  const actions = useActionBindings();
  const isTransfer = kind.kind === 'transfer';
  const isIncome = kind.kind === 'income';
  const guidance = asObject(data.guidance);
  const fieldBinding = (field, bindingOptions) =>
    actions.change('transaction-composer-change', { field }, bindingOptions);
  return (
    <div className="transaction-wizard-step transaction-details-step">
      <TransactionKindBadge kind={kind} />
      <div className="transaction-wizard-fields">
        <TransactionAccountField
          field="primaryAccountId"
          id="transaction-from-account"
          label={data.primaryAccountLabel || (isIncome ? 'To account' : 'From account')}
          options={options.accounts}
          placeholder={data.primaryAccountPlaceholder}
          selected={selection.primaryAccount}
          value={draft.primaryAccountId}
        />
        {isTransfer ? (
          <TransactionAccountField
            disabledOptionId={draft.primaryAccountId}
            field="secondaryAccountId"
            id="transaction-to-account"
            label={data.secondaryAccountLabel || 'To account'}
            options={options.accounts}
            selected={selection.secondaryAccount}
            value={draft.secondaryAccountId}
          />
        ) : null}
        {guidance.message ? (
          <div className={`transaction-create-guidance ${guidance.tone || 'info'}`}>
            <span className="transaction-create-guidance-icon">
              <Icon name={guidance.icon || 'info'} />
            </span>
            <span>
              <strong>{guidance.title}</strong>
              <small>{guidance.message}</small>
            </span>
          </div>
        ) : null}
        <div className={`transaction-money-fields${data.showCurrency ? '' : ' single'}`}>
          <div className="field">
            <label htmlFor="transaction-amount">{data.amountLabel || 'Amount'}</label>
            <FinancialValueInput
              allowNegative={false}
              id="transaction-amount"
              min="0"
              value={draft.amount || ''}
              {...fieldBinding('amount')}
            />
          </div>
          {data.showCurrency ? (
            <div className="field transaction-currency-field">
              <label htmlFor="transaction-currency">Currency</label>
              <select
                id="transaction-currency"
                value={draft.currency || 'PHP'}
                {...fieldBinding('currency')}
              >
                {asArray(options.currencies).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="transaction-date">Date</label>
          <input
            id="transaction-date"
            type="date"
            value={draft.date || ''}
            {...fieldBinding('date')}
          />
        </div>
        {!isTransfer ? (
          <div className="field">
            <label htmlFor="transaction-category">{isIncome ? 'Source' : 'Category'}</label>
            <CategorizedSelect
              aria-label={isIncome ? 'Source' : 'Category'}
              id="transaction-category"
              options={options.categories}
              placeholder={isIncome ? 'Choose source' : 'Choose category'}
              value={draft.categoryId || ''}
              {...fieldBinding('categoryId')}
            />
          </div>
        ) : null}
        {!isTransfer ? (
          <div className="field">
            <label htmlFor="transaction-description">Description</label>
            <input
              id="transaction-description"
              placeholder={isIncome ? 'e.g. July salary' : 'What was this for?'}
              type="text"
              value={draft.description || ''}
              {...fieldBinding('description')}
            />
          </div>
        ) : null}
        {data.showFxRate ? (
          <div className="field">
            <label htmlFor="transaction-fx-rate">FX rate to base</label>
            <input
              id="transaction-fx-rate"
              min="0"
              step="0.0001"
              type="number"
              value={draft.fxRateToBase || ''}
              {...fieldBinding('fxRateToBase')}
            />
            <small>
              {data.fxRateLabel ? `${data.fxRateLabel}. ` : ''}Enter the rate used for this
              transaction; Cavalry will not infer it silently.
            </small>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="transaction-note">Note (optional)</label>
          <textarea
            id="transaction-note"
            placeholder="Add a note…"
            rows="3"
            value={draft.note || ''}
            {...fieldBinding('note')}
          />
        </div>
      </div>
      <MessageList errors={data.errors} warnings={data.warnings} />
      <button
        className={`btn btn-primary transaction-wizard-next${isIncome ? ' good' : ''}`}
        type="button"
        {...actions.action('review-transaction')}
      >
        Next
        <Icon name="arrow_forward" />
      </button>
    </div>
  );
}

function TransactionReviewStep({ modal }) {
  const data = asObject(modal);
  const impact = asObject(data.impact);
  const actions = useActionBindings();
  const hasWarnings = asArray(data.warnings).length > 0;
  return (
    <div className="transaction-wizard-step transaction-review-step">
      <TransactionKindBadge kind={data.kind} />
      <div className="transaction-review-card">
        {asArray(data.reviewRows).map((row) => (
          <div className="transaction-review-row" key={row.label}>
            <span>{row.label}</span>
            <strong className={row.tone || ''}>
              <span>
                {row.icon ? <Icon name={row.icon} /> : null}
                {row.value || '—'}
              </span>
              {row.detail ? <small>{row.detail}</small> : null}
            </strong>
          </div>
        ))}
      </div>
      {impact.prefix ? (
        <div className={`transaction-impact ${impact.tone || 'info'}`}>
          <span className="transaction-impact-icon">
            <Icon name={impact.icon || 'info'} />
          </span>
          <p>
            {impact.prefix}
            {impact.amount ? (
              <>
                {' '}
                <strong>{impact.amount}</strong>
                {impact.suffix || '.'}
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      <MessageList errors={data.errors} warnings={data.warnings} />
      <div className="transaction-review-actions">
        <button className="btn" type="button" {...actions.action('edit-transaction-details')}>
          Edit Details
        </button>
        <button
          className={`btn btn-primary transaction-wizard-submit${
            data.kind?.kind === 'income' ? ' good' : ''
          }`}
          type="button"
          {...actions.action(hasWarnings ? 'confirm-transaction-warnings' : 'submit-transaction')}
        >
          <Icon name="check_box" />
          {hasWarnings ? warningConfirmationCopy(data.warnings) : 'Add Transaction'}
        </button>
      </div>
    </div>
  );
}

function CreateTransactionWizard({ modal }) {
  const data = asObject(modal);
  const actions = useActionBindings();
  const closeModal = actions.action('close-modal');
  const dismiss = useModalDismiss(closeModal.onClick);
  return (
    <div className="modal-backdrop" data-react-modal="transaction-composer" onMouseDown={dismiss}>
      <div
        aria-label={data.title || 'Add Transaction'}
        aria-modal="true"
        className={`modal-card transaction-wizard transaction-wizard-${data.step || 'type'}`}
        role="dialog"
      >
        <TransactionWizardHeader modal={data} />
        {data.step === 'type' ? <TransactionTypeStep modal={data} /> : null}
        {data.step === 'details' ? <TransactionDetailsStep modal={data} /> : null}
        {data.step === 'review' ? <TransactionReviewStep modal={data} /> : null}
      </div>
    </div>
  );
}

function ComposerModal({ modal }) {
  const data = asObject(modal);
  if (data.mode === 'create') return <CreateTransactionWizard modal={data} />;
  if (data.context) return <TransactionEditModal modal={data} />;
  return <LegacyComposerModal modal={data} />;
}

function DeleteModal({ modal }) {
  const data = asObject(modal);
  const actions = useActionBindings();
  const closeModal = actions.action('close-modal');
  const dismiss = useModalDismiss(closeModal.onClick);
  return (
    <div className="modal-backdrop" data-react-modal="transaction-delete" onMouseDown={dismiss}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Delete transaction">
        <ModalHeader
          badge="Delete Transaction"
          title={data.description || 'Transaction'}
          detail="Review exactly what will be removed before deleting this posting."
        />
        <div className="kpi-list">
          <div className="list-row">
            <div className="meta">
              <b>Date</b>
            </div>
            <div>{data.date}</div>
          </div>
          <div className="list-row">
            <div className="meta">
              <b>Amount</b>
            </div>
            <div className="amount">{data.amount}</div>
          </div>
        </div>
        <MessageList errors={data.errors} />
        <div className="modal-actions">
          <button className="btn" type="button" {...actions.action('close-modal')}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            type="button"
            {...actions.action('confirm-delete-transaction', { transactionId: data.transactionId })}
          >
            <Icon name="delete" />
            Delete Transaction
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, tone = '' }) {
  return (
    <div className="transaction-detail-field">
      <span>{label}</span>
      <strong className={tone}>{value || '—'}</strong>
    </div>
  );
}

function DetailSidePanel({ modal }) {
  const data = asObject(modal);
  const actions = useActionBindings();
  return (
    <aside
      aria-label="Transaction detail"
      aria-modal="false"
      className="transaction-side-panel transaction-detail-panel"
      data-react-panel="transaction-detail"
      role="dialog"
    >
      <div className="transaction-side-panel-header transaction-detail-header">
        <div className="transaction-detail-heading">
          <span className="transaction-detail-mark">
            <Icon name={data.icon || 'receipt_long'} />
          </span>
          <div>
            <div className="transaction-detail-title-row">
              <h2>{data.title}</h2>
            </div>
            <small>{data.displayDate || data.date}</small>
          </div>
        </div>
        <button
          aria-label="Close transaction detail"
          className="btn btn-icon"
          type="button"
          {...actions.action('close-modal')}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={`transaction-detail-amount ${data.tone || ''}`}>{data.amount}</div>
      <div className="transaction-detail-summary">
        <DetailField
          label={data.beforeLabel || 'Balance before'}
          value={data.beforeBalance}
          tone={data.beforeTone}
        />
        <div className="transaction-detail-change">
          <span>
            <b>{data.movementLabel || data.typeLabel}</b>
            <small>{data.title}</small>
          </span>
          <strong className={data.changeTone || data.tone || ''}>
            {data.accountChange || data.amount}
          </strong>
        </div>
        <DetailField
          label={data.afterLabel || 'Balance after'}
          value={data.afterBalance}
          tone={data.afterTone}
        />
      </div>
      <div className="transaction-detail-card">
        <DetailField label={data.accountLabel || 'Account'} value={data.account} />
        <DetailField label="Category" value={data.category} />
        <DetailField label="Type" value={data.typeLabel} tone={data.tone || ''} />
        <DetailField label="Note" value={data.note} />
      </div>
      <div className="transaction-side-panel-actions">
        <button
          className="btn btn-primary transaction-edit-button"
          type="button"
          {...actions.action('open-transaction-editor', { transactionId: data.transactionId })}
        >
          <Icon name="edit" />
          Edit Transaction
        </button>
        <button
          aria-label="More transaction actions"
          className="btn btn-icon"
          type="button"
          {...actions.action('delete-transaction', { transactionId: data.transactionId })}
        >
          <Icon name="more_horiz" />
        </button>
      </div>
    </aside>
  );
}

function TransactionModal({ modal }) {
  if (!modal) return null;
  if (modal.type === 'composer') return <ComposerModal modal={modal} />;
  if (modal.type === 'delete') return <DeleteModal modal={modal} />;
  return null;
}

function TransactionRouteView({ model }) {
  const data = asObject(model);
  const actions = useActionBindings();
  const detailOpen = asObject(data.modal).type === 'detail';
  const sidePanelOpen = detailOpen || data.filterOpen;
  return (
    <>
      <section className="transactions-page" data-react-route="transactions">
        <PageHeader title="Transactions">
          <button className="btn" type="button" {...actions.action('export-workbook')}>
            <Icon name="download" />
            Export
          </button>
          <button className="btn" type="button" {...actions.action('export-csv-bundle')}>
            <Icon name="table_view" />
            Export CSV
          </button>
          <button className="btn" type="button" {...actions.action('trigger-csv-import')}>
            <Icon name="upload_file" />
            Import CSV
          </button>
        </PageHeader>
        <section className="summary-card-grid">
          {asArray(data.stats).map((card) => (
            <StatCard key={card.id || card.label} {...card} />
          ))}
        </section>
        <div className={`transaction-workspace${sidePanelOpen ? ' has-side-panel' : ''}`}>
          <section className="reference-card transaction-register-card">
            <div className="transaction-type-toolbar">
              <TypeTabs activeType={data.filterType || 'all'} />
            </div>
            <InlineFilterToolbar
              activeFilterCount={data.activeFilterCount}
              filterOpen={data.filterOpen}
              filters={data.filters}
              options={data.filterOptions}
            />
            <TransactionTable
              emptyState={data.emptyState}
              rows={asArray(data.rows)}
              selectedTransactionId={detailOpen ? data.modal.transactionId : ''}
              showRunningBalance={data.showRunningBalance}
            />
            <Pagination pagination={data.pagination} />
          </section>
          {detailOpen ? (
            <DetailSidePanel modal={data.modal} />
          ) : data.filterOpen ? (
            <FilterSidePanel
              activeFilterCount={data.activeFilterCount}
              filters={data.filters}
              options={data.filterOptions}
            />
          ) : null}
        </div>
      </section>
      <TransactionModal modal={data.modal} />
      {data.importPreview ? <ImportPreviewModal model={data.importPreview} /> : null}
    </>
  );
}

export function TransactionRoute({ model, onAction }) {
  return (
    <ActionBindingProvider onAction={onAction}>
      <TransactionRouteView model={model} />
    </ActionBindingProvider>
  );
}

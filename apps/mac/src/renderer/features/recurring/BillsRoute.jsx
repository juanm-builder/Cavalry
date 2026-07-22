import React, { useEffect, useState } from 'react';

import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { FinancialValueInput, formatFinancialValue } from '../../shared/FinancialValueInput.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import {
  getReconciliationPayload,
  getReconciliationTone,
  getRowReconciliation,
  ReconciliationProof,
  ReconciliationReview
} from './BillsReconciliation.jsx';

function Icon({ name, className = '' }) {
  return (
    <span className={`material-symbols-rounded${className ? ` ${className}` : ''}`}>{name}</span>
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function emit(onAction, type, payload = {}) {
  return typeof onAction === 'function' ? onAction({ type, payload }) : undefined;
}

function PageHeader({ title, children }) {
  return (
    <section className="page-header">
      <div>
        <h1>{title}</h1>
      </div>
      <div className="page-actions">{children}</div>
    </section>
  );
}

function ControlSelect({ icon, label, options = [], value, className = '', onChange }) {
  return (
    <label className={`bill-control-select ${className}`}>
      {icon ? <Icon name={icon} /> : null}
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value || ''}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {asArray(options).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon className="select-caret" name="expand_more" />
    </label>
  );
}

function SummaryPill({ tone, status, label, value, detail, onAction }) {
  return (
    <button
      className={`bill-summary-pill ${tone || ''}`}
      type="button"
      onClick={() => emit(onAction, 'set-bills-status', { billsStatus: status })}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function KindTabs({ activeKind, onAction }) {
  const tabs = [
    ['all', 'All'],
    ['bill', 'Bills'],
    ['subscription', 'Subscriptions']
  ];
  return (
    <div className="pill-tabs">
      {tabs.map(([kind, label]) => (
        <button
          key={kind}
          className={activeKind === kind ? 'active' : ''}
          type="button"
          onClick={() => emit(onAction, 'set-bills-kind', { billsKind: kind })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ActionMenu({ children }) {
  return (
    <details className="action-menu">
      <summary
        className="btn btn-icon action-menu-trigger"
        title="Bill actions"
        aria-label="Bill actions"
      >
        <Icon name="more_vert" />
      </summary>
      <div className="action-menu-popover">{children}</div>
    </details>
  );
}

function StatusPill({ status, tone }) {
  return <span className={`status-pill ${tone || 'info'}`}>{status || 'Upcoming'}</span>;
}

function EditorModal({ initialValues, options, onAction, onClose }) {
  const dismiss = useModalDismiss(() => onClose(true));
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState('');
  const isSubscription = values.kind === 'subscription';
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  function submit(event) {
    event.preventDefault();
    if (!String(values.name || '').trim()) {
      setError('Name is required.');
      return;
    }
    if (!values.categoryId) {
      setError('Pick an expense or debt category.');
      return;
    }
    if (!values.dueDate) {
      setError('Choose a valid due date.');
      return;
    }
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid amount.');
      return;
    }
    const result = emit(onAction, 'save-recurring-item', {
      ...values,
      amount,
      autoRenew: values.autoRenew === true,
      isActive: values.isActive !== false
    });
    if (result && result.ok === false) {
      setError(
        result.errors && result.errors[0]
          ? result.errors[0].message
          : 'The recurring item could not be saved.'
      );
      return;
    }
    onClose(false);
  }

  return (
    <div className="modal-backdrop" data-modal-backdrop="true" onMouseDown={dismiss}>
      <div
        className="modal-card modal-card-wide bill-form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${values.recurringItemId ? 'Edit' : 'Add'} bill or subscription`}
      >
        <div className="bill-form-header">
          <div>
            <h3>
              {values.recurringItemId
                ? `Edit ${isSubscription ? 'Subscription' : 'Bill'}`
                : `Add ${isSubscription ? 'Subscription' : 'Bill'}`}
            </h3>
            <p>
              {isSubscription
                ? 'Track a recurring service or membership'
                : 'Create a recurring payment reminder'}
            </p>
          </div>
          <button
            className="btn btn-icon"
            type="button"
            onClick={() => onClose(true)}
            title="Close"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>
        <form className="bill-subscription-form" onSubmit={submit} noValidate>
          <div className="bill-kind-toggle">
            <label className={!isSubscription ? 'active' : ''}>
              <input
                type="radio"
                name="kind"
                value="bill"
                checked={!isSubscription}
                onChange={() => update('kind', 'bill')}
              />
              <Icon name="receipt_long" />
              Bill
            </label>
            <label className={isSubscription ? 'active' : ''}>
              <input
                type="radio"
                name="kind"
                value="subscription"
                checked={isSubscription}
                onChange={() => update('kind', 'subscription')}
              />
              <Icon name="sync" />
              Subscription
            </label>
          </div>
          {error ? (
            <div className="panel-note status-bad" role="alert">
              {error}
            </div>
          ) : null}
          <div className="bill-form-body">
            <div className="bill-form-grid">
              <div className="field">
                <label>{isSubscription ? 'Service Name *' : 'Name *'}</label>
                <input
                  aria-label="Recurring name"
                  type="text"
                  name="name"
                  value={values.name || ''}
                  onChange={(event) => update('name', event.currentTarget.value)}
                />
              </div>
              <div className="field">
                <label>Amount *</label>
                <FinancialValueInput
                  allowNegative={false}
                  aria-label="Recurring amount"
                  min="0"
                  name="amount"
                  value={values.amount || ''}
                  onChange={(event) => update('amount', event.currentTarget.value)}
                />
              </div>
              <div className="field">
                <label>{isSubscription ? 'Billing Anchor Date *' : 'Due Date *'}</label>
                <input
                  aria-label="Recurring due date"
                  type="date"
                  name="dueDate"
                  value={values.dueDate || ''}
                  onChange={(event) => update('dueDate', event.currentTarget.value)}
                />
                {isSubscription ? (
                  <small>
                    Used to calculate each expected charge; it may be a past known date.
                  </small>
                ) : null}
              </div>
              <div className="field">
                <label>{isSubscription ? 'Billing Cycle *' : 'Frequency *'}</label>
                <select
                  aria-label="Recurring frequency"
                  name="frequency"
                  value={values.frequency || 'Monthly'}
                  onChange={(event) => update('frequency', event.currentTarget.value)}
                >
                  {asArray(options.frequencies).map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {frequency}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Category *</label>
                <CategorizedSelect
                  aria-label="Recurring category"
                  name="categoryId"
                  options={options.categories}
                  placeholder="Select category"
                  value={values.categoryId || ''}
                  onChange={(event) => update('categoryId', event.currentTarget.value)}
                />
              </div>
              <div className="field">
                <label>Payment Method</label>
                <select
                  aria-label="Recurring payment account"
                  name="accountId"
                  value={values.accountId || ''}
                  onChange={(event) => update('accountId', event.currentTarget.value)}
                >
                  <option value="">Not set</option>
                  {asArray(options.accounts).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {isSubscription ? (
                <label className="bill-auto-renew-toggle bill-form-full">
                  <input
                    type="checkbox"
                    name="autoRenew"
                    checked={values.autoRenew === true}
                    onChange={(event) => update('autoRenew', event.currentTarget.checked)}
                  />
                  <Icon name="autorenew" />
                  <span>
                    <strong>Auto-renews</strong>
                    <small>Show this as a recurring subscription renewal.</small>
                  </span>
                </label>
              ) : null}
              <div className="field bill-form-full">
                <label>
                  Notes <span className="label-optional">(Optional)</span>
                </label>
                <textarea
                  name="note"
                  value={values.note || ''}
                  onChange={(event) => update('note', event.currentTarget.value)}
                />
              </div>
            </div>
            <aside className="bill-preview-panel">
              <span className="tag">Preview</span>
              <div className="bill-preview-row">
                <Icon
                  className={`mini-icon ${isSubscription ? 'info' : 'warn'}`}
                  name={isSubscription ? 'sync' : 'receipt_long'}
                />
                <span>
                  <strong>{values.name || (isSubscription ? 'Netflix' : 'Internet')}</strong>
                  <small>{values.frequency || 'Monthly'}</small>
                </span>
              </div>
              <div className="bill-preview-details">
                <span>{values.dueDate || 'Due date'}</span>
                <b className="amount">
                  {formatFinancialValue(values.amount || 0)} {options.currency}
                </b>
              </div>
              <div className="bill-preview-footer">
                <StatusPill status="Upcoming" tone="warn" />
              </div>
            </aside>
          </div>
          <div className="bill-form-footer">
            <label className="bill-active-toggle">
              <input
                type="checkbox"
                name="isActive"
                checked={values.isActive !== false}
                onChange={(event) => update('isActive', event.currentTarget.checked)}
              />
              <span>
                <strong>Active</strong>
                <small>Inactive items stay saved but stay out of Due Next.</small>
              </span>
            </label>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => onClose(true)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit">
                Save {isSubscription ? 'Subscription' : 'Bill'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ArchiveModal({ row, onAction, onClose }) {
  const [error, setError] = useState('');
  const dismiss = useModalDismiss(() => onClose(true));
  function archive() {
    const result = emit(onAction, 'archive-recurring-item', {
      recurringItemId: row.recurringItemId
    });
    if (result && result.ok === false) {
      setError(
        result.errors && result.errors[0]
          ? result.errors[0].message
          : 'The recurring item could not be archived.'
      );
      return;
    }
    onClose(false);
  }
  return (
    <div className="modal-backdrop" data-modal-backdrop="true" onMouseDown={dismiss}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Archive recurring item"
      >
        <div className="panel-header">
          <div>
            <div className="badge">
              <Icon name="archive" />
              Archive Recurring Item
            </div>
            <h3>{row.name}</h3>
          </div>
          <button
            className="btn btn-icon"
            type="button"
            onClick={() => onClose(true)}
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="panel-note">
          Future occurrences will be hidden. Posted transactions remain in the ledger.
        </div>
        {error ? (
          <div className="panel-note status-bad" role="alert">
            {error}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={() => onClose(true)}>
            Cancel
          </button>
          <button className="btn btn-danger" type="button" onClick={archive}>
            <Icon name="archive" />
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

function BillRow({ row, sheetId, onAction, onEdit, onArchive }) {
  const reconciliation = getRowReconciliation(row);
  const reconciliationTransaction = reconciliation.transaction;
  const linkedTransaction =
    row.transaction ||
    (['matched', 'partial'].includes(reconciliation.state) ? reconciliationTransaction : null);
  const displayTone = getReconciliationTone(reconciliation, row.tone);
  const displayStatus =
    reconciliation.state === 'candidate'
      ? reconciliation.statusLabel || 'Review match'
      : reconciliation.state !== 'unmatched' && reconciliation.statusLabel
        ? reconciliation.statusLabel
        : row.status;
  const relativeDateLabel =
    reconciliation.state === 'matched' && reconciliation.statusLabel
      ? reconciliation.statusLabel
      : row.relativeDateLabel;
  const reconciliationPayload = getReconciliationPayload(row, reconciliation);
  const openMain = () => {
    if (linkedTransaction)
      emit(onAction, 'open-transaction-detail', { transactionId: linkedTransaction.id });
    else if (row.actions && row.actions.canEdit) onEdit(row);
  };
  return (
    <div
      className={`bill-register-row ${displayTone || ''}${reconciliation.state !== 'unmatched' ? ' has-reconciliation' : ''}`}
    >
      <button className="bill-register-main" type="button" onClick={openMain}>
        <Icon className={`mini-icon ${displayTone || ''}`} name={row.icon || 'receipt_long'} />
        <span>
          <strong>{row.name}</strong>
          <small>
            {row.metaLabel}
            {row.note ? ` • ${row.note}` : ''}
          </small>
        </span>
      </button>
      <div className="bill-register-due">
        <strong>{row.dueDateCopy}</strong>
        <small>{relativeDateLabel}</small>
      </div>
      <b className="bill-register-amount amount">{row.amountCopy}</b>
      <div className="bill-register-status">
        <StatusPill status={displayStatus} tone={displayTone} />
      </div>
      <div className="bill-register-actions">
        <ActionMenu>
          {row.actions && row.actions.canPay && reconciliation.state !== 'candidate' ? (
            <button
              className="btn btn-icon"
              type="button"
              aria-label="Post linked transaction"
              onClick={() =>
                emit(onAction, 'pay-bill-row', {
                  sheetId,
                  recurringItemId: row.recurringItemId,
                  dueDate: row.dueDate,
                  billRowId: row.id,
                  amount: Number(row.paymentAmount) || row.amount,
                  currency: row.currency,
                  description: row.name,
                  categoryId: row.categoryId,
                  primaryAccountId:
                    row.expectedTransactionKind === 'liability_payment'
                      ? row.fundingAccountId || ''
                      : row.accountId,
                  secondaryAccountId:
                    row.expectedTransactionKind === 'liability_payment' ? row.accountId : '',
                  template: row.paymentTemplate,
                  sourceRoute: 'bills',
                  recurringTrackingMode: 'link',
                  recurringOccurrenceDate: row.dueDate
                })
              }
            >
              <Icon name="payments" />
            </button>
          ) : null}
          {row.actions && row.actions.canOpenTransaction && linkedTransaction ? (
            <button
              className="btn btn-icon"
              type="button"
              aria-label={
                reconciliation.state === 'unmatched'
                  ? 'View paid transaction'
                  : 'View matched transaction'
              }
              onClick={() =>
                emit(onAction, 'open-transaction-detail', { transactionId: linkedTransaction.id })
              }
            >
              <Icon name="visibility" />
            </button>
          ) : null}
          {row.actions && row.actions.canReviewPossibleTransaction && row.possibleTransaction ? (
            <button
              className="btn btn-icon"
              type="button"
              aria-label="Review possible matching transaction"
              onClick={() =>
                emit(onAction, 'open-transaction-detail', {
                  transactionId: row.possibleTransaction.id
                })
              }
            >
              <Icon name="rule" />
            </button>
          ) : null}
          {reconciliation.canUndo && reconciliationPayload.transactionId ? (
            <button
              className="btn btn-icon"
              type="button"
              aria-label="Undo matched transaction"
              onClick={() =>
                emit(onAction, 'undo-recurring-transaction-match', reconciliationPayload)
              }
            >
              <Icon name="undo" />
            </button>
          ) : null}
          {row.actions && row.actions.canEdit ? (
            <button
              className="btn btn-icon"
              type="button"
              aria-label="Edit recurring item"
              onClick={() => onEdit(row)}
            >
              <Icon name="edit" />
            </button>
          ) : null}
          {row.actions && row.actions.canArchive ? (
            <button
              className="btn btn-icon"
              type="button"
              aria-label="Archive recurring item"
              onClick={() => onArchive(row)}
            >
              <Icon name="archive" />
            </button>
          ) : null}
        </ActionMenu>
      </div>
      {reconciliation.state === 'candidate' ? (
        <ReconciliationReview row={row} reconciliation={reconciliation} onAction={onAction} />
      ) : null}
      {['matched', 'partial'].includes(reconciliation.state) ? (
        <ReconciliationProof reconciliation={reconciliation} />
      ) : null}
      {reconciliation.state === 'partial' && reconciliation.pendingCandidate ? (
        <ReconciliationReview
          row={row}
          reconciliation={reconciliation.pendingCandidate}
          onAction={onAction}
        />
      ) : null}
    </div>
  );
}

function BillCreateRow({ onCreate }) {
  return (
    <button
      aria-label="Create bill or subscription"
      className="bill-register-row bill-create-row"
      onClick={onCreate}
      type="button"
    >
      <span className="bill-create-row-icon">
        <Icon name="add" />
      </span>
      <span>
        <strong>Create bill or subscription</strong>
        <small>Add a recurring payment or subscription</small>
      </span>
    </button>
  );
}

function Pagination({ pagination, onAction }) {
  const data = pagination || {};
  if (!data.visible) return null;
  return (
    <div className="table-pagination bills-table-footer">
      <span className="table-page-copy">
        Showing {data.showingStart} to {data.showingEnd} of {data.rowCount} items
      </span>
      <div>
        <button
          className="btn btn-icon"
          type="button"
          onClick={() => emit(onAction, 'bills-prev-page', { page: data.currentPage })}
          disabled={data.currentPage <= 1}
        >
          <Icon name="chevron_left" />
        </button>
        <button
          className="btn btn-primary btn-icon"
          type="button"
          onClick={() => emit(onAction, 'bills-first-page')}
        >
          {String(data.currentPage || 1)}
        </button>
        <button
          className="btn btn-icon"
          type="button"
          onClick={() => emit(onAction, 'bills-next-page', { page: data.currentPage })}
          disabled={data.currentPage >= data.totalPages}
        >
          <Icon name="chevron_right" />
        </button>
      </div>
      <label className="rows-per-page">
        Rows per page:
        <select
          aria-label="Bills rows per page"
          value={String(data.rowsPerPage || 10)}
          onChange={(event) =>
            emit(onAction, 'set-bills-rows-per-page', { value: Number(event.currentTarget.value) })
          }
        >
          <option value="10">10</option>
          <option value="25">25</option>
        </select>
      </label>
    </div>
  );
}

function FilterPanel({ filters, options, onAction }) {
  const [draft, setDraft] = useState(filters);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="bills-filter-shell"
      id="bills-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        emit(onAction, 'apply-bills-filter', draft);
      }}
    >
      <div className="bills-filter-row">
        <label className="bill-search-field">
          <Icon name="search" />
          <input
            type="search"
            name="search"
            value={draft.search || ''}
            onChange={(event) => update('search', event.currentTarget.value)}
            placeholder="Search bills, category, payment method"
          />
        </label>
        <button className="btn btn-icon" type="submit" aria-label="Apply bill search">
          <Icon name="search" />
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => emit(onAction, 'toggle-bills-filter')}
          aria-expanded={draft.filterOpen ? 'true' : 'false'}
        >
          <Icon name="filter_alt" />
          Filter
        </button>
        <ControlSelect
          icon="sort"
          label="Sort bills"
          options={options.sorts}
          value={draft.sort}
          className="bill-sort-select"
          onChange={(value) => emit(onAction, 'set-bills-sort', { value })}
        />
      </div>
      {draft.filterOpen ? (
        <div className="bill-filter-panel">
          <div className="field">
            <label>Due Date</label>
            <input
              type="date"
              value={draft.date || ''}
              onChange={(event) => update('date', event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label>Status</label>
            <select
              value={draft.status || 'all'}
              onChange={(event) => update('status', event.currentTarget.value)}
            >
              {asArray(options.statuses).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Category</label>
            <CategorizedSelect
              aria-label="Filter bills by category"
              clearLabel="All Categories"
              options={asArray(options.categories).filter((item) => item.value)}
              placeholder="All Categories"
              value={draft.categoryId || ''}
              onChange={(event) => update('categoryId', event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label>Account</label>
            <select
              value={draft.accountId || ''}
              onChange={(event) => update('accountId', event.currentTarget.value)}
            >
              {asArray(options.accounts).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="bill-filter-actions">
            <button className="btn btn-primary" type="submit">
              <Icon name="filter_alt" />
              Apply
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => emit(onAction, 'reset-bills-filter')}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function DueNext({ groups, onEdit }) {
  return (
    <article className="reference-card bill-due-card bill-due-next-card">
      <div className="reference-card-title">
        <h3>Due Next</h3>
      </div>
      <div className="bill-date-strip">
        <span>Overdue</span>
        <span>Today</span>
        <span>Tomorrow</span>
        <span>Later</span>
      </div>
      {asArray(groups).length ? (
        asArray(groups).map((group) => (
          <div className="bill-due-group" key={group.label}>
            <div className="bill-due-group-title">{group.label}</div>
            <div className="bill-due-queue">
              {asArray(group.rows).map((row) => (
                <button
                  className="bill-due-row"
                  type="button"
                  key={row.id}
                  onClick={() => onEdit(row)}
                >
                  <Icon
                    className={`mini-icon ${row.tone || ''}`}
                    name={row.icon || 'receipt_long'}
                  />
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.dueDateCopy}</small>
                  </span>
                  <b className="amount">{row.dueAmountCopy || row.amountCopy}</b>
                  <span className={`bill-days-tag ${row.tone || ''}`}>{row.relativeDateLabel}</span>
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="empty-state compact-empty">
          <strong>No upcoming bills.</strong>
        </div>
      )}
    </article>
  );
}

export function BillsRoute({
  model,
  onAction,
  initialTargetRecurringItem = null,
  targetRequestKey = 0,
  onTargetHandled
}) {
  const data = model || {};
  const filters = data.filters || {};
  const header = data.header || {};
  const options = data.filterOptions || {
    accounts: [],
    categories: [],
    statuses: [],
    sorts: data.sortOptions || []
  };
  const [editor, setEditor] = useState(null);
  const [editorInstanceKey, setEditorInstanceKey] = useState(0);
  const [archiveRow, setArchiveRow] = useState(null);

  useEffect(() => {
    if (!targetRequestKey || !initialTargetRecurringItem?.recurringItemId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setArchiveRow(null);
      setEditor({ ...initialTargetRecurringItem });
      setEditorInstanceKey((current) => current + 1);
      onTargetHandled?.(targetRequestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [initialTargetRecurringItem, onTargetHandled, targetRequestKey]);

  function openEditor(row) {
    const values =
      row && row.editorValues
        ? row.editorValues
        : {
            recurringItemId: '',
            kind: 'bill',
            name: '',
            categoryId: '',
            accountId: '',
            amount: '',
            currency: data.currency || 'PHP',
            frequency: 'Monthly',
            dueDate: data.today || '',
            autoRenew: false,
            isActive: true,
            note: ''
          };
    setEditor(values);
    setEditorInstanceKey((current) => current + 1);
    emit(onAction, 'open-bill-subscription', {
      sheetId: header.sheetId || '',
      recurringItemId: values.recurringItemId || ''
    });
  }

  function closeEditor(notify) {
    setEditor(null);
    if (notify) emit(onAction, 'close-modal');
  }

  function closeArchive(notify) {
    setArchiveRow(null);
    if (notify) emit(onAction, 'close-modal');
  }

  return (
    <section data-react-route="bills">
      <PageHeader title="Bills & Subscriptions">
        <ControlSelect
          icon="calendar_month"
          label="Bills month"
          options={header.sheetOptions}
          value={header.sheetId}
          className="bill-month-picker"
          onChange={(value) => emit(onAction, 'set-bills-sheet', { value })}
        />
      </PageHeader>
      {data.feedback && data.feedback.error ? (
        <div className="panel-note status-bad" role="alert">
          {data.feedback.error}
        </div>
      ) : null}
      {data.subscriptionReview && data.subscriptionReview.error ? (
        <div className="panel-note status-bad" role="alert">
          {data.subscriptionReview.error}
        </div>
      ) : null}
      {data.subscriptionReview && asArray(data.subscriptionReview.candidates).length ? (
        <section className="subscription-review-panel">
          <div className="reference-card-title">
            <h3>Subscription Review</h3>
            <span className="tag">{data.subscriptionReview.candidates.length}</span>
          </div>
          <div className="subscription-review-candidates">
            {data.subscriptionReview.candidates.map((candidate) => (
              <article className="subscription-review-candidate" key={candidate.id}>
                <strong>{candidate.name}</strong>
                <small>
                  {candidate.frequency} • {candidate.transactionCount} transactions
                </small>
                <b className="amount">{candidate.amountCopy}</b>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="bills-simple-summary">
        {asArray(data.summaryPills).map((pill) => (
          <SummaryPill key={pill.status} {...pill} onAction={onAction} />
        ))}
      </section>
      <section className="bills-page-grid bills-simple-layout">
        <article className="reference-card reference-card-wide bills-table-card bills-register-card">
          <div className="bills-register-title-row">
            <div>
              <h3>Bill List</h3>
              <span className="muted">{data.periodLabel || ''}</span>
            </div>
            <span className="tag">{String(data.rowCount || 0)} items</span>
          </div>
          <div className="register-toolbar bills-register-toolbar">
            <KindTabs activeKind={filters.filterKind || 'all'} onAction={onAction} />
          </div>
          <FilterPanel
            key={[
              filters.search,
              filters.status,
              filters.categoryId,
              filters.accountId,
              filters.date,
              filters.sort,
              data.filterOpen
            ].join('|')}
            filters={{ ...filters, filterOpen: data.filterOpen === true }}
            options={options}
            onAction={onAction}
          />
          <div className="bill-filter-chips">
            {asArray(data.filterChips).map((chip, index) => (
              <span
                className={`bill-filter-chip${data.filterChips.length === 1 && chip === 'All recurring items' ? ' is-muted' : ''}`}
                key={`${chip}-${index}`}
              >
                {chip}
              </span>
            ))}
            {asArray(data.filterChips).some((chip) => chip !== 'All recurring items') ? (
              <button
                className="bill-filter-chip bill-filter-reset-chip"
                type="button"
                onClick={() => emit(onAction, 'reset-bills-filter')}
              >
                Reset
              </button>
            ) : null}
          </div>
          {asArray(data.rows).length ? (
            <div className="bill-register-list">
              {header.sheetId ? <BillCreateRow onCreate={() => openEditor(null)} /> : null}
              {data.rows.map((row) => (
                <BillRow
                  key={row.id}
                  row={row}
                  sheetId={header.sheetId}
                  onAction={onAction}
                  onEdit={openEditor}
                  onArchive={setArchiveRow}
                />
              ))}
            </div>
          ) : (
            <div className="bill-empty-register">
              {header.sheetId ? <BillCreateRow onCreate={() => openEditor(null)} /> : null}
              <div className="empty-state compact-empty">
                <strong>No bills match this view.</strong>
              </div>
            </div>
          )}
          <Pagination pagination={data.pagination} onAction={onAction} />
        </article>
        <aside className="bills-side-stack bills-simple-side">
          <DueNext groups={data.dueNextGroups} onEdit={openEditor} />
          <article className="reference-card bill-month-note-card">
            <div className="reference-card-title">
              <h3>Recurring</h3>
              <span className="tag">
                {String((data.recurring && data.recurring.monthlyCount) || 0)}
              </span>
            </div>
            <p>{(data.recurring && data.recurring.monthlyTotalCopy) || '0'} expected monthly.</p>
          </article>
        </aside>
      </section>
      {editor ? (
        <EditorModal
          key={`${editor.recurringItemId || 'new'}:${editorInstanceKey}`}
          initialValues={editor}
          options={
            data.editorOptions || {
              currency: data.currency || 'PHP',
              categories: [],
              accounts: [],
              frequencies: ['Monthly']
            }
          }
          onAction={onAction}
          onClose={closeEditor}
        />
      ) : null}
      {archiveRow ? (
        <ArchiveModal row={archiveRow} onAction={onAction} onClose={closeArchive} />
      ) : null}
    </section>
  );
}

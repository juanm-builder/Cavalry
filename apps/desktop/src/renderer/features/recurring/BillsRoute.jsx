import React, { useEffect, useState } from 'react';

import { CavalryIcon, CavalryIconDisc } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';

import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';
import { BillsEditorModal } from './BillsEditorModal.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import {
  getReconciliationPayload,
  getReconciliationTone,
  getRowReconciliation,
  ReconciliationProof,
  ReconciliationReview
} from './BillsReconciliation.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function IconDisc({ name, className = '' }) {
  return <CavalryIconDisc className={className} name={name} />;
}

const BILL_PAGE_SIZE_OPTIONS = Object.freeze([
  { value: '10', label: '10' },
  { value: '25', label: '25' }
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function renderInBody(content) {
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function emit(onAction, type, payload = {}) {
  return typeof onAction === 'function' ? onAction({ type, payload }) : undefined;
}

function PageHeader({ title, subtitle, children }) {
  return (
    <section className="page-header bills-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="page-actions">{children}</div>
    </section>
  );
}

function ControlSelect({ icon, label, options = [], value, className = '', onChange }) {
  return (
    <div className={`bill-control-select ${className}`}>
      <CavalrySelect
        aria-label={label}
        leadingIcon={icon || ''}
        onChange={(event) => onChange(event.currentTarget.value)}
        options={asArray(options)}
        showLeadingIcon={Boolean(icon)}
        value={value || ''}
      />
    </div>
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
      <strong className={`amount ${tone || 'neutral'}`}>{value}</strong>
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
  return renderInBody(
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

function BillRow({ row, sheetId, onAction, onEdit, onArchive, onSelect }) {
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
    if (typeof onSelect === 'function') onSelect(row);
  };
  return (
    <div
      className={`bill-register-row ${displayTone || ''}${reconciliation.state !== 'unmatched' ? ' has-reconciliation' : ''}`}
    >
      <button className="bill-register-main" type="button" onClick={openMain}>
        <IconDisc className={`mini-icon ${displayTone || ''}`} name={row.icon || 'receipt_long'} />
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
      <b className={`bill-register-amount amount ${displayTone || 'neutral'}`}>{row.amountCopy}</b>
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
      <span className="rows-per-page">
        Rows per page:
        <CavalrySelect
          aria-label="Bills rows per page"
          onChange={(event) =>
            emit(onAction, 'set-bills-rows-per-page', { value: Number(event.currentTarget.value) })
          }
          options={BILL_PAGE_SIZE_OPTIONS}
          showLeadingIcon={false}
          value={String(data.rowsPerPage || 10)}
        />
      </span>
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
        <div className="bill-search-field">
          <Icon name="search" />
          <input
            aria-label="Search bills"
            type="search"
            name="search"
            value={draft.search || ''}
            onChange={(event) => update('search', event.currentTarget.value)}
            placeholder="Search bills, category, payment method"
          />
          <button className="bill-search-submit" type="submit" aria-label="Apply bill search">
            <Icon name="chevron_right" />
          </button>
        </div>
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
            <CavalrySelect
              aria-label="Status"
              onChange={(event) => update('status', event.currentTarget.value)}
              options={asArray(options.statuses)}
              showLeadingIcon={false}
              value={draft.status || 'all'}
            />
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
            <CavalrySelect
              aria-label="Account"
              leadingIcon="account_balance_wallet"
              onChange={(event) => update('accountId', event.currentTarget.value)}
              options={asArray(options.accounts).map((item) => ({
                ...item,
                icon: item.icon || (item.value ? 'account_balance_wallet' : 'select_all')
              }))}
              value={draft.accountId || ''}
            />
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

function BillOccurrenceModal({ row, onAction, onEdit, onClose }) {
  const dismiss = useModalDismiss(() => onClose(true));
  if (!row) return null;
  const reconciliation = getRowReconciliation(row);
  const linkedTransaction =
    row.transaction ||
    (['matched', 'partial'].includes(reconciliation.state) ? reconciliation.transaction : null);
  return renderInBody(
    <div className="modal-backdrop" data-modal-backdrop="true" onMouseDown={dismiss}>
      <div
        aria-label={`${row.name} occurrence details`}
        aria-modal="true"
        className="modal-card modal-card-wide bill-form-modal"
        role="dialog"
      >
        <div className="bill-form-header">
          <div>
            <h3>{row.name}</h3>
            <p>This occurrence is separate from the recurring rule behind it.</p>
          </div>
          <button
            aria-label="Close occurrence details"
            className="btn btn-icon"
            onClick={() => onClose(true)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="bill-form-body">
          <div className="budget-detail-card">
            <dl className="budget-detail-list">
              <div>
                <dt>Status</dt>
                <dd>{row.status}</dd>
              </div>
              <div>
                <dt>Expected date</dt>
                <dd>{row.dueDateCopy || row.dueDate}</dd>
              </div>
              <div>
                <dt>Expected amount</dt>
                <dd>{row.dueAmountCopy || row.amountCopy}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{row.categoryName || 'Uncategorized'}</dd>
              </div>
              <div>
                <dt>Payment method</dt>
                <dd>{row.paymentMethod || 'Not set'}</dd>
              </div>
              <div>
                <dt>Frequency</dt>
                <dd>{row.frequency || 'Not set'}</dd>
              </div>
              <div>
                <dt>Matching evidence</dt>
                <dd>
                  {reconciliation.explanation ||
                    reconciliation.detail ||
                    'No transaction has been linked yet.'}
                </dd>
              </div>
            </dl>
          </div>
          {['candidate'].includes(reconciliation.state) ? (
            <ReconciliationReview row={row} reconciliation={reconciliation} onAction={onAction} />
          ) : null}
          {['matched', 'partial'].includes(reconciliation.state) ? (
            <ReconciliationProof reconciliation={reconciliation} />
          ) : null}
        </div>
        <div className="modal-actions bill-form-actions">
          {linkedTransaction ? (
            <button
              className="btn"
              onClick={() =>
                emit(onAction, 'open-transaction-detail', { transactionId: linkedTransaction.id })
              }
              type="button"
            >
              <Icon name="receipt_long" /> View transaction
            </button>
          ) : null}
          <button className="btn" onClick={() => onEdit(row)} type="button">
            <Icon name="edit" /> Edit recurring rule
          </button>
        </div>
      </div>
    </div>
  );
}

function InactiveRecurring({ items, onAction }) {
  if (!asArray(items).length) return null;
  return (
    <article className="reference-card bill-month-note-card">
      <div className="reference-card-title">
        <h3>Inactive</h3>
        <span className="tag">{String(items.length)}</span>
      </div>
      <div className="bill-due-queue">
        {items.map((item) => (
          <div className="bill-due-row" key={item.id}>
            <IconDisc
              className="mini-icon info"
              name={item.kind === 'subscription' ? 'sync' : 'archive'}
            />
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.frequency} • {item.categoryName}
              </small>
            </span>
            <b className="amount neutral">{item.amountCopy}</b>
            <button
              aria-label={`Restore ${item.name}`}
              className="btn btn-icon"
              onClick={() =>
                emit(onAction, 'restore-recurring-item', { recurringItemId: item.recurringItemId })
              }
              type="button"
            >
              <Icon name="restore" />
            </button>
          </div>
        ))}
      </div>
    </article>
  );
}

function DueNext({ groups, onSelect }) {
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
                  onClick={() => onSelect(row)}
                >
                  <IconDisc
                    className={`mini-icon ${row.tone || ''}`}
                    name={row.icon || 'receipt_long'}
                  />
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.dueDateCopy}</small>
                  </span>
                  <b className={`amount ${row.tone || 'neutral'}`}>
                    {row.dueAmountCopy || row.amountCopy}
                  </b>
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

function SubscriptionSuggestions({ review, onReview }) {
  const candidates = asArray(review && review.candidates);
  if (!candidates.length) {
    if (review && review.status === 'complete' && !review.error) {
      return (
        <aside className="subscription-suggestion-empty" role="status">
          <Icon name="check_circle" />
          <span>
            <strong>No new recurring charges found</strong>
            <small>
              Your existing bills and subscriptions already cover the patterns Cavalry found.
            </small>
          </span>
        </aside>
      );
    }
    return null;
  }

  return (
    <section className="reference-card subscription-suggestion-panel">
      <div className="subscription-suggestion-heading">
        <div>
          <span className="subscription-suggestion-kicker">
            <Icon name="auto_awesome" /> Suggestions
          </span>
          <h3>Possible recurring charges</h3>
          <p>Review each suggestion before Cavalry adds anything.</p>
        </div>
        <span className="tag">{candidates.length}</span>
      </div>
      <div className="subscription-suggestion-list">
        {candidates.map((candidate) => (
          <article className="subscription-suggestion-row" key={candidate.id}>
            <span className="subscription-suggestion-icon">
              <Icon name={candidate.kind === 'subscription' ? 'subscriptions' : 'receipt_long'} />
            </span>
            <span className="subscription-suggestion-copy">
              <strong>{candidate.name}</strong>
              <small>
                {candidate.frequency || 'Monthly'} · {candidate.transactionCount} similar charge
                {candidate.transactionCount === 1 ? '' : 's'}
              </small>
              <em>{candidate.confidenceLabel || 'Possible recurring'}</em>
            </span>
            <b className="amount neutral">{candidate.amountCopy}</b>
            <button
              aria-label={`Review ${candidate.name} recurring suggestion`}
              className="btn subscription-suggestion-review"
              onClick={() => onReview(candidate)}
              type="button"
            >
              Review
            </button>
          </article>
        ))}
      </div>
    </section>
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
  const [detailRow, setDetailRow] = useState(null);

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
    setDetailRow(null);
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

  function openCandidate(candidate) {
    const editorOptions = data.editorOptions || {};
    const categoryIds = new Set(asArray(editorOptions.categories).map((option) => option.value));
    const accountIds = new Set(asArray(editorOptions.accounts).map((option) => option.value));
    const values = {
      recurringItemId: '',
      kind: candidate.kind === 'subscription' ? 'subscription' : 'bill',
      name: candidate.name || '',
      categoryId: categoryIds.has(candidate.categoryId) ? candidate.categoryId : '',
      accountId: accountIds.has(candidate.accountId) ? candidate.accountId : '',
      amount: candidate.amount || '',
      currency: candidate.currency || data.currency || 'PHP',
      frequency: candidate.frequency || 'Monthly',
      dueDate: candidate.nextDueDate || data.today || '',
      autoRenew: candidate.kind === 'subscription',
      isActive: true,
      note: candidate.reason
        ? `Suggested from your transaction history: ${candidate.reason}`
        : `Suggested from ${candidate.transactionCount || 0} similar transactions. Review before saving.`
    };
    setDetailRow(null);
    setArchiveRow(null);
    setEditor(values);
    setEditorInstanceKey((current) => current + 1);
    emit(onAction, 'open-bill-subscription', {
      sheetId: header.sheetId || '',
      recurringItemId: '',
      source: 'recurring-suggestion',
      candidateId: candidate.id || ''
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

  function closeDetail(notify) {
    setDetailRow(null);
    if (notify) emit(onAction, 'close-modal');
  }

  return (
    <section data-react-route="bills">
      <PageHeader title="Bills & Subscriptions">
        <button
          className="btn bills-scan-button"
          disabled={!header.sheetId || header.scanDisabled}
          onClick={() =>
            emit(onAction, 'scan-subscription-review', { sheetId: header.sheetId || '' })
          }
          type="button"
        >
          <Icon name={header.scanIcon || 'manage_search'} />
          {header.scanLabel || 'Find recurring charges'}
        </button>
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
      <SubscriptionSuggestions review={data.subscriptionReview} onReview={openCandidate} />
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
                  onSelect={setDetailRow}
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
          <DueNext groups={data.dueNextGroups} onSelect={setDetailRow} />
          <article className="reference-card bill-month-note-card">
            <div className="reference-card-title">
              <h3>Recurring</h3>
              <span className="tag">
                {String((data.recurring && data.recurring.monthlyCount) || 0)}
              </span>
            </div>
            <p>{(data.recurring && data.recurring.monthlyTotalCopy) || '0'} monthly equivalent.</p>
          </article>
          <InactiveRecurring items={data.inactiveItems} onAction={onAction} />
        </aside>
      </section>
      {detailRow ? (
        <BillOccurrenceModal
          row={detailRow}
          onAction={onAction}
          onEdit={openEditor}
          onClose={closeDetail}
        />
      ) : null}
      {editor ? (
        <BillsEditorModal
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

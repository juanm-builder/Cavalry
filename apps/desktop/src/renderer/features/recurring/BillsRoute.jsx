import { PrivateValue } from '../../shared/PrivateValue.jsx';
import React, { useEffect, useState } from 'react';

import { CavalryIcon, CavalryIconDisc } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';

import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';
import { BillsEditorModal } from './BillsEditorModal.jsx';
import { BillOccurrenceModal } from './BillOccurrenceModal.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import {
  getReconciliationPayload,
  getReconciliationTone,
  getRowReconciliation
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
        <PrivateValue as="h1">{title}</PrivateValue>
        {subtitle ? <PrivateValue as="p">{subtitle}</PrivateValue> : null}
      </div>
      <PrivateValue as="div" className="page-actions">
        {children}
      </PrivateValue>
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

function SummaryValue({ label, value }) {
  return (
    <div className="bill-overview-value">
      <PrivateValue as="span">{label}</PrivateValue>
      <PrivateValue as="strong" className="amount neutral">
        {value}
      </PrivateValue>
    </div>
  );
}

function KindTabs({ activeKind, onAction }) {
  const tabs = [
    ['all', 'All'],
    ['bill', 'Bills'],
    ['subscription', 'Subscriptions']
  ];
  return (
    <div className="bill-kind-tabs" aria-label="Bill type">
      {tabs.map(([kind, label]) => (
        <PrivateValue
          as="button"
          key={kind}
          className={activeKind === kind ? 'active' : ''}
          type="button"
          aria-pressed={activeKind === kind}
          onClick={() => emit(onAction, 'set-bills-kind', { billsKind: kind })}
        >
          {label}
        </PrivateValue>
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
      <PrivateValue as="div" className="action-menu-popover">
        {children}
      </PrivateValue>
    </details>
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
            <PrivateValue as="h3">{row.name}</PrivateValue>
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
          <PrivateValue as="div" className="panel-note status-bad" role="alert">
            {error}
          </PrivateValue>
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
        : row.status === 'Expected charge not recorded'
          ? 'Not recorded'
          : row.status;
  const reconciliationPayload = getReconciliationPayload(row, reconciliation);
  const openMain = () => {
    if (typeof onSelect === 'function') onSelect(row);
  };
  return (
    <div className={`bill-register-row ${displayTone || ''}`}>
      <button className="bill-register-main" type="button" onClick={openMain}>
        <IconDisc className={`mini-icon ${displayTone || ''}`} name={row.icon || 'receipt_long'} />
        <span>
          <PrivateValue as="strong">{row.name}</PrivateValue>
          <PrivateValue as="small">
            {[row.frequency, row.paymentMethod].filter(Boolean).join(' · ') || row.metaLabel}
          </PrivateValue>
        </span>
      </button>
      <div className="bill-register-due">
        <PrivateValue as="span" title={row.dueDateCopy}>
          {row.dueDateCopy?.replace(/^([A-Za-z]{3})[a-z]+ /, '$1 ').replace(/, \d{4}$/, '') ||
            row.dueDate}
        </PrivateValue>
      </div>
      <PrivateValue as="b" className="bill-register-amount amount neutral">
        {row.amountCopy}
      </PrivateValue>
      <div className="bill-register-status">
        <button
          className={`bill-status-link ${displayTone}`}
          type="button"
          onClick={openMain}
          aria-label={`${displayStatus || 'Upcoming'}: ${row.name}`}
        >
          {reconciliation.state === 'matched' ? <Icon name="check" /> : null}
          <PrivateValue as="span">{displayStatus || 'Upcoming'}</PrivateValue>
          {reconciliation.state === 'candidate' || reconciliation.pendingCandidate ? (
            <Icon name="chevron_right" />
          ) : null}
        </button>
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
            <PrivateValue
              as="button"
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
            </PrivateValue>
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
    </div>
  );
}

function Pagination({ pagination, onAction }) {
  const data = pagination || {};
  if (!data.visible) return null;
  return (
    <div className="table-pagination bills-table-footer">
      <PrivateValue as="span" className="table-page-copy">
        Showing {data.showingStart} to {data.showingEnd} of {data.rowCount} items
      </PrivateValue>
      <div>
        <button
          className="btn btn-icon"
          type="button"
          onClick={() => emit(onAction, 'bills-prev-page', { page: data.currentPage })}
          disabled={data.currentPage <= 1}
        >
          <Icon name="chevron_left" />
        </button>
        <PrivateValue
          as="button"
          className="btn btn-primary btn-icon"
          type="button"
          onClick={() => emit(onAction, 'bills-first-page')}
        >
          {String(data.currentPage || 1)}
        </PrivateValue>
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

function FilterPanel({ filters, options, header, onAction }) {
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
            placeholder="Search items"
          />
          <button className="bill-search-submit" type="submit" aria-label="Apply bill search">
            <Icon name="chevron_right" />
          </button>
        </div>
        <button
          className="btn btn-quiet bills-scan-button"
          disabled={!header.sheetId || header.scanDisabled}
          onClick={() =>
            emit(onAction, 'scan-subscription-review', { sheetId: header.sheetId || '' })
          }
          type="button"
        >
          <Icon name={header.scanIcon || 'manage_search'} />
          {header.scanDisabled ? header.scanLabel : 'Find recurring'}
        </button>
        <button
          className="btn btn-quiet btn-icon"
          type="button"
          onClick={() => emit(onAction, 'toggle-bills-filter')}
          aria-expanded={draft.filterOpen ? 'true' : 'false'}
          aria-label="Filter and sort bills"
        >
          <Icon name="filter_alt" />
        </button>
      </div>
      {draft.filterOpen ? (
        <div className="bill-filter-panel">
          <div className="field">
            <label>Sort</label>
            <ControlSelect
              label="Sort bills"
              options={options.sorts}
              value={draft.sort}
              onChange={(value) => emit(onAction, 'set-bills-sort', { value })}
            />
          </div>
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

function InactiveRecurring({ items, onAction }) {
  if (!asArray(items).length) return null;
  return (
    <details className="bill-inactive-section">
      <summary>
        <Icon name="chevron_right" />
        <PrivateValue as="span">Inactive ({items.length})</PrivateValue>
      </summary>
      <div className="bill-due-queue">
        {items.map((item) => (
          <div className="bill-due-row" key={item.id}>
            <IconDisc
              className="mini-icon info"
              name={item.kind === 'subscription' ? 'sync' : 'archive'}
            />
            <span>
              <PrivateValue as="strong">{item.name}</PrivateValue>
              <PrivateValue as="small">
                {item.frequency} • {item.categoryName}
              </PrivateValue>
            </span>
            <PrivateValue as="b" className="amount neutral">
              {item.amountCopy}
            </PrivateValue>
            <PrivateValue
              as="button"
              aria-label={`Restore ${item.name}`}
              className="btn btn-icon"
              onClick={() =>
                emit(onAction, 'restore-recurring-item', { recurringItemId: item.recurringItemId })
              }
              type="button"
            >
              <Icon name="restore" />
            </PrivateValue>
          </div>
        ))}
      </div>
    </details>
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
        <PrivateValue as="span" className="tag">
          {candidates.length}
        </PrivateValue>
      </div>
      <div className="subscription-suggestion-list">
        {candidates.map((candidate) => (
          <article className="subscription-suggestion-row" key={candidate.id}>
            <span className="subscription-suggestion-icon">
              <Icon name={candidate.kind === 'subscription' ? 'subscriptions' : 'receipt_long'} />
            </span>
            <span className="subscription-suggestion-copy">
              <PrivateValue as="strong">{candidate.name}</PrivateValue>
              <PrivateValue as="small">
                {candidate.frequency || 'Monthly'} · {candidate.transactionCount} similar charge
                {candidate.transactionCount === 1 ? '' : 's'}
              </PrivateValue>
              <PrivateValue as="em">
                {candidate.confidenceLabel || 'Possible recurring'}
              </PrivateValue>
            </span>
            <PrivateValue as="b" className="amount neutral">
              {candidate.amountCopy}
            </PrivateValue>
            <PrivateValue
              as="button"
              aria-label={`Review ${candidate.name} recurring suggestion`}
              className="btn subscription-suggestion-review"
              onClick={() => onReview(candidate)}
              type="button"
            >
              Review
            </PrivateValue>
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
    <section data-react-route="bills" className="bills-minimal-page">
      <PageHeader title="Bills & Subscriptions">
        <ControlSelect
          icon="calendar_month"
          label="Bills month"
          options={header.sheetOptions}
          value={header.sheetId}
          className="bill-month-picker"
          onChange={(value) => emit(onAction, 'set-bills-sheet', { value })}
        />
        <button
          aria-label="Create bill or subscription"
          className="btn btn-primary"
          disabled={!header.sheetId}
          onClick={() => openEditor(null)}
          type="button"
        >
          <Icon name="add" /> Add item
        </button>
      </PageHeader>
      {data.feedback && data.feedback.error ? (
        <PrivateValue as="div" className="panel-note status-bad" role="alert">
          {data.feedback.error}
        </PrivateValue>
      ) : null}
      {data.subscriptionReview && data.subscriptionReview.error ? (
        <PrivateValue as="div" className="panel-note status-bad" role="alert">
          {data.subscriptionReview.error}
        </PrivateValue>
      ) : null}
      <section className="bills-overview" aria-label="Billing overview">
        {(
          data.overview || [
            { label: 'Scheduled', value: '—' },
            { label: 'Recorded', value: '—' },
            { label: 'To review', value: '—' }
          ]
        ).map((item) => (
          <SummaryValue key={item.label} {...item} />
        ))}
      </section>
      <article className="reference-card bills-minimal-register">
        <div className="bills-minimal-toolbar">
          <KindTabs activeKind={filters.filterKind || 'all'} onAction={onAction} />
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
            header={header}
            options={options}
            onAction={onAction}
          />
        </div>
        {asArray(data.filterChips).some((chip) => chip !== 'All recurring items') ? (
          <div className="bills-active-filter-note">
            <PrivateValue as="span">
              {asArray(data.filterChips)
                .filter((chip) => chip !== 'All recurring items')
                .join(' · ')}
            </PrivateValue>
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() => emit(onAction, 'reset-bills-filter')}
            >
              Clear
            </button>
          </div>
        ) : null}
        <div className="bill-register-head" aria-hidden="true">
          <span>Item</span>
          <span>Due</span>
          <span>Amount</span>
          <span>Status</span>
          <span />
        </div>
        {asArray(data.rows).length ? (
          <div className="bill-register-list">
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
          <div className="empty-state compact-empty">
            <strong>No bills match this view.</strong>
          </div>
        )}
        <Pagination pagination={data.pagination} onAction={onAction} />
      </article>
      <SubscriptionSuggestions review={data.subscriptionReview} onReview={openCandidate} />
      <InactiveRecurring items={data.inactiveItems} onAction={onAction} />
      {detailRow ? (
        <BillOccurrenceModal
          row={asArray(data.rows).find((row) => row.id === detailRow.id) || detailRow}
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

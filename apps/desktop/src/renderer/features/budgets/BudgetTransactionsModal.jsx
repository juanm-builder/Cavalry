import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useActionBindings } from '../../shared/action-binding.jsx';
import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import {
  BudgetCategoryAvatar,
  formatMoney,
  getPlanTypeCopy,
  getRowStatusDetail,
  getUsageTone
} from './budget-view-helpers.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function renderInBody(content) {
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

export function BudgetTransactionsModal({ row, currency, onClose, periodLabel, sheetId }) {
  const actions = useActionBindings();
  const [activeTab, setActiveTab] = useState('overview');
  const drawerRef = useRef(null);
  useEffect(() => {
    if (!row) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, row]);
  useEffect(() => {
    if (!row || !drawerRef.current) return;
    drawerRef.current.focus({ preventScroll: true });
  }, [row]);
  if (!row) return null;
  const category = row.category || {};
  const copy = getPlanTypeCopy(row.categoryType);
  const tone = getUsageTone(row);
  const needsAttention =
    row.isMissing || row.isArchived || Number(row.receipt?.unresolvedCount) > 0;
  const hasBudget = Number(row.planned) > 0;
  const canDelete = !!sheetId && row.canDelete !== false && hasBudget;
  const canEdit = !!category.id && !row.isMissing && !row.isArchived && !row.isUncategorized;
  const status = row.statusLabel || 'Review';
  const editBinding = actions.action('open-simple-budget', {
    sheetId,
    categoryId: category.id,
    planned: Number(row.planned) || '',
    ...(row.note ? { note: row.note } : {})
  });
  const deleteBinding = actions.action('archive-budget', {
    sheetId,
    categoryId: category.id
  });
  return renderInBody(
    <div className="budget-drawer-layer budget-detail-modal-layer">
      <button
        aria-label={`Dismiss ${category.name} budget details`}
        className="budget-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={`${category.name} budget details`}
        aria-modal="true"
        className="budget-dialog budget-category-detail-dialog"
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="budget-drawer-header">
          <div className="budget-detail-heading">
            <BudgetCategoryAvatar category={category} />
            <div>
              <h2>{category.name}</h2>
              <span
                className={
                  tone === 'bad' ? 'status-bad' : tone === 'warn' ? 'warn-text' : 'good-text'
                }
              >
                {status}
              </span>
            </div>
          </div>
          <button
            aria-label={`Close ${category.name} budget details`}
            className="btn btn-icon"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <div aria-label="Budget detail views" className="budget-detail-tabs" role="tablist">
          <button
            aria-controls="budget-overview-panel"
            aria-selected={activeTab === 'overview'}
            className={activeTab === 'overview' ? 'active' : ''}
            id="budget-overview-tab"
            onClick={() => setActiveTab('overview')}
            role="tab"
            type="button"
          >
            Overview
          </button>
          <button
            aria-controls="budget-transactions-panel"
            aria-selected={activeTab === 'transactions'}
            className={activeTab === 'transactions' ? 'active' : ''}
            id="budget-transactions-tab"
            onClick={() => setActiveTab('transactions')}
            role="tab"
            type="button"
          >
            Transactions
          </button>
        </div>
        <div className="budget-detail-scroll">
          {activeTab === 'overview' ? (
            <div
              aria-labelledby="budget-overview-tab"
              className="budget-detail-overview-grid"
              id="budget-overview-panel"
              role="tabpanel"
            >
              <section className="budget-detail-card">
                <div className="budget-detail-card-heading">
                  <h3>{copy.detailTitle}</h3>
                  <span className="tag">Monthly</span>
                </div>
                <div className="budget-vs-actual">
                  <div>
                    <strong className={tone === 'bad' ? 'status-bad' : ''}>
                      {formatMoney(row.actual, currency)}
                    </strong>
                    <span>{copy.actualLabel}</span>
                  </div>
                  <div>
                    <strong>{formatMoney(row.planned, currency)}</strong>
                    <span>{copy.planLabel}</span>
                  </div>
                </div>
                <div className="budget-detail-progress">
                  <span style={{ width: `${Math.min(100, Number(row.progressPercent) || 0)}%` }} />
                </div>
                <div className="budget-detail-progress-meta">
                  <span>{row.percent}% of plan</span>
                  <strong className={tone === 'bad' ? 'status-bad' : 'good-text'}>
                    {getRowStatusDetail(row, currency)}
                  </strong>
                </div>
              </section>
              {Number(row.committed) > 0 ? (
                <section className="budget-detail-card">
                  <div className="budget-detail-card-heading">
                    <h3>Recurring commitments</h3>
                    <span className="tag">Separate</span>
                  </div>
                  <p className="monthly-plan-formula-copy">
                    These items inform the plan but do not automatically change this category’s
                    limit.
                  </p>
                  <dl className="budget-detail-list">
                    <div>
                      <dt>Committed</dt>
                      <dd>{formatMoney(row.committed, currency)}</dd>
                    </div>
                    <div>
                      <dt>Covered by plan</dt>
                      <dd>
                        {formatMoney(
                          Math.min(Number(row.planned) || 0, Number(row.committed) || 0),
                          currency
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Not covered</dt>
                      <dd>
                        {formatMoney(
                          Math.max(0, (Number(row.committed) || 0) - (Number(row.planned) || 0)),
                          currency
                        )}
                      </dd>
                    </div>
                  </dl>
                  {row.commitmentRows?.length ? (
                    <div className="monthly-plan-commitment-list">
                      {row.commitmentRows.map((commitment) => (
                        <div key={commitment.id}>
                          <span>
                            <strong>{commitment.name}</strong>
                            <small>{commitment.dueDate || commitment.frequency}</small>
                          </span>
                          <b>{formatMoney(commitment.amount, currency)}</b>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
              {needsAttention ? (
                <section className="budget-detail-card monthly-plan-attention-card">
                  <div className="budget-detail-card-heading">
                    <h3>Needs review</h3>
                    <Icon name="warning" />
                  </div>
                  <p>
                    {row.isMissing
                      ? 'The category referenced by this plan row no longer exists. Its plan amount is excluded from trusted totals.'
                      : row.isArchived
                        ? 'This category is archived. Its plan amount remains visible but is excluded from trusted totals.'
                        : 'One or more transactions are missing the information required for a trusted base-currency total.'}
                  </p>
                </section>
              ) : null}
              <details className="budget-detail-card budget-detail-more">
                <summary>More details</summary>
                <dl className="budget-detail-list">
                  <div>
                    <dt>Difference</dt>
                    <dd>{formatMoney(row.remaining, currency)}</dd>
                  </div>
                  <div>
                    <dt>Plan period</dt>
                    <dd>{periodLabel || 'Monthly'}</dd>
                  </div>
                  {row.createdAt ? (
                    <div>
                      <dt>Added</dt>
                      <dd>{row.createdAt}</dd>
                    </div>
                  ) : null}
                  {row.note ? (
                    <div>
                      <dt>Note</dt>
                      <dd>{row.note}</dd>
                    </div>
                  ) : null}
                </dl>
              </details>
            </div>
          ) : (
            <div
              aria-labelledby="budget-transactions-tab"
              id="budget-transactions-panel"
              role="tabpanel"
            >
              <div className="budget-transaction-tab-heading">
                <h3>Transactions</h3>
                <p>{row.transactions?.length || 0} associated transactions</p>
              </div>
              <div className="budget-transaction-list">
                {row.transactions?.length ? (
                  row.transactions.map((transaction) => (
                    <button
                      aria-label={`View ${transaction.description} transaction details`}
                      className="budget-transaction-row"
                      key={transaction.id}
                      type="button"
                      {...actions.action('open-budget-transaction', {
                        transactionId: transaction.id
                      })}
                    >
                      <span>
                        <strong>{transaction.description}</strong>
                        <small>
                          {transaction.date}
                          {transaction.eventKind
                            ? ` • ${String(transaction.eventKind).replaceAll('_', ' ')}`
                            : ''}
                        </small>
                      </span>
                      <b>{formatMoney(transaction.amount, transaction.currency || currency)}</b>
                      <Icon name="chevron_right" />
                    </button>
                  ))
                ) : (
                  <div className="empty-state compact-empty">
                    <strong>No transactions in this period.</strong>
                  </div>
                )}
                {row.receipt?.unresolved?.map((transaction) => (
                  <div
                    className="budget-transaction-row unresolved"
                    key={`unresolved:${transaction.transactionId}`}
                  >
                    <span>
                      <strong>{transaction.description}</strong>
                      <small>{transaction.date} • excluded from total</small>
                    </span>
                    <b>{formatMoney(transaction.nativeAmount, transaction.nativeCurrency)}</b>
                    <Icon name="warning" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {activeTab === 'overview' && (canEdit || canDelete) ? (
          <div
            className={`budget-detail-actions budget-detail-footer${canEdit && canDelete ? '' : ' single'}`}
          >
            {canEdit ? (
              <button
                aria-label="Edit Budget"
                className="btn"
                onClick={(event) => {
                  editBinding.onClick?.(event);
                  onClose();
                }}
                type="button"
              >
                {hasBudget ? 'Edit Plan' : 'Add to Plan'}
              </button>
            ) : null}
            {canDelete ? (
              <button
                aria-label="Delete Budget"
                className="btn btn-danger"
                onClick={(event) => {
                  deleteBinding.onClick?.(event);
                  onClose();
                }}
                type="button"
              >
                <Icon name="delete" /> Remove from Plan
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

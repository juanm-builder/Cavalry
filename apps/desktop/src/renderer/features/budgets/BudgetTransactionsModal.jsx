import { PrivateValue } from '../../shared/PrivateValue.jsx';
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
      <PrivateValue
        as="button"
        aria-label={`Dismiss ${category.name} budget details`}
        className="budget-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <PrivateValue
        as="aside"
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
              <PrivateValue as="h2">{category.name}</PrivateValue>
              <PrivateValue
                as="span"
                className={`budget-detail-status ${
                  tone === 'bad' ? 'status-bad' : tone === 'warn' ? 'warn-text' : 'good-text'
                }`}
              >
                {status}
              </PrivateValue>
            </div>
          </div>
          <PrivateValue
            as="button"
            aria-label={`Close ${category.name} budget details`}
            className="btn btn-icon"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </PrivateValue>
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
                  <PrivateValue as="h3">{copy.detailTitle}</PrivateValue>
                  <span className="tag">Monthly</span>
                </div>
                <div className="budget-vs-actual">
                  <div>
                    <PrivateValue as="strong" className={tone === 'bad' ? 'status-bad' : ''}>
                      {formatMoney(row.actual, currency)}
                    </PrivateValue>
                    <PrivateValue as="span">{copy.actualLabel}</PrivateValue>
                  </div>
                  <div>
                    <PrivateValue as="strong">{formatMoney(row.planned, currency)}</PrivateValue>
                    <PrivateValue as="span">{copy.planLabel}</PrivateValue>
                  </div>
                </div>
                <div className="budget-detail-progress">
                  <span style={{ width: `${Math.min(100, Number(row.progressPercent) || 0)}%` }} />
                </div>
                <div className="budget-detail-progress-meta">
                  <PrivateValue as="span">{row.percent}% of plan</PrivateValue>
                  <PrivateValue as="strong" className={tone === 'bad' ? 'status-bad' : 'good-text'}>
                    {getRowStatusDetail(row, currency)}
                  </PrivateValue>
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
                      <PrivateValue as="dd">{formatMoney(row.committed, currency)}</PrivateValue>
                    </div>
                    <div>
                      <dt>Covered by plan</dt>
                      <PrivateValue as="dd">
                        {formatMoney(
                          Math.min(Number(row.planned) || 0, Number(row.committed) || 0),
                          currency
                        )}
                      </PrivateValue>
                    </div>
                    <div>
                      <dt>Not covered</dt>
                      <PrivateValue as="dd">
                        {formatMoney(
                          Math.max(0, (Number(row.committed) || 0) - (Number(row.planned) || 0)),
                          currency
                        )}
                      </PrivateValue>
                    </div>
                  </dl>
                  {row.commitmentRows?.length ? (
                    <div className="monthly-plan-commitment-list">
                      {row.commitmentRows.map((commitment) => (
                        <div key={commitment.id}>
                          <span>
                            <PrivateValue as="strong">{commitment.name}</PrivateValue>
                            <PrivateValue as="small">
                              {commitment.dueDate || commitment.frequency}
                            </PrivateValue>
                          </span>
                          <PrivateValue as="b">
                            {formatMoney(commitment.amount, currency)}
                          </PrivateValue>
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
                  <PrivateValue as="p">
                    {row.isMissing
                      ? 'The category referenced by this plan row no longer exists. Its plan amount is excluded from trusted totals.'
                      : row.isArchived
                        ? 'This category is archived. Its plan amount remains visible but is excluded from trusted totals.'
                        : 'One or more transactions are missing the information required for a trusted base-currency total.'}
                  </PrivateValue>
                </section>
              ) : null}
              <details className="budget-detail-card budget-detail-more">
                <summary>More details</summary>
                <dl className="budget-detail-list">
                  <div>
                    <dt>Difference</dt>
                    <PrivateValue as="dd">{formatMoney(row.remaining, currency)}</PrivateValue>
                  </div>
                  <div>
                    <dt>Plan period</dt>
                    <PrivateValue as="dd">{periodLabel || 'Monthly'}</PrivateValue>
                  </div>
                  {row.createdAt ? (
                    <div>
                      <dt>Added</dt>
                      <PrivateValue as="dd">{row.createdAt}</PrivateValue>
                    </div>
                  ) : null}
                  {row.note ? (
                    <div>
                      <dt>Note</dt>
                      <PrivateValue as="dd">{row.note}</PrivateValue>
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
                <PrivateValue as="p">
                  {row.transactions?.length || 0} associated transactions
                </PrivateValue>
              </div>
              <div className="budget-transaction-list">
                {row.transactions?.length ? (
                  row.transactions.map((transaction) => (
                    <PrivateValue
                      as="button"
                      aria-label={`View ${transaction.description} transaction details`}
                      className="budget-transaction-row"
                      key={transaction.id}
                      type="button"
                      {...actions.action('open-budget-transaction', {
                        transactionId: transaction.id
                      })}
                    >
                      <span>
                        <PrivateValue as="strong">{transaction.description}</PrivateValue>
                        <PrivateValue as="small">
                          {transaction.date}
                          {transaction.eventKind
                            ? ` • ${String(transaction.eventKind).replaceAll('_', ' ')}`
                            : ''}
                        </PrivateValue>
                      </span>
                      <PrivateValue as="b">
                        {formatMoney(transaction.amount, transaction.currency || currency)}
                      </PrivateValue>
                      <Icon name="chevron_right" />
                    </PrivateValue>
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
                      <PrivateValue as="strong">{transaction.description}</PrivateValue>
                      <PrivateValue as="small">
                        {transaction.date} • excluded from total
                      </PrivateValue>
                    </span>
                    <PrivateValue as="b">
                      {formatMoney(transaction.nativeAmount, transaction.nativeCurrency)}
                    </PrivateValue>
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
              <PrivateValue
                as="button"
                aria-label="Edit Budget"
                className="btn"
                onClick={(event) => {
                  editBinding.onClick?.(event);
                  onClose();
                }}
                type="button"
              >
                {hasBudget ? 'Edit Plan' : 'Add to Plan'}
              </PrivateValue>
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
      </PrivateValue>
    </div>
  );
}

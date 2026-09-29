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
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('');
  const [sort, setSort] = useState('newest');
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
  const accounts = [
    ...new Map(
      [...(row.transactions || []), ...(row.receipt?.unresolved || [])].map((item) => [
        item.accountId || '',
        item.accountName || 'No account'
      ])
    ).entries()
  ];
  const matchesSearch = (item) =>
    `${item.description} ${item.date} ${item.accountName || ''}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  const transactions = (row.transactions || [])
    .filter((item) => matchesSearch(item) && (!account || item.accountId === account))
    .slice()
    .sort((a, b) => {
      const order =
        sort === 'highest'
          ? Math.abs(b.amount) - Math.abs(a.amount)
          : sort === 'lowest'
            ? Math.abs(a.amount) - Math.abs(b.amount)
            : sort === 'oldest'
              ? a.date.localeCompare(b.date)
              : b.date.localeCompare(a.date);
      return order || a.id.localeCompare(b.id);
    });
  const unresolved = (row.receipt?.unresolved || []).filter(
    (item) => matchesSearch(item) && (!account || item.accountId === account)
  );
  const filteredTotal = transactions.reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const expense = row.categoryType === 'expense';
  const varianceLabel = expense
    ? row.remaining < 0
      ? 'Over budget'
      : 'Left to spend'
    : row.actual < row.planned
      ? 'To target'
      : 'Above target';
  const signedAmount = (amount) =>
    `${(expense ? -amount : amount) < 0 ? '−' : (expense ? -amount : amount) > 0 ? '+' : ''}${formatMoney(Math.abs(amount), currency)}`;
  const plannedShare =
    expense && row.actual > row.planned && row.actual > 0
      ? Math.max(0, (row.planned / row.actual) * 100)
      : Math.min(100, Math.max(0, Number(row.progressPercent) || 0));
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
              <PrivateValue as="small" className="budget-detail-period">
                {periodLabel || 'Monthly plan'}
              </PrivateValue>
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
                <div className="budget-detail-metrics">
                  <div>
                    <span>{expense ? 'Planned' : copy.planLabel}</span>
                    <PrivateValue as="strong">{formatMoney(row.planned, currency)}</PrivateValue>
                  </div>
                  <div>
                    <span>{copy.actualLabel}</span>
                    <PrivateValue as="strong">{formatMoney(row.actual, currency)}</PrivateValue>
                  </div>
                  <div>
                    <span>{varianceLabel}</span>
                    <PrivateValue
                      as="strong"
                      className={tone === 'bad' ? 'status-bad' : 'good-text'}
                    >
                      {formatMoney(Math.abs(row.remaining), currency)}
                    </PrivateValue>
                  </div>
                </div>
                <div className="budget-detail-progress">
                  <span style={{ width: `${plannedShare}%`, background: 'var(--accent)' }} />
                  {expense && row.actual > row.planned ? (
                    <span
                      style={{ width: `${100 - plannedShare}%`, background: 'var(--budget-red)' }}
                    />
                  ) : null}
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
                    <PrivateValue as="strong">{formatMoney(row.committed, currency)}</PrivateValue>
                  </div>
                  <p className="monthly-plan-formula-copy">
                    Scheduled payments in this category. Your plan limit is set separately.
                  </p>
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
                  <div className="budget-commitment-coverage">
                    <PrivateValue as="span">
                      Covered {formatMoney(Math.min(row.planned, row.committed), currency)}
                    </PrivateValue>
                    <PrivateValue as="span">
                      Uncovered {formatMoney(Math.max(0, row.committed - row.planned), currency)}
                    </PrivateValue>
                  </div>
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
                <summary>Calculation details</summary>
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
              <div className="budget-transaction-summary">
                <PrivateValue as="span">
                  {copy.actualLabel} <strong>{formatMoney(row.actual, currency)}</strong>
                </PrivateValue>
                <PrivateValue as="span" className={tone === 'bad' ? 'status-bad' : ''}>
                  {getRowStatusDetail(row, currency)}
                </PrivateValue>
              </div>
              <div className="budget-transaction-controls">
                <label className="budget-transaction-search">
                  <Icon name="search" />
                  <input
                    aria-label="Search transactions"
                    placeholder="Search transactions"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <select
                  aria-label="Sort transactions"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="highest">Amount: High to low</option>
                  <option value="lowest">Amount: Low to high</option>
                </select>
                <PrivateValue as="span" className="budget-transaction-period">
                  {periodLabel || 'This month'}
                </PrivateValue>
                <select
                  aria-label="Filter by account"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                >
                  <option value="">All accounts</option>
                  {accounts
                    .filter(([id]) => id)
                    .map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="budget-transaction-table-heading">
                <span>Date</span>
                <span>Transaction</span>
                <span>Account</span>
                <span>Amount</span>
                <span />
              </div>
              <div className="budget-transaction-list">
                {transactions.length ? (
                  transactions.map((transaction) => (
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
                      <PrivateValue as="small">{transaction.date}</PrivateValue>
                      <span>
                        <PrivateValue as="strong">{transaction.description}</PrivateValue>
                        {transaction.nativeCurrency && transaction.nativeCurrency !== currency ? (
                          <PrivateValue as="small">
                            {formatMoney(transaction.nativeAmount, transaction.nativeCurrency)} ·
                            converted to {currency}
                          </PrivateValue>
                        ) : null}
                      </span>
                      <PrivateValue as="span" className="budget-transaction-account">
                        {transaction.accountName || 'No account'}
                      </PrivateValue>
                      <PrivateValue
                        as="b"
                        className={
                          (expense ? -transaction.amount : transaction.amount) < 0
                            ? 'status-bad'
                            : 'good-text'
                        }
                      >
                        {signedAmount(transaction.amount)}
                      </PrivateValue>
                      <Icon name="chevron_right" />
                    </PrivateValue>
                  ))
                ) : (
                  <div className="empty-state compact-empty">
                    <strong>
                      {search || account
                        ? 'No matching transactions.'
                        : 'No transactions in this period.'}
                    </strong>
                  </div>
                )}
                {unresolved.map((transaction) => (
                  <div
                    className="budget-transaction-row unresolved"
                    key={`unresolved:${transaction.transactionId}`}
                  >
                    <PrivateValue as="small">{transaction.date}</PrivateValue>
                    <span>
                      <PrivateValue as="strong">{transaction.description}</PrivateValue>
                      <small>Needs review · excluded from total</small>
                    </span>
                    <PrivateValue as="span" className="budget-transaction-account">
                      {transaction.accountName || 'No account'}
                    </PrivateValue>
                    <PrivateValue as="b">
                      {formatMoney(transaction.nativeAmount, transaction.nativeCurrency)}
                    </PrivateValue>
                    <Icon name="warning" />
                  </div>
                ))}
              </div>
              <div className="budget-transaction-total">
                <span>
                  {transactions.length + unresolved.length} transaction
                  {transactions.length + unresolved.length === 1 ? '' : 's'}
                  {unresolved.length ? ` · ${unresolved.length} excluded from total` : ''}
                </span>
                <PrivateValue as="strong">
                  Total {formatMoney(filteredTotal, currency)}
                </PrivateValue>
              </div>
            </div>
          )}
        </div>
        {canEdit || canDelete ? (
          <div
            className={`budget-detail-actions budget-detail-footer${canEdit && canDelete ? '' : ' single'}`}
          >
            {canEdit ? (
              <PrivateValue
                as="button"
                aria-label="Edit Budget"
                className="btn btn-primary"
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
                className="btn budget-remove-plan"
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

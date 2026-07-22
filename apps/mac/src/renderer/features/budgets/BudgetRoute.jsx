import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { BudgetEditorModal } from './BudgetEditorModal.jsx';

function Icon({ name, className = '' }) {
  return (
    <span className={`material-symbols-rounded${className ? ` ${className}` : ''}`}>{name}</span>
  );
}

function formatMoney(value, currency = 'PHP') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${(Number(value) || 0).toFixed(2)} ${currency || 'PHP'}`;
  }
}

function getBudgetCategoryIcon(category) {
  if (category && category.icon) return String(category.icon);
  const name = String(category && category.name ? category.name : '').toLowerCase();
  if (/(grocery|groceries|food|dining|restaurant|meal)/.test(name)) return 'restaurant';
  if (/(subscription|netflix|spotify|software|cloud|app)/.test(name)) return 'credit_card';
  if (/(transport|bus|train|fuel|gas|parking|ride|commute)/.test(name)) return 'directions_bus';
  if (/(utility|electric|water|internet|phone|bill)/.test(name)) return 'bolt';
  if (/(personal|care|health|medical|beauty|wellness)/.test(name)) return 'favorite';
  if (/(rent|home|housing|mortgage)/.test(name)) return 'home';
  if (/(random|other|misc)/.test(name)) return 'deployed_code';
  return 'shopping_bag';
}

function getUsageTone(row) {
  const percent = Number(row && row.percent) || 0;
  if (Number(row && row.remaining) < 0) return 'bad';
  if (percent >= 75) return 'warn';
  return 'good';
}

function getCategoryColor(category, index = 0) {
  if (category && category.color) return String(category.color);
  const name = String(category && category.name ? category.name : '').toLowerCase();
  if (/(food|dining|grocery|meal)/.test(name)) return '#ff6b6b';
  if (/(subscription|software|cloud|app)/.test(name)) return '#a66cff';
  if (/(transport|fuel|ride|commute)/.test(name)) return '#43a5ff';
  if (/(utility|electric|water|internet|phone)/.test(name)) return '#36c99b';
  if (/(rent|home|housing|mortgage)/.test(name)) return '#ffad45';
  if (/(health|medical|care|wellness)/.test(name)) return '#f05ba7';
  const palette = ['#6f7cff', '#b56cff', '#27b9c8', '#ff7d55', '#7ac943', '#ec5f83'];
  const key = String((category && (category.id || category.name)) || index);
  const hash = [...key].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0
  );
  return palette[hash % palette.length];
}

function getMonthShift(range, offset) {
  const start = new Date(`${String(range && range.start).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const shifted = new Date(start.getFullYear(), start.getMonth() + offset, 1);
  const end = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0);
  const toKey = (date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  return { start: toKey(shifted), end: toKey(end) };
}

function BudgetStatus({ summary, currency, range, currentDate }) {
  const spent = Number(summary.spent) || 0;
  const total = Number(summary.totalBudget) || 0;
  const left = Number(summary.leftToSpend) || 0;
  const over = left < 0;
  const today = new Date(`${currentDate || range.end}T00:00:00`);
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const calculatedPeriodDays = Math.max(1, Math.floor((end - start) / 86400000) + 1);
  const calculatedDaysElapsed = Math.max(
    0,
    Math.min(calculatedPeriodDays, Math.floor((today - start) / 86400000) + 1)
  );
  const daysInPeriod = Number(summary.periodDays ?? calculatedPeriodDays);
  const daysElapsed = Number(summary.daysElapsed ?? calculatedDaysElapsed);
  const daysRemaining = Number(
    summary.remainingDays ?? Math.max(0, daysInPeriod - daysElapsed + 1)
  );
  const safeToday = Number(
    summary.safeToSpendToday ?? (left > 0 && daysRemaining > 0 ? left / daysRemaining : 0)
  );
  const dailyBudget = Number(summary.dailyBudget ?? total / Math.max(1, daysInPeriod));
  const remainingToday = Number(summary.remainingToday ?? dailyBudget);
  return (
    <article className={`budget-status-card ${over ? 'bad' : 'good'}`}>
      <div className="budget-status-primary">
        <span className="budget-status-eyebrow">
          <Icon name={over ? 'warning' : 'check_circle'} /> Budget status
        </span>
        <h2>{over ? 'Over Budget' : 'On Track'}</h2>
        <strong>{formatMoney(Math.abs(left), currency)}</strong>
        <p>
          {over
            ? 'Review the categories driving the overage.'
            : `You have ${daysRemaining} days left in this period.`}
        </p>
      </div>
      <div className="budget-status-middle">
        <div className="budget-status-stat">
          <span>Spent</span>
          <strong>{formatMoney(spent, currency)}</strong>
          <small>of {formatMoney(total, currency)}</small>
          <div className="budget-status-line">
            <i style={{ width: `${Math.min(100, Number(summary.spentPercent) || 0)}%` }} />
          </div>
          <em>{summary.spentPercent || 0}% of total budget</em>
        </div>
        <div className="budget-status-stat">
          <span>Remaining today</span>
          <strong className={remainingToday < 0 ? 'bad-text' : 'good-text'}>
            {formatMoney(remainingToday, currency)}
          </strong>
          <small>Daily budget: {formatMoney(dailyBudget, currency)}</small>
        </div>
      </div>
      <div className="budget-status-right">
        <div className="budget-status-stat">
          <span>Days elapsed</span>
          <strong>{daysElapsed}</strong>
          <small>of {daysInPeriod} days</small>
          <div className="budget-status-line info">
            <i style={{ width: `${(daysElapsed / daysInPeriod) * 100}%` }} />
          </div>
          <em>{Math.round((daysElapsed / daysInPeriod) * 100)}% of the period</em>
        </div>
        <div className="budget-safe-card">
          <span className="budget-safe-icon">
            <Icon name="monitoring" />
          </span>
          <span>
            <small>Safe to spend today</small>
            <strong>{formatMoney(safeToday, currency)}</strong>
            <em>{over ? 'Daily budget exceeded' : 'Based on budget remaining'}</em>
          </span>
        </div>
      </div>
    </article>
  );
}

function BudgetCategoryAvatar({ category }) {
  const color = String(category && category.color ? category.color : '#ef7f7f');
  return (
    <span className="budget-category-avatar" style={{ '--category-color': color }}>
      <Icon name={getBudgetCategoryIcon(category)} />
    </span>
  );
}

function EmptyBudgetRows() {
  return (
    <div className="empty-state compact-empty">
      <strong>No category budgets yet.</strong>
      <p>Add a few simple monthly limits to start.</p>
    </div>
  );
}

function BudgetUsageBar({ rows = [], currency, onSelect }) {
  if (!rows.length) return <EmptyBudgetRows />;
  const plannedTotal = rows.reduce(
    (total, row) => total + Math.max(0, Number(row.planned) || 0),
    0
  );
  const actualTotal = rows.reduce((total, row) => total + Math.max(0, Number(row.actual) || 0), 0);
  const capacity = Math.max(1, plannedTotal, actualTotal);
  const remainingPercent = Math.max(0, ((capacity - actualTotal) / capacity) * 100);
  return (
    <div className="budget-usage">
      <div className="budget-usage-track" aria-label="Budget usage by category">
        {rows.map((row, index) => {
          const category = row.category || {};
          const width = (Math.max(0, Number(row.actual) || 0) / capacity) * 100;
          return (
            <button
              aria-label={`Open ${category.name || 'category'} budget details`}
              key={category.id || index}
              onClick={() => onSelect(row)}
              style={{
                '--segment-color': getCategoryColor(category, index),
                width: `${width}%`
              }}
              title={`${category.name}: ${formatMoney(row.actual, currency)} spent`}
              type="button"
            />
          );
        })}
        {remainingPercent > 0 ? (
          <span className="budget-usage-remaining" style={{ width: `${remainingPercent}%` }} />
        ) : null}
      </div>
      <div className="budget-usage-legend">
        {rows.map((row, index) => {
          return (
            <button
              className="budget-usage-key"
              key={row.category?.id || index}
              onClick={() => onSelect(row)}
              style={{ '--category-color': getCategoryColor(row.category, index) }}
              type="button"
            >
              <span className="budget-usage-key-dot" />
              <span>
                <strong>{row.category?.name || 'Category'}</strong>
                <small>{formatMoney(row.actual, currency)}</small>
                <em>{row.percent}%</em>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BudgetCategoryTable({ rows, currency, onSelect }) {
  const actions = useActionBindings();
  const createEntry = (
    <button
      aria-label="Create budget"
      className="budget-category-create-row"
      type="button"
      {...actions.action('open-simple-budget')}
    >
      <span className="budget-category-list-name">
        <span className="budget-category-create-icon">
          <Icon name="add" />
        </span>
        <span>
          <strong>Create budget</strong>
          <small>Set a category spending limit</small>
        </span>
      </span>
    </button>
  );
  if (!rows.length)
    return (
      <section className="budget-categories-section reference-card">
        <div className="budget-section-heading">
          <div>
            <h3>Categories</h3>
            <p>Add a category budget to see it here.</p>
          </div>
        </div>
        {createEntry}
        <EmptyBudgetRows />
      </section>
    );
  return (
    <section className="budget-categories-section reference-card">
      <div className="budget-section-heading">
        <div>
          <h3>Categories</h3>
          <p>Tap a category to view budget details.</p>
        </div>
      </div>
      <div className="budget-category-list-head">
        <span>Category</span>
        <span>Budget</span>
        <span>Spent</span>
        <span>Status</span>
        <span />
      </div>
      <div className="budget-category-list">
        {createEntry}
        {rows.map((row, index) => {
          const tone = getUsageTone(row);
          const status =
            tone === 'bad'
              ? `Over by ${formatMoney(Math.abs(Number(row.remaining) || 0), currency)}`
              : Number(row.remaining) === 0
                ? 'On budget'
                : `${formatMoney(Math.max(0, Number(row.remaining) || 0), currency)} left`;
          return (
            <button
              className="budget-category-list-row"
              key={row.category?.id}
              onClick={() => onSelect(row)}
              style={{ '--category-color': getCategoryColor(row.category, index) }}
              type="button"
            >
              <span className="budget-category-list-name">
                <span className="budget-usage-category-icon">
                  <Icon name={getBudgetCategoryIcon(row.category)} />
                </span>
                <strong>{row.category?.name}</strong>
              </span>
              <span className="amount">{formatMoney(row.planned, currency)}</span>
              <span className="amount">{formatMoney(row.actual, currency)}</span>
              <span className={`budget-category-status ${tone}`}>
                <b>{row.percent}%</b>
                <small>{status}</small>
              </span>
              <Icon name="chevron_right" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function BudgetTransactionsModal({ row, currency, onClose, periodLabel, sheetId }) {
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
  const overBudget = Number(row.remaining) < 0;
  const hasBudget = Number(row.planned) > 0;
  const canDelete = row.canDelete !== false && hasBudget;
  const variance = Math.abs(Number(row.remaining) || 0);
  const status = overBudget
    ? 'Over budget'
    : Number(row.remaining) === 0
      ? 'On budget'
      : 'On track';
  const editBinding = actions.action('open-simple-budget', {
    sheetId,
    categoryId: category.id,
    planned: Number(row.planned) || ''
  });
  const deleteBinding = actions.action('archive-budget', {
    sheetId,
    categoryId: category.id
  });
  return (
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
        className="budget-drawer budget-category-detail-drawer"
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="budget-drawer-header">
          <div className="budget-detail-heading">
            <BudgetCategoryAvatar category={category} />
            <div>
              <h2>{category.name}</h2>
              <span className={overBudget ? 'status-bad' : 'good-text'}>{status}</span>
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
            <div aria-labelledby="budget-overview-tab" id="budget-overview-panel" role="tabpanel">
              <section className="budget-detail-card">
                <div className="budget-detail-card-heading">
                  <h3>Budget vs Actual</h3>
                  <span className="tag">Monthly</span>
                </div>
                <div className="budget-vs-actual">
                  <div>
                    <strong className={overBudget ? 'status-bad' : ''}>
                      {formatMoney(row.actual, currency)}
                    </strong>
                    <span>Spent</span>
                  </div>
                  <div>
                    <strong>{formatMoney(row.planned, currency)}</strong>
                    <span>Budget</span>
                  </div>
                </div>
                <div className="budget-detail-progress">
                  <span style={{ width: `${Math.min(100, Number(row.progressPercent) || 0)}%` }} />
                </div>
                <div className="budget-detail-progress-meta">
                  <span>{row.percent}% used</span>
                  <strong className={overBudget ? 'status-bad' : 'good-text'}>
                    {overBudget
                      ? `${formatMoney(variance, currency)} over`
                      : Number(row.remaining) === 0
                        ? 'On budget'
                        : `${formatMoney(variance, currency)} left`}
                  </strong>
                </div>
              </section>
              <section className="budget-detail-card">
                <div className="budget-detail-card-heading">
                  <h3>Details</h3>
                </div>
                <dl className="budget-detail-list">
                  <div>
                    <dt>Budget</dt>
                    <dd>{formatMoney(row.planned, currency)}</dd>
                  </div>
                  <div>
                    <dt>Spent</dt>
                    <dd>{formatMoney(row.actual, currency)}</dd>
                  </div>
                  <div>
                    <dt>Remaining</dt>
                    <dd>{formatMoney(row.remaining, currency)}</dd>
                  </div>
                  <div>
                    <dt>Percent Used</dt>
                    <dd>{row.percent}%</dd>
                  </div>
                  <div>
                    <dt>Date Created</dt>
                    <dd>{row.createdAt || 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Budget Period</dt>
                    <dd>{periodLabel || 'Monthly'}</dd>
                  </div>
                </dl>
              </section>
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
                        <small>{transaction.date}</small>
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
              </div>
            </div>
          )}
        </div>
        {activeTab === 'overview' ? (
          <div
            className={`budget-detail-actions budget-detail-footer${canDelete ? '' : ' single'}`}
          >
            <button
              className="btn"
              onClick={(event) => {
                editBinding.onClick?.(event);
                onClose();
              }}
              type="button"
            >
              {hasBudget ? 'Edit Budget' : 'Create Budget'}
            </button>
            {canDelete ? (
              <button
                className="btn btn-danger"
                onClick={(event) => {
                  deleteBinding.onClick?.(event);
                  onClose();
                }}
                type="button"
              >
                <Icon name="delete" /> Delete Budget
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function DateRangeControl({ range, periodLabel }) {
  const actions = useActionBindings();
  const shift = (offset) => {
    const next = getMonthShift(range, offset);
    if (!next) return;
    actions
      .action('set-budget-range', {
        rangeStart: next.start,
        rangeEnd: next.end
      })
      .onClick?.();
  };
  return (
    <div className="budget-date-control" aria-label="Budget period">
      <button
        aria-label="Previous month"
        className="budget-date-arrow"
        onClick={() => shift(-1)}
        type="button"
      >
        <Icon name="chevron_left" />
      </button>
      <span>{periodLabel}</span>
      <button
        aria-label="Next month"
        className="budget-date-arrow"
        onClick={() => shift(1)}
        type="button"
      >
        <Icon name="chevron_right" />
      </button>
    </div>
  );
}

function BudgetRouteView({
  model,
  initialTargetSheetId = '',
  initialTargetCategoryId = '',
  initialTargetBudget = null,
  initialTargetCategory = null,
  targetRequestKey = 0,
  onTargetHandled
}) {
  const data = model || {};
  const [selectedRow, setSelectedRow] = useState(null);
  const [detailInstanceKey, setDetailInstanceKey] = useState(0);
  const currency = data.currency || 'PHP';
  const summary = data.summary || {};
  const range = data.range || {};
  const periodLabel = data.periodLabel || '';
  const categoryRows = useMemo(() => {
    const categoryDetails = new Map(
      (data.categoryOptions || []).map((category) => [category.id, category])
    );
    return [...(data.categoryRows || [])]
      .map((row) => {
        const details = categoryDetails.get(row.category?.id) || {};
        return {
          ...row,
          category: { ...row.category, icon: details.icon || '', color: details.color || '' },
          createdAt: details.createdAt || '',
          canDelete: details.canDelete
        };
      })
      .sort((left, right) => (Number(right.actual) || 0) - (Number(left.actual) || 0));
  }, [data.categoryOptions, data.categoryRows]);
  const usageRows = categoryRows;

  function openDetail(row) {
    setSelectedRow(row);
    setDetailInstanceKey((current) => current + 1);
  }

  useEffect(() => {
    if (!targetRequestKey || !initialTargetSheetId) return;
    if (String(data.sheet?.id || '') !== initialTargetSheetId) return;
    if (!initialTargetCategoryId) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setSelectedRow(null);
        onTargetHandled?.(targetRequestKey);
      });
      return () => {
        cancelled = true;
      };
    }
    const matchingRow = categoryRows.find(
      (row) => String(row.category?.id || '') === initialTargetCategoryId
    );
    const planned = Number(initialTargetBudget?.planned ?? initialTargetBudget?.amount) || 0;
    const fallbackRow = initialTargetCategory
      ? {
          category: { ...initialTargetCategory },
          planned,
          actual: 0,
          remaining: planned,
          percent: 0,
          progressPercent: 0,
          transactions: [],
          createdAt: initialTargetBudget?.createdAt || '',
          canDelete: planned > 0
        }
      : null;
    const targetRow = matchingRow || fallbackRow;
    if (!targetRow) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedRow(targetRow);
      setDetailInstanceKey((current) => current + 1);
      onTargetHandled?.(targetRequestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [
    categoryRows,
    data.sheet?.id,
    initialTargetBudget,
    initialTargetCategory,
    initialTargetCategoryId,
    initialTargetSheetId,
    model,
    onTargetHandled,
    targetRequestKey
  ]);

  return (
    <section data-react-route="budgets">
      <section className="page-header">
        <div>
          <h1>Budget</h1>
        </div>
        <div className="page-actions">
          <DateRangeControl periodLabel={periodLabel} range={range} />
        </div>
      </section>
      <BudgetStatus
        currency={currency}
        currentDate={data.currentDate}
        range={range}
        summary={summary}
      />
      <section className="budget-usage-section">
        <article className="reference-card budget-usage-card">
          <div className="reference-card-title">
            <div>
              <h3>Budget Usage</h3>
              <p>Where your budget is going.</p>
            </div>
          </div>
          <BudgetUsageBar rows={usageRows} currency={currency} onSelect={openDetail} />
        </article>
      </section>
      <BudgetCategoryTable currency={currency} onSelect={openDetail} rows={categoryRows} />
      <BudgetEditorModal editor={data.editor} categories={data.categoryOptions || []} />
      <BudgetTransactionsModal
        currency={currency}
        key={`${selectedRow?.category?.id || 'closed'}:${detailInstanceKey}`}
        onClose={() => setSelectedRow(null)}
        periodLabel={periodLabel}
        row={selectedRow}
        sheetId={data.sheet?.id || ''}
      />
    </section>
  );
}

export function BudgetRoute({ model, onAction, ...targetProps }) {
  return (
    <ActionBindingProvider onAction={onAction}>
      <BudgetRouteView model={model} {...targetProps} />
    </ActionBindingProvider>
  );
}

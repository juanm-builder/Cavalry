import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { BudgetEditorModal } from './BudgetEditorModal.jsx';
import { BudgetTransactionsModal } from './BudgetTransactionsModal.jsx';
import {
  BudgetCategoryAvatar,
  formatMoney,
  getBudgetCategoryIcon,
  getCategoryColor,
  getPlanTypeCopy,
  getRowStatusDetail,
  getUsageTone
} from './budget-view-helpers.jsx';

function renderInBody(content) {
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
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
  const spentPercent = total > 0 ? Math.max(0, Math.round((spent / total) * 100)) : 0;
  const statusTone = over ? 'bad' : left > 0 ? 'good' : 'neutral';
  return (
    <article className={`budget-status-card budget-status-compact ${statusTone}`}>
      <div className="budget-status-summary">
        <span className="budget-status-eyebrow">
          <Icon name={over ? 'warning' : 'check_circle'} /> {over ? 'Over plan' : 'On track'}
        </span>
        <strong>{formatMoney(Math.abs(left), currency)}</strong>
        <small>{over ? 'above your spending plan' : 'left in your spending plan'}</small>
      </div>
      <div className="budget-status-progress-block">
        <div className="budget-status-progress-copy">
          <span>Spent this month</span>
          <strong className={spent > 0 ? 'bad-text' : 'neutral-text'}>{spentPercent}%</strong>
        </div>
        <div className="budget-status-line">
          <i style={{ width: `${Math.min(100, spentPercent)}%` }} />
        </div>
        <small>
          {total > 0
            ? `${formatMoney(spent, currency)} of ${formatMoney(total, currency)}`
            : `${formatMoney(spent, currency)} spent · no spending plan yet`}
        </small>
      </div>
      <div className="budget-status-quick-stats">
        <div>
          <span>Day</span>
          <strong>
            {daysElapsed} of {daysInPeriod}
          </strong>
        </div>
        <div>
          <span>Safe today</span>
          <strong
            className={safeToday < 0 ? 'bad-text' : safeToday > 0 ? 'good-text' : 'neutral-text'}
          >
            {formatMoney(Math.max(0, safeToday), currency)}
          </strong>
        </div>
        <div>
          <span>Daily plan</span>
          <strong>{formatMoney(dailyBudget, currency)}</strong>
        </div>
      </div>
    </article>
  );
}

function EmptyBudgetRows({
  title = 'No plan entries yet.',
  detail = 'Add a monthly amount to start.'
}) {
  return (
    <div className="empty-state compact-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function PlanOverview({ summary, currency, onSelect }) {
  const plannedIncome = Number(summary.plannedIncome) || 0;
  const actualIncome = Number(summary.income) || 0;
  const incomeBasis = Number(summary.incomePlanBasis) || 0;
  const cards = [
    {
      key: 'income',
      label: 'Income plan',
      value: plannedIncome > 0 ? plannedIncome : incomeBasis,
      detail:
        plannedIncome > 0
          ? `${formatMoney(actualIncome, currency)} received`
          : `${formatMoney(actualIncome, currency)} received · add a plan anytime`,
      icon: 'payments',
      tone: 'info',
      valueTone: 'neutral',
      detailTone: actualIncome > 0 ? 'good' : 'neutral'
    },
    {
      key: 'spending',
      label: 'Spending plan',
      value: Number(summary.plannedSpending) || 0,
      detail: `${formatMoney(summary.spent, currency)} spent`,
      icon: 'account_balance_wallet',
      tone: Number(summary.leftToSpend) < 0 ? 'bad' : 'info',
      valueTone: 'neutral',
      detailTone: Number(summary.spent) > 0 ? 'bad' : 'neutral'
    },
    {
      key: 'commitments',
      label: 'Recurring',
      value: Number(summary.committedSpending) || 0,
      detail:
        Number(summary.uncoveredCommitments) > 0
          ? `${formatMoney(summary.uncoveredCommitments, currency)} outside your limits`
          : 'Covered by your spending limits',
      icon: 'event_repeat',
      tone: Number(summary.uncoveredCommitments) > 0 ? 'warn' : 'info',
      valueTone: 'neutral',
      detailTone: Number(summary.uncoveredCommitments) > 0 ? 'bad' : 'neutral'
    },
    {
      key: 'unallocated',
      label: 'Unallocated',
      value: Number(summary.unallocated) || 0,
      detail: 'Income not assigned to this month’s plan',
      icon: 'calculate',
      tone:
        Number(summary.unallocated) < 0 ? 'bad' : Number(summary.unallocated) > 0 ? 'good' : 'info',
      valueTone:
        Number(summary.unallocated) < 0
          ? 'bad'
          : Number(summary.unallocated) > 0
            ? 'good'
            : 'neutral'
    }
  ];
  if (Number(summary.plannedSavings) > 0) {
    cards.push({
      key: 'savings',
      label: 'Savings',
      value: Number(summary.plannedSavings) || 0,
      detail: `${formatMoney(summary.saved, currency)} saved`,
      icon: 'savings',
      tone: 'info',
      valueTone: 'neutral',
      detailTone: Number(summary.saved) > 0 ? 'good' : 'neutral'
    });
  }
  if (Number(summary.plannedDebt) > 0) {
    cards.push({
      key: 'debt',
      label: 'Debt target',
      value: Number(summary.plannedDebt) || 0,
      detail: `${formatMoney(summary.debtPaid, currency)} paid down`,
      icon: 'credit_score',
      tone: 'info',
      valueTone: 'neutral',
      detailTone: Number(summary.debtPaid) > 0 ? 'good' : 'neutral'
    });
  }
  return (
    <section aria-label="Monthly Plan overview" className="monthly-plan-overview">
      {cards.map((card) => (
        <button
          className={`monthly-plan-overview-card ${card.tone}`}
          key={card.key}
          onClick={() => onSelect(card.key)}
          type="button"
        >
          <span className="monthly-plan-overview-icon">
            <Icon name={card.icon} />
          </span>
          <span className="monthly-plan-overview-copy">
            <small>{card.label}</small>
            <strong className={card.valueTone || 'neutral'}>
              {formatMoney(card.value, currency)}
            </strong>
            <em className={card.detailTone || 'neutral'}>{card.detail}</em>
          </span>
          <Icon className="monthly-plan-overview-chevron" name="chevron_right" />
        </button>
      ))}
    </section>
  );
}

// Only speaks up when something needs attention. An all-clear banner on every
// healthy month was noise, but the unresolved-items warning still has to show.
function TrustNotice({ trust }) {
  const unresolvedCount = Number(trust && trust.unresolvedCount) || 0;
  if (!unresolvedCount) return null;
  return (
    <aside className="monthly-plan-trust warn">
      <Icon name="warning" />
      <span>
        <strong>
          {unresolvedCount} item{unresolvedCount === 1 ? '' : 's'} need review
        </strong>
        <small>Review these before relying on the total.</small>
      </span>
    </aside>
  );
}

function getMetricRows(metricKey, sections) {
  const source = sections || {};
  if (metricKey === 'income') return source.income || [];
  if (metricKey === 'spending') return source.spending || [];
  if (metricKey === 'commitments') {
    return (source.spending || []).filter((row) => Number(row && row.committed) > 0);
  }
  if (metricKey === 'savings') return source.savings || [];
  if (metricKey === 'debt') return source.debt || [];
  if (metricKey === 'unallocated') {
    return []
      .concat(source.income || [])
      .concat(source.spending || [])
      .concat(source.savings || [])
      .concat(source.debt || [])
      .filter((row) => Number(row && row.planned) !== 0 || Number(row && row.committed) !== 0);
  }
  return [];
}

function getMetricDefinition(metricKey, summary, currency) {
  const definitions = {
    income: {
      title: 'Income plan',
      explanation:
        summary.incomePlanBasisSource === 'planned'
          ? 'Expected income is used to work out how much remains unallocated.'
          : 'Until you add expected income, Cavalry temporarily uses income already received.',
      lines: [
        ['Expected', formatMoney(summary.plannedIncome, currency)],
        ['Received', formatMoney(summary.income, currency)],
        ['Used for planning', formatMoney(summary.incomePlanBasis, currency)]
      ]
    },
    spending: {
      title: 'Spending plan',
      explanation:
        'Only the limits you set are counted here. Recurring charges stay visible separately.',
      lines: [
        ['Planned', formatMoney(summary.plannedSpending, currency)],
        ['Spent', formatMoney(summary.spent, currency)],
        ['Left', formatMoney(summary.leftToSpend, currency)]
      ]
    },
    commitments: {
      title: 'Recurring charges',
      explanation:
        'Recurring charges are compared with your limits without silently increasing them.',
      lines: [
        ['Monthly total', formatMoney(summary.committedSpending, currency)],
        ['Covered', formatMoney(summary.coveredCommitments, currency)],
        ['Outside limits', formatMoney(summary.uncoveredCommitments, currency)]
      ]
    },
    savings: {
      title: 'Savings',
      explanation: 'Savings count toward your plan without being reported as spending.',
      lines: [
        ['Target', formatMoney(summary.plannedSavings, currency)],
        ['Saved', formatMoney(summary.saved, currency)],
        [
          'Left',
          formatMoney(Math.max(0, Number(summary.plannedSavings) - Number(summary.saved)), currency)
        ]
      ]
    },
    debt: {
      title: 'Debt target',
      explanation: 'Principal payments are tracked separately from everyday spending.',
      lines: [
        ['Target', formatMoney(summary.plannedDebt, currency)],
        ['Paid down', formatMoney(summary.debtPaid, currency)],
        [
          'Left',
          formatMoney(Math.max(0, Number(summary.plannedDebt) - Number(summary.debtPaid)), currency)
        ]
      ]
    },
    unallocated: {
      title: 'Unallocated',
      explanation:
        'Income used for planning minus spending, savings, debt, and uncovered recurring charges.',
      lines: [
        ['Income', formatMoney(summary.incomePlanBasis, currency)],
        ['Plan', `− ${formatMoney(summary.plannedOutflow, currency)}`],
        ['Recurring outside limits', `− ${formatMoney(summary.uncoveredCommitments, currency)}`],
        ['Unallocated', formatMoney(summary.unallocated, currency)]
      ]
    }
  };
  return definitions[metricKey] || definitions.spending;
}

function PlanMetricModal({ metricKey, summary, sections, currency, onClose, onSelectRow }) {
  const dialogRef = useRef(null);
  const definition = getMetricDefinition(metricKey, summary, currency);
  const rows = getMetricRows(metricKey, sections);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);
  return renderInBody(
    <div className="budget-drawer-layer budget-detail-modal-layer">
      <button
        aria-label={`Dismiss ${definition.title} details`}
        className="budget-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={`${definition.title} details`}
        aria-modal="true"
        className="budget-dialog monthly-plan-metric-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="budget-drawer-header">
          <div>
            <span className="budget-status-eyebrow">
              <Icon name="query_stats" /> Plan details
            </span>
            <h2>{definition.title}</h2>
          </div>
          <button
            aria-label={`Close ${definition.title} details`}
            className="btn btn-icon"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="budget-detail-scroll monthly-plan-metric-scroll">
          <section
            className="monthly-plan-metric-summary"
            aria-label={`${definition.title} summary`}
          >
            {definition.lines.map(([label, value], index) => (
              <div className={index === definition.lines.length - 1 ? 'is-total' : ''} key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <section className="budget-detail-card monthly-plan-metric-included">
            <div className="budget-detail-card-heading">
              <h3>Included categories</h3>
              <span className="tag">{rows.length}</span>
            </div>
            <div className="budget-transaction-list monthly-plan-metric-rows">
              {rows.length ? (
                rows.map((row) => {
                  const amount =
                    metricKey === 'commitments'
                      ? Number(row.committed) || 0
                      : Number(row.planned) || 0;
                  return (
                    <button
                      className="budget-transaction-row"
                      key={`${metricKey}:${row.categoryId}`}
                      onClick={() => onSelectRow(row)}
                      type="button"
                    >
                      <span>
                        <strong>{row.category?.name || 'Missing category'}</strong>
                        <small>
                          {metricKey === 'commitments'
                            ? `${formatMoney(row.planned, currency)} spending limit`
                            : `${formatMoney(row.actual, currency)} actual`}
                        </small>
                      </span>
                      <b>{formatMoney(amount, currency)}</b>
                      <Icon name="chevron_right" />
                    </button>
                  );
                })
              ) : (
                <EmptyBudgetRows
                  detail="Add an amount to include it in this month’s plan."
                  title="Nothing here yet."
                />
              )}
            </div>
          </section>
          <details className="monthly-plan-calculation-note">
            <summary>How this is calculated</summary>
            <p>{definition.explanation}</p>
          </details>
        </div>
      </aside>
    </div>
  );
}

function BudgetCategoryTable({
  rows,
  currency,
  onSelect,
  type = 'expense',
  showCreate = false,
  alwaysRender = false
}) {
  const actions = useActionBindings();
  const copy = getPlanTypeCopy(type);
  const createEntry = showCreate ? (
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
        <span className="budget-category-list-copy">
          <strong>Add to Monthly Plan</strong>
          <small>Add spending, savings, debt, or expected income</small>
        </span>
      </span>
    </button>
  ) : null;
  if (!rows.length && !showCreate && !alwaysRender) return null;
  return (
    <section className="budget-categories-section reference-card">
      <div className="budget-section-heading monthly-plan-section-heading">
        <div>
          <h3>
            <Icon name={copy.icon} /> {copy.title}
          </h3>
          <p>{copy.description}</p>
        </div>
      </div>
      {rows.length ? (
        <>
          <div className="budget-category-list-head">
            <span>Category</span>
            <span>{copy.planLabel}</span>
            <span>{copy.actualLabel}</span>
            <span>Status</span>
            <span />
          </div>
          <div className="budget-category-list">
            {createEntry}
            {rows.map((row, index) => {
              const tone = getUsageTone(row);
              const statusLabel = row.statusLabel || 'Review';
              const statusDetail = getRowStatusDetail(row, currency);
              const rowDescriptionId = `budget-${type}-${String(
                row.category?.id || row.categoryId || `missing-${index}`
              )
                .replace(/[^a-zA-Z0-9_-]+/g, '-')
                .replace(/^-+|-+$/g, '')}-${index}-description`;
              const commitmentCopy =
                type === 'expense' && Number(row.committed) > 0
                  ? `${formatMoney(row.committed, currency)} committed`
                  : '';
              return (
                <button
                  aria-describedby={rowDescriptionId}
                  className="budget-category-list-row"
                  key={row.category?.id || row.categoryId}
                  onClick={() => onSelect(row)}
                  style={{ '--category-color': getCategoryColor(row.category, index) }}
                  type="button"
                >
                  <span className="budget-category-list-name">
                    <span className="budget-usage-category-icon">
                      <Icon name={getBudgetCategoryIcon(row.category)} />
                    </span>
                    <span className="budget-category-list-copy">
                      <strong>{row.category?.name || 'Missing category'}</strong>
                      {commitmentCopy || row.isMissing || row.isArchived ? (
                        <small>
                          {row.isMissing
                            ? 'Missing category'
                            : row.isArchived
                              ? 'Archived category'
                              : commitmentCopy}
                        </small>
                      ) : null}
                    </span>
                  </span>
                  <span className="amount neutral">{formatMoney(row.planned, currency)}</span>
                  <span
                    className={`amount ${
                      Number(row.actual) <= 0
                        ? 'neutral'
                        : type === 'income'
                          ? 'good'
                          : type === 'expense'
                            ? 'bad'
                            : 'good'
                    }`}
                  >
                    {formatMoney(row.actual, currency)}
                  </span>
                  <span className={`budget-category-status ${tone}`}>
                    <b>{statusLabel}</b>
                    <small>{statusDetail}</small>
                  </span>
                  <Icon name="chevron_right" />
                  <span className="sr-only" id={rowDescriptionId}>
                    {copy.planLabel}: {formatMoney(row.planned, currency)}. {copy.actualLabel}:{' '}
                    {formatMoney(row.actual, currency)}. Status: {statusLabel}. {statusDetail}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="budget-category-list">
          {createEntry}
          <EmptyBudgetRows
            detail="Add your first amount to build this month’s plan."
            title="No plan entries yet."
          />
        </div>
      )}
    </section>
  );
}

const PLAN_SECTION_TABS = Object.freeze([
  { key: 'all', label: 'All', sectionKey: 'all' },
  { key: 'expense', label: 'Spending', sectionKey: 'spending' },
  { key: 'income', label: 'Income', sectionKey: 'income' },
  { key: 'savings', label: 'Savings', sectionKey: 'savings' },
  { key: 'debt', label: 'Debt', sectionKey: 'debt' }
]);

function PlanSectionTabs({ activeType, sections, onChange }) {
  return (
    <div aria-label="Monthly Plan sections" className="monthly-plan-tabs" role="tablist">
      {PLAN_SECTION_TABS.map((tab) => {
        const count =
          tab.key === 'all'
            ? PLAN_SECTION_TABS.reduce(
                (total, entry) =>
                  entry.key === 'all' ? total : total + (sections[entry.sectionKey] || []).length,
                0
              )
            : (sections[tab.sectionKey] || []).length;
        return (
          <button
            aria-selected={activeType === tab.key}
            className={activeType === tab.key ? 'active' : ''}
            key={tab.key}
            onClick={() => onChange(tab.key)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            <small>{count}</small>
          </button>
        );
      })}
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
  const actions = useActionBindings();
  const data = model || {};
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedMetric, setSelectedMetric] = useState('');
  const [activePlanType, setActivePlanType] = useState('expense');
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
          categoryType: row.categoryType || details.type || row.category?.type || 'expense',
          category: { ...row.category, icon: details.icon || '', color: details.color || '' },
          createdAt: details.createdAt || '',
          note: details.note || row.sources?.find((source) => source.note)?.note || '',
          canDelete: details.canDelete
        };
      })
      .sort((left, right) => (Number(right.actual) || 0) - (Number(left.actual) || 0));
  }, [data.categoryOptions, data.categoryRows]);
  const sections = useMemo(
    () => ({
      income: categoryRows.filter((row) => row.categoryType === 'income'),
      spending: categoryRows.filter((row) => row.categoryType === 'expense'),
      savings: categoryRows.filter((row) => row.categoryType === 'savings'),
      debt: categoryRows.filter((row) => row.categoryType === 'debt')
    }),
    [categoryRows]
  );
  const activeRowsByType = {
    expense: sections.spending,
    income: sections.income,
    savings: sections.savings,
    debt: sections.debt
  };

  function openDetail(row) {
    if (
      activePlanType !== 'all' &&
      row?.categoryType &&
      PLAN_SECTION_TABS.some((tab) => tab.key === row.categoryType)
    ) {
      setActivePlanType(row.categoryType);
    }
    setSelectedMetric('');
    setSelectedRow(row);
    setDetailInstanceKey((current) => current + 1);
  }

  function openMetric(metricKey) {
    setSelectedRow(null);
    setSelectedMetric(metricKey);
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
          categoryType: initialTargetCategory.type || 'expense',
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
      <section className="page-header monthly-plan-header">
        <div>
          <h1>Monthly Plan</h1>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            type="button"
            {...actions.action('open-simple-budget')}
          >
            <Icon name="add" /> Add to Plan
          </button>
          <DateRangeControl periodLabel={periodLabel} range={range} />
        </div>
      </section>
      <div className="monthly-plan-summary-shell">
        <PlanOverview currency={currency} onSelect={openMetric} summary={summary} />
        <TrustNotice trust={data.trust || {}} />
      </div>
      <BudgetStatus
        currency={currency}
        currentDate={data.currentDate}
        range={range}
        summary={summary}
      />
      <section className="monthly-plan-category-workspace">
        <div className="monthly-plan-workspace-heading">
          <div>
            <h2>Your plan</h2>
          </div>
          <PlanSectionTabs
            activeType={activePlanType}
            onChange={setActivePlanType}
            sections={sections}
          />
        </div>
        {activePlanType === 'all' ? (
          <div className="monthly-plan-all-sections">
            {PLAN_SECTION_TABS.filter((tab) => tab.key !== 'all').map((tab, index) => (
              <BudgetCategoryTable
                alwaysRender
                currency={currency}
                key={tab.key}
                onSelect={openDetail}
                rows={activeRowsByType[tab.key] || []}
                showCreate={index === 0}
                type={tab.key}
              />
            ))}
          </div>
        ) : (
          <BudgetCategoryTable
            currency={currency}
            onSelect={openDetail}
            rows={activeRowsByType[activePlanType] || []}
            showCreate
            type={activePlanType}
          />
        )}
      </section>
      <BudgetEditorModal editor={data.editor} categories={data.categoryOptions || []} />
      {selectedMetric ? (
        <PlanMetricModal
          currency={currency}
          metricKey={selectedMetric}
          onClose={() => setSelectedMetric('')}
          onSelectRow={openDetail}
          sections={sections}
          summary={summary}
        />
      ) : null}
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

import { PrivateValue } from '../../shared/PrivateValue.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { BudgetEditorModal } from './BudgetEditorModal.jsx';
import { BudgetTransactionsModal } from './BudgetTransactionsModal.jsx';
import {
  BudgetCategoryAvatar,
  formatMoney,
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

function EmptyBudgetRows({
  title = 'No plan entries yet.',
  detail = 'Add a monthly amount to start.'
}) {
  return (
    <div className="empty-state compact-empty">
      <PrivateValue as="strong">{title}</PrivateValue>
      <PrivateValue as="p">{detail}</PrivateValue>
    </div>
  );
}

function PlanOverview({ summary, currency, onSelect }) {
  const income = Number(summary.plannedIncome) || 0;
  const spending = Number(summary.plannedSpending ?? summary.totalBudget) || 0;
  const leftToSave = Math.round((income - spending) * 100) / 100;
  const cards = [
    { key: 'income', label: 'Expected income', value: income, icon: 'payments' },
    { key: 'spending', label: 'Planned spending', value: spending, icon: 'account_balance_wallet' },
    { key: 'left-to-save', label: 'Left to save', value: leftToSave, icon: 'savings' }
  ];
  const amountLength = Math.max(...cards.map((card) => formatMoney(card.value, currency).length));
  return (
    <>
      <section
        aria-label="Monthly Plan overview"
        className="plan-summary-equation"
        style={{ '--summary-card-min': `${Math.max(250, amountLength * 18 + 84)}px` }}
      >
        {cards.map((card) => (
          <button
            className={`plan-summary-card ${card.key} ${card.key === 'left-to-save' ? (leftToSave < 0 ? 'bad' : 'good') : ''}`}
            key={card.key}
            onClick={() => onSelect(card.key)}
            type="button"
          >
            <span className="plan-summary-icon">
              <Icon name={card.icon} />
            </span>
            <span className="plan-summary-copy">
              <span>{card.label}</span>
              <PrivateValue as="strong">{formatMoney(card.value, currency)}</PrivateValue>
            </span>
          </button>
        ))}
      </section>
      <section aria-label="Monthly actuals" className="plan-monthly-actuals">
        <h2>
          <Icon name="query_stats" /> Monthly actuals
        </h2>
        <dl>
          {[
            ['Received', summary.income],
            ['Spent', summary.spent],
            ['Saved', summary.saved]
          ].map(([label, amount]) => (
            <div key={label}>
              <dt>{label}</dt>
              <PrivateValue as="dd">{formatMoney(amount, currency)}</PrivateValue>
            </div>
          ))}
        </dl>
      </section>
    </>
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
        <PrivateValue as="strong">
          {unresolvedCount} item{unresolvedCount === 1 ? '' : 's'} need review
        </PrivateValue>
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
  if (metricKey === 'unallocated' || metricKey === 'left-to-save') {
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
    'left-to-save': {
      title: 'Left to save',
      explanation:
        'Expected income minus planned spending. This is the amount available before savings and debt targets are allocated.',
      lines: [
        ['Expected income', formatMoney(summary.plannedIncome, currency)],
        [
          'Planned spending',
          `− ${formatMoney(summary.plannedSpending ?? summary.totalBudget, currency)}`
        ],
        [
          'Left to save',
          formatMoney(
            (Number(summary.plannedIncome) || 0) -
              (Number(summary.plannedSpending ?? summary.totalBudget) || 0),
            currency
          )
        ]
      ]
    },
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
      <PrivateValue
        as="button"
        aria-label={`Dismiss ${definition.title} details`}
        className="budget-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <PrivateValue
        as="aside"
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
            <PrivateValue as="h2">{definition.title}</PrivateValue>
          </div>
          <PrivateValue
            as="button"
            aria-label={`Close ${definition.title} details`}
            className="btn btn-icon"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </PrivateValue>
        </div>
        <div className="budget-detail-scroll monthly-plan-metric-scroll">
          <PrivateValue
            as="section"
            className="monthly-plan-metric-summary"
            aria-label={`${definition.title} summary`}
          >
            {definition.lines.map(([label, value], index) => (
              <div className={index === definition.lines.length - 1 ? 'is-total' : ''} key={label}>
                <PrivateValue as="span">{label}</PrivateValue>
                <PrivateValue as="strong">{value}</PrivateValue>
              </div>
            ))}
          </PrivateValue>
          <section className="budget-detail-card monthly-plan-metric-included">
            <div className="budget-detail-card-heading">
              <h3>Included categories</h3>
              <PrivateValue as="span" className="tag">
                {rows.length}
              </PrivateValue>
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
                        <PrivateValue as="strong">
                          {row.category?.name || 'Missing category'}
                        </PrivateValue>
                        <PrivateValue as="small">
                          {metricKey === 'commitments'
                            ? `${formatMoney(row.planned, currency)} spending limit`
                            : `${formatMoney(row.actual, currency)} actual`}
                        </PrivateValue>
                      </span>
                      <PrivateValue as="b">{formatMoney(amount, currency)}</PrivateValue>
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
            <PrivateValue as="p">{definition.explanation}</PrivateValue>
          </details>
        </div>
      </PrivateValue>
    </div>
  );
}

function BudgetCategoryTable({
  rows,
  currency,
  onSelect,
  type = 'expense',
  showCreate = true,
  alwaysRender = false
}) {
  const actions = useActionBindings();
  const copy = getPlanTypeCopy(type);
  const totalPlanned = rows.reduce(
    (sum, row) => sum + (row.includedInPlanTotals === false ? 0 : Number(row.planned) || 0),
    0
  );
  const totalActual = rows.reduce((sum, row) => sum + (Number(row.actual) || 0), 0);
  const totals = (
    <div aria-label={`Total ${copy.title.toLowerCase()}`} className="budget-section-total">
      <strong>Total {copy.title}</strong>
      <PrivateValue as="strong">{formatMoney(totalPlanned, currency)}</PrivateValue>
      <PrivateValue as="strong">{formatMoney(totalActual, currency)}</PrivateValue>
      <span />
    </div>
  );
  const createEntry =
    showCreate || !rows.length ? (
      <button
        aria-label={`Add ${type === 'expense' ? 'spending' : type} plan`}
        className="budget-category-create-row"
        type="button"
        {...actions.action('open-simple-budget', { categoryType: type })}
      >
        <span className="budget-category-list-name">
          <span className="budget-category-create-icon">
            <Icon name="add" />
          </span>
          <span className="budget-category-list-copy">
            <strong>Add a budget</strong>
          </span>
        </span>
      </button>
    ) : null;
  if (!rows.length && !showCreate && !alwaysRender) return null;
  return (
    <section className="budget-categories-section reference-card">
      <div className="budget-section-heading monthly-plan-section-heading">
        <div>
          <PrivateValue as="h3">
            <Icon name={copy.icon} /> {copy.title}
          </PrivateValue>
          <PrivateValue as="span" className="plan-section-count">
            {rows.length}{' '}
            {type === 'debt'
              ? rows.length === 1
                ? 'payment'
                : 'payments'
              : rows.length === 1
                ? 'category'
                : 'categories'}
          </PrivateValue>
        </div>
      </div>
      {rows.length ? (
        <>
          <div className="budget-category-list-head">
            <span>Category</span>
            <PrivateValue as="span">{type === 'expense' ? 'Planned' : copy.planLabel}</PrivateValue>
            <PrivateValue as="span">{copy.actualLabel}</PrivateValue>
            <span />
          </div>
          <PrivateValue as="div" className="budget-category-list">
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
                    <BudgetCategoryAvatar category={row.category} />
                    <span className="budget-category-list-copy">
                      <PrivateValue as="strong">
                        {row.category?.name || 'Missing category'}
                      </PrivateValue>
                      {commitmentCopy || row.isMissing || row.isArchived ? (
                        <PrivateValue as="small">
                          {row.isMissing
                            ? 'Missing category'
                            : row.isArchived
                              ? 'Archived category'
                              : commitmentCopy}
                        </PrivateValue>
                      ) : null}
                    </span>
                  </span>
                  <PrivateValue as="span" className="amount neutral">
                    {formatMoney(row.planned, currency)}
                  </PrivateValue>
                  <PrivateValue
                    as="span"
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
                  </PrivateValue>
                  <span className={`budget-category-status sr-only ${tone}`}>
                    <PrivateValue as="b">{statusLabel}</PrivateValue>
                    <PrivateValue as="small">{statusDetail}</PrivateValue>
                  </span>
                  <Icon name="chevron_right" />
                  <PrivateValue as="span" className="sr-only" id={rowDescriptionId}>
                    {copy.planLabel}: {formatMoney(row.planned, currency)}. {copy.actualLabel}:{' '}
                    {formatMoney(row.actual, currency)}. Status: {statusLabel}. {statusDetail}
                  </PrivateValue>
                </button>
              );
            })}
            {totals}
          </PrivateValue>
        </>
      ) : (
        <PrivateValue as="div" className="budget-category-list">
          {createEntry}
          <p className="plan-empty-copy">
            {type === 'debt' ? 'No payments planned' : 'No entries planned'}
          </p>
          {totals}
        </PrivateValue>
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
            <PrivateValue as="span">{tab.label}</PrivateValue>
            <PrivateValue as="small">{count}</PrivateValue>
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
      <PrivateValue as="span">{periodLabel}</PrivateValue>
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
  const [activePlanType, setActivePlanType] = useState('all');
  const [sortOrder, setSortOrder] = useState('amount-desc');
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
      .sort((left, right) => {
        const nameOrder = String(left.category?.name || '').localeCompare(
          String(right.category?.name || '')
        );
        if (sortOrder === 'name') return nameOrder;
        const difference = (Number(left.planned) || 0) - (Number(right.planned) || 0);
        return (sortOrder === 'amount-asc' ? difference : -difference) || nameOrder;
      });
  }, [data.categoryOptions, data.categoryRows, sortOrder]);
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
    <section className="budget-plan-page" data-react-route="budgets">
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
      <PlanOverview currency={currency} onSelect={openMetric} summary={summary} />
      <TrustNotice trust={data.trust || {}} />
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
        <div className="plan-sort-toolbar">
          <select
            aria-label="Sort plan entries"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          >
            <option value="amount-desc">Sort: Amount — High to low</option>
            <option value="amount-asc">Sort: Amount — Low to high</option>
            <option value="name">Sort: Name — A to Z</option>
          </select>
        </div>
        {activePlanType === 'all' ? (
          <div className="monthly-plan-all-sections">
            {PLAN_SECTION_TABS.filter((tab) => tab.key !== 'all').map((tab) => (
              <BudgetCategoryTable
                alwaysRender
                currency={currency}
                key={tab.key}
                onSelect={openDetail}
                rows={activeRowsByType[tab.key] || []}
                showCreate
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

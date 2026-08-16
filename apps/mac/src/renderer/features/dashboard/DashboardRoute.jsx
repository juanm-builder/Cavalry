import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeCurrency(value) {
  return (
    String(value || 'PHP')
      .trim()
      .toUpperCase() || 'PHP'
  );
}

function formatMoneyWithCurrency(value, currency = 'PHP') {
  const nextCurrency = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: nextCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${(Number(value) || 0).toFixed(2)} ${nextCurrency}`;
  }
}

function formatMoney(value, currency = 'PHP') {
  return formatMoneyWithCurrency(value, currency);
}

function formatCompactMoney(value, currency = 'PHP') {
  const amount = Math.abs(Number(value) || 0);
  const sample = formatMoney(0, currency);
  const prefix = sample.replace(/[\d\s.,-]/g, '').trim() || `${normalizeCurrency(currency)} `;
  let display = String(Math.round(amount));
  if (amount >= 1000000) {
    display =
      (Math.round((amount / 1000000) * 10) / 10)
        .toFixed(amount >= 10000000 ? 0 : 1)
        .replace(/\.0$/, '') + 'M';
  } else if (amount >= 1000) {
    display =
      (Math.round((amount / 1000) * 10) / 10).toFixed(amount >= 10000 ? 0 : 1).replace(/\.0$/, '') +
      'k';
  }
  return `${Number(value) < 0 ? '-' : ''}${prefix}${display}`;
}

function getMoneyTone(value) {
  const amount = Number(value) || 0;
  if (amount > 0) return 'good';
  if (amount < 0) return 'bad';
  return 'neutral';
}

function getFlowTone(flowType, value) {
  if ((Number(value) || 0) === 0) return 'neutral';
  return flowType === 'inflow' ? 'good' : flowType === 'outflow' ? 'bad' : 'neutral';
}

function getRangePayload(range) {
  const nextRange = asObject(range);
  return nextRange.start && nextRange.end
    ? {
        rangeStart: nextRange.start,
        rangeEnd: nextRange.end
      }
    : {};
}

function PageHeader({ title, subtitle, eyebrow, center, children }) {
  return (
    <section className={`page-header${center ? ' dashboard-page-header' : ''}`}>
      <div>
        {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {center ? <div className="dashboard-page-header-center">{center}</div> : null}
      <div className="page-actions">{children}</div>
    </section>
  );
}

const DASHBOARD_AVERAGE_PERIODS = Object.freeze(['yearly', 'monthly', 'weekly']);

function DashboardAveragePeriodSelector({ value, onChange }) {
  const currentIndex = Math.max(0, DASHBOARD_AVERAGE_PERIODS.indexOf(value));
  const move = (offset) => {
    const nextIndex =
      (currentIndex + offset + DASHBOARD_AVERAGE_PERIODS.length) % DASHBOARD_AVERAGE_PERIODS.length;
    onChange(DASHBOARD_AVERAGE_PERIODS[nextIndex]);
  };
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <div
      className="dashboard-average-period-selector"
      role="group"
      aria-label="Dashboard average period"
    >
      <button aria-label="Previous average period" onClick={() => move(-1)} type="button">
        ‹
      </button>
      <strong aria-live="polite">{label}</strong>
      <button aria-label="Next average period" onClick={() => move(1)} type="button">
        ›
      </button>
    </div>
  );
}

function RouteButton({ label, route }) {
  const actions = useActionBindings();
  return (
    <button className="btn" type="button" {...actions.navigate(route)}>
      {label}
    </button>
  );
}

function CommandModule({ model }) {
  const actions = useActionBindings();
  const cards = asArray(asObject(model.stats).cards);
  const netWorth = cards.find((card) => card && card.id === 'net_worth') || {};
  const inflows = cards.find((card) => card && card.id === 'total_inflows') || {};
  const outflows = cards.find((card) => card && card.id === 'total_outflows') || {};
  const netFlow = cards.find((card) => card && card.id === 'net_flow') || {};
  const netWorthValue = Number(netWorth.value) || 0;
  const inflowValue = Number(inflows.value) || 0;
  const outflowValue = Number(outflows.value) || 0;
  const netFlowValue = Number(netFlow.value) || 0;
  const netFlowDirection = netFlowValue > 0 ? 'positive' : netFlowValue < 0 ? 'negative' : 'zero';
  const flowScale = Math.max(inflowValue, outflowValue, 1);
  const rangePayload = getRangePayload(model.range);
  return (
    <section className="dashboard-command" data-dashboard-module="command">
      <button
        className="dashboard-net-worth-card"
        type="button"
        {...actions.action('open-dashboard-account-group', { accountGroup: 'net-worth' })}
      >
        <span className="dashboard-kicker">Net Worth</span>
        <strong className={getMoneyTone(netWorthValue)}>
          {formatMoney(netWorthValue, model.currency)}
        </strong>
        <span className="dashboard-net-worth-note">
          Assets less liabilities · as of {String(model.asOfDate || model.range?.end || '')}
        </span>
        <span aria-hidden="true" className="dashboard-net-worth-link">
          View position <span>→</span>
        </span>
      </button>

      <article className="dashboard-flow-summary">
        <div className="dashboard-flow-summary-head">
          <div>
            <span className="dashboard-kicker">Cash flow</span>
            <h2>Money in vs. money out</h2>
          </div>
          <span className="dashboard-flow-period">{model.periodLabel}</span>
        </div>
        <div className="dashboard-flow-summary-grid">
          <button
            className={`dashboard-flow-summary-item ${getFlowTone('inflow', inflowValue)}`}
            type="button"
            {...actions.action('open-dashboard-flow', {
              flowType: 'inflow',
              ...rangePayload
            })}
          >
            <span>Total Inflows</span>
            <strong>{formatMoney(inflowValue, model.currency)}</strong>
            <small>Money in</small>
          </button>
          <div
            aria-label={`Net flow, ${netFlowDirection}, ${formatMoney(netFlowValue, model.currency)}`}
            className="dashboard-flow-connector"
            role="group"
          >
            <span aria-hidden="true">Net Flow</span>
            <b aria-hidden="true" className={getMoneyTone(netFlowValue)}>
              {formatMoney(netFlowValue, model.currency)}
            </b>
          </div>
          <button
            className={`dashboard-flow-summary-item ${getFlowTone('outflow', outflowValue)}`}
            type="button"
            {...actions.action('open-dashboard-flow', {
              flowType: 'outflow',
              ...rangePayload
            })}
          >
            <span>Total Outflows</span>
            <strong>{formatMoney(outflowValue, model.currency)}</strong>
            <small>Money out</small>
          </button>
        </div>
        <div className="dashboard-flow-balance" aria-hidden="true">
          <span
            className="good"
            style={{ width: `${Math.max(4, (inflowValue / flowScale) * 100)}%` }}
          />
          <span
            className="bad"
            style={{ width: `${Math.max(4, (outflowValue / flowScale) * 100)}%` }}
          />
        </div>
      </article>
    </section>
  );
}

function FlowValueAxis({ maxAmount, currency }) {
  const max = Math.max(1, Number(maxAmount) || 0);
  return (
    <div className="flow-value-axis" aria-hidden="true">
      <span>{formatCompactMoney(max, currency)}</span>
      <span>{formatCompactMoney(max / 2, currency)}</span>
      <span>{formatCompactMoney(0, currency)}</span>
    </div>
  );
}

function getTransactionAmount(transaction) {
  const source = asObject(transaction);
  return Number(source.baseAmount ?? source.amount) || 0;
}

function getTransactionTone(transaction) {
  const amount = getTransactionAmount(transaction);
  if (!amount) return 'neutral';
  const eventKind = String(transaction?.eventKind || transaction?.template || '');
  if (['merchant_refund', 'refund', 'reimbursement'].includes(eventKind)) return 'good';
  const kind = String(transaction?.flowKind || '');
  if (kind === 'inflow') return 'good';
  if (['expense', 'savings', 'debt'].includes(kind)) return 'bad';
  return 'neutral';
}

function formatDirectionalTransactionMoney(transaction, currency) {
  const amount = getTransactionAmount(transaction);
  const tone = getTransactionTone(transaction);
  const formatted = formatMoney(Math.abs(amount), currency);
  if (!amount) return formatted;
  if (tone === 'good') return `+${formatted}`;
  if (tone === 'bad') return `−${formatted}`;
  return formatted;
}

function getTransactionCategoryName(model, transaction) {
  const category = asObject(asObject(model.categoryLookup)[transaction?.categoryId]);
  return category.name || 'Uncategorized';
}

function transactionMatchesFlow(transaction, flowType) {
  const kind = String(transaction?.flowKind || '');
  if (flowType === 'inflow') return kind === 'inflow';
  if (flowType === 'outflow') return ['expense', 'savings', 'debt'].includes(kind);
  return ['inflow', 'expense', 'savings', 'debt'].includes(kind) || !kind;
}

function buildTransactionGroup(item, flowType, label) {
  const transactions = asArray(item?.transactions).filter((transaction) =>
    transactionMatchesFlow(transaction, flowType)
  );
  const totals = asObject(item?.totals);
  const totalKey = flowType === 'inflow' ? 'income' : flowType === 'outflow' ? 'outflow' : '';
  const hasCanonicalTotal = totalKey && Number.isFinite(Number(totals[totalKey]));
  const transactionTotal = transactions.reduce((sum, transaction) => {
    const amount = Math.abs(getTransactionAmount(transaction));
    if (flowType === 'outflow' && getTransactionTone(transaction) === 'good') {
      return sum - amount;
    }
    return sum + amount;
  }, 0);
  const total =
    flowType === 'both'
      ? Math.abs(Number(totals.income) || 0) + Math.abs(Number(totals.outflow) || 0)
      : hasCanonicalTotal
        ? Math.abs(Number(totals[totalKey]) || 0)
        : Math.abs(transactionTotal);
  return {
    id: `${item?.periodKey || item?.id || label}-${flowType}`,
    label,
    flowType,
    range: asObject(item?.range),
    transactions,
    total
  };
}

function TransactionHoverPreview({ group, currency }) {
  if (!group) return null;
  const transactions = asArray(group.transactions);
  return (
    <div className="chart-transaction-tooltip" role="status">
      <div>
        <strong>{group.label}</strong>
        <span>
          {transactions.length} transaction{transactions.length === 1 ? '' : 's'} ·{' '}
          <b className={getFlowTone(group.flowType, group.total)}>
            {formatMoney(group.total, currency)}
          </b>
        </span>
      </div>
      {transactions.length ? (
        transactions.slice(0, 3).map((transaction) => (
          <div className="chart-transaction-tooltip-row" key={transaction.id}>
            <span>{transaction.description || 'Transaction'}</span>
            <b className={getTransactionTone(transaction)}>
              {formatDirectionalTransactionMoney(transaction, currency)}
            </b>
          </div>
        ))
      ) : (
        <small>No posted transactions in this point.</small>
      )}
      {transactions.length > 3 ? <small>+{transactions.length - 3} more</small> : null}
    </div>
  );
}

function TransactionSummaryModal({ group, model, onClose }) {
  const actions = useActionBindings();
  const transactions = asArray(group?.transactions);
  const dismiss = useModalDismiss(onClose, !!group);
  if (!group) return null;
  return (
    <div
      className="modal-backdrop dashboard-transaction-summary-backdrop"
      data-react-modal="dashboard-transaction-summary"
      onMouseDown={dismiss}
    >
      <section
        className="modal-card dashboard-transaction-summary-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${group.label} transaction summary`}
      >
        <div className="panel-header">
          <div>
            <span className="dashboard-kicker">Condensed view</span>
            <h3>{group.label}</h3>
            <p>
              {transactions.length} transaction{transactions.length === 1 ? '' : 's'} ·{' '}
              <b className={getFlowTone(group.flowType, group.total)}>
                {formatMoney(group.total, model.currency)}
              </b>
            </p>
          </div>
          <button className="btn btn-icon" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {transactions.length ? (
          <div className="dashboard-transaction-summary-list">
            {transactions.map((transaction) => (
              <article className="dashboard-transaction-summary-row" key={transaction.id}>
                <div>
                  <strong>{transaction.description || 'Transaction'}</strong>
                  <span>
                    {transaction.date || 'No date'} ·{' '}
                    {getTransactionCategoryName(model, transaction)}
                  </span>
                </div>
                <b className={getTransactionTone(transaction)}>
                  {formatDirectionalTransactionMoney(transaction, model.currency)}
                </b>
                <button
                  className="btn"
                  type="button"
                  {...actions.action('open-transaction-detail', {
                    transactionId: transaction.id
                  })}
                >
                  View full details
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <strong>No posted transactions for this chart point.</strong>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function MiniDonut({ rows = [], currency, centerLabel = 'Total', onHoverGroup, onSelectGroup }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const topRows = rows.slice(0, 6);
  const total = rows.reduce((sum, row) => {
    return sum + Math.abs(Number(row.total || row.actual) || 0);
  }, 0);
  const donutSize = 220;
  const donutCenter = donutSize / 2;
  const donutRadius = 70;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const chartRows = topRows.reduce(
    (state, row, index) => {
      const amount = Math.abs(Number(row.total || row.actual) || 0);
      const percent = total > 0 ? (amount / total) * 100 : 0;
      const chartRow = {
        row,
        amount,
        percent,
        percentLabel: `${String(Math.round(percent))}%`,
        startPercent: state.accumulatedPercent,
        toneClass: `tone-${index % 6}`
      };
      return {
        accumulatedPercent: state.accumulatedPercent + percent,
        rows: amount > 0 && percent > 0 ? state.rows.concat(chartRow) : state.rows
      };
    },
    { accumulatedPercent: 0, rows: [] }
  ).rows;
  const activeItem = chartRows[activeIndex] || null;
  const activeCategory = activeItem && (activeItem.row.category || {});
  const activeName = activeCategory?.name || (activeItem && activeItem.row.label) || centerLabel;
  const activePercent = activeItem ? Math.round(activeItem.percent) : null;
  const activeTransactions = asArray(activeItem?.row?.transactions);
  const activeTransaction = activeTransactions[0] || null;

  return (
    <div className="donut-layout">
      <div className="donut-chart-wrap">
        <div className="mini-donut" aria-label="Spending by category">
          <svg
            className="mini-donut-svg"
            viewBox={`0 0 ${donutSize} ${donutSize}`}
            role="img"
            aria-label="Spending by category chart"
          >
            <circle
              className="mini-donut-track"
              cx={donutCenter}
              cy={donutCenter}
              r={donutRadius}
            />
            {chartRows.map((item) => {
              const index = chartRows.indexOf(item);
              const dash = Math.max(0, donutCircumference * (item.percent / 100));
              const gap = Math.max(0, donutCircumference - dash);
              const dashOffset = -donutCircumference * (item.startPercent / 100);
              const category = item.row.category || {};
              const name = category.name || item.row.label || 'Other';
              const group = {
                id: `category-${category.id || index}`,
                label: `${name} spending`,
                flowType: 'outflow',
                transactions: asArray(item.row.transactions),
                total: item.amount
              };
              return (
                <circle
                  key={`${(item.row.category && item.row.category.id) || item.row.label || item.toneClass}-slice`}
                  className={`mini-donut-slice ${item.toneClass}${activeIndex === index ? ' is-active' : ''}`}
                  cx={donutCenter}
                  cy={donutCenter}
                  r={donutRadius}
                  transform={`rotate(-90 ${donutCenter} ${donutCenter})`}
                  strokeDasharray={`${dash.toFixed(2)} ${gap.toFixed(2)}`}
                  strokeDashoffset={dashOffset.toFixed(2)}
                  tabIndex={0}
                  aria-label={`${name}, ${formatMoney(item.amount, currency)}, ${item.percentLabel}`}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                    onHoverGroup?.(group);
                  }}
                  onMouseLeave={() => {
                    setActiveIndex(null);
                    onHoverGroup?.(null);
                  }}
                  onFocus={() => {
                    setActiveIndex(index);
                    onHoverGroup?.(group);
                  }}
                  onBlur={() => {
                    setActiveIndex(null);
                    onHoverGroup?.(null);
                  }}
                  onClick={() => onSelectGroup?.(group)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectGroup?.(group);
                    }
                  }}
                />
              );
            })}
          </svg>
          <div className="mini-donut-center">
            <b className={getFlowTone('outflow', activeItem ? activeItem.amount : total)}>
              {formatMoney(activeItem ? activeItem.amount : total, currency)}
            </b>
            <span>{activeName}</span>
            {activeItem ? <small>{activePercent}% of spending</small> : null}
          </div>
        </div>
        {activeItem ? (
          <p className="donut-hover-hint" aria-live="polite">
            {`${activeName}: ${formatMoney(activeItem.amount, currency)} · ${activePercent}%${
              activeTransaction
                ? ` · ${activeTransaction.description || 'Transaction'}${
                    activeTransactions.length > 1 ? ` +${activeTransactions.length - 1} more` : ''
                  }`
                : ''
            }`}
          </p>
        ) : null}
      </div>
      <div className="donut-legend">
        {topRows.length ? (
          topRows.map((row, index) => {
            const amount = Math.abs(Number(row.total || row.actual) || 0);
            const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
            const category = row.category || {};
            const name = category.name || row.label || 'Other';
            const categoryId = category.id || '';
            const group = {
              id: `category-${categoryId || index}`,
              label: `${name} spending`,
              flowType: 'outflow',
              transactions: asArray(row.transactions),
              total: amount
            };
            const content = (
              <>
                <span className={`category-dot tone-${index % 6}`} />
                <strong>{name}</strong>
                <span className={`amount ${getFlowTone('outflow', amount)}`}>
                  {formatMoney(amount, currency)}
                </span>
              </>
            );
            return categoryId ? (
              <button
                key={categoryId}
                className="legend-row dashboard-click-row"
                type="button"
                aria-label={`${name}, ${formatMoney(amount, currency)}, ${String(percent)}%`}
                onClick={() => onSelectGroup?.(group)}
                onMouseEnter={() => {
                  setActiveIndex(index);
                  onHoverGroup?.(group);
                }}
                onMouseLeave={() => {
                  setActiveIndex(null);
                  onHoverGroup?.(null);
                }}
                onFocus={() => {
                  setActiveIndex(index);
                  onHoverGroup?.(group);
                }}
                onBlur={() => {
                  setActiveIndex(null);
                  onHoverGroup?.(null);
                }}
              >
                {content}
              </button>
            ) : (
              <div
                key={`${name}-${index}`}
                className="legend-row"
                aria-label={`${name}, ${formatMoney(amount, currency)}, ${String(percent)}%`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                {content}
              </div>
            );
          })
        ) : (
          <div className="empty-state compact-empty">
            <strong>No data yet.</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function getTimelineTrendPoints(rows) {
  const values = rows.map((item) => Number(asObject(item.totals).actualNet) || 0);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  return values
    .map((value, index) => {
      const x = rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100;
      const y = 50 - (value / max) * 42;
      return `${x.toFixed(2)},${Math.max(6, Math.min(94, y)).toFixed(2)}`;
    })
    .join(' ');
}

function TimelineFilter({ active, children, onClick, label }) {
  return (
    <button
      aria-pressed={active}
      className={`timeline-filter${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function FlowsModule({ model, averagePeriod = 'weekly' }) {
  const [flowFilter, setFlowFilter] = useState('both');
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const monthlyFlow = asObject(model.monthlyFlow);
  const timeline = asObject(model.timeline);
  const monthRows = asArray(timeline.rows || monthlyFlow.rows);
  const timelineSeries = asObject(timeline.series);
  const selectedRows = asArray(timelineSeries[averagePeriod]);
  const chartRows = selectedRows.length ? selectedRows : monthRows;
  const spendingSummary = asObject(model.spendingSummary);
  const dashboardAverages = asObject(timeline.dashboardAverages || timeline.averages);
  const fallbackSpending = Number(asObject(model.periodSummary).expense) || 0;
  const spendingAverages = {
    yearly: Number(asObject(dashboardAverages.yearly).spending ?? fallbackSpending) || 0,
    monthly: Number(asObject(dashboardAverages.monthly).spending ?? fallbackSpending) || 0,
    weekly: Number(asObject(dashboardAverages.weekly).spending ?? fallbackSpending) || 0
  };
  const trendPoints = chartRows.length > 0 ? getTimelineTrendPoints(chartRows) : '';
  const flowScale = Math.max(
    1,
    ...chartRows.map((item) => {
      const totals = asObject(item.totals);
      if (flowFilter === 'inflow') return Math.abs(Number(totals.income) || 0);
      if (flowFilter === 'outflow') return Math.abs(Number(totals.outflow) || 0);
      return Math.max(Math.abs(Number(totals.income) || 0), Math.abs(Number(totals.outflow) || 0));
    })
  );
  const showInflow = flowFilter !== 'outflow';
  const showOutflow = flowFilter !== 'inflow';
  const minimumColumnWidth = averagePeriod === 'monthly' ? 8 : averagePeriod === 'yearly' ? 28 : 36;

  return (
    <section className="dashboard-timeline-grid" data-dashboard-module="flows">
      <article className="reference-card reference-card-wide dashboard-timeline-card">
        <div className="timeline-header">
          <div>
            <h2>Cash-flow timeline</h2>
          </div>
        </div>
        <div className="timeline-controls" aria-label="Money timeline filters">
          <div className="timeline-control-group">
            <span>Show</span>
            <TimelineFilter
              active={flowFilter === 'both'}
              onClick={() => setFlowFilter('both')}
              label="Show inflows and outflows"
            >
              All flows
            </TimelineFilter>
            <TimelineFilter
              active={flowFilter === 'inflow'}
              onClick={() => setFlowFilter('inflow')}
              label="Show inflows only"
            >
              Inflows
            </TimelineFilter>
            <TimelineFilter
              active={flowFilter === 'outflow'}
              onClick={() => setFlowFilter('outflow')}
              label="Show outflows only"
            >
              Outflows
            </TimelineFilter>
          </div>
        </div>
        <div className="timeline-summary-strip">
          <div>
            <span>Average spending per year</span>
            <strong className={getFlowTone('outflow', spendingAverages.yearly)}>
              {formatMoney(spendingAverages.yearly, model.currency)}
            </strong>
          </div>
          <div>
            <span>Average spending per month</span>
            <strong className={getFlowTone('outflow', spendingAverages.monthly)}>
              {formatMoney(spendingAverages.monthly, model.currency)}
            </strong>
          </div>
          <div>
            <span>Average spending per week</span>
            <strong className={getFlowTone('outflow', spendingAverages.weekly)}>
              {formatMoney(spendingAverages.weekly, model.currency)}
            </strong>
          </div>
        </div>
        {chartRows.length ? (
          <div className="timeline-chart-wrap">
            <FlowValueAxis maxAmount={flowScale} currency={model.currency} />
            <div className="timeline-chart">
              <TransactionHoverPreview group={hoveredGroup} currency={model.currency} />
              <svg
                className="timeline-trend-line"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="Net movement trend"
              >
                <polyline points={trendPoints} />
              </svg>
              <div
                className="timeline-bars"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, chartRows.length)}, minmax(${minimumColumnWidth}px, 1fr))`
                }}
              >
                {chartRows.map((item) => {
                  const totals = asObject(item.totals);
                  const income = Math.abs(Number(totals.income) || 0);
                  const outflow = Math.abs(Number(totals.outflow) || 0);
                  const incomeHeight = income
                    ? Math.max(8, Math.round((income / flowScale) * 100))
                    : 0;
                  const expenseHeight = outflow
                    ? Math.max(8, Math.round((outflow / flowScale) * 100))
                    : 0;
                  const label = item.label || item.monthLabel || item.shortLabel || 'Period';
                  const inflowGroup = buildTransactionGroup(item, 'inflow', `${label} inflows`);
                  const outflowGroup = buildTransactionGroup(item, 'outflow', `${label} outflows`);
                  const allGroup = buildTransactionGroup(item, 'both', `${label} activity`);
                  return (
                    <div className="combo-month" key={item.periodKey || item.monthKey || item.id}>
                      <span className="combo-bars">
                        <button
                          className={`combo-bar timeline-bar good${showInflow ? '' : ' is-filtered'}${income ? '' : ' is-empty'}`}
                          type="button"
                          title={`${label} inflows`}
                          aria-label={`${label} inflows, ${formatMoney(income, model.currency)}`}
                          style={{ height: `${incomeHeight}%` }}
                          onClick={() => setSelectedGroup(inflowGroup)}
                          onMouseEnter={() => setHoveredGroup(inflowGroup)}
                          onMouseLeave={() => setHoveredGroup(null)}
                          onFocus={() => setHoveredGroup(inflowGroup)}
                          onBlur={() => setHoveredGroup(null)}
                        />
                        <button
                          className={`combo-bar timeline-bar bad${showOutflow ? '' : ' is-filtered'}${outflow ? '' : ' is-empty'}`}
                          type="button"
                          title={`${label} outflows`}
                          aria-label={`${label} outflows, ${formatMoney(outflow, model.currency)}`}
                          style={{ height: `${expenseHeight}%` }}
                          onClick={() => setSelectedGroup(outflowGroup)}
                          onMouseEnter={() => setHoveredGroup(outflowGroup)}
                          onMouseLeave={() => setHoveredGroup(null)}
                          onFocus={() => setHoveredGroup(outflowGroup)}
                          onBlur={() => setHoveredGroup(null)}
                        />
                      </span>
                      <button
                        className="combo-label"
                        type="button"
                        onClick={() => setSelectedGroup(allGroup)}
                        onMouseEnter={() => setHoveredGroup(allGroup)}
                        onMouseLeave={() => setHoveredGroup(null)}
                        onFocus={() => setHoveredGroup(allGroup)}
                        onBlur={() => setHoveredGroup(null)}
                      >
                        {item.shortLabel || String(item.monthLabel || '').slice(0, 3)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <strong>No {averagePeriod} flow yet.</strong>
          </div>
        )}
      </article>
      <article className="reference-card dashboard-spending-card">
        <div className="reference-card-title">
          <div>
            <h2>Spending by category</h2>
          </div>
          <span className="tag">{model.periodLabel}</span>
        </div>
        <MiniDonut
          rows={asArray(spendingSummary.rows)}
          currency={model.currency}
          centerLabel="Spent"
          onSelectGroup={setSelectedGroup}
        />
      </article>
      <TransactionSummaryModal
        group={selectedGroup}
        model={model}
        onClose={() => setSelectedGroup(null)}
      />
    </section>
  );
}

function TAccountColumn({ title, rows = [], total, tone, balances, currency }) {
  const actions = useActionBindings();
  const getBalanceTone = (balance) => {
    if (!balance) return 'neutral';
    if (tone === 'bad') return balance > 0 ? 'bad' : 'good';
    return balance > 0 ? 'good' : 'bad';
  };
  return (
    <div className={`dashboard-t-account-column ${tone}`}>
      <div className="dashboard-t-account-column-header">
        <span>{title}</span>
        <b className={`amount ${getBalanceTone(Number(total) || 0)}`}>
          {formatMoney(total, currency)}
        </b>
      </div>
      {rows.length ? (
        rows.map((account) => {
          const balance = Number(balances[account.id]) || 0;
          return (
            <button
              key={account.id}
              className="dashboard-t-account-row"
              type="button"
              {...actions.action('open-account-history', { accountId: account.id })}
            >
              <span>
                <strong>{account.name}</strong>
                <small>
                  {account.currency} · {account.subtype || account.group}
                  {account.hasCurrencyMismatch ? ' · currency repair required' : ''}
                </small>
              </span>
              <b className={`amount ${getBalanceTone(balance)}`}>
                {formatMoney(balance, currency)}
              </b>
            </button>
          );
        })
      ) : (
        <div className="empty-state compact-empty">
          <strong>No {title.toLowerCase()} yet.</strong>
        </div>
      )}
    </div>
  );
}

function MoneyShapeModule({ model }) {
  const money = asObject(model.money);
  return (
    <section className="dashboard-card-grid" data-dashboard-module="money_shape">
      <article className="reference-card reference-card-wide dashboard-t-accounts-card">
        <div className="reference-card-title">
          <div>
            <h3>Assets & obligations</h3>
          </div>
          <RouteButton label="View All" route="accounts" />
        </div>
        <div className="dashboard-t-account-grid">
          <TAccountColumn
            title="Asset Accounts"
            rows={asArray(money.assetAccountRows)}
            total={money.totalAssets}
            tone="good"
            balances={asObject(money.balances)}
            currency={model.currency}
          />
          <TAccountColumn
            title="Liability Accounts"
            rows={asArray(money.liabilityAccountRows)}
            total={money.totalLiabilities}
            tone="bad"
            balances={asObject(money.balances)}
            currency={model.currency}
          />
        </div>
      </article>
    </section>
  );
}

function EmptyLayoutPanel() {
  const actions = useActionBindings();
  return (
    <section className="panel dashboard-empty-layout">
      <div className="badge">
        <Icon name="visibility_off" />
        Dashboard Hidden
      </div>
      <h3>No dashboard sections are visible.</h3>
      <p>Use Customize Dashboard to turn sections back on or reset the layout.</p>
      <button
        className="btn btn-primary"
        type="button"
        {...actions.action('open-dashboard-customizer')}
      >
        <Icon name="tune" />
        Customize Dashboard
      </button>
    </section>
  );
}

const MODULES = Object.freeze({
  command: CommandModule,
  flows: FlowsModule,
  money_shape: MoneyShapeModule
});

function getVisibleLayout(model) {
  const layout = asArray(model.layout);
  const visible = layout.filter((item) => item && item.visible !== false && MODULES[item.id]);
  if (visible.length) {
    return visible;
  }
  if (layout.length) {
    return [];
  }
  return Object.keys(MODULES).map((id) => ({ id, visible: true }));
}

function DashboardRouteView({ model }) {
  const data = model || {};
  const actions = useActionBindings();
  const [averagePeriod, setAveragePeriod] = useState('yearly');
  const visibleLayout = getVisibleLayout(data);
  const timeframeView = asObject(asObject(data.timeframes)[averagePeriod]);
  const activeData = {
    ...data,
    ...timeframeView,
    timeline: {
      ...asObject(data.timeline),
      averages: timeframeView.timelineAverages || asObject(data.timeline).averages,
      dashboardAverages: asObject(data.timeline).averages
    }
  };
  return (
    <section data-react-route="dashboard">
      <PageHeader
        eyebrow={data.currentDate ? `As of ${data.currentDate}` : 'Money overview'}
        title="Money overview"
        center={
          <DashboardAveragePeriodSelector value={averagePeriod} onChange={setAveragePeriod} />
        }
      >
        <button className="btn" type="button" {...actions.action('open-dashboard-customizer')}>
          <Icon name="tune" />
          Customize
        </button>
        <button className="btn" type="button" {...actions.action('export-workbook')}>
          <Icon name="download" />
          Export
        </button>
      </PageHeader>
      {visibleLayout.length ? (
        visibleLayout.map((item) => {
          const Module = MODULES[item.id];
          return <Module key={item.id} model={activeData} averagePeriod={averagePeriod} />;
        })
      ) : (
        <EmptyLayoutPanel />
      )}
    </section>
  );
}

export function DashboardRoute({ model, onAction }) {
  return (
    <ActionBindingProvider onAction={onAction}>
      <DashboardRouteView model={model} />
    </ActionBindingProvider>
  );
}

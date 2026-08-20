import React from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { useActionBindings } from '../../shared/action-binding.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const LEDGER_TYPE_OPTIONS = Object.freeze([
  { value: 'all', label: 'All transactions', icon: 'select_all' },
  { value: 'income', label: 'Income', icon: 'arrow_upward' },
  { value: 'expense', label: 'Expenses', icon: 'arrow_downward' },
  { value: 'transfer', label: 'Transfers', icon: 'sync_alt' }
]);

const LEDGER_SORT_OPTIONS = Object.freeze([
  { value: 'date', label: 'Date' },
  { value: 'amount', label: 'Amount' },
  { value: 'description', label: 'Description' },
  { value: 'account', label: 'Account' },
  { value: 'category', label: 'Category' },
  { value: 'type', label: 'Type' }
]);

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function isoToDay(value) {
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) ? Math.round(stamp / 86400000) : 0;
}

function RangeSlider({ label, min, max, low, high, step = 1, onLow, onHigh, format }) {
  const safeMax = Math.max(min + step, max);
  const lowPercent = ((low - min) / (safeMax - min)) * 100;
  const highPercent = ((high - min) / (safeMax - min)) * 100;
  return (
    <div className="field ledger-range-field">
      <div className="ledger-range-heading">
        <label>{label}</label>
        <span>
          {format(low)} <span aria-hidden="true">–</span> {format(high)}
        </span>
      </div>
      <div
        className="ledger-dual-range"
        style={{ '--range-start': `${lowPercent}%`, '--range-end': `${highPercent}%` }}
      >
        <div className="ledger-range-track" />
        <input
          aria-label={`Minimum ${label.toLowerCase()}`}
          max={safeMax}
          min={min}
          onChange={onLow}
          step={step}
          type="range"
          value={low}
        />
        <input
          aria-label={`Maximum ${label.toLowerCase()}`}
          max={safeMax}
          min={min}
          onChange={onHigh}
          step={step}
          type="range"
          value={high}
        />
      </div>
    </div>
  );
}

function DateRangeFilter({ filters, range }) {
  const actions = useActionBindings();
  const bounds = asObject(range);
  if (!bounds.min || !bounds.max) return null;
  const min = isoToDay(bounds.min);
  const max = isoToDay(bounds.max);
  const low = filters.start ? isoToDay(filters.start) : min;
  const high = filters.end ? isoToDay(filters.end) : max;
  const lowBinding = actions.change('set-ledger-filter-start-day');
  const highBinding = actions.change('set-ledger-filter-end-day');
  return (
    <RangeSlider
      label="Date range"
      min={min}
      max={max}
      low={low}
      high={high}
      format={(day) =>
        new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC'
        }).format(new Date(day * 86400000))
      }
      onLow={(event) => {
        event.currentTarget.value = String(Math.min(Number(event.currentTarget.value), high));
        lowBinding.onChange?.(event);
      }}
      onHigh={(event) => {
        event.currentTarget.value = String(Math.max(Number(event.currentTarget.value), low));
        highBinding.onChange?.(event);
      }}
    />
  );
}

function AmountRangeFilter({ filters, range }) {
  const actions = useActionBindings();
  const bounds = asObject(range);
  const min = Number(bounds.min) || 0;
  const max = Math.max(min + 1, Number(bounds.max) || 1);
  const low = filters.minAmount === '' ? min : Number(filters.minAmount);
  const high = filters.maxAmount === '' ? max : Number(filters.maxAmount);
  const lowBinding = actions.change('set-ledger-filter-min-amount');
  const highBinding = actions.change('set-ledger-filter-max-amount');
  const currency = bounds.currency || 'PHP';
  return (
    <RangeSlider
      label="Amount range"
      min={min}
      max={max}
      low={low}
      high={high}
      step={Number(bounds.step) || 1}
      format={(value) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency,
          maximumFractionDigits: 0
        }).format(value)
      }
      onLow={(event) => {
        event.currentTarget.value = String(Math.min(Number(event.currentTarget.value), high));
        lowBinding.onChange?.(event);
      }}
      onHigh={(event) => {
        event.currentTarget.value = String(Math.max(Number(event.currentTarget.value), low));
        highBinding.onChange?.(event);
      }}
    />
  );
}

function FilterFields({ filters, options }) {
  const actions = useActionBindings();
  const data = asObject(filters);
  const lists = asObject(options);
  return (
    <>
      <div className="field">
        <label htmlFor="ledger-filter-account">Account</label>
        <CavalrySelect
          aria-label="Account"
          id="ledger-filter-account"
          leadingIcon="account_balance_wallet"
          name="accountId"
          options={[
            { value: '', label: 'All accounts', icon: 'select_all' },
            ...asArray(lists.accounts).map((option) => ({
              value: option.value,
              label: option.label,
              icon: option.icon || 'account_balance_wallet'
            }))
          ]}
          placeholder="All accounts"
          value={data.accountId || ''}
          {...actions.change('set-ledger-filter-account')}
        />
      </div>
      <div className="field">
        <label htmlFor="ledger-filter-category">Category</label>
        <CategorizedSelect
          aria-label="Filter transactions by category"
          clearLabel="All categories"
          id="ledger-filter-category"
          name="categoryId"
          options={lists.categories}
          placeholder="All categories"
          value={data.categoryId || ''}
          {...actions.change('set-ledger-filter-category')}
        />
      </div>
      <div className="field">
        <label htmlFor="ledger-filter-type">Type</label>
        <CavalrySelect
          aria-label="Type"
          id="ledger-filter-type"
          options={LEDGER_TYPE_OPTIONS}
          value={data.type || 'all'}
          {...actions.change('set-ledger-type')}
        />
      </div>
      <DateRangeFilter filters={data} range={lists.dateRange} />
      <AmountRangeFilter filters={data} range={lists.amountRange} />
      <div className="field">
        <label htmlFor="ledger-sort-key">Sort by</label>
        <CavalrySelect
          aria-label="Sort by"
          id="ledger-sort-key"
          options={LEDGER_SORT_OPTIONS}
          showLeadingIcon={false}
          value={data.sortKey || 'date'}
          {...actions.change('set-ledger-sort-key')}
        />
      </div>
    </>
  );
}

export function InlineFilterToolbar({ filters, filterOpen, activeFilterCount }) {
  const actions = useActionBindings();
  const data = asObject(filters);
  return (
    <div className="transaction-filter-toolbar">
      <div className="transaction-search-control" role="search">
        <Icon name="search" />
        <label className="sr-only" htmlFor="ledger-filter-search">
          Search transactions
        </label>
        <input
          autoComplete="off"
          id="ledger-filter-search"
          name="search"
          placeholder="Search descriptions, categories, accounts"
          type="search"
          value={data.search || ''}
          {...actions.change('set-ledger-filter-search')}
        />
        {data.search ? (
          <button
            aria-label="Clear transaction search"
            className="transaction-search-clear"
            type="button"
            {...actions.action('set-ledger-filter-search', { value: '' })}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      <button
        aria-expanded={filterOpen}
        className="btn transaction-filter-button"
        type="button"
        {...actions.action('toggle-ledger-filter')}
      >
        <Icon name="filter_alt" />
        Filters
        {activeFilterCount ? <span className="filter-count">{activeFilterCount}</span> : null}
      </button>
      <button
        className="btn transaction-sort-button"
        type="button"
        {...actions.action('toggle-ledger-sort-direction')}
        aria-label={data.sortDirection === 'asc' ? 'Sort descending' : 'Sort ascending'}
      >
        <Icon name={data.sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'} />
        {data.sortDirection === 'asc' ? 'Ascending' : 'Descending'}
      </button>
      <button
        className="btn transaction-reset-button"
        disabled={!activeFilterCount}
        type="button"
        {...actions.action('reset-ledger-filter')}
      >
        Reset
      </button>
    </div>
  );
}

export function FilterSidePanel({ filters, options, activeFilterCount }) {
  const actions = useActionBindings();
  return (
    <aside
      aria-label="Transaction filters"
      className="transaction-side-panel transaction-filter-panel"
    >
      <div className="transaction-side-panel-header">
        <div>
          <h2>Filters</h2>
          <small>
            {activeFilterCount ? `${activeFilterCount} active filters` : 'Refine your view'}
          </small>
        </div>
        <button
          aria-label="Close filters"
          className="btn btn-icon"
          type="button"
          {...actions.action('toggle-ledger-filter')}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="transaction-side-panel-content" id="ledger-filter-form">
        <FilterFields filters={filters} options={options} />
      </div>
      <div className="transaction-side-panel-actions">
        <button className="btn btn-ghost" type="button" {...actions.action('reset-ledger-filter')}>
          Clear all
        </button>
        <button
          className="btn btn-primary"
          type="button"
          {...actions.action('toggle-ledger-filter')}
        >
          Apply Filters
        </button>
      </div>
    </aside>
  );
}

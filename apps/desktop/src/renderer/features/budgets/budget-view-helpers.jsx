import React from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

export function formatMoney(value, currency = 'PHP') {
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

export function getBudgetCategoryIcon(category) {
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

export function getUsageTone(row) {
  const statusTone = String((row && row.statusTone) || '').toLowerCase();
  if (statusTone === 'bad') return 'bad';
  if (statusTone === 'warning' || statusTone === 'warn') return 'warn';
  if (statusTone === 'good' || statusTone === 'info') return 'good';
  const percent = Number(row && row.percent) || 0;
  if (Number(row && row.remaining) < 0 && row?.categoryType === 'expense') return 'bad';
  if (percent >= 75) return 'warn';
  return 'good';
}

const PLAN_TYPE_COPY = Object.freeze({
  expense: {
    title: 'Spending',
    description: 'Planned and spent by category.',
    planLabel: 'Plan',
    actualLabel: 'Spent',
    detailTitle: 'Spending plan vs actual',
    actualVerb: 'spent',
    icon: 'shopping_bag'
  },
  savings: {
    title: 'Savings',
    description: 'Savings targets and progress.',
    planLabel: 'Target',
    actualLabel: 'Saved',
    detailTitle: 'Savings target vs actual',
    actualVerb: 'saved',
    icon: 'savings'
  },
  debt: {
    title: 'Debt Paydown',
    description: 'Principal targets and progress.',
    planLabel: 'Target',
    actualLabel: 'Paid down',
    detailTitle: 'Debt target vs actual',
    actualVerb: 'paid down',
    icon: 'credit_score'
  },
  income: {
    title: 'Income',
    description: 'Expected and received income.',
    planLabel: 'Expected',
    actualLabel: 'Received',
    detailTitle: 'Expected income vs actual',
    actualVerb: 'received',
    icon: 'payments'
  }
});

export function getPlanTypeCopy(type) {
  return PLAN_TYPE_COPY[String(type || 'expense')] || PLAN_TYPE_COPY.expense;
}

export function getRowStatusDetail(row, currency) {
  const type = String(row && row.categoryType ? row.categoryType : 'expense');
  const planned = Number(row && row.planned) || 0;
  const actual = Number(row && row.actual) || 0;
  const remaining = Number(row && row.remaining) || 0;
  if (row && row.isMissing) return 'Excluded until the missing category is repaired';
  if (row && row.isArchived) return 'Excluded from trusted plan totals';
  if (!(planned > 0)) {
    return actual !== 0 ? 'No plan set for this activity' : 'No plan set';
  }
  if (type === 'income') {
    return remaining >= 0
      ? `${formatMoney(remaining, currency)} ahead`
      : `${formatMoney(Math.abs(remaining), currency)} still expected`;
  }
  if (type === 'savings' || type === 'debt') {
    return remaining > 0
      ? `${formatMoney(remaining, currency)} to target`
      : remaining < 0
        ? `${formatMoney(Math.abs(remaining), currency)} ahead`
        : 'Target reached';
  }
  return remaining < 0
    ? `${formatMoney(Math.abs(remaining), currency)} over`
    : `${formatMoney(remaining, currency)} left`;
}

export function getCategoryColor(category, index = 0) {
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

export function BudgetCategoryAvatar({ category }) {
  const color = String(category && category.color ? category.color : '#ef7f7f');
  return (
    <span className="budget-category-avatar" style={{ '--category-color': color }}>
      <CavalryIcon name={getBudgetCategoryIcon(category)} />
    </span>
  );
}

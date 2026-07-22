// Keep this module read-only and free of finance semantics, DOM, Electron, and Node APIs.

export const DASHBOARD_MONTH_NAMES = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]);

export function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function clonePlain(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

export function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function normalizeMonthValue(value) {
  const match = asString(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return '';
  }
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    return '';
  }
  return match[1] + '-' + match[2];
}

export function formatDisplayDate(dateValue) {
  const date = parseISODate(dateValue);
  if (!date) {
    return asString(dateValue) || 'No date';
  }
  return (
    DASHBOARD_MONTH_NAMES[date.getMonth()] +
    ' ' +
    String(date.getDate()) +
    ', ' +
    String(date.getFullYear())
  );
}

export function formatMonthValue(value) {
  const normalized = normalizeMonthValue(value);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('-');
  const monthIndex = Number(parts[1]) - 1;
  return DASHBOARD_MONTH_NAMES[monthIndex] + ' ' + parts[0];
}

export function formatVisibleDateRangeLabel(range) {
  const start = parseISODate(range && range.start);
  const end = parseISODate(range && range.end);
  if (!start || !end) {
    return 'Visible period';
  }
  if (range.start === range.end) {
    return formatDisplayDate(range.start);
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const startCopy = DASHBOARD_MONTH_NAMES[start.getMonth()] + ' ' + String(start.getDate());
  const endCopy =
    (sameMonth ? '' : DASHBOARD_MONTH_NAMES[end.getMonth()] + ' ') +
    String(end.getDate()) +
    ', ' +
    String(end.getFullYear());
  return startCopy + ' - ' + endCopy;
}

export function getDashboardSpendingRangeLabel(range) {
  if (!(range && range.startMonth && range.endMonth)) {
    return 'All months';
  }
  if (range.startMonth === range.endMonth) {
    return formatMonthValue(range.startMonth);
  }
  return formatMonthValue(range.startMonth) + ' - ' + formatMonthValue(range.endMonth);
}

export function titleCaseLabel(value, fallback) {
  const source = asString(value || fallback)
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!source) {
    return '';
  }
  return source
    .split(/\s+/)
    .map((part) => {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

export function getTemplateLabel(template) {
  const labels = {
    income_received: 'Income Received',
    expense_paid: 'Expense Paid',
    expense_charged: 'Expense Charged',
    debt_payment: 'Debt Payment',
    liability_payment: 'Debt Payment',
    transfer: 'Transfer',
    opening_balance: 'Opening Balance',
    existing_liability: 'Existing Liability',
    time_deposit_redeemed: 'Time Deposit Redeemed',
    daily_interest: 'Daily Interest'
  };
  return labels[asString(template)] || asString(template || 'Manual').replace(/_/g, ' ');
}

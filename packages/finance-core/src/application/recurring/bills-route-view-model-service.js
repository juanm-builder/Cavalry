import { roundMoney } from '../../domain/money.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFilterKind(value) {
  const kind = asString(value) || 'all';
  return ['all', 'bill', 'subscription'].includes(kind) ? kind : 'all';
}

function normalizeStatus(value) {
  const status = asString(value) || 'all';
  return [
    'all',
    'due',
    'upcoming',
    'paid',
    'overdue',
    'unrecorded',
    'review',
    'partial',
    'attention'
  ].includes(status)
    ? status
    : 'all';
}

function normalizeSort(value) {
  const sort = asString(value) || 'dueDate';
  return ['dueDate', 'name', 'amount', 'status', 'category'].includes(sort) ? sort : 'dueDate';
}

function getCategoryName(row) {
  return asString(row && row.category && row.category.name);
}

function getFilteredKindRows(rows, filterKind) {
  if (filterKind === 'bill') return rows.filter((row) => row && row.kind !== 'subscription');
  if (filterKind === 'subscription') {
    return rows.filter((row) => row && row.kind === 'subscription');
  }
  return rows.slice();
}

function getDueWeekRows(rows, today) {
  const todayDate = parseISODate(today);
  return rows
    .filter((row) => {
      const date = parseISODate(row && row.dueDate);
      if (!date || !todayDate || !['Upcoming', 'Partial'].includes(row.status)) return false;
      const diff = Math.round((date.getTime() - todayDate.getTime()) / 86400000);
      return diff >= 0 && diff <= 7;
    })
    .sort((a, b) => asString(a && a.dueDate).localeCompare(asString(b && b.dueDate)));
}

function numericAmount(row) {
  if (row && row.baseAmountVerified === false) return 0;
  const amount = Number(row && row.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function remainingAmount(row) {
  if (row && row.baseAmountVerified === false) return 0;
  if (row && row.remainingAmount !== null && row.remainingAmount !== undefined) {
    const remaining = Number(row.remainingAmount);
    if (Number.isFinite(remaining)) return remaining;
  }
  return numericAmount(row);
}

function sumRows(rows) {
  return roundMoney(asArray(rows).reduce((sum, row) => sum + numericAmount(row), 0));
}

function sumRemainingRows(rows) {
  return roundMoney(asArray(rows).reduce((sum, row) => sum + remainingAmount(row), 0));
}

function frequencyMonthlyFactor(frequency) {
  const normalized = asString(frequency).toLowerCase();
  if (normalized === 'weekly') return 52 / 12;
  if (normalized === 'every 2 weeks' || normalized === 'biweekly') return 26 / 12;
  if (normalized === 'monthly') return 1;
  if (normalized === 'quarterly') return 1 / 3;
  if (normalized === 'yearly' || normalized === 'annual') return 1 / 12;
  return 0;
}

function getRecurringTemplateKey(row) {
  return (
    asString(row && row.recurringItemId) ||
    [
      asString(row && row.name).toLowerCase(),
      asString(row && row.frequency).toLowerCase(),
      asString(row && row.categoryId),
      asString(row && row.accountId),
      String(Number(row && (row.originalAmount ?? row.amount)) || 0)
    ].join('|')
  );
}

function buildMonthlyEquivalent(rows) {
  const templates = new Map();
  asArray(rows).forEach((row) => {
    const categoryType = asString(
      row && (row.categoryType || (row.category && row.category.type))
    ).toLowerCase();
    if (categoryType === 'debt') return;
    const key = getRecurringTemplateKey(row);
    if (!key || templates.has(key)) return;
    templates.set(key, row);
  });
  let total = 0;
  let unresolvedCount = 0;
  templates.forEach((row) => {
    if (row && row.baseAmountVerified === false) {
      unresolvedCount += 1;
      return;
    }
    total += numericAmount(row) * frequencyMonthlyFactor(row && row.frequency);
  });
  return {
    count: templates.size,
    total: roundMoney(total),
    unresolvedCount
  };
}

function buildSummary(rows, today) {
  const paidRows = rows.filter((row) => row && row.status === 'Paid');
  const upcomingRows = rows.filter((row) => row && row.status === 'Upcoming');
  const overdueRows = rows.filter((row) => row && row.status === 'Overdue');
  const reviewRows = rows.filter((row) => row && row.status === 'Review match');
  const partialRows = rows.filter((row) => row && row.status === 'Partial');
  const unrecordedRows = rows.filter((row) => row && row.status === 'Expected charge not recorded');
  const dueRows = upcomingRows.concat(overdueRows, partialRows, unrecordedRows);
  const dueWeekRows = getDueWeekRows(dueRows, today);
  return {
    paidCount: paidRows.length,
    upcomingCount: upcomingRows.length,
    overdueCount: overdueRows.length,
    unrecordedCount: unrecordedRows.length,
    reviewCount: reviewRows.length,
    partialCount: partialRows.length,
    dueWeekCount: dueWeekRows.length,
    totalPaid: sumRows(paidRows),
    totalDueWeek: sumRows(dueWeekRows),
    totalOverdue: sumRows(overdueRows),
    totalUnrecorded: sumRows(unrecordedRows),
    totalReview: sumRows(reviewRows),
    totalPartial: sumRemainingRows(partialRows),
    unresolvedFxCount: rows.filter((row) => row && row.baseAmountVerified === false).length
  };
}

export function applyBillsFiltersAndSort(rows, options = {}) {
  const accountId = asString(options.accountId);
  const categoryId = asString(options.categoryId);
  const status = normalizeStatus(options.status);
  const dateValue = asString(options.date);
  const search = asString(options.search).toLowerCase();
  const sort = normalizeSort(options.sort);
  const statusRank = {
    Overdue: 0,
    Partial: 1,
    'Review match': 2,
    'Expected charge not recorded': 3,
    Upcoming: 4,
    Paid: 5
  };
  const filtered = asArray(rows).filter((row) => {
    if (accountId && row.accountId !== accountId) return false;
    if (categoryId && row.categoryId !== categoryId) return false;
    if (options.ignoreStatus !== true && status !== 'all') {
      if (
        status === 'due' &&
        !['Upcoming', 'Overdue', 'Partial', 'Expected charge not recorded'].includes(row.status)
      ) {
        return false;
      }
      if (status === 'unrecorded' && row.status !== 'Expected charge not recorded') return false;
      if (status === 'review' && row.status !== 'Review match') return false;
      if (status === 'partial' && row.status !== 'Partial') return false;
      if (
        status === 'attention' &&
        !['Review match', 'Partial', 'Expected charge not recorded'].includes(row.status)
      ) {
        return false;
      }
      if (
        !['due', 'unrecorded', 'review', 'partial', 'attention'].includes(status) &&
        asString(row.status).toLowerCase() !== status
      ) {
        return false;
      }
    }
    if (options.ignoreDate !== true && dateValue && row.dueDate !== dateValue) return false;
    if (search) {
      const haystack = [
        row.name,
        row.kind,
        getCategoryName(row),
        row.paymentMethod,
        row.frequency,
        row.status,
        row.note
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  return filtered.sort((a, b) => {
    if (sort === 'name') return asString(a && a.name).localeCompare(asString(b && b.name));
    if (sort === 'amount') return numericAmount(b) - numericAmount(a);
    if (sort === 'status') {
      return (
        (statusRank[a && a.status] ?? 4) - (statusRank[b && b.status] ?? 4) ||
        asString(a && a.dueDate).localeCompare(asString(b && b.dueDate))
      );
    }
    if (sort === 'category') {
      return (
        getCategoryName(a).localeCompare(getCategoryName(b)) ||
        asString(a && a.dueDate).localeCompare(asString(b && b.dueDate))
      );
    }
    return (
      asString(a && a.dueDate).localeCompare(asString(b && b.dueDate)) ||
      asString(a && a.name).localeCompare(asString(b && b.name))
    );
  });
}

export function buildBillsRouteViewModel(rows, options = {}) {
  const filterKind = normalizeFilterKind(options.filterKind);
  const kindRows = getFilteredKindRows(asArray(rows), filterKind);
  const recurringScopeRows = getFilteredKindRows(
    Array.isArray(options.recurringRows) ? options.recurringRows : kindRows,
    filterKind
  );
  const billRows = applyBillsFiltersAndSort(kindRows, {
    accountId: options.accountId,
    categoryId: options.categoryId,
    status: options.status,
    date: options.date,
    search: options.search,
    sort: options.sort
  });

  // Headline cards describe the selected Bills/Subscriptions scope, not the
  // transient table search/filter subset. viewSummary is returned separately.
  const summary = buildSummary(kindRows, options.today);
  const viewSummary = buildSummary(billRows, options.today);
  const dueRows = billRows.filter((row) =>
    ['Upcoming', 'Overdue', 'Partial', 'Expected charge not recorded'].includes(row && row.status)
  );
  const dueNextRows = dueRows
    .slice()
    .sort((a, b) => asString(a && a.dueDate).localeCompare(asString(b && b.dueDate)))
    .slice(0, 8);
  const monthlyEquivalent = buildMonthlyEquivalent(recurringScopeRows);
  const rowsPerPage = Math.max(5, Number(options.rowsPerPage) || 10);
  const totalPages = Math.max(1, Math.ceil(billRows.length / rowsPerPage));
  const currentPage = Math.max(1, Math.min(totalPages, Number(options.page) || 1));
  const startIndex = (currentPage - 1) * rowsPerPage;
  const pageRows = billRows.slice(startIndex, startIndex + rowsPerPage);

  return {
    filters: {
      filterKind,
      accountId: asString(options.accountId),
      categoryId: asString(options.categoryId),
      status: normalizeStatus(options.status),
      date: asString(options.date),
      search: asString(options.search),
      sort: normalizeSort(options.sort)
    },
    summaryScope: 'kind',
    rowCount: billRows.length,
    rows: billRows,
    pageRows,
    dueNextRows,
    summary,
    viewSummary,
    recurring: {
      // Compatibility aliases now represent a normalized monthly equivalent.
      monthlyCount: monthlyEquivalent.count,
      monthlyTotal: monthlyEquivalent.total,
      monthlyEquivalentCount: monthlyEquivalent.count,
      monthlyEquivalentTotal: monthlyEquivalent.total,
      unresolvedFxCount: monthlyEquivalent.unresolvedCount
    },
    pagination: {
      rowsPerPage,
      totalPages,
      currentPage,
      startIndex,
      showingStart: billRows.length ? startIndex + 1 : 0,
      showingEnd: Math.min(startIndex + rowsPerPage, billRows.length)
    }
  };
}

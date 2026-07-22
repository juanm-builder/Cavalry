import { roundMoney } from '../../domain/money.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFilterKind(value) {
  const kind = asString(value) || 'all';
  return ['all', 'bill', 'subscription'].indexOf(kind) >= 0 ? kind : 'all';
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
  ].indexOf(status) >= 0
    ? status
    : 'all';
}

function normalizeSort(value) {
  const sort = asString(value) || 'dueDate';
  return ['dueDate', 'name', 'amount', 'status', 'category'].indexOf(sort) >= 0 ? sort : 'dueDate';
}

function getCategoryName(row) {
  return asString(row && row.category && row.category.name);
}

function getFilteredKindRows(rows, filterKind) {
  if (filterKind === 'bill') {
    return rows.filter((row) => row && row.kind !== 'subscription');
  }
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
    .sort((a, b) => {
      return asString(a && a.dueDate).localeCompare(asString(b && b.dueDate));
    });
}

function sumRows(rows) {
  return rows.reduce((sum, row) => roundMoney(sum + (Number(row && row.amount) || 0)), 0);
}

function sumRemainingRows(rows) {
  return rows.reduce(
    (sum, row) =>
      roundMoney(sum + (Number(row && row.remainingAmount) || Number(row && row.amount) || 0)),
    0
  );
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
    if (accountId && row.accountId !== accountId) {
      return false;
    }
    if (categoryId && row.categoryId !== categoryId) {
      return false;
    }
    if (options.ignoreStatus !== true && status !== 'all') {
      if (
        status === 'due' &&
        row.status !== 'Upcoming' &&
        row.status !== 'Overdue' &&
        row.status !== 'Partial'
      ) {
        if (row.status !== 'Expected charge not recorded') return false;
      }
      if (status === 'unrecorded' && row.status !== 'Expected charge not recorded') {
        return false;
      }
      if (status === 'review' && row.status !== 'Review match') return false;
      if (status === 'partial' && row.status !== 'Partial') return false;
      if (
        status === 'attention' &&
        !['Review match', 'Partial', 'Expected charge not recorded'].includes(row.status)
      ) {
        return false;
      }
      if (
        status !== 'due' &&
        status !== 'unrecorded' &&
        status !== 'review' &&
        status !== 'partial' &&
        status !== 'attention' &&
        asString(row.status).toLowerCase() !== status
      ) {
        return false;
      }
    }
    if (options.ignoreDate !== true && dateValue && row.dueDate !== dateValue) {
      return false;
    }
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
      if (haystack.indexOf(search) < 0) {
        return false;
      }
    }
    return true;
  });
  return filtered.sort((a, b) => {
    if (sort === 'name') {
      return asString(a && a.name).localeCompare(asString(b && b.name));
    }
    if (sort === 'amount') {
      return (Number(b && b.amount) || 0) - (Number(a && a.amount) || 0);
    }
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
  const billRows = applyBillsFiltersAndSort(kindRows, {
    accountId: options.accountId,
    categoryId: options.categoryId,
    status: options.status,
    date: options.date,
    search: options.search,
    sort: options.sort
  });
  const paidRows = billRows.filter((row) => row && row.status === 'Paid');
  const upcomingRows = billRows.filter((row) => row && row.status === 'Upcoming');
  const overdueRows = billRows.filter((row) => row && row.status === 'Overdue');
  const reviewRows = billRows.filter((row) => row && row.status === 'Review match');
  const partialRows = billRows.filter((row) => row && row.status === 'Partial');
  const unrecordedRows = billRows.filter(
    (row) => row && row.status === 'Expected charge not recorded'
  );
  const dueRows = upcomingRows.concat(overdueRows, partialRows, unrecordedRows);
  const dueNextRows = dueRows
    .slice()
    .sort((a, b) => {
      return asString(a && a.dueDate).localeCompare(asString(b && b.dueDate));
    })
    .slice(0, 8);
  const dueWeekRows = getDueWeekRows(dueRows, options.today);
  const monthlyRecurringRows = billRows.filter((row) => {
    return (
      asString(row && row.frequency).toLowerCase() === 'monthly' &&
      asString(row && row.category && row.category.type).toLowerCase() !== 'debt'
    );
  });
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
    rowCount: billRows.length,
    rows: billRows,
    pageRows,
    dueNextRows,
    summary: {
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
      totalPartial: sumRemainingRows(partialRows)
    },
    recurring: {
      monthlyCount: monthlyRecurringRows.length,
      monthlyTotal: sumRows(monthlyRecurringRows)
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

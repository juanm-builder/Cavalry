const SCHEMA_VERSION = 2;

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeCurrency(value) {
  return asString(value).toUpperCase() || 'PHP';
}

function defaultNow() {
  return new Date().toISOString();
}

function defaultId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function monthKeyFromTimestamp(timestamp, year) {
  const match = /^(\d{4})-(\d{2})/.exec(asString(timestamp));
  return match ? `${match[1]}-${match[2]}` : `${year}-01`;
}

function monthIndexFromKey(monthKey) {
  const month = Number(String(monthKey).slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : 0;
}

export function createWorkbook(options = {}, services = {}) {
  const now = typeof services.now === 'function' ? services.now() : options.now || defaultNow();
  const createId = typeof services.createId === 'function' ? services.createId : defaultId;
  const inferredYear = Number(String(now).slice(0, 4));
  const year = Number.isInteger(Number(options.year))
    ? Number(options.year)
    : Number.isInteger(inferredYear)
      ? inferredYear
      : new Date().getFullYear();
  const currency = normalizeCurrency(options.currency);
  const monthKey = asString(options.monthKey) || monthKeyFromTimestamp(now, year);
  const workbookId = asString(options.id) || createId('workbook');

  const accountIds = {
    cash: createId('account_cash'),
    opening: createId('account_opening_equity'),
    income: createId('account_income'),
    expense: createId('account_expense')
  };
  const categoryIds = {
    income: createId('category_income'),
    expense: createId('category_expense')
  };
  const bucketIds = {
    income: createId('bucket_income'),
    expense: createId('bucket_expense')
  };

  return {
    id: workbookId,
    version: SCHEMA_VERSION,
    name: asString(options.name) || 'My Cavalry Workbook',
    year,
    currency,
    createdAt: now,
    updatedAt: now,
    settings: {
      usdToBaseRate: Number(options.usdToBaseRate) || 0,
      fileAutosave: {
        enabled: false,
        fileName: '',
        lastSavedAt: '',
        lastError: ''
      },
      dashboardLayout: []
    },
    plannerBuckets: [
      { id: bucketIds.income, key: 'income', name: 'Income' },
      { id: bucketIds.expense, key: 'other', name: 'Other' }
    ],
    accounts: [
      {
        id: accountIds.cash,
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency,
        openedDate: monthKey + '-01',
        isActive: true
      },
      {
        id: accountIds.opening,
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency,
        isSystem: true,
        isActive: true
      },
      {
        id: accountIds.income,
        name: 'Income',
        group: 'income',
        subtype: 'income',
        currency,
        isActive: true
      },
      {
        id: accountIds.expense,
        name: 'General Expense',
        group: 'expense',
        subtype: 'expense',
        currency,
        isActive: true
      }
    ],
    categories: [
      {
        id: categoryIds.income,
        name: 'Income',
        type: 'income',
        color: '#53d18f',
        currency,
        linkedAccountId: accountIds.income,
        plannerBucketId: bucketIds.income,
        isActive: true
      },
      {
        id: categoryIds.expense,
        name: 'General',
        type: 'expense',
        color: '#ef7f7f',
        currency,
        linkedAccountId: accountIds.expense,
        plannerBucketId: bucketIds.expense,
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    recurringItems: [],
    recurringReconciliations: [],
    sheets: [
      {
        id: createId('sheet'),
        name: monthKey,
        monthKey,
        monthIndex: monthIndexFromKey(monthKey),
        budgets: [],
        budgetLineItems: [],
        entries: []
      }
    ],
    fxRates: [],
    assets: [],
    aiDrafts: [],
    externalDraftGroups: [],
    advisorDraftGroups: [],
    advisorThreads: [],
    checkpoints: [],
    migrationNotes: []
  };
}

export { SCHEMA_VERSION as CURRENT_WORKBOOK_SCHEMA_VERSION };

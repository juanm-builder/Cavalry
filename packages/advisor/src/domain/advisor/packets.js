import { normalizeDateKey, roundMoney } from '@cavalry/finance-core/domain/money.js';
import { getLedgerHistoricalBalancesAsOf } from '@cavalry/finance-core/domain/ledger/balances.js';
import {
  getMeaningfulLedgerCleanupPayload,
  normalizeLedgerCleanupPayload
} from './ledger-drafts.js';
import {
  ADVISOR_TRANSACTION_BATCH_LIMIT,
  ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2,
  ADVISOR_TRANSACTION_TEMPLATES,
  advisorPromptRequestsTransactionHistory,
  advisorTransactionTextKey,
  buildAdvisorTransactionIntakePreflightHints,
  parseAdvisorTransactionListRows
} from './transaction-drafts.js';
import {
  ADVISOR_BRAIN_CONTEXT_REQUEST_KINDS,
  ADVISOR_BRAIN_INTENT,
  normalizeAdvisorBrainContextRequests
} from './brain.js';
import {
  getAdvisorImageAttachmentMetadata,
  getAdvisorImageIntakePrompt
} from './image-attachments.js';
import {
  buildAdvisorCategoryReliabilitySummary,
  buildAdvisorSemanticSummary,
  calculateAdvisorBudgetPercentages,
  classifyAdvisorTransactionSemantics,
  SPENDING_DEFINITION
} from './financial-semantics.js';

function getAccountById(workbook, accountId) {
  return workbook && workbook.accounts
    ? workbook.accounts.find((account) => account.id === accountId) || null
    : null;
}

function getCategoryById(workbook, categoryId) {
  return workbook && workbook.categories
    ? workbook.categories.find((category) => category.id === categoryId) || null
    : null;
}

function getCounterpartyById(workbook, counterpartyId) {
  return workbook && workbook.counterparties
    ? workbook.counterparties.find((counterparty) => counterparty.id === counterpartyId) || null
    : null;
}

function getAdvisorAccountSnapshotAsOfDate(workbook, options = {}) {
  const explicit = normalizeDateKey(options.asOfDate || options.as_of_date);
  if (explicit) {
    return explicit;
  }
  const dates = [];
  (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).forEach(
    (transaction) => {
      const date = normalizeDateKey(transaction && transaction.date);
      if (date) {
        dates.push(date);
      }
    }
  );
  (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).forEach((account) => {
    const opened = normalizeDateKey(account && account.openedDate);
    const placement = normalizeDateKey(account && account.placementDate);
    if (opened) dates.push(opened);
    if (placement) dates.push(placement);
  });
  return dates.sort()[dates.length - 1] || normalizeDateKey(options.currentDate) || '';
}

export function advisorPacketSourceRef(type, id) {
  return String(type || 'source') + ':' + String(id || 'unknown');
}

export function advisorPacketSourceId(prefix, rawValue) {
  return (
    String(prefix || 'source') +
    ':' +
    String(rawValue || 'unknown')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
  );
}

function advisorDecimal(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return roundMoney(numeric).toFixed(2);
}

function advisorMoney(amount, currency, sourceRefs, formula, inputRefs) {
  const item = {
    amount: advisorDecimal(amount),
    currency,
    source_refs: sourceRefs || []
  };
  if (formula) {
    item.formula = formula;
  }
  if (inputRefs && inputRefs.length) {
    item.input_refs = inputRefs;
  }
  return item;
}

function normalizeAdvisorQuestionText(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultFormatMoneyWithCurrency(value, currency) {
  return advisorDecimal(value) + ' ' + String(currency || 'PHP');
}

function getService(services, name, fallback) {
  return typeof services[name] === 'function' ? services[name] : fallback;
}

function getFilteredTransactionsForPacket(workbook, range, services) {
  const getFilteredTransactions = services.getFilteredTransactions;
  if (typeof getFilteredTransactions === 'function') {
    return getFilteredTransactions(workbook, range);
  }
  const start = range && range.start ? range.start : '';
  const end = range && range.end ? range.end : '';
  return (workbook.transactions || []).filter((transaction) => {
    const date = String((transaction && transaction.date) || '');
    return !!date && (!start || date >= start) && (!end || date <= end);
  });
}

function getTransactionBaseAmountForPacket(transaction, services) {
  const getTransactionBaseAmount = services.getTransactionBaseAmount;
  if (typeof getTransactionBaseAmount === 'function') {
    return getTransactionBaseAmount(transaction);
  }
  return roundMoney(
    Number((transaction && (transaction.baseAmount || transaction.amount)) || 0) || 0
  );
}

function getTransactionFlowKindForPacket(workbook, transaction, services) {
  const getTransactionFlowKind = services.getTransactionFlowKind;
  if (typeof getTransactionFlowKind === 'function') {
    return getTransactionFlowKind(workbook, transaction);
  }
  const template = String(transaction && transaction.template ? transaction.template : '');
  if (template === 'opening_balance' || template === 'existing_liability') return 'opening';
  if (template === 'transfer') return 'transfer';
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  if (category && category.type === 'income') return 'inflow';
  if (category && category.type === 'expense') return 'expense';
  if (category && category.type === 'savings') return 'savings';
  if (category && category.type === 'debt') return 'debt';
  if (template === 'income_received' || template === 'daily_interest') return 'inflow';
  if (template === 'expense_paid' || template === 'expense_charged') return 'expense';
  if (template === 'debt_payment' || template === 'liability_payment') return 'debt';
  return 'transfer';
}

function formatMoneyForPacket(value, workbook, services) {
  const formatMoney = services.formatMoney;
  if (typeof formatMoney === 'function') {
    return formatMoney(value, workbook);
  }
  const formatMoneyWithCurrency = getService(
    services,
    'formatMoneyWithCurrency',
    defaultFormatMoneyWithCurrency
  );
  return formatMoneyWithCurrency(value, workbook && workbook.currency ? workbook.currency : 'PHP');
}

function formatDeltaMoneyForPacket(value, workbook, services) {
  const formatDeltaMoney = services.formatDeltaMoney;
  if (typeof formatDeltaMoney === 'function') {
    return formatDeltaMoney(value, workbook);
  }
  const amount = Number(value) || 0;
  if (amount > 0) return '+' + formatMoneyForPacket(amount, workbook, services);
  if (amount < 0) return '-' + formatMoneyForPacket(Math.abs(amount), workbook, services);
  return formatMoneyForPacket(0, workbook, services);
}

function formatDisplayDateForPacket(value, services) {
  const formatDisplayDate = services.formatDisplayDate;
  return typeof formatDisplayDate === 'function'
    ? formatDisplayDate(value)
    : String(value || 'No date');
}

function getTransactionAccountLabelForPacket(workbook, transaction, services) {
  const getTransactionAccountLabel = services.getTransactionAccountLabel;
  if (typeof getTransactionAccountLabel === 'function') {
    return getTransactionAccountLabel(workbook, transaction);
  }
  const account = (transaction && transaction.lines ? transaction.lines : [])
    .map((line) => getAccountById(workbook, line.accountId))
    .find((item) => item && (item.group === 'asset' || item.group === 'liability'));
  return account ? account.name : 'Workbook';
}

function getTransferAccountLabelForPacket(workbook, transaction) {
  const lines = transaction && transaction.lines ? transaction.lines : [];
  const accountLines = lines
    .map((line) => ({
      line,
      account: getAccountById(workbook, line.accountId)
    }))
    .filter(
      (item) =>
        item.account && (item.account.group === 'asset' || item.account.group === 'liability')
    );
  const source = accountLines.find((item) => item.line && item.line.direction === 'credit');
  const destination = accountLines.find((item) => item.line && item.line.direction === 'debit');
  if (source && destination) {
    return source.account.name + ' -> ' + destination.account.name;
  }
  if (accountLines.length >= 2) {
    return accountLines[0].account.name + ' -> ' + accountLines[1].account.name;
  }
  return accountLines.length ? accountLines[0].account.name : 'Workbook';
}

function getAdvisorCategorizationReviewRange(workbook, context, prompt, services) {
  const getAdvisorLedgerCleanupRange = services.getAdvisorLedgerCleanupRange;
  if (typeof getAdvisorLedgerCleanupRange === 'function') {
    return getAdvisorLedgerCleanupRange(prompt, workbook);
  }
  const text = String(prompt || '').toLowerCase();
  if (/\b(all|whole|entire|everything|every transaction|full workbook)\b/.test(text)) {
    return { start: '', end: '' };
  }
  const profile = context && context.profile ? context.profile : {};
  return {
    start: profile.rangeStart || '',
    end: profile.rangeEnd || ''
  };
}

function transactionIsInCategorizationReviewRange(transaction, range, services) {
  if (!(range && range.start)) {
    return true;
  }
  const transactionIsInDateRange = services.transactionIsInDateRange;
  if (typeof transactionIsInDateRange === 'function') {
    return transactionIsInDateRange(transaction, range);
  }
  const date = String(transaction && transaction.date ? transaction.date : '');
  return !!(date && date >= range.start && date <= range.end);
}

function getCategorizationReviewRangeLabel(range, context, services) {
  if (!(range && range.start)) {
    return 'Full workbook';
  }
  const formatVisibleDateRangeLabel = services.formatVisibleDateRangeLabel;
  if (typeof formatVisibleDateRangeLabel === 'function') {
    return formatVisibleDateRangeLabel(range);
  }
  const profile = context && context.profile ? context.profile : {};
  return (
    profile.rangeLabel || [range.start, range.end].filter(Boolean).join(' - ') || 'Visible period'
  );
}

export function isAdvisorCategorizationVagueCategory(category) {
  const key = advisorTransactionTextKey(category && category.name);
  return (
    !key ||
    [
      'misc',
      'miscellaneous',
      'other',
      'others',
      'uncategorized',
      'uncategorized expense',
      'uncategorized expenses',
      'general',
      'general expense',
      'general expenses'
    ].indexOf(key) >= 0
  );
}

function getAdvisorCategorizationVagueCategories(workbook, services) {
  const isAdvisorCleanupVagueCategory = services.isAdvisorCleanupVagueCategory;
  const isVagueCategory =
    typeof isAdvisorCleanupVagueCategory === 'function'
      ? isAdvisorCleanupVagueCategory
      : isAdvisorCategorizationVagueCategory;
  return (workbook.categories || []).filter(
    (category) => category && category.isActive !== false && isVagueCategory(category)
  );
}

export function countAdvisorDuplicateLabels(items, keyFn) {
  const groups = {};
  (items || []).forEach((item) => {
    if (item && item.isActive === false) {
      return;
    }
    const key = keyFn(item);
    if (!key) {
      return;
    }
    groups[key] = groups[key] || [];
    groups[key].push(item);
  });
  return Object.keys(groups)
    .filter((key) => groups[key].length > 1)
    .map((key) => ({
      label: key,
      count: groups[key].length,
      names: groups[key]
        .map((item) => item.name || item.id || '')
        .filter(Boolean)
        .slice(0, 6)
    }));
}

export function getAdvisorCategorizationReviewTransactions(workbook, range, services = {}) {
  return (workbook.transactions || []).filter((transaction) =>
    transactionIsInCategorizationReviewRange(transaction, range, services)
  );
}

export function getAdvisorReviewableCategorizationTransactions(workbook, prompt, services = {}) {
  const context = services.context || {};
  const range = getAdvisorCategorizationReviewRange(workbook || {}, context, prompt, services);
  const vagueCategoryIds = {};
  getAdvisorCategorizationVagueCategories(workbook || {}, services).forEach((category) => {
    vagueCategoryIds[category.id] = true;
  });
  return getAdvisorCategorizationReviewTransactions(workbook || {}, range, services).filter(
    (transaction) =>
      !transaction.categoryId ||
      vagueCategoryIds[transaction.categoryId] ||
      !getCategoryById(workbook || {}, transaction.categoryId)
  );
}

export function getAdvisorTransactionSourceRef(transaction) {
  return advisorPacketSourceId(
    'transaction',
    transaction && transaction.id ? transaction.id : 'unknown'
  );
}

export function buildAdvisorFullWorkbookPacket(workbook = {}) {
  return {
    packet_version: 'cavalry.workbook.structured.v1',
    workbook: {
      id: workbook.id || '',
      name: workbook.name || 'Cavalry',
      year: workbook.year || '',
      currency: workbook.currency || 'PHP',
      source_ref: advisorPacketSourceRef('workbook', workbook.id || 'active')
    },
    accounts: (workbook.accounts || []).map((account) => ({
      id: account.id,
      name: account.name,
      group: account.group,
      subtype: account.subtype || '',
      currency: account.currency || workbook.currency,
      isActive: account.isActive !== false,
      isSystem: account.isSystem === true,
      canUseInTransactionDraft:
        account.isActive !== false &&
        account.isSystem !== true &&
        ['asset', 'liability'].includes(account.group),
      source_ref: advisorPacketSourceRef('account', account.id)
    })),
    categories: (workbook.categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      type: category.type,
      currency: category.currency || workbook.currency,
      linkedAccountId: category.linkedAccountId || '',
      isActive: category.isActive !== false,
      source_ref: advisorPacketSourceRef('category', category.id)
    })),
    counterparties: (workbook.counterparties || []).map((counterparty) => ({
      id: counterparty.id,
      name: counterparty.name,
      kind: counterparty.kind || 'other',
      isActive: counterparty.isActive !== false,
      source_ref: advisorPacketSourceRef('counterparty', counterparty.id)
    })),
    transactions: (workbook.transactions || []).map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      template: transaction.template,
      description: transaction.description,
      categoryId: transaction.categoryId || '',
      counterpartyId: transaction.counterpartyId || '',
      recurringItemId: transaction.recurringItemId || '',
      amount: transaction.amount,
      currency: transaction.originalCurrency || workbook.currency,
      source: transaction.source || 'manual',
      reference: transaction.reference || '',
      note: transaction.note || '',
      source_ref: advisorPacketSourceRef('transaction', transaction.id)
    })),
    recurring_items: (workbook.recurringItems || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      categoryId: item.categoryId,
      counterpartyId: item.counterpartyId || '',
      accountId: item.accountId || '',
      amount: item.amount,
      currency: item.currency || workbook.currency,
      frequency: item.frequency,
      anchorDate: item.anchorDate,
      autoRenew: item.autoRenew === true,
      isActive: item.isActive !== false,
      note: item.note || '',
      source_ref: advisorPacketSourceRef('recurringItem', item.id)
    })),
    budgets: (workbook.sheets || []).map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      monthIndex: sheet.monthIndex,
      notes: sheet.notes || '',
      budgets: (sheet.budgets || []).map((budget) => ({
        categoryId: budget.categoryId,
        planned: budget.planned,
        source_ref: advisorPacketSourceRef('budget', sheet.id + ':' + budget.categoryId)
      })),
      budgetLineItems: (sheet.budgetLineItems || []).map((item) => ({
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        planned: item.planned,
        currency: item.currency || workbook.currency,
        dueDate: item.dueDate || '',
        recurringItemId: item.recurringItemId || '',
        source_ref: advisorPacketSourceRef('budgetLineItem', item.id)
      })),
      source_ref: advisorPacketSourceRef('sheet', sheet.id)
    })),
    ai_drafts: (workbook.aiDrafts || []).map((draft) => ({
      id: draft.id,
      status: draft.status,
      operation: draft.operation,
      objectType: draft.objectType,
      title: draft.title,
      source_refs: draft.sourceRefs || [],
      source_ref: advisorPacketSourceRef('aiDraft', draft.id)
    }))
  };
}

export function buildAdvisorAccountSnapshotPacket(workbook = {}, options = {}) {
  const safeWorkbook = workbook || {};
  const currency = safeWorkbook.currency || 'PHP';
  const asOfDate = getAdvisorAccountSnapshotAsOfDate(safeWorkbook, options);
  const balances = getLedgerHistoricalBalancesAsOf(safeWorkbook, asOfDate);
  const formatBalance =
    typeof options.formatBalance === 'function'
      ? options.formatBalance
      : (amount) => defaultFormatMoneyWithCurrency(amount, currency);
  const sourceAccounts = (safeWorkbook.accounts || []).filter(
    (account) => account && ['asset', 'liability'].includes(account.group)
  );
  const rows = sourceAccounts
    .map((account) => ({
      account,
      balance: roundMoney(Number(balances[account.id] || 0) || 0)
    }))
    .filter((row) => row.account.isActive !== false || Math.abs(row.balance) > 0.0001)
    .map((row) => {
      const account = row.account;
      const sourceRef = advisorPacketSourceRef('account', account.id);
      return {
        account_id: account.id,
        name: account.name,
        group: account.group,
        subtype: account.subtype || '',
        currency: account.currency || currency,
        is_active: account.isActive !== false,
        is_system: account.isSystem === true,
        selectable_for_transaction_drafts:
          account.isActive !== false &&
          account.isSystem !== true &&
          ['asset', 'liability'].includes(account.group),
        balance: advisorDecimal(row.balance),
        balance_currency: currency,
        balance_display: formatBalance(row.balance, account),
        as_of: asOfDate,
        source_ref: sourceRef,
        source_refs: [sourceRef]
      };
    })
    .sort((a, b) => {
      if (a.group !== b.group) {
        return a.group === 'asset' ? -1 : 1;
      }
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  const activeRows = rows.filter((row) => row.is_active && !row.is_system);
  const assetTotal = activeRows
    .filter((row) => row.group === 'asset')
    .reduce((sum, row) => roundMoney(sum + Math.max(0, Number(row.balance) || 0)), 0);
  const liabilityTotal = activeRows
    .filter((row) => row.group === 'liability')
    .reduce((sum, row) => roundMoney(sum + Math.max(0, Number(row.balance) || 0)), 0);
  const archivedNonzeroCount = rows.filter(
    (row) => !row.is_active && Math.abs(Number(row.balance) || 0) > 0.0001
  ).length;
  return {
    packet_version: 'cavalry.account_snapshot.v1',
    as_of: asOfDate,
    currency,
    selection: {
      policy: 'active_asset_liability_accounts_plus_archived_nonzero',
      source_count: sourceAccounts.length,
      included_count: rows.length,
      omitted_count: Math.max(0, sourceAccounts.length - rows.length),
      continuation_supported: false,
      included_refs: rows.map((row) => row.source_ref)
    },
    counts: {
      included_accounts: rows.length,
      active_accounts: rows.filter((row) => row.is_active).length,
      archived_nonzero_accounts: archivedNonzeroCount,
      asset_accounts: rows.filter((row) => row.group === 'asset').length,
      liability_accounts: rows.filter((row) => row.group === 'liability').length
    },
    totals: {
      assets: advisorMoney(
        assetTotal,
        currency,
        ['account_snapshot:assets'].concat(
          rows
            .filter((row) => row.is_active && !row.is_system && row.group === 'asset')
            .map((row) => row.source_ref)
        )
      ),
      liabilities: advisorMoney(
        liabilityTotal,
        currency,
        ['account_snapshot:liabilities'].concat(
          rows
            .filter((row) => row.is_active && !row.is_system && row.group === 'liability')
            .map((row) => row.source_ref)
        )
      ),
      net_worth: advisorMoney(roundMoney(assetTotal - liabilityTotal), currency, [
        'account_snapshot:net_worth',
        'account_snapshot:assets',
        'account_snapshot:liabilities'
      ])
    },
    accounts: rows,
    limitations: archivedNonzeroCount
      ? [
          'Archived accounts with nonzero balances are included for historical review but are not selectable for new drafts.'
        ]
      : []
  };
}

function getAdvisorCategorySortRank(category) {
  const type = String((category && category.type) || '');
  if (type === 'income') return 1;
  if (type === 'expense') return 2;
  if (type === 'savings') return 3;
  if (type === 'debt') return 4;
  return 9;
}

function buildAdvisorCategoryUsageMap(transactions, services = {}) {
  return (Array.isArray(transactions) ? transactions : []).reduce((map, transaction) => {
    const categoryId = String((transaction && transaction.categoryId) || '').trim();
    if (!categoryId) {
      return map;
    }
    if (!map[categoryId]) {
      map[categoryId] = {
        count: 0,
        amount: 0,
        source_refs: []
      };
    }
    map[categoryId].count += 1;
    map[categoryId].amount = roundMoney(
      map[categoryId].amount + Math.abs(getTransactionBaseAmountForPacket(transaction, services))
    );
    const ref = getAdvisorTransactionSourceRef(transaction);
    if (ref && map[categoryId].source_refs.indexOf(ref) < 0) {
      map[categoryId].source_refs.push(ref);
    }
    return map;
  }, {});
}

export function buildAdvisorCategoryInventoryPacket(
  workbook = {},
  context = {},
  options = {},
  services = {}
) {
  const safeWorkbook = workbook || {};
  const safeContext = context || {};
  const profile = safeContext.profile || {};
  const currency = profile.currency || safeWorkbook.currency || 'PHP';
  const range = {
    start: profile.rangeStart || '',
    end: profile.rangeEnd || ''
  };
  const allCategories = (safeWorkbook.categories || []).filter(Boolean);
  const selectedTransactions = getFilteredTransactionsForPacket(safeWorkbook, range, services);
  const selectedUsage = buildAdvisorCategoryUsageMap(selectedTransactions, services);
  const allTimeUsage = buildAdvisorCategoryUsageMap(safeWorkbook.transactions || [], services);
  const categories = allCategories
    .slice()
    .sort((left, right) => {
      const rankDelta = getAdvisorCategorySortRank(left) - getAdvisorCategorySortRank(right);
      if (rankDelta) {
        return rankDelta;
      }
      if ((left && left.isActive !== false) !== (right && right.isActive !== false)) {
        return left && left.isActive !== false ? -1 : 1;
      }
      return String((left && left.name) || '').localeCompare(String((right && right.name) || ''));
    })
    .map((category) => {
      const categoryId = String((category && category.id) || '').trim();
      const sourceRef = advisorPacketSourceRef('category', categoryId);
      const selected = selectedUsage[categoryId] || { count: 0, amount: 0, source_refs: [] };
      const allTime = allTimeUsage[categoryId] || { count: 0, amount: 0, source_refs: [] };
      return {
        category_id: categoryId,
        name: category.name || 'Unnamed category',
        type: category.type || '',
        currency: category.currency || currency,
        is_active: category.isActive !== false,
        linked_account_id: category.linkedAccountId || '',
        planner_bucket_id: category.plannerBucketId || '',
        selected_period_transaction_count: selected.count,
        selected_period_amount: advisorDecimal(selected.amount),
        selected_period_amount_display: formatMoneyForPacket(
          selected.amount,
          safeWorkbook,
          services
        ),
        all_time_transaction_count: allTime.count,
        source_ref: sourceRef,
        source_refs: [sourceRef].concat(selected.source_refs.slice(0, 20))
      };
    });
  const countByType = (type) => categories.filter((category) => category.type === type).length;
  return {
    packet_version: 'cavalry.category_inventory.v1',
    question_type: 'category_inventory',
    selection: {
      policy: 'full_category_inventory',
      source_count: allCategories.length,
      included_count: categories.length,
      omitted_count: 0,
      continuation_supported: false,
      row_limit: categories.length,
      included_refs: categories.map((category) => category.source_ref)
    },
    period: {
      start: range.start,
      end: range.end,
      label: profile.rangeLabel || 'Selected period'
    },
    counts: {
      categories_total: categories.length,
      active_categories: categories.filter((category) => category.is_active).length,
      archived_categories: categories.filter((category) => !category.is_active).length,
      income_categories: countByType('income'),
      expense_categories: countByType('expense'),
      savings_categories: countByType('savings'),
      debt_categories: countByType('debt'),
      selected_period_categories_with_transactions: categories.filter(
        (category) => Number(category.selected_period_transaction_count || 0) > 0
      ).length,
      selected_period_categories_without_transactions: categories.filter(
        (category) => Number(category.selected_period_transaction_count || 0) <= 0
      ).length
    },
    categories,
    source_refs: categories.map((category) => category.source_ref),
    limitations: [
      'This includes every category record in the workbook, including categories with zero selected-period transactions.',
      'Selected-period amounts are usage totals for the current date scope, not budget limits.'
    ]
  };
}

const ADVISOR_TEXT_HISTORY_DEFAULT_LIMIT = 8;

const ADVISOR_TEXT_HISTORY_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'into',
  'with',
  'using',
  'this',
  'that',
  'then',
  'than',
  'same',
  'last',
  'time',
  'transaction',
  'transactions',
  'previous',
  'prior',
  'again',
  'usual',
  'like',
  'copy',
  'create',
  'add',
  'draft',
  'paid',
  'pay',
  'payment',
  'transferred',
  'transfer',
  'moved',
  'move',
  'sent',
  'send',
  'received',
  'receive',
  'today',
  'yesterday',
  'tomorrow',
  'php',
  'pesos',
  'peso',
  'usd',
  'my',
  'our',
  'your'
]);

function clampAdvisorTextHistoryLimit(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return ADVISOR_TEXT_HISTORY_DEFAULT_LIMIT;
  }
  return Math.max(5, Math.min(10, numeric));
}

function normalizeAdvisorHistoryDate(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : '';
}

function sortAdvisorHistoryTransactionsNewestFirst(left, right) {
  const leftDate = normalizeAdvisorHistoryDate(left && left.date);
  const rightDate = normalizeAdvisorHistoryDate(right && right.date);
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }
  return String((right && right.id) || '').localeCompare(String((left && left.id) || ''));
}

function getAdvisorTextHistoryPromptTokens(prompt) {
  const seen = new Set();
  return advisorTransactionTextKey(prompt)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(
      (word) =>
        word.length >= 3 && !/^\d+$/.test(word) && !ADVISOR_TEXT_HISTORY_STOP_WORDS.has(word)
    )
    .filter((word) => {
      if (seen.has(word)) {
        return false;
      }
      seen.add(word);
      return true;
    })
    .slice(0, 24);
}

function getAdvisorHistoryTransactionAccounts(workbook, transaction) {
  const seen = new Set();
  return (transaction && transaction.lines ? transaction.lines : [])
    .map((line) => {
      const account = getAccountById(workbook, line && line.accountId);
      if (!(
        account &&
        account.isActive !== false &&
        account.isSystem !== true &&
        ['asset', 'liability'].includes(account.group)
      )) {
        return null;
      }
      const key = account.id || account.name;
      if (!key || seen.has(key)) {
        return null;
      }
      seen.add(key);
      return {
        id: account.id,
        name: account.name,
        group: account.group,
        subtype: account.subtype || '',
        direction: line.direction || '',
        source_ref: advisorPacketSourceRef('account', account.id)
      };
    })
    .filter(Boolean);
}

function getAdvisorHistoryTransactionFieldNames(workbook, transaction) {
  const accounts = getAdvisorHistoryTransactionAccounts(workbook, transaction);
  const debitAccount = accounts.find((account) => account.direction === 'debit') || null;
  const creditAccount = accounts.find((account) => account.direction === 'credit') || null;
  const template = String((transaction && transaction.template) || '');
  if (template === 'income_received') {
    return {
      primaryAccountName: debitAccount ? debitAccount.name : '',
      secondaryAccountName: ''
    };
  }
  if (template === 'transfer' || template === 'debt_payment' || template === 'liability_payment') {
    return {
      primaryAccountName: creditAccount ? creditAccount.name : '',
      secondaryAccountName: debitAccount ? debitAccount.name : ''
    };
  }
  return {
    primaryAccountName: creditAccount ? creditAccount.name : debitAccount ? debitAccount.name : '',
    secondaryAccountName: ''
  };
}

function getAdvisorHistoryTransactionSearchText(workbook, transaction) {
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  const counterparty =
    transaction && transaction.counterpartyId
      ? getCounterpartyById(workbook, transaction.counterpartyId)
      : null;
  const accounts = getAdvisorHistoryTransactionAccounts(workbook, transaction);
  return advisorTransactionTextKey(
    [
      transaction && transaction.template,
      transaction && transaction.description,
      transaction && transaction.note,
      category && category.name,
      counterparty && counterparty.name,
      accounts.map((account) => account.name).join(' ')
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function scoreAdvisorHistoryTransaction(workbook, transaction, prompt, tokens) {
  const searchText = getAdvisorHistoryTransactionSearchText(workbook, transaction);
  const promptKey = advisorTransactionTextKey(prompt);
  let score = 0;
  tokens.forEach((token) => {
    if ((' ' + searchText + ' ').includes(' ' + token + ' ')) {
      score += 3;
    } else if (searchText.includes(token)) {
      score += 1;
    }
  });
  const template = String((transaction && transaction.template) || '');
  if (
    /\b(transfer|transferred|move|moved|sent|send)\b/.test(promptKey) &&
    template === 'transfer'
  ) {
    score += 2;
  }
  if (
    /\b(paid|pay|bought|buy|spent|spend|expense|purchase)\b/.test(promptKey) &&
    (template === 'expense_paid' || template === 'expense_charged')
  ) {
    score += 2;
  }
  if (/\b(income|salary|received|receive)\b/.test(promptKey) && template === 'income_received') {
    score += 2;
  }
  const amount = Number((transaction && (transaction.amount || transaction.baseAmount)) || 0) || 0;
  if (
    amount > 0 &&
    new RegExp('\\b' + String(amount).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(
      promptKey
    )
  ) {
    score += 1;
  }
  return score;
}

function buildAdvisorHistoryTransactionRow(workbook, transaction) {
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  const counterparty =
    transaction && transaction.counterpartyId
      ? getCounterpartyById(workbook, transaction.counterpartyId)
      : null;
  const accounts = getAdvisorHistoryTransactionAccounts(workbook, transaction);
  const fieldNames = getAdvisorHistoryTransactionFieldNames(workbook, transaction);
  const note = String((transaction && transaction.note) || '').trim();
  const row = {
    id: transaction.id,
    date: transaction.date || '',
    template: transaction.template || '',
    description: transaction.description || '',
    amount: roundMoney(
      Number((transaction && (transaction.amount || transaction.baseAmount)) || 0) || 0
    ),
    currency: transaction.originalCurrency || transaction.currency || workbook.currency || 'PHP',
    categoryId: transaction.categoryId || '',
    categoryName: category ? category.name : '',
    counterpartyId: transaction.counterpartyId || '',
    counterpartyName: counterparty ? counterparty.name : '',
    primaryAccountName: fieldNames.primaryAccountName,
    secondaryAccountName: fieldNames.secondaryAccountName,
    account_names: accounts.map((account) => account.name),
    source_ref: advisorPacketSourceRef('transaction', transaction.id)
  };
  if (note) {
    row.note = note.slice(0, 160);
  }
  return row;
}

function buildAdvisorTransactionHistoryContext(workbook, prompt, options = {}) {
  if (!advisorPromptRequestsTransactionHistory(prompt)) {
    return {
      included: false,
      reason: 'not_requested',
      policy: 'none',
      max_transactions: 0,
      transactions: []
    };
  }
  const maxTransactions = clampAdvisorTextHistoryLimit(
    options.historyLimit || options.maxHistoryTransactions
  );
  const tokens = getAdvisorTextHistoryPromptTokens(prompt);
  const transactions = (workbook.transactions || [])
    .filter((transaction) => transaction && transaction.id)
    .slice()
    .sort(sortAdvisorHistoryTransactionsNewestFirst);
  const scored = transactions.map((transaction, index) => ({
    transaction,
    index,
    score: scoreAdvisorHistoryTransaction(workbook, transaction, prompt, tokens)
  }));
  const hasMatches = scored.some((item) => item.score > 0);
  const selected = (
    hasMatches
      ? scored
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score || left.index - right.index)
      : scored
  )
    .slice(0, maxTransactions)
    .map((item) => buildAdvisorHistoryTransactionRow(workbook, item.transaction));
  return {
    included: selected.length > 0,
    reason: 'prompt_requested_history',
    policy: 'recent_matching_transactions',
    match_mode: hasMatches ? 'token_match' : 'recent_fallback',
    max_transactions: maxTransactions,
    transactions: selected
  };
}

const ADVISOR_TEXT_INTENT_LOOKUP_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'i',
  'in',
  'into',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'the',
  'these',
  'this',
  'to',
  'using',
  'with',
  'add',
  'also',
  'book',
  'charge',
  'charged',
  'create',
  'entry',
  'expense',
  'expenses',
  'log',
  'paid',
  'pay',
  'post',
  'record',
  'save',
  'spent',
  'transaction',
  'transactions',
  'today',
  'todya',
  'yesterday'
]);

function getAdvisorTextIntentFieldSearchParts(fields) {
  const source = fields && typeof fields === 'object' ? fields : {};
  return [
    source.template,
    source.description,
    source.categoryId,
    source.categoryName,
    source.primaryAccountId,
    source.primaryAccountName,
    source.secondaryAccountId,
    source.secondaryAccountName,
    source.counterpartyId,
    source.counterpartyName,
    source.counterpartyKind,
    source.note
  ].filter(Boolean);
}

function getAdvisorTextIntentLookupTokens(parts) {
  const key = advisorTransactionTextKey(
    (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join(' ')
  );
  const seen = new Set();
  return key
    .split(/\s+/)
    .filter((token) => {
      if (
        !token ||
        token.length < 2 ||
        /^\d+$/.test(token) ||
        ADVISOR_TEXT_INTENT_LOOKUP_STOP_WORDS.has(token) ||
        seen.has(token)
      ) {
        return false;
      }
      seen.add(token);
      return true;
    })
    .slice(0, 80);
}

function buildAdvisorPreparedTransactionRows(prompt, options = {}) {
  return parseAdvisorTransactionListRows(prompt, {
    currentDate: options.currentDate,
    defaultDateForUndatedRows: options.defaultDateForUndatedRows === true
  })
    .slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT)
    .map((row, index) => {
      const fields = row && row.fields ? row.fields : {};
      return {
        rowIndex: index + 1,
        sourceText: String((row && row.sourceText) || '').trim(),
        normalizedPrompt: String((row && row.prompt) || '').trim(),
        evidence: {
          template: fields.template || '',
          date: fields.date || '',
          description: fields.description || '',
          amount: Number(fields.amount || 0) || 0,
          currency: fields.currency || '',
          primaryAccountName: fields.primaryAccountName || '',
          secondaryAccountName: fields.secondaryAccountName || '',
          categoryName: fields.categoryName || '',
          counterpartyName: fields.counterpartyName || ''
        }
      };
    });
}

function buildAdvisorTextIntentLookupSearchParts(prompt, pendingAction, localHints, preparedRows) {
  const parts = [prompt];
  (Array.isArray(preparedRows) ? preparedRows : []).forEach((row) => {
    parts.push(row.sourceText, row.normalizedPrompt);
    parts.push(...getAdvisorTextIntentFieldSearchParts(row.evidence));
  });
  (Array.isArray(localHints) ? localHints : []).forEach((hint) => {
    const source = hint && typeof hint === 'object' ? hint : {};
    const intent = source.intent && typeof source.intent === 'object' ? source.intent : {};
    parts.push(
      source.sourceText,
      source.source_text,
      source.prompt,
      source.reason,
      intent.template,
      intent.reason
    );
    parts.push(...getAdvisorTextIntentFieldSearchParts(intent.fields));
  });
  if (pendingAction && typeof pendingAction === 'object') {
    parts.push(pendingAction.template, pendingAction.reason);
    parts.push(...getAdvisorTextIntentFieldSearchParts(pendingAction.fields));
  }
  return parts.filter(Boolean);
}

function scoreAdvisorTextLookupItem(item, tokens, searchKey) {
  const nameKey = advisorTransactionTextKey(item && item.name);
  if (!nameKey) {
    return 0;
  }
  let score = 0;
  if (searchKey && (' ' + searchKey + ' ').includes(' ' + nameKey + ' ')) {
    score += 12;
  }
  const itemKey = advisorTransactionTextKey(
    [item.id, item.name, item.group, item.subtype, item.type, item.kind].filter(Boolean).join(' ')
  );
  tokens.forEach((token) => {
    if ((' ' + nameKey + ' ').includes(' ' + token + ' ')) {
      score += 5;
    } else if (nameKey.includes(token)) {
      score += 3;
    } else if ((' ' + itemKey + ' ').includes(' ' + token + ' ')) {
      score += 1;
    }
  });
  return score;
}

function selectAdvisorTextLookupItems(items, tokens, searchKey, options = {}) {
  const sourceItems = (Array.isArray(items) ? items : []).filter(options.filter || (() => true));
  const limit = Math.max(1, Math.round(Number(options.limit || 16) || 16));
  const minimum = Math.max(0, Math.min(limit, Math.round(Number(options.minimum || 0) || 0)));
  const scored = sourceItems.map((item, index) => ({
    item,
    index,
    score: scoreAdvisorTextLookupItem(item, tokens, searchKey)
  }));
  const selected = scored.filter((entry) => entry.score > 0);
  if (selected.length < minimum) {
    scored.forEach((entry) => {
      if (
        selected.length < minimum &&
        !selected.some((selectedEntry) => selectedEntry.index === entry.index)
      ) {
        selected.push(entry);
      }
    });
  }
  return selected
    .slice(0, limit)
    .map((entry) => (options.map ? options.map(entry.item) : entry.item));
}

function getAdvisorBrainActiveAiDrafts(workbook) {
  return (workbook.aiDrafts || []).filter(
    (draft) => draft && ['pending', 'needs_fix', 'failed'].includes(String(draft.status || ''))
  );
}

function getAdvisorBrainBudgetRows(workbook, limit = 20) {
  const rows = [];
  (workbook.sheets || []).forEach((sheet) => {
    (sheet.budgets || []).forEach((budget) => {
      const category = getCategoryById(workbook, budget && budget.categoryId);
      rows.push({
        sheetId: sheet.id,
        sheetName: sheet.name || '',
        monthIndex: sheet.monthIndex,
        categoryId: budget.categoryId || '',
        categoryName: category ? category.name : '',
        planned: roundMoney(Number(budget.planned || 0) || 0),
        source_ref: advisorPacketSourceRef(
          'budget',
          String(sheet.id || '') + ':' + String(budget.categoryId || '')
        )
      });
    });
  });
  return rows.slice(0, Math.max(0, limit));
}

function getAdvisorBrainRecurringRows(workbook, limit = 20) {
  return (workbook.recurringItems || [])
    .filter((item) => item && item.isActive !== false)
    .slice(0, Math.max(0, limit))
    .map((item) => {
      const category = getCategoryById(workbook, item.categoryId);
      const counterparty = getCounterpartyById(workbook, item.counterpartyId);
      const account = getAccountById(workbook, item.accountId);
      return {
        id: item.id,
        kind: item.kind || 'bill',
        name: item.name,
        categoryId: item.categoryId || '',
        categoryName: category ? category.name : '',
        counterpartyId: item.counterpartyId || '',
        counterpartyName: counterparty ? counterparty.name : '',
        accountId: item.accountId || '',
        accountName: account ? account.name : '',
        amount: roundMoney(Number(item.amount || 0) || 0),
        currency: item.currency || workbook.currency || 'PHP',
        frequency: item.frequency || '',
        anchorDate: item.anchorDate || '',
        autoRenew: item.autoRenew === true,
        source_ref: advisorPacketSourceRef('recurringItem', item.id)
      };
    });
}

function getAdvisorBrainAiDraftRows(workbook, limit = 20) {
  return getAdvisorBrainActiveAiDrafts(workbook)
    .slice(0, Math.max(0, limit))
    .map((draft) => ({
      id: draft.id,
      status: draft.status,
      operation: draft.operation,
      objectType: draft.objectType,
      targetId: draft.targetId || '',
      title: draft.title || '',
      summary: draft.summary || '',
      source_refs: draft.sourceRefs || [],
      source_ref: advisorPacketSourceRef('aiDraft', draft.id)
    }));
}

function getAdvisorBrainPromptTokens(prompt) {
  return getAdvisorTextHistoryPromptTokens(prompt).slice(0, 16);
}

function getAdvisorBrainTransactionRows(workbook, prompt, limit = 12) {
  const tokens = getAdvisorBrainPromptTokens(prompt);
  const rows = (workbook.transactions || [])
    .filter((transaction) => transaction && transaction.id)
    .slice()
    .sort(sortAdvisorHistoryTransactionsNewestFirst)
    .map((transaction, index) => ({
      transaction,
      index,
      score: scoreAdvisorHistoryTransaction(workbook, transaction, prompt, tokens)
    }));
  const hasMatches = rows.some((row) => row.score > 0);
  const selected = (
    hasMatches
      ? rows
          .filter((row) => row.score > 0)
          .sort((left, right) => right.score - left.score || left.index - right.index)
      : rows
  ).slice(0, Math.max(0, limit));
  return selected.map((row) => buildAdvisorHistoryTransactionRow(workbook, row.transaction));
}

function buildAdvisorBrainWorkbookMap(workbook) {
  return {
    workbook: {
      id: workbook.id || 'unknown',
      name: workbook.name || 'Workbook',
      year: workbook.year || '',
      currency: workbook.currency || 'PHP',
      source_ref: advisorPacketSourceRef('workbook', workbook.id)
    },
    counts: {
      accounts: (workbook.accounts || []).length,
      categories: (workbook.categories || []).length,
      counterparties: (workbook.counterparties || []).length,
      transactions: (workbook.transactions || []).length,
      recurring_items: (workbook.recurringItems || []).length,
      budget_months: (workbook.sheets || []).length,
      active_ai_drafts: getAdvisorBrainActiveAiDrafts(workbook).length
    },
    accounts: (workbook.accounts || [])
      .filter((account) => account && account.isActive !== false)
      .map((account) => ({
        id: account.id,
        name: account.name,
        group: account.group,
        subtype: account.subtype || '',
        currency: account.currency || workbook.currency,
        isSystem: account.isSystem === true,
        canUseInTransactionDraft:
          account.isActive !== false &&
          account.isSystem !== true &&
          ['asset', 'liability'].includes(account.group),
        source_ref: advisorPacketSourceRef('account', account.id)
      })),
    categories: (workbook.categories || [])
      .filter((category) => category && category.isActive !== false)
      .map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        currency: category.currency || workbook.currency,
        linkedAccountId: category.linkedAccountId || '',
        source_ref: advisorPacketSourceRef('category', category.id)
      })),
    counterparties: (workbook.counterparties || [])
      .filter((counterparty) => counterparty && counterparty.isActive !== false)
      .map((counterparty) => ({
        id: counterparty.id,
        name: counterparty.name,
        kind: counterparty.kind || 'other',
        source_ref: advisorPacketSourceRef('counterparty', counterparty.id)
      })),
    recurring_items: getAdvisorBrainRecurringRows(workbook, 12),
    budgets: getAdvisorBrainBudgetRows(workbook, 12),
    ai_drafts: getAdvisorBrainAiDraftRows(workbook, 8),
    recent_transactions: getAdvisorBrainTransactionRows(workbook, '', 6)
  };
}

function advisorBrainRequestWants(kind, requests) {
  return (requests || []).some(
    (request) => request.kind === kind || (kind === 'transactions' && request.kind === 'history')
  );
}

function buildAdvisorBrainTargetedContext(workbook, prompt, requests, options = {}) {
  const limit = Math.max(1, Math.min(50, Math.round(Number(options.targetLimit || 12) || 12)));
  const wantsTransactions =
    advisorBrainRequestWants('transactions', requests) ||
    /\b(transaction|transactions|charge|expense|payment|income|transfer|delete|edit|same|last|previous)\b/i.test(
      String(prompt || '')
    );
  const wantsRecurring =
    advisorBrainRequestWants('recurring_items', requests) ||
    /\b(subscription|subscriptions|recurring|bill|bills)\b/i.test(String(prompt || ''));
  const wantsBudgets =
    advisorBrainRequestWants('budgets', requests) ||
    /\bbudget|budgets\b/i.test(String(prompt || ''));
  const wantsDrafts =
    advisorBrainRequestWants('ai_drafts', requests) ||
    /\bdraft|drafts|review queue\b/i.test(String(prompt || ''));
  const context = {};
  if (wantsTransactions) {
    context.transactions = getAdvisorBrainTransactionRows(workbook, prompt, limit);
  }
  if (wantsRecurring) {
    context.recurring_items = getAdvisorBrainRecurringRows(workbook, limit);
  }
  if (wantsBudgets) {
    context.budgets = getAdvisorBrainBudgetRows(workbook, limit);
  }
  if (wantsDrafts) {
    context.ai_drafts = getAdvisorBrainAiDraftRows(workbook, limit);
  }
  return context;
}

export function buildAdvisorBrainContextPacket(workbook = {}, prompt = '', options = {}) {
  const safeWorkbook = workbook || {};
  const requests = normalizeAdvisorBrainContextRequests(
    options.contextRequests || options.context_requests
  );
  const wantsFull =
    options.contextMode === 'full' || requests.some((request) => request.kind === 'full_workbook');
  const packet = {
    packet_version: 'cavalry.advisor_brain.context.v1',
    intent: ADVISOR_BRAIN_INTENT,
    task: 'Act as Cavalry Advisor Brain for workbook-domain work. Propose reviewable AI drafts only; never claim that workbook data was already changed.',
    current_date: String(options.currentDate || '').trim(),
    workbook_currency: safeWorkbook.currency || 'PHP',
    context_mode: wantsFull ? 'full' : requests.length ? 'targeted' : 'compact',
    context_catalog: {
      requestable_kinds: ADVISOR_BRAIN_CONTEXT_REQUEST_KINDS,
      policy:
        'Compact workbook map is always included. Targeted slices or full_workbook are included only when requested or when the prompt clearly needs them.'
    },
    workbook_map: buildAdvisorBrainWorkbookMap(safeWorkbook),
    requested_context: requests,
    output_schema: {
      message:
        'safe user-facing explanation; must say drafts are for review when drafts are returned',
      drafts: [
        {
          operation: 'create | edit | archive | delete',
          objectType:
            'transaction | category | counterparty | recurringItem | billSubscription | budget | ledgerCleanup | ledgerReview',
          targetId: 'existing id for edit/archive/delete',
          title: 'short draft title',
          summary: 'short review summary',
          proposed: 'object matching the target draft type',
          sourceRefs: ['source refs used'],
          confidence: '0..1',
          reason: 'why this draft is safe to review'
        }
      ],
      questions: ['missing information questions'],
      references: [{ token: 'label', source_refs: ['source refs'] }],
      context_requests: [
        {
          kind: 'transactions | recurring_items | budgets | ai_drafts | full_workbook',
          query: 'optional search terms',
          limit: 'optional max rows'
        }
      ]
    },
    rules: [
      'Return only JSON.',
      'Never write, post, apply, delete, or archive directly. Return reviewable drafts only.',
      'If a write is unsafe or missing required information, return a draft with missing details or ask a question.',
      'For edit, archive, and delete drafts, use an existing targetId from the provided workbook context.',
      'For transaction drafts, use balanced Cavalry-supported transaction templates and explicit user amounts/dates unless the user explicitly asks to repeat a previous transaction or gives a resolvable account-balance reference such as matching the current liability balance.',
      'For delete requests, create delete drafts. Do not claim deletion happened.',
      'Use context_requests when the compact map is not enough; ask for full_workbook only when broad workbook reasoning is required.'
    ],
    user_message: String(prompt || '').trim()
  };
  if (wantsFull) {
    packet.full_workbook = buildAdvisorFullWorkbookPacket(safeWorkbook);
  } else {
    packet.targeted_context = buildAdvisorBrainTargetedContext(
      safeWorkbook,
      prompt,
      requests,
      options
    );
  }
  return packet;
}

export function buildAdvisorTransactionTextIntentPacket(
  workbook = {},
  prompt = '',
  pendingAction = null,
  options = {}
) {
  const safeWorkbook = workbook || {};
  const currentDate = String(options.currentDate || '').trim();
  const pending = pendingAction && typeof pendingAction === 'object' ? pendingAction : null;
  const historyContext = buildAdvisorTransactionHistoryContext(safeWorkbook, prompt, options);
  const localHints = Array.isArray(options.localHints)
    ? options.localHints.slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT)
    : [];
  const preparedRows = buildAdvisorPreparedTransactionRows(prompt, {
    currentDate,
    defaultDateForUndatedRows: options.defaultDateForUndatedRows === true
  });
  const preflightHints = buildAdvisorTransactionIntakePreflightHints(safeWorkbook, prompt, {
    currentDate,
    defaultDateForUndatedRows: options.defaultDateForUndatedRows === true
  });
  const accountBalances = getLedgerHistoricalBalancesAsOf(safeWorkbook, currentDate);
  const lookupSearchParts = buildAdvisorTextIntentLookupSearchParts(
    prompt,
    pending,
    localHints,
    preparedRows
  );
  const lookupTokens = getAdvisorTextIntentLookupTokens(lookupSearchParts);
  const lookupSearchKey = advisorTransactionTextKey(lookupSearchParts.join(' '));
  const accountCandidates = selectAdvisorTextLookupItems(
    safeWorkbook.accounts || [],
    lookupTokens,
    lookupSearchKey,
    {
      limit: 16,
      minimum: 8,
      filter: (account) =>
        account &&
        account.isActive !== false &&
        account.isSystem !== true &&
        ['asset', 'liability'].includes(account.group),
      map: (account) => ({
        id: account.id,
        name: account.name,
        group: account.group,
        currency: account.currency || safeWorkbook.currency,
        subtype: account.subtype || '',
        isSystem: account.isSystem === true,
        canUseInTransactionDraft: account.isSystem !== true,
        balance: advisorDecimal(Number(accountBalances[account.id] || 0) || 0),
        balance_currency: safeWorkbook.currency || 'PHP',
        balance_as_of: currentDate || ''
      })
    }
  );
  const categoryCandidates = selectAdvisorTextLookupItems(
    safeWorkbook.categories || [],
    lookupTokens,
    lookupSearchKey,
    {
      limit: 24,
      minimum: 12,
      filter: (category) =>
        category &&
        category.isActive !== false &&
        ['expense', 'income', 'debt'].includes(category.type),
      map: (category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        currency: category.currency || safeWorkbook.currency
      })
    }
  );
  const counterpartyCandidates = selectAdvisorTextLookupItems(
    safeWorkbook.counterparties || [],
    lookupTokens,
    lookupSearchKey,
    {
      limit: 16,
      minimum: 8,
      filter: (counterparty) => counterparty && counterparty.isActive !== false,
      map: (counterparty) => ({
        id: counterparty.id,
        name: counterparty.name,
        kind: counterparty.kind || 'other'
      })
    }
  );
  return {
    packet_version: 'cavalry.transaction_intent.v4',
    intake_schema_version: ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2,
    task: 'Extract one or more safe transaction draft candidates from messy human text or speech. Never create, edit, or delete data.',
    intake_mode: 'transaction_text_intake',
    current_date: currentDate,
    workbook_currency: safeWorkbook.currency || 'PHP',
    workbook_context: {
      workbook: {
        id: safeWorkbook.id || 'unknown',
        name: safeWorkbook.name || 'Workbook',
        currency: safeWorkbook.currency || 'PHP',
        source_ref: advisorPacketSourceRef('workbook', safeWorkbook.id)
      },
      data_policy:
        'Only active lookup data is included for text transaction intake. Existing transactions, budgets, recurring items, and drafts are intentionally omitted. When the user explicitly asks for history, history_context may include only a small recent matching transaction sample.'
    },
    lookup_scope: {
      mode: 'focused_candidates',
      policy:
        'Accounts, categories, and counterparties are narrowed to prompt-matching candidates plus a small workbook-order fallback. Use names from user_message over candidates when the user typed a new merchant or description.',
      workbook_counts: {
        accounts: (safeWorkbook.accounts || []).filter(
          (account) =>
            account &&
            account.isActive !== false &&
            account.isSystem !== true &&
            ['asset', 'liability'].includes(account.group)
        ).length,
        categories: (safeWorkbook.categories || []).filter(
          (category) =>
            category &&
            category.isActive !== false &&
            ['expense', 'income', 'debt'].includes(category.type)
        ).length,
        counterparties: (safeWorkbook.counterparties || []).filter(
          (counterparty) => counterparty && counterparty.isActive !== false
        ).length
      },
      candidate_counts: {
        accounts: accountCandidates.length,
        categories: categoryCandidates.length,
        counterparties: counterpartyCandidates.length
      },
      search_tokens: lookupTokens.slice(0, 24)
    },
    history_context: historyContext,
    preflight_hints: preflightHints,
    prepared_transaction_rows: preparedRows,
    supported_templates: ADVISOR_TRANSACTION_TEMPLATES,
    max_transactions: ADVISOR_TRANSACTION_BATCH_LIMIT,
    output_schema: {
      schema_version: ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2,
      route:
        'new_transaction_batch | update_pending_draft | clarification | cancel | not_transaction',
      usePendingDraft:
        'boolean; true only when the user is clearly modifying the supplied pending_draft',
      reason: 'short string',
      questions: ['short follow-up question when clarification is needed'],
      intent: 'transaction_drafts | needs_info | not_transaction',
      transactions: [
        {
          status: 'ready | needs_info',
          template:
            'expense_paid | expense_charged | income_received | transfer | debt_payment | opening_balance',
          confidence: 'number from 0 to 1',
          reason: 'short string explaining this draft',
          sourceText: 'the shortest original user-message span for this one transaction only',
          fields: {
            date: 'YYYY-MM-DD',
            description:
              'clean merchant or purpose label; omit amount, currency, date, payment account, and row separators',
            amount: 'number',
            currency: 'PHP or USD',
            categoryId: 'known category id',
            categoryName: 'category name if id is unknown',
            primaryAccountId: 'known account id',
            primaryAccountName: 'account name if id is unknown',
            secondaryAccountId: 'known account id',
            secondaryAccountName: 'known account name',
            counterpartyId: 'known counterparty id',
            counterpartyName: 'counterparty name',
            counterpartyKind: 'merchant | biller | employer | family | client | other',
            note: 'string'
          },
          fieldEvidence: {
            template: 'short exact phrase supporting the transaction type',
            date: 'short exact phrase supporting the date',
            amount: 'short exact phrase supporting the amount',
            category: 'short exact phrase supporting category inference',
            primaryAccount: 'short exact phrase supporting payment/source/charged account',
            secondaryAccount: 'short exact phrase supporting destination/paid-to account',
            counterparty: 'short exact phrase supporting merchant/payee/payer',
            description: 'short exact phrase supporting description or purchased item'
          },
          missingFields: ['field name such as amount, date, primaryAccountId, categoryId'],
          missing_fields: ['same values as missingFields for compatibility']
        }
      ]
    },
    rules: [
      'Model-first segmentation: return one transaction item for every described or attempted transaction, even when it is incomplete.',
      'Preserve uncertainty. If the user did not provide a field, leave that field blank or 0 and list it in missingFields and missing_fields instead of guessing.',
      'Every transaction item must have sourceText scoped to that one transaction only. Do not use the full user message as sourceText for every item.',
      'For every non-empty field, include the shortest exact user phrase that supports it in fieldEvidence. If no phrase supports a required field, leave the field empty and mark it missing.',
      'Never copy amount, date, merchant, category, or account evidence from a neighboring transaction. Each item must be grounded in its own sourceText plus clearly shared wording such as a shared date.',
      'Handle corrections inside the same item: "cash, sorry, credit card" means the corrected value is credit card and the earlier value must not be used.',
      'Vague references such as "for it", "that one", or "same card" may inherit only from the immediately relevant transaction when the reference is unambiguous; otherwise mark the field missing.',
      'First decide route. If the user says "also add", "add these", "post these", or lists new purchase/payment events, use new_transaction_batch even when pending_draft exists.',
      'Use update_pending_draft only when the user clearly corrects or clarifies the pending_draft, such as changing its amount, account, date, category, or merchant.',
      'Treat preflight_hints and local_parser_hints as non-authoritative hints. Prefer the full user_message when hints conflict with the user wording.',
      'Use prepared_transaction_rows as row-bound evidence when present. Never borrow category, merchant, amount, date, or account from one prepared row for another row.',
      'Write descriptions as concise merchant or purpose labels, not as copied raw rows. For example, "405 pesos Grab - GCash" becomes "Grab" and "85 pesos toll fee - Cash" becomes "toll fee".',
      'Use only the provided ids when filling categoryId, account ids, or counterpartyId.',
      'If the user supplied a clear merchant, purchase description, or document text, infer the best category name from that row when no categoryId is available; leave categoryId blank and put the proposed category in categoryName.',
      'For primaryAccountId and secondaryAccountId, use only this packet top-level accounts list. System accounts are not valid transaction draft accounts.',
      'Transfers must be between user-owned Cavalry accounts. If money briefly passes through another person and returns to one of the user accounts for the same total, net it as direct transfer drafts into the final user account and mention the person in description or note.',
      'If a required field is missing or ambiguous, leave the id blank and list the missing field.',
      'Amounts must be explicit money amounts from the user message unless the user clearly asks to use a provided account-balance reference such as matching liabilities or a named credit-card balance. Expand shorthand before returning JSON: 15k means 15000, 1.5k means 1500, and 2m means 2000000. Never return amount as a string like "15k". Never use a day number, month number, list number, transaction count, account count, or any unrelated number as the amount.',
      'When the user says to match liabilities or a named card balance, use the matching liability balance from the provided account candidates only if it is unambiguous; otherwise set amount to 0 and include amount in missing_fields.',
      'If the user describes a transaction without a price or amount, set amount to 0, include amount in missing_fields, and explain that the amount is unknown rather than guessing.',
      'Resolve today and yesterday using current_date. Do not guess a missing date.',
      'Read the full user message before extracting drafts. Shared dates, currencies, source accounts, destination accounts, and payment accounts apply to every related draft unless the user says otherwise.',
      'Create separate drafts when the user gives separate amounts with separate purposes, merchants, destinations, categories, or payees.',
      'Do not merge separate amounts into one draft unless the user explicitly says they are one total, combined amount, or total spend.',
      'For transfers with one shared source and destination but multiple amounts, create one transfer draft per amount and preserve each purpose in description or note.',
      'For multiple purchases, payments, charges, income items, or transfers in one sentence, return one transaction item for each distinct event.',
      'For ambiguous amount lists, return drafts with missing_fields rather than inventing accounts, categories, or counterparties.',
      'Use history_context only as a small matching example set for labels, accounts, categories, merchants, and descriptions. Never infer from transactions outside history_context.',
      'Do not copy a prior amount or prior date from history_context unless the user explicitly asks to repeat the same transaction or same amount/date.',
      'Return only JSON. Do not include markdown or prose.'
    ],
    accounts: accountCandidates,
    categories: categoryCandidates,
    counterparties: counterpartyCandidates,
    local_parser_hints: localHints.map((hint) => {
      const source = hint && typeof hint === 'object' ? hint : {};
      const intent = source.intent && typeof source.intent === 'object' ? source.intent : {};
      return {
        sourceText: String(source.sourceText || source.source_text || source.prompt || '').trim(),
        template: String(intent.template || '').trim(),
        fields: intent.fields && typeof intent.fields === 'object' ? intent.fields : {},
        reason: String(intent.reason || source.reason || '').trim()
      };
    }),
    pending_draft: pending
      ? {
          template: pending.template,
          fields: pending.fields || {},
          missing_fields: pending.missingFields || pending.missing_fields || []
        }
      : null,
    user_message: String(prompt || '').trim()
  };
}

export function buildAdvisorTransactionImageIntentPacket(
  workbook = {},
  prompt = '',
  attachments = [],
  options = {}
) {
  const safeWorkbook = workbook || {};
  const imageMetadata = getAdvisorImageAttachmentMetadata(attachments);
  const currentDate = String(options.currentDate || '').trim();
  return {
    packet_version: 'cavalry.transaction_image_intent.v1',
    task: 'Extract reviewable transaction drafts from receipt or payment screenshots. Never post anything automatically.',
    intake_mode: 'transaction_image_intake',
    current_date: currentDate,
    workbook_currency: safeWorkbook.currency || 'PHP',
    workbook_context: {
      workbook: {
        id: safeWorkbook.id || 'unknown',
        name: safeWorkbook.name || 'Workbook',
        currency: safeWorkbook.currency || 'PHP',
        source_ref: advisorPacketSourceRef('workbook', safeWorkbook.id)
      },
      data_policy:
        'Only active lookup data is included for image intake. Existing transactions, budgets, recurring items, and drafts are intentionally omitted.'
    },
    supported_templates: ADVISOR_TRANSACTION_TEMPLATES,
    max_transactions: 8,
    image_attachments: imageMetadata,
    output_schema: {
      reason: 'short string',
      question: 'short follow-up question when needs_info',
      intent: 'transaction_drafts | needs_info | not_transaction',
      transactions: [
        {
          template:
            'expense_paid | expense_charged | income_received | transfer | debt_payment | opening_balance',
          confidence: 'number from 0 to 1',
          reason: 'short string explaining visible evidence for this draft',
          sourceAttachmentId: 'id from image_attachments for the image that supports this draft',
          sourceText: 'short visible text span or image note supporting this draft',
          fields: {
            date: 'YYYY-MM-DD',
            description: 'string',
            amount: 'number',
            currency: 'PHP or USD',
            categoryId: 'known category id',
            categoryName: 'category name if visibly clear and id is unknown',
            primaryAccountId: 'known account id',
            primaryAccountName: 'payment or credit account name if visibly clear',
            secondaryAccountId: 'known account id',
            secondaryAccountName: 'known account name',
            counterpartyId: 'known counterparty id',
            counterpartyName: 'merchant or payee name visible in the image',
            counterpartyKind: 'merchant | biller | employer | family | client | other',
            note: 'visible reference number, receipt number, or short evidence note'
          },
          extraction: {
            imageEvidence: 'short visible text span such as merchant, total, date, or reference',
            sourceAttachmentId: 'id from image_attachments for the image that supports this draft',
            usedUserText: 'boolean',
            usedImageText: 'boolean',
            uncertainFields: ['field name']
          },
          missing_fields: ['field name']
        }
      ]
    },
    rules: [
      'Extract only facts visible in the image or explicitly typed by the user: date, merchant or payee, amount, currency, payment account hints, reference number, and notes.',
      'Every transaction must include sourceAttachmentId matching the id of the one image_attachments item that supports it. Do not mix facts across different images.',
      'If the user asks for the grand total, just the total, or total only, extract the grand total only and do not create line-item transactions.',
      'For receipts, prefer final payable labels such as Bill Amount, Amount Due, Grand Total, Total Due, Total, Amount Paid, or tender/payment lines like CASH, CARD, GCASH, PAYMAYA, BDO Pay when they represent the paid amount.',
      'Do not use Total Sales as the final paid amount when service charge, tax, subtotal, amount due, or tender/payment lines show a different payable amount.',
      'Use explicitly typed user text for account and date when the image only supplies amount, merchant, or receipt evidence.',
      'Return needs_info only when amount, date, or account cannot be determined from the user text plus the visible image.',
      'Never guess missing amount, date, or account. Category may be inferred from visible merchant, payee, or item text; if no known category id fits, leave categoryId blank and put the proposed category name in categoryName.',
      'If required fields are unclear, still return a draft with missing_fields so the user can complete it.',
      'Prefer expense_paid for receipt or payment screenshots unless the image clearly indicates credit card charge, transfer, income, or debt payment.',
      'Use only the provided ids when filling categoryId, account ids, or counterpartyId.',
      'For primaryAccountId and secondaryAccountId, use only this packet top-level accounts list. System accounts are not valid transaction draft accounts.',
      'If an account is not visibly clear, leave the id and name blank. If a category is likely from visible merchant or item text, include categoryName so Cavalry can prepare a reviewable category proposal.',
      'Create one transaction per distinct visible receipt, payment, charge, transfer, income item, or debt payment, capped at 8 total. Do not extract line items unless the user explicitly asks for line items.',
      'When this packet contains one receipt image, return at most one transaction unless the user explicitly asks for line items.',
      'Do not summarize bank statements or arbitrary finance documents in v1. Focus on receipts and payment screenshots.',
      'Return only JSON. Do not include markdown or prose.'
    ],
    accounts: (safeWorkbook.accounts || [])
      .filter(
        (account) =>
          account &&
          account.isActive !== false &&
          account.isSystem !== true &&
          ['asset', 'liability'].includes(account.group)
      )
      .map((account) => ({
        id: account.id,
        name: account.name,
        group: account.group,
        currency: account.currency || safeWorkbook.currency,
        subtype: account.subtype || '',
        isSystem: account.isSystem === true,
        canUseInTransactionDraft: account.isSystem !== true
      })),
    categories: (safeWorkbook.categories || [])
      .filter(
        (category) =>
          category &&
          category.isActive !== false &&
          ['expense', 'income', 'debt'].includes(category.type)
      )
      .map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        currency: category.currency || safeWorkbook.currency
      })),
    counterparties: (safeWorkbook.counterparties || [])
      .filter((counterparty) => counterparty && counterparty.isActive !== false)
      .map((counterparty) => ({
        id: counterparty.id,
        name: counterparty.name,
        kind: counterparty.kind || 'other'
      })),
    user_message: getAdvisorImageIntakePrompt(prompt)
  };
}

function pushSourceRef(list, type, id) {
  const value = String(id || '').trim();
  if (value) {
    list.push(advisorPacketSourceRef(type, value));
  }
}

export function getLedgerCleanupSourceRefsFromPayload(cleanup = {}) {
  const sourceRefs = [];
  (cleanup.transactionPatches || []).forEach((patch) => {
    pushSourceRef(sourceRefs, 'transaction', patch && patch.transactionId);
  });
  (cleanup.categoryChanges || []).forEach((change) => {
    pushSourceRef(sourceRefs, 'category', change && change.categoryId);
    pushSourceRef(sourceRefs, 'category', change && change.targetCategoryId);
    pushSourceRef(sourceRefs, 'category', change && change.replacementCategoryId);
  });
  (cleanup.counterpartyChanges || []).forEach((change) => {
    pushSourceRef(sourceRefs, 'counterparty', change && change.counterpartyId);
    pushSourceRef(sourceRefs, 'counterparty', change && change.targetCounterpartyId);
    pushSourceRef(sourceRefs, 'counterparty', change && change.replacementCounterpartyId);
  });
  return sourceRefs.filter((ref, index, list) => ref && list.indexOf(ref) === index);
}

export function getAdvisorTransactionImpactRow(workbook, transaction, services = {}) {
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  const amount = getTransactionBaseAmountForPacket(transaction, services);
  const kind = getTransactionFlowKindForPacket(workbook, transaction, services);
  const sourceText =
    String((transaction && transaction.description) || '') +
    ' ' +
    String((category && category.name) || '');
  let impact = 0;
  let impactType = 'neutral_excluded';
  let explanation = 'This movement is treated as neutral for net-worth impact.';
  let confidence = 'medium';
  if (kind === 'inflow') {
    impact = amount;
    impactType = 'income';
    explanation = 'Income or interest increases net worth.';
    confidence = 'high';
  } else if (kind === 'expense') {
    impact = -amount;
    impactType =
      transaction && transaction.template === 'expense_charged'
        ? 'liability_increase_expense'
        : 'expense';
    explanation =
      transaction && transaction.template === 'expense_charged'
        ? 'A charged expense increases a liability, so it reduces net worth.'
        : 'Spending from an asset account reduces net worth.';
    confidence = 'high';
  } else if (kind === 'debt') {
    if (/\b(interest|finance charge|fee|fees|penalty)\b/i.test(sourceText)) {
      impact = -amount;
      impactType = 'interest_expense';
      explanation = 'This looks like interest or fees, so it is treated as a net-worth reducer.';
    } else {
      impactType = 'debt_payment_excluded';
      explanation =
        'Debt payments usually reduce cash and liability together; principal movement is neutral unless interest is split out.';
    }
  } else if (kind === 'savings') {
    impactType = 'savings_transfer_excluded';
    explanation =
      'Savings entries usually move value between owned accounts, so they are excluded from net-worth impact.';
  } else if (kind === 'transfer') {
    impactType = 'transfer_excluded';
    explanation = 'Transfers between owned accounts change location of money, not net worth.';
    confidence = 'high';
  } else if (kind === 'opening') {
    impactType = 'opening_balance_excluded';
    explanation =
      'Opening balances set a starting position and are excluded from selected-period impact.';
    confidence = 'high';
  }
  const sourceRef = getAdvisorTransactionSourceRef(transaction);
  return {
    transaction_id: transaction && transaction.id ? transaction.id : '',
    date: transaction && transaction.date ? transaction.date : '',
    date_label: formatDisplayDateForPacket(
      transaction && transaction.date ? transaction.date : '',
      services
    ),
    description:
      transaction && transaction.description ? transaction.description : 'Ledger Transaction',
    account: getTransactionAccountLabelForPacket(workbook, transaction, services),
    category: category ? category.name : 'Uncategorized',
    category_id: category ? category.id : '__uncategorized',
    flow_kind: kind,
    amount: advisorDecimal(amount),
    amount_display: formatMoneyForPacket(amount, workbook, services),
    direction: impact > 0 ? 'positive' : impact < 0 ? 'negative' : 'neutral',
    net_worth_impact: advisorDecimal(impact),
    net_worth_impact_display: formatDeltaMoneyForPacket(impact, workbook, services),
    impact_type: impactType,
    confidence,
    explanation,
    source_ref: sourceRef,
    source_refs: [sourceRef]
  };
}

export function buildAdvisorNetWorthImpactPacket(workbook, context, options = {}, services = {}) {
  const currency = context.profile.currency || workbook.currency || 'PHP';
  const limit = Math.max(
    6,
    Math.min(40, Number(options && options.limit ? options.limit : 14) || 14)
  );
  const range = {
    start: context.profile.rangeStart,
    end: context.profile.rangeEnd
  };
  const rows = getFilteredTransactionsForPacket(workbook, range, services).map((transaction) =>
    getAdvisorTransactionImpactRow(workbook, transaction, services)
  );
  const impactRows = rows
    .filter((row) => Math.abs(Number(row.net_worth_impact) || 0) > 0.0001)
    .sort(
      (a, b) =>
        Math.abs(Number(b.net_worth_impact) || 0) - Math.abs(Number(a.net_worth_impact) || 0)
    );
  const negativeRows = impactRows.filter((row) => Number(row.net_worth_impact) < 0);
  const positiveRows = impactRows.filter((row) => Number(row.net_worth_impact) > 0);
  const neutralRows = rows.filter((row) => Math.abs(Number(row.net_worth_impact) || 0) <= 0.0001);
  const categoryMap = {};
  impactRows.forEach((row) => {
    const key = row.category_id || '__uncategorized';
    if (!categoryMap[key]) {
      categoryMap[key] = {
        category_id: key,
        name: row.category || 'Uncategorized',
        total_impact: 0,
        positive_impact: 0,
        negative_impact: 0,
        transaction_count: 0,
        source_refs: []
      };
    }
    const impact = Number(row.net_worth_impact) || 0;
    categoryMap[key].total_impact = roundMoney(categoryMap[key].total_impact + impact);
    if (impact > 0) {
      categoryMap[key].positive_impact = roundMoney(categoryMap[key].positive_impact + impact);
    } else if (impact < 0) {
      categoryMap[key].negative_impact = roundMoney(categoryMap[key].negative_impact + impact);
    }
    categoryMap[key].transaction_count += 1;
    if (row.source_ref) {
      categoryMap[key].source_refs.push(row.source_ref);
    }
  });
  const categorySummary = Object.keys(categoryMap)
    .map((key) => {
      const row = categoryMap[key];
      return {
        category_id: row.category_id,
        name: row.name,
        total_impact: advisorDecimal(row.total_impact),
        total_impact_display: formatDeltaMoneyForPacket(row.total_impact, workbook, services),
        positive_impact: advisorDecimal(row.positive_impact),
        negative_impact: advisorDecimal(row.negative_impact),
        transaction_count: row.transaction_count,
        source_refs: row.source_refs.slice(0, 12)
      };
    })
    .sort((a, b) => Math.abs(Number(b.total_impact) || 0) - Math.abs(Number(a.total_impact) || 0));
  const excludedCounts = neutralRows.reduce(
    (counts, row) => {
      counts[row.impact_type] = (counts[row.impact_type] || 0) + 1;
      counts.total += 1;
      return counts;
    },
    { total: 0 }
  );
  const positiveTotal = roundMoney(
    positiveRows.reduce((sum, row) => sum + (Number(row.net_worth_impact) || 0), 0)
  );
  const negativeTotal = roundMoney(
    negativeRows.reduce((sum, row) => sum + (Number(row.net_worth_impact) || 0), 0)
  );
  const netImpact = roundMoney(positiveTotal + negativeTotal);
  const selectedImpactRows = impactRows.slice(0, limit);
  const omittedImpactRows = Math.max(0, impactRows.length - selectedImpactRows.length);
  return {
    packet_version: 'cavalry.transaction_impact.v1',
    question_type: 'transaction_net_worth_impact',
    selection: {
      policy: 'ranked_net_worth_impact_rows',
      source_count: rows.length,
      included_count: selectedImpactRows.length,
      omitted_count: omittedImpactRows,
      continuation_supported: omittedImpactRows > 0,
      row_limit: limit,
      included_transaction_ids: selectedImpactRows.map((row) => row.transaction_id)
    },
    period: {
      start: context.profile.rangeStart,
      end: context.profile.rangeEnd,
      label: context.profile.rangeLabel
    },
    definition: {
      net_worth_impact:
        'Income increases net worth. Expenses decrease net worth. Transfers, savings moves, opening balances, and principal-only debt payments are excluded when they only move value between owned accounts or reduce cash and debt at the same time.',
      caveat:
        'Interest or fees reduce net worth only when Cavalry can identify them from the transaction description or category.'
    },
    totals: {
      selected_period_income: advisorMoney(context.snapshot.income, currency, [
        'computed.cashflow_period.income'
      ]),
      selected_period_expenses_only: advisorMoney(context.snapshot.expense, currency, [
        'computed.cashflow_period.expenses_only'
      ]),
      selected_period_net_flow: advisorMoney(context.snapshot.net, currency, [
        'computed.cashflow_period.net_cashflow'
      ]),
      estimated_transaction_net_worth_impact: advisorMoney(netImpact, currency, [
        'computed.transaction_impact.estimated_net_worth_impact'
      ]),
      positive_impact: advisorMoney(positiveTotal, currency, [
        'computed.transaction_impact.positive_impact'
      ]),
      negative_impact: advisorMoney(negativeTotal, currency, [
        'computed.transaction_impact.negative_impact'
      ])
    },
    top_negative_impact_transactions: negativeRows.slice(0, limit),
    top_positive_impact_transactions: positiveRows.slice(0, Math.min(10, limit)),
    top_absolute_impact_transactions: impactRows.slice(0, limit),
    category_impact_summary: categorySummary.slice(0, 12),
    excluded_neutral_transactions: neutralRows.slice(0, Math.min(16, limit)),
    excluded_transactions_summary: excludedCounts,
    source_refs: selectedImpactRows.map((row) => row.source_ref),
    limitations: [
      'This uses selected-period transactions only.',
      'It does not estimate market value changes or balance adjustments outside the ledger.',
      'Neutral transfers and principal-only debt payments can affect cash flow without changing net worth.'
    ]
  };
}

export function buildAdvisorCategorizationReviewPacket(
  workbook,
  context = {},
  prompt = '',
  services = {}
) {
  const safeWorkbook = workbook || {};
  const safeContext = context || {};
  const range = getAdvisorCategorizationReviewRange(safeWorkbook, safeContext, prompt, services);
  const transactions = getAdvisorCategorizationReviewTransactions(safeWorkbook, range, services);
  const normalizeCleanup = getService(
    services,
    'normalizeLedgerCleanupPayload',
    normalizeLedgerCleanupPayload
  );
  const getMeaningfulCleanup = getService(
    services,
    'getMeaningfulLedgerCleanupPayload',
    getMeaningfulLedgerCleanupPayload
  );
  let cleanup = normalizeCleanup({});
  let cleanupError = '';
  try {
    const buildLocalProposal = services.buildLocalAdvisorLedgerCleanupProposal;
    const proposal =
      typeof buildLocalProposal === 'function'
        ? buildLocalProposal(safeWorkbook, prompt)
        : services.cleanupProposal || {};
    cleanup = getMeaningfulCleanup(safeWorkbook, proposal);
  } catch (error) {
    cleanupError = String(error && error.message ? error.message : error);
  }
  const vagueCategories = getAdvisorCategorizationVagueCategories(safeWorkbook, services);
  const vagueCategoryIds = {};
  vagueCategories.forEach((category) => {
    vagueCategoryIds[category.id] = true;
  });
  const vagueTransactions = transactions.filter(
    (transaction) =>
      !transaction.categoryId ||
      vagueCategoryIds[transaction.categoryId] ||
      !getCategoryById(safeWorkbook, transaction.categoryId)
  );
  const duplicateCategories = countAdvisorDuplicateLabels(
    safeWorkbook.categories || [],
    (category) => String(category.type || '') + ':' + advisorTransactionTextKey(category.name)
  );
  const duplicateCounterparties = countAdvisorDuplicateLabels(
    safeWorkbook.counterparties || [],
    (counterparty) => advisorTransactionTextKey(counterparty.name)
  );
  const buildSuggestionRows = services.buildAdvisorCleanupSuggestionPacketRows;
  const suggestions =
    typeof buildSuggestionRows === 'function' ? buildSuggestionRows(safeWorkbook, cleanup, 12) : [];
  const sampleTransactions = vagueTransactions.slice(0, 10);
  const categorizationIncludedIds = []
    .concat(vagueCategories.slice(0, 12).map((category) => 'category:' + category.id))
    .concat(sampleTransactions.map((transaction) => getAdvisorTransactionSourceRef(transaction)))
    .concat(
      suggestions.flatMap((suggestion) =>
        suggestion && Array.isArray(suggestion.source_refs) ? suggestion.source_refs : []
      )
    )
    .filter((ref, index, list) => ref && list.indexOf(ref) === index);
  const categorizationSourceCount =
    transactions.length +
    vagueCategories.length +
    duplicateCategories.length +
    duplicateCounterparties.length +
    suggestions.length;
  const categorizationOmittedCount = Math.max(
    0,
    categorizationSourceCount - categorizationIncludedIds.length
  );
  const semanticSummary = buildAdvisorSemanticSummary(safeWorkbook, transactions);
  const categoryReliability = buildAdvisorCategoryReliabilitySummary({
    transactions,
    vagueRows: vagueTransactions,
    duplicateCategoryGroups: duplicateCategories,
    semanticSummary
  });
  return {
    packet_version: 'cavalry.categorization_review.v1',
    question_type: 'categorization_review',
    selection: {
      policy: 'categorization_review_slices',
      source_count: categorizationSourceCount,
      included_count: categorizationIncludedIds.length,
      omitted_count: categorizationOmittedCount,
      continuation_supported: categorizationOmittedCount > 0,
      row_limit: 12,
      included_refs: categorizationIncludedIds
    },
    period: {
      start: range.start || '',
      end: range.end || '',
      label: getCategorizationReviewRangeLabel(range, safeContext, services)
    },
    counts: {
      transactions_reviewed: transactions.length,
      vague_categories: vagueCategories.length,
      transactions_in_vague_or_missing_categories: vagueTransactions.length,
      duplicate_category_label_groups: duplicateCategories.length,
      duplicate_counterparty_label_groups: duplicateCounterparties.length,
      safe_candidate_changes: suggestions.length
    },
    category_reliability: categoryReliability,
    semantic_summary: semanticSummary,
    vague_categories: vagueCategories.slice(0, 12).map((category) => ({
      id: category.id,
      name: category.name,
      type: category.type,
      source_refs: ['category:' + category.id]
    })),
    duplicate_categories: duplicateCategories.slice(0, 8),
    duplicate_counterparties: duplicateCounterparties.slice(0, 8),
    candidate_cleanup: cleanup,
    candidate_improvements: suggestions,
    sample_transactions_needing_review: sampleTransactions.map((transaction) => {
      const category = getCategoryById(safeWorkbook, transaction.categoryId);
      return {
        transaction_id: transaction.id,
        date: transaction.date,
        description: transaction.description,
        amount: advisorDecimal(getTransactionBaseAmountForPacket(transaction, services)),
        currency: transaction.originalCurrency || safeWorkbook.currency,
        current_category: category ? category.name : 'Missing category',
        source_refs: [getAdvisorTransactionSourceRef(transaction)]
      };
    }),
    limitations: [
      'This is a review packet, not a workbook mutation.',
      'Candidate changes still need a separate cleanup draft and user confirmation before anything changes.',
      cleanupError && !/no proposed changes/i.test(cleanupError) ? cleanupError : ''
    ].filter(Boolean)
  };
}

function isAdvisorAnalysisVagueCategoryName(value) {
  const key = advisorTransactionTextKey(value);
  return (
    !key ||
    [
      'misc',
      'miscellaneous',
      'other',
      'others',
      'for others',
      'random',
      'uncategorized',
      'uncategorized expense',
      'uncategorized expenses',
      'general',
      'general expense',
      'general expenses'
    ].indexOf(key) >= 0
  );
}

function advisorAnalysisMoney(value, workbook, services, sourceRefs, useDelta) {
  const currency = workbook && workbook.currency ? workbook.currency : 'PHP';
  const item = advisorMoney(value, currency, sourceRefs || []);
  item.display = useDelta
    ? formatDeltaMoneyForPacket(value, workbook, services)
    : formatMoneyForPacket(value, workbook, services);
  return item;
}

function isAdvisorTransferLikeAnalysisRow(row, transaction) {
  const source = advisorTransactionTextKey(
    [
      row && row.description,
      row && row.category_name,
      row && row.type_label,
      transaction && transaction.template
    ]
      .filter(Boolean)
      .join(' ')
  );
  return (
    row &&
    (row.flow_kind === 'transfer' ||
      row.flow_kind === 'savings' ||
      /\b(transfer|fund|allowance|move cash|money move|cash in|cash out)\b/.test(source))
  );
}

function isAdvisorRecurringAnalysisRow(row, transaction) {
  const source = advisorTransactionTextKey(
    [row && row.description, row && row.category_name, row && row.type_label]
      .filter(Boolean)
      .join(' ')
  );
  return (
    !!(transaction && transaction.recurringItemId) ||
    /\b(subscription|subscriptions|recurring|monthly|annual|chatgpt|netflix|spotify|icloud|google|adobe)\b/.test(
      source
    )
  );
}

function getUniqueAnalysisTransactionIds(rowGroups) {
  const seen = {};
  const ids = [];
  (rowGroups || []).forEach((rows) => {
    (rows || []).forEach((row) => {
      const id = String(row && row.transaction_id ? row.transaction_id : '').trim();
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
  });
  return ids;
}

export function buildAdvisorTransactionAnalysisPacket(
  workbook,
  context = {},
  options = {},
  services = {}
) {
  const safeWorkbook = workbook || {};
  const safeContext = context || {};
  const profile = safeContext.profile || {};
  const snapshot = safeContext.snapshot || {};
  const budget = safeContext.budget || {};
  const range = {
    start: profile.rangeStart || '',
    end: profile.rangeEnd || ''
  };
  const sourceRows = sortAdvisorTransactionsNewestFirst(
    getFilteredTransactionsForPacket(safeWorkbook, range, services)
  ).map((transaction) => ({
    transaction,
    row: getAdvisorTransactionListRow(safeWorkbook, transaction, services)
  }));
  const semanticSummary = buildAdvisorSemanticSummary(
    safeWorkbook,
    sourceRows.map((item) => item.transaction)
  );
  const transferLikeRows = sourceRows
    .filter((item) => isAdvisorTransferLikeAnalysisRow(item.row, item.transaction))
    .map((item) => item.row)
    .slice(0, 12);
  const vagueRows = sourceRows
    .filter((item) => isAdvisorAnalysisVagueCategoryName(item.row.category_name))
    .map((item) => item.row)
    .slice(0, 12);
  const recurringRows = sourceRows
    .filter((item) => isAdvisorRecurringAnalysisRow(item.row, item.transaction))
    .map((item) => item.row)
    .slice(0, 12);
  const transferIds = {};
  transferLikeRows.forEach((row) => {
    transferIds[row.transaction_id] = true;
  });
  const largestExpenseRows = sourceRows
    .filter((item) => item.row.flow_kind === 'expense' && !transferIds[item.row.transaction_id])
    .sort((a, b) => Number(b.row.base_amount || 0) - Number(a.row.base_amount || 0))
    .map((item) => item.row)
    .slice(0, 12);
  const budgetUsedPercent = Number(budget.budgetUsedPercent || 0);
  const plannedOutflow = Number(budget.plannedOutflow || 0);
  const actualOutflow = Number(snapshot.outflow || 0);
  const budgetPercentages = calculateAdvisorBudgetPercentages(actualOutflow, plannedOutflow);
  const budgetReliabilityStatus =
    plannedOutflow <= 0 && actualOutflow > 0
      ? 'missing_plan'
      : budgetUsedPercent >= 1000
        ? 'extreme_or_mismatched'
        : 'usable';
  const includedTransactionIds = getUniqueAnalysisTransactionIds([
    recurringRows,
    vagueRows,
    transferLikeRows,
    largestExpenseRows
  ]);
  const omittedCount = Math.max(0, sourceRows.length - includedTransactionIds.length);
  const categoryReliability = buildAdvisorCategoryReliabilitySummary({
    transactions: sourceRows.map((item) => item.transaction),
    vagueRows,
    semanticSummary
  });
  const consumptionAmount =
    semanticSummary.spending_definitions[SPENDING_DEFINITION.CONSUMPTION_ONLY].amount;
  const consumptionPlusInterestFees =
    semanticSummary.spending_definitions[SPENDING_DEFINITION.CONSUMPTION_PLUS_INTEREST_FEES].amount;
  const semanticSourceRefs = semanticSummary.source_refs || [];
  return {
    packet_version: 'cavalry.transaction_analysis.v1',
    question_type: options.questionType || 'transaction_analysis',
    selection: {
      policy: 'ranked_analysis_slices',
      source_count: sourceRows.length,
      included_count: includedTransactionIds.length,
      omitted_count: omittedCount,
      continuation_supported: omittedCount > 0,
      row_limit_per_slice: 12,
      category_limit: 8,
      included_transaction_ids: includedTransactionIds
    },
    period: {
      start: profile.rangeStart || '',
      end: profile.rangeEnd || '',
      label: profile.rangeLabel || 'Selected period'
    },
    totals: {
      selected_period_income: advisorAnalysisMoney(snapshot.income || 0, safeWorkbook, services, [
        'computed.cashflow_period.income'
      ]),
      selected_period_total_outflow: advisorAnalysisMoney(
        snapshot.outflow || 0,
        safeWorkbook,
        services,
        ['computed.cashflow_period.total_outflow', 'computed.cashflow_period.spending']
      ),
      selected_period_spending: advisorAnalysisMoney(
        consumptionAmount,
        safeWorkbook,
        services,
        ['computed.cashflow_period.consumption_spending'].concat(semanticSourceRefs.slice(0, 20))
      ),
      selected_period_consumption_spending: advisorAnalysisMoney(
        consumptionAmount,
        safeWorkbook,
        services,
        ['computed.cashflow_period.consumption_spending'].concat(semanticSourceRefs.slice(0, 20))
      ),
      selected_period_consumption_plus_interest_fees: advisorAnalysisMoney(
        consumptionPlusInterestFees,
        safeWorkbook,
        services,
        ['computed.cashflow_period.consumption_plus_interest_fees'].concat(
          semanticSourceRefs.slice(0, 20)
        )
      ),
      selected_period_expenses_only: advisorAnalysisMoney(
        snapshot.expense || 0,
        safeWorkbook,
        services,
        ['computed.cashflow_period.expenses_only']
      ),
      selected_period_debt_payments: advisorAnalysisMoney(
        snapshot.debt || 0,
        safeWorkbook,
        services,
        ['computed.cashflow_period.debt_payments']
      ),
      selected_period_transfers_or_internal_moves: advisorAnalysisMoney(
        snapshot.savings || 0,
        safeWorkbook,
        services,
        [
          'computed.cashflow_period.transfers_or_internal_moves',
          'computed.cashflow_period.savings_transfers'
        ]
      ),
      selected_period_net_cashflow: advisorAnalysisMoney(
        snapshot.net || 0,
        safeWorkbook,
        services,
        ['computed.cashflow_period.net_cashflow'],
        true
      )
    },
    budget_reliability: {
      status: budgetReliabilityStatus,
      planned_outflow: advisorDecimal(plannedOutflow),
      actual_outflow: advisorDecimal(actualOutflow),
      percent_used: advisorDecimal(budgetUsedPercent),
      percent_of_budget:
        budgetPercentages.percent_of_budget === null
          ? null
          : advisorDecimal(budgetPercentages.percent_of_budget),
      percent_over_budget:
        budgetPercentages.percent_over_budget === null
          ? null
          : advisorDecimal(budgetPercentages.percent_over_budget),
      message:
        budgetReliabilityStatus === 'usable'
          ? 'Budget percentage appears usable for the selected range.'
          : 'Budget percentage may be incomplete or mismatched to the selected range; do not lead with it.'
    },
    spending_definition: {
      selected: SPENDING_DEFINITION.CONSUMPTION_ONLY,
      label: 'Consumption spending',
      description:
        semanticSummary.spending_definitions[SPENDING_DEFINITION.CONSUMPTION_ONLY].description,
      alternatives: semanticSummary.spending_definitions
    },
    semantic_summary: semanticSummary,
    category_reliability: categoryReliability,
    top_spending_categories: (budget.topSpendRows || []).slice(0, 8).map((row) => ({
      category_id: row.category && row.category.id ? row.category.id : '',
      name: row.category && row.category.name ? row.category.name : 'Uncategorized',
      amount: advisorDecimal(row.total),
      amount_display: formatMoneyForPacket(row.total, safeWorkbook, services),
      source_refs: [
        advisorPacketSourceId(
          'category_spend',
          row.category && row.category.id ? row.category.id : 'uncategorized'
        )
      ]
    })),
    over_budget_categories: (budget.overspentRows || []).slice(0, 8).map((row) => ({
      category_id: row.category && row.category.id ? row.category.id : '',
      name: row.category && row.category.name ? row.category.name : 'Uncategorized',
      planned: advisorDecimal(row.planned),
      actual: advisorDecimal(row.actual),
      over_by: advisorDecimal(Math.abs(row.remaining || 0)),
      over_by_display: formatMoneyForPacket(Math.abs(row.remaining || 0), safeWorkbook, services),
      percent_used: advisorDecimal(row.percent),
      percent_of_budget: advisorDecimal(
        calculateAdvisorBudgetPercentages(row.actual, row.planned).percent_of_budget || 0
      ),
      percent_over_budget: advisorDecimal(
        Math.max(
          0,
          calculateAdvisorBudgetPercentages(row.actual, row.planned).percent_over_budget || 0
        )
      ),
      source_refs: [
        advisorPacketSourceId(
          'budget',
          row.category && row.category.id ? row.category.id : 'uncategorized'
        )
      ]
    })),
    recurring_or_subscription_rows: recurringRows,
    vague_category_rows: vagueRows,
    transfer_like_rows: transferLikeRows,
    largest_real_expense_rows: largestExpenseRows,
    counts: {
      selected_period_transactions: sourceRows.length,
      possible_transfer_or_non_expense_rows: transferLikeRows.length,
      vague_category_rows: vagueRows.length,
      recurring_or_subscription_rows: recurringRows.length,
      largest_real_expense_rows: largestExpenseRows.length
    },
    limitations: [
      'This analysis is based on selected-period transactions only.',
      'Transfer-like rows are candidates for review, not automatic exclusions.',
      'Budget conclusions depend on the selected range and the completeness of the budget plan.'
    ]
  };
}

export function getAdvisorTransactionListMode(question, responseStyle) {
  const lower = normalizeAdvisorQuestionText(question);
  const asksLatestTransaction =
    /\b(latest|most recent)\s+(transaction|transactions|purchase|purchases|charge|charges|payment|payments)\b/.test(
      lower
    ) ||
    /\b(show|list|display|give me|what is|what was)\b.{0,32}\b(last|latest|most recent)\b.{0,16}\b(transaction|transactions|purchase|purchases|charge|charges|payment|payments)\b/.test(
      lower
    ) ||
    /\b(last)\s+(transaction|purchase|charge|payment)\b/.test(lower);
  if (asksLatestTransaction) {
    return 'last';
  }
  if (/\brecent\b/.test(lower)) {
    return 'recent';
  }
  if (
    responseStyle === 'breakdown' ||
    /\b(full|complete|all|list|show|history|breakdown|details?)\b/.test(lower)
  ) {
    return 'full';
  }
  return 'recent';
}

export function sortAdvisorTransactionsNewestFirst(transactions) {
  return (transactions || []).slice().sort((a, b) => {
    if (String(a.date || '') !== String(b.date || '')) {
      return String(a.date || '') < String(b.date || '') ? 1 : -1;
    }
    return String(a.id || '').localeCompare(String(b.id || '')) * -1;
  });
}

export function getAdvisorTransactionLineRows(workbook, transaction) {
  return (transaction.lines || []).map((line) => {
    const account = getAccountById(workbook, line.accountId);
    return {
      line_id: line.id || '',
      account_id: line.accountId || '',
      account_name: account ? account.name : '',
      account_group: account ? account.group : '',
      direction: line.direction || '',
      amount: advisorDecimal(line.amount || line.baseAmount || 0),
      currency: line.currency || transaction.originalCurrency || workbook.currency || 'PHP',
      base_amount: advisorDecimal(line.baseAmount || 0),
      note: line.note || ''
    };
  });
}

export function getAdvisorTransactionListRow(workbook, transaction, services = {}) {
  const category = transaction.categoryId
    ? getCategoryById(workbook, transaction.categoryId)
    : null;
  const counterparty = transaction.counterpartyId
    ? getCounterpartyById(workbook, transaction.counterpartyId)
    : null;
  const amount = getTransactionBaseAmountForPacket(transaction, services);
  const currency = transaction.originalCurrency || workbook.currency || 'PHP';
  const formatMoneyWithCurrency = getService(
    services,
    'formatMoneyWithCurrency',
    defaultFormatMoneyWithCurrency
  );
  const getTemplateLabel = services.getTemplateLabel;
  const isTransfer = String(transaction.template || '') === 'transfer';
  const transferAccountLabel = isTransfer
    ? getTransferAccountLabelForPacket(workbook, transaction)
    : '';
  return {
    transaction_id: transaction.id,
    date: transaction.date || '',
    template: transaction.template || '',
    type_label:
      typeof getTemplateLabel === 'function'
        ? getTemplateLabel(transaction.template || '')
        : String(transaction.template || 'Manual').replace(/_/g, ' '),
    description: transaction.description || 'Transaction',
    amount: advisorDecimal(amount),
    amount_display: formatMoneyWithCurrency(
      transaction.amount || amount,
      transaction.originalCurrency || currency
    ),
    base_amount: advisorDecimal(amount),
    currency,
    flow_kind: getTransactionFlowKindForPacket(workbook, transaction, services),
    category_id: transaction.categoryId || '',
    category_name: isTransfer ? 'Transfer' : category ? category.name : 'Uncategorized',
    counterparty_id: transaction.counterpartyId || '',
    counterparty_name: counterparty ? counterparty.name : '',
    account_label:
      transferAccountLabel || getTransactionAccountLabelForPacket(workbook, transaction, services),
    account_lines: getAdvisorTransactionLineRows(workbook, transaction),
    semantic_classification: classifyAdvisorTransactionSemantics(workbook, transaction),
    note: transaction.note || '',
    reference: transaction.reference || '',
    source: transaction.source || 'manual',
    source_ref: getAdvisorTransactionSourceRef(transaction),
    source_refs: [getAdvisorTransactionSourceRef(transaction)]
  };
}

export function buildAdvisorTransactionListPacket(workbook, context, options = {}, services = {}) {
  const mode = getAdvisorTransactionListMode(options.question, options.responseStyle);
  const range = {
    start: context.profile.rangeStart,
    end: context.profile.rangeEnd
  };
  const allRows = sortAdvisorTransactionsNewestFirst(
    getFilteredTransactionsForPacket(workbook, range, services)
  ).map((transaction) => getAdvisorTransactionListRow(workbook, transaction, services));
  const rows =
    mode === 'last' ? allRows.slice(0, 1) : mode === 'recent' ? allRows.slice(0, 20) : allRows;
  const omittedCount = Math.max(0, allRows.length - rows.length);
  return {
    packet_version: 'cavalry.transaction_list.v1',
    question_type: 'transaction_list',
    mode,
    selection: {
      policy:
        mode === 'last'
          ? 'latest_transaction'
          : mode === 'recent'
            ? 'recent_transaction_rows'
            : 'full_selected_range',
      source_count: allRows.length,
      included_count: rows.length,
      omitted_count: omittedCount,
      continuation_supported: omittedCount > 0,
      row_limit: mode === 'last' ? 1 : mode === 'recent' ? 20 : allRows.length,
      included_transaction_ids: rows.map((row) => row.transaction_id)
    },
    period: {
      start: context.profile.rangeStart,
      end: context.profile.rangeEnd,
      label: context.profile.rangeLabel
    },
    counts: {
      selected_period_transactions: allRows.length,
      included_transactions: rows.length,
      omitted_transactions: omittedCount
    },
    transactions: rows,
    source_refs: rows.map((row) => row.source_ref),
    limitations: [
      'Rows are limited to the currently selected Cavalry date range.',
      mode === 'full'
        ? 'All selected-period transaction rows are included.'
        : 'Ask for the full transaction list to include every selected-period row.'
    ]
  };
}
